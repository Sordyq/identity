// // // src/did/did.service.ts
import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HashingService } from '../crypto/hashing.service';
import { CompleteOperationDto } from './dto/complete-operation.dto';
import { InitiateOperationDto } from './dto/initiate-operation.dto';
import { WalletConnectService } from '../wallet-connect/wallet-connect.service';
import nacl from 'tweetnacl';
import base64js from 'base64-js';
import * as QRCode from 'qrcode';

@Injectable()
export class DidService {
  private readonly logger = new Logger(DidService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashingService: HashingService,
    private readonly wcService: WalletConnectService,
  ) { }

  // Create a new DID from a public key
  async createDID(publicKey: string): Promise<string> {
    const didSuffix = this.hashingService.createHash(publicKey).substring(0, 16);
    const did = `did:hedera:testnet:${didSuffix}`;

    await this.prisma.userDID.create({
      data: { did, publicKey },
    });

    return did;
  }

  // Retrieve public key for a given DID
  async getPublicKey(did: string): Promise<string | null> {
    const userDID = await this.prisma.userDID.findUnique({
      where: { did },
      select: { publicKey: true },
    });

    return userDID?.publicKey || null;
  }

  /**
   * Initiate a DID operation AND create a WalletConnect pairing URI.
   * Returns { operationId, signingPayload, message, expiresAt, wcUri }.
   */

  async initiateDIDOperation(initiateOperationDto: InitiateOperationDto) {
    const { did, operationType, operationData } = initiateOperationDto;

    // Verify DID exists
    const userDID = await this.prisma.userDID.findUnique({ where: { did } });
    if (!userDID) {
      throw new NotFoundException(`DID ${did} not found`);
    }

    // Create signing payload
    const canonical = this.canonicalize({ did, operationType, operationData });
    const signingPayload = this.hashingService.createHash(`${canonical}:${Date.now()}`);

    // Persist operation
    const operation = await this.prisma.dIDOperation.create({
      data: {
        did,
        operationType,
        operationData,
        signingPayload,
        status: 'awaiting_signature',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    try {
      // ✅ FIXED: Create pairing but don't wait for approval
      const { uri, approval } = await this.wcService.createPairing(operation.id);

      // Generate QR code
      const qrCodeDataUrl = await QRCode.toDataURL(uri);

      // Save WC URI immediately
      await this.prisma.dIDOperation.update({
        where: { id: operation.id },
        data: { wcUri: uri },
      });

      // ✅ FIXED: Handle approval in background with proper error handling
      this.handleSessionApproval(operation.id, approval);

      return {
        operationId: operation.id,
        signingPayload,
        message: canonical,
        expiresAt: operation.expiresAt,
        wcUri: uri,
        wcQrCode: qrCodeDataUrl,
      };
    } catch (error) {
      this.logger.error('Failed to create WalletConnect pairing', error);

      // Update operation status to reflect failure
      await this.prisma.dIDOperation.update({
        where: { id: operation.id },
        data: { status: 'failed' },
      });

      throw new InternalServerErrorException('Failed to initiate WalletConnect pairing');
    }
  }

  // ✅ Add proper session approval handler
  private async handleSessionApproval(operationId: string, approval: () => Promise<any>) {
    try {
      const session = await approval();

      await this.prisma.dIDOperation.update({
        where: { id: operationId },
        data: {
          wcTopic: session.topic,
          wcExpiry: new Date(Date.now() + 60 * 60 * 1000),
          status: 'awaiting_signature', // Ensure correct status
        },
      });

      this.logger.log(`WC pairing approved for op ${operationId}, topic=${session.topic}`);
    } catch (error) {
      this.logger.error(`WC pairing failed for op ${operationId}`, error);

      await this.prisma.dIDOperation.update({
        where: { id: operationId },
        data: {
          status: 'failed',
          wcTopic: null
        },
      });
    }
  }

  // Keep your existing complete flow (client-side POST signature) intact
  async completeDIDOperation(completeOperationDto: CompleteOperationDto) {
    const { operationId, signature, signingPayload, did } = completeOperationDto;

    const operation = await this.prisma.dIDOperation.findUnique({ where: { id: operationId } });
    if (!operation) throw new NotFoundException(`Operation ${operationId} not found`);
    if (operation.status !== 'awaiting_signature') {
      throw new BadRequestException(`Operation ${operationId} is not awaiting signature`);
    }

    if (new Date() > operation.expiresAt) {
      await this.prisma.dIDOperation.update({ where: { id: operationId }, data: { status: 'expired' } });
      throw new BadRequestException(`Operation ${operationId} has expired`);
    }

    if (operation.did !== did) throw new BadRequestException('DID mismatch');
    if (operation.signingPayload !== signingPayload) throw new BadRequestException('Signing payload mismatch');

    const publicKey = await this.getPublicKey(did);
    if (!publicKey) throw new NotFoundException(`Public key for DID ${did} not found`);

    const isValid = this.verifyEd25519Signature(publicKey, signingPayload, signature);
    if (!isValid) {
      await this.prisma.dIDOperation.update({ where: { id: operationId }, data: { status: 'failed' } });
      throw new BadRequestException('Invalid signature');
    }

    await this.prisma.dIDOperation.update({
      where: { id: operationId },
      data: {
        status: 'completed',
        signature,
      },
    });

    const operationResult = await this.executeHederaOperation(operation);
    return { success: true, operationId, result: operationResult };
  }

  /**
   * Push the signing request to the wallet via WalletConnect for opId.
   * Frontend should call this after showing QR and pairing has been approved (wcTopic present).
   */
  async pushSigningRequestByOpId(opId: string, method = 'did_sign') {
    const op = await this.prisma.dIDOperation.findUnique({ where: { id: opId } });
    if (!op) throw new NotFoundException('Operation not found');
    if (!op.wcTopic) throw new BadRequestException('No WalletConnect topic for this operation');
    if (new Date() > op.expiresAt) throw new BadRequestException('Operation expired');

    // ensure expected state
    await this.prisma.dIDOperation.update({ where: { id: opId }, data: { status: 'awaiting_signature' } });

    // build params - send base64 signing payload or agreed payload shape
    const params = { message: op.signingPayload, operationId: opId };

    try {
      // send request through WalletConnectService; service must implement sendRequest(topic, method, params)
      const response: any = await this.wcService.sendRequest(op.wcTopic, method, [params]);

      // expected response shape: { signature: base64, publicKey: base64 }
      if (!response?.signature || !response?.publicKey) {
        await this.prisma.dIDOperation.update({ where: { id: opId }, data: { status: 'failed', signature: null } });
        throw new BadRequestException('Invalid signature response from wallet');
      }

      // verify signature server-side
      const verified = this.verifyEd25519Signature(response.publicKey, op.signingPayload, response.signature);
      if (!verified) {
        await this.prisma.dIDOperation.update({ where: { id: opId }, data: { status: 'failed' } });
        throw new BadRequestException('Signature verification failed');
      }

      // persist signature + signerPublicKey
      await this.prisma.dIDOperation.update({
        where: { id: opId },
        data: { signature: response.signature, status: 'signed', signerPublicKey: response.publicKey },
      });

      // submit to Hedera and update status
      await this.prisma.dIDOperation.update({ where: { id: opId }, data: { status: 'submitting' } });
      const txResult = await this.executeHederaOperation(op);

      await this.prisma.dIDOperation.update({ where: { id: opId }, data: { status: 'completed' } });
      return { success: true, opId, txResult };
    } catch (err) {
      this.logger.error('Failed to push signing request via WalletConnect', err);
      await this.prisma.dIDOperation.update({ where: { id: opId }, data: { status: 'failed', signature: null } });
      throw err;
    }
  }

  // verify Ed25519 signature (pub key can be base64 or hex)
  private verifyEd25519Signature(pubKeyBase64OrHex: string, messageBase64: string, signatureBase64: string): boolean {
    try {
      let pubKeyBytes: Uint8Array;
      try {
        pubKeyBytes = base64js.toByteArray(pubKeyBase64OrHex);
      } catch {
        pubKeyBytes = Uint8Array.from(Buffer.from(pubKeyBase64OrHex, 'hex'));
      }
      const msgBytes = base64js.toByteArray(messageBase64);
      const sigBytes = base64js.toByteArray(signatureBase64);
      return nacl.sign.detached.verify(msgBytes, sigBytes, pubKeyBytes);
    } catch (err) {
      this.logger.warn('Signature verification error', err);
      return false;
    }
  }

  // Execute the actual Hedera network operation (placeholder)
  private async executeHederaOperation(operation: any) {
    // Replace with actual Hedera SDK submit logic
    switch (operation.operationType) {
      case 'create':
        return { message: 'DID created on Hedera network' };
      case 'update':
        return { message: 'DID document updated on Hedera network' };
      case 'add_key':
        return { message: 'New verification method added to DID document' };
      case 'revoke_key':
        return { message: 'Verification method revoked from DID document' };
      default:
        return { message: 'Operation executed successfully' };
    }
  }

  // existing status lookup
  async getOperationStatus(operationId: string) {
    const operation = await this.prisma.dIDOperation.findUnique({
      where: { id: operationId },
      select: {
        id: true,
        did: true,
        operationType: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
        wcUri: true,
        wcTopic: true,
        signerPublicKey: true,
      },
    });

    if (!operation) {
      throw new NotFoundException(`Operation ${operationId} not found`);
    }

    return operation;
  }

  // canonicalize helper used to produce deterministic signing payload
  private canonicalize(obj: any): string {
    const sortKeys = (o: any): any => {
      if (Array.isArray(o)) return o.map(sortKeys);
      if (o && typeof o === 'object') {
        return Object.keys(o).sort().reduce((acc, k) => {
          acc[k] = sortKeys(o[k]);
          return acc;
        }, {} as any);
      }
      return o;
    };
    return JSON.stringify(sortKeys(obj));
  }

  private async autoRequestSignatureAfterPairing(
      operationId: string,
      topic: string,
      signingPayloadHex: string,
      storedPubKey?: string
    ) {
      try {
        this.logger.log(`Auto-requesting signature for op ${operationId} on topic ${topic}`);

        // convert hex → base64 (what wallets expect)
        const signingPayloadBase64 = Buffer.from(signingPayloadHex, 'hex').toString('base64');

        // send hedera_signMessage with explicit encoding
        const params = [{ message: signingPayloadBase64, encoding: 'base64' }];
        const response: any = await this.wcService.sendRequest(
          topic,
          'hedera_signMessage',
          params,
        );

        this.logger.debug(`Wallet response: ${JSON.stringify(response)}`);

        // handle different response shapes
        let signature: string | undefined;
        let walletPubKey: string | undefined;

        if (typeof response === 'string') {
          signature = response;
        } else if (response && typeof response === 'object') {
          signature = response.signature ?? response.sig ?? undefined;
          walletPubKey = response.publicKey ?? response.pubKey ?? response.public_key ?? undefined;
        }

        if (!signature) {
          this.logger.warn(`No signature returned by wallet for op ${operationId}`);
          await this.prisma.dIDOperation.update({
            where: { id: operationId },
            data: { status: 'failed' },
          });
          return;
        }

        const verifierPubKey = walletPubKey ?? storedPubKey;
        if (!verifierPubKey) {
          this.logger.warn(`No public key available to verify signature for op ${operationId}`);
          await this.prisma.dIDOperation.update({
            where: { id: operationId },
            data: { status: 'failed' },
          });
          return;
        }

        // verify signature: message = base64 payload
        const verified = this.verifyEd25519Signature(
          signingPayloadBase64,
          signature,
          verifierPubKey,
        );

        if (!verified) {
          this.logger.warn(`Signature verification failed for op ${operationId}`);
          await this.prisma.dIDOperation.update({
            where: { id: operationId },
            data: { status: 'failed' },
          });
          return;
        }

        // persist results
        await this.prisma.dIDOperation.update({
          where: { id: operationId },
          data: {
            signature,
            signerPublicKey: walletPubKey ?? null,
            status: 'completed',
          },
        });

        this.logger.log(`Auto signature flow completed for op ${operationId}`);
      } catch (err) {
        this.logger.error(`autoRequestSignatureAfterPairing failed for op ${operationId}`, err);
        try {
          await this.prisma.dIDOperation.update({
            where: { id: operationId },
            data: { status: 'failed' },
          });
        } catch (e) { /* ignore */ }
      }
  }
}
