// src/did/did.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HashingService } from '../crypto/hashing.service';
import { CompleteOperationDto } from './dto/complete-operation.dto';
import { InitiateOperationDto } from './dto/initiate-operation.dto';
import { WalletConnectService } from '../wallet-connect/wallet-connect.service';
import { SignatureVerifier } from '../signature/signature-verifier.service';
import * as QRCode from 'qrcode';
import axios from 'axios';

@Injectable()
export class DidService {
  private readonly logger = new Logger(DidService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashingService: HashingService,
    private readonly wcService: WalletConnectService,
    private readonly signatureVerifier: SignatureVerifier,
  ) {}

  // Create a new DID from a public key
  async createDID(publicKey: string): Promise<string> {
    const didSuffix = this.hashingService.createHash(publicKey).substring(0, 16);
    const did = `did:hedera:testnet:${didSuffix}`;

    await this.prisma.userDID.create({
      data: { did, publicKey },
    });

    return did;
  }

  async getPublicKeyFromMirror(accountId: string): Promise<string> {
    try {
      const url = `https://testnet.mirrornode.hedera.com/api/v1/accounts/${accountId}`;
      const { data } = await axios.get(url);

      if (data?.key?._type === "ED25519" && data.key.key) {
        return data.key.key;
      }

      throw new Error('Invalid key data from mirror node');
    } catch (error) {
      this.logger.error(`Failed to fetch public key for ${accountId}`, error);
      throw error;
    }
  }

  async completeDIDOperation(completeOperationDto: CompleteOperationDto) {
    const { operationId, signature, signingPayload, did } = completeOperationDto;

    const operation = await this.prisma.dIDOperation.findUnique({ where: { id: operationId } });
    if (!operation) throw new NotFoundException(`Operation ${operationId} not found`);
    if (operation.status !== 'awaiting_signature') {
      throw new BadRequestException(`Operation ${operationId} is not awaiting signature`);
    }

    if (new Date() > operation.expiresAt) {
      await this.prisma.dIDOperation.update({
        where: { id: operationId },
        data: { status: 'expired' },
      });
      throw new BadRequestException(`Operation ${operationId} has expired`);
    }

    if (operation.did !== did) throw new BadRequestException('DID mismatch');
    if (operation.signingPayload !== signingPayload) {
      throw new BadRequestException('Signing payload mismatch');
    }

    const publicKey = await this.getPublicKey(did);
    if (!publicKey) throw new NotFoundException(`Public key for DID ${did} not found`);

    // Use the shared SignatureVerifier here
    const ok = await this.signatureVerifier.verifySignature(
      publicKey,
      Buffer.from(signingPayload, 'utf8').toString('base64'),
      signature,
    );

    if (!ok) {
      await this.prisma.dIDOperation.update({
        where: { id: operationId },
        data: { status: 'failed' },
      });
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

  async checkConnectionStatus(opId: string) {
    const op = await this.prisma.dIDOperation.findUnique({ where: { id: opId } });
    if (!op || !op.wcTopic) return { connected: false };

    const session = this.wcService.getSession(op.wcTopic);
    return {
      connected: !!session,
      topic: op.wcTopic,
      accounts: session?.namespaces?.hedera?.accounts || [],
      sessionData: session,
    };
  }

  async createDidForSession(operationId: string, topic: string) {
  const session = this.wcService.getSession(topic);
  if (!session) throw new BadRequestException('No active session');

  const accountId = this.wcService.extractAccountId(session);

  // Try HashPack direct first
  let publicKeyHex: string;
  try {
    publicKeyHex = await this.wcService.getPublicKey(topic, accountId);
  } catch {
    // fallback to mirror node if wallet doesn’t support hedera_getPublicKey
    publicKeyHex = await this.getPublicKeyFromMirror(accountId);
  }

  if (!publicKeyHex || publicKeyHex.length !== 64) {
    throw new BadRequestException('Invalid Ed25519 public key from wallet/mirror');
  }

  const did = `did:hedera:testnet:${accountId}`;

  await this.prisma.userDID.create({
    data: { did, publicKey: publicKeyHex, accountId },
  });

  this.logger.log(`✅ DID created for ${accountId} with key ${publicKeyHex}`);
  return did;
  }

  async verifyOperationSignature(
    did: string,
    messageBase64: string,
    signatureMap: string,
  ) {
    const record = await this.prisma.userDID.findUnique({ where: { did } });
    if (!record) throw new BadRequestException('DID not found');

    const ok = await this.signatureVerifier.verifySignature(
      record.publicKey,
      messageBase64,
      signatureMap,
    );

    if (!ok) throw new BadRequestException('Signature verification failed');
    return true;
  }

  // canonicalize same as before...
  private canonicalize(obj: any): string {
    const sortKeys = (o: any): any => {
      if (Array.isArray(o)) return o.map(sortKeys);
      if (o && typeof o === 'object') {
        return Object.keys(o)
          .sort()
          .reduce((acc, k) => {
            acc[k] = sortKeys(o[k]);
            return acc;
          }, {} as any);
      }
      return o;
    };
    return JSON.stringify(sortKeys(obj));
  }

  /**
  * Initiate a DID operation AND create a WalletConnect pairing URI.
  * Signing payload is stored as the canonical message STRING (not hex).
  */
  async initiateDIDOperation(initDto: { did: string; operationType: string; operationData: any }) {
    const { did, operationType, operationData } = initDto;
    const userDID = await this.prisma.userDID.findFirst({ where: { did } });
    if (!userDID) throw new NotFoundException(`DID ${did} not found`);

    const canonical = this.canonicalize({ did, operationType, operationData });
    const operation = await this.prisma.dIDOperation.create({
      data: {
        did,
        operationType,
        operationData,
        signingPayload: canonical,
        status: 'awaiting_signature',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    try {
      const { uri, approval } = await this.wcService.createPairing(operation.id);
      const qrCodeDataUrl = await QRCode.toDataURL(uri);

      await this.prisma.dIDOperation.update({ where: { id: operation.id }, data: { wcUri: uri } });

      // Handle approval and auto sign
      this.handleSessionApproval(operation.id, approval);

      return {
        operationId: operation.id,
        signingPayload: canonical,
        message: canonical,
        expiresAt: operation.expiresAt,
        wcUri: uri,
        wcQrCode: qrCodeDataUrl,
      };
    } catch (error) {
      this.logger.error('Failed to create WalletConnect pairing', error);
      await this.prisma.dIDOperation.update({ where: { id: operation.id }, data: { status: 'failed' } });
      throw new InternalServerErrorException('Failed to initiate WalletConnect pairing');
    }
  }

  private async handleSessionApproval(operationId: string, approval: () => Promise<any>) {
    try {
      const session = await approval();
      await this.prisma.dIDOperation.update({
        where: { id: operationId },
        data: { wcTopic: session.topic, wcExpiry: new Date(Date.now() + 60 * 60 * 1000), status: 'awaiting_signature' },
      });
      this.logger.log(`WC pairing approved for op ${operationId}, topic=${session.topic}`);

      // Auto-trigger signing request
      setTimeout(() => {
        this.pushSigningRequestByOpId(operationId).catch((err) => {
          this.logger.error(`Auto-signing failed for op ${operationId}`, err);
        });
      }, 2000);
    } catch (error) {
      this.logger.error(`WC pairing failed for op ${operationId}`, error);
      await this.prisma.dIDOperation.update({ where: { id: operationId }, data: { status: 'failed', wcTopic: null } });
    }
  }

  async pushSigningRequestByOpId(opId: string) {
    this.logger.log(`=== Starting signing request for op ${opId} ===`);
    const op = await this.prisma.dIDOperation.findUnique({ where: { id: opId } });
    if (!op) throw new NotFoundException('Operation not found');
    if (!op.wcTopic) throw new BadRequestException('No WalletConnect topic for this operation');
    if (new Date() > op.expiresAt) throw new BadRequestException('Operation expired');

    const originalMessage = op.signingPayload;
    this.logger.log(`Signing payload (db): ${String(originalMessage).substring(0, 300)}...`);

    const session = this.wcService.getSession(op.wcTopic);
    if (!session) throw new BadRequestException('No active WalletConnect session');

    const accountId = this.wcService.extractAccountId(session);
    if (!accountId) throw new BadRequestException('No accountId in session');

    await this.prisma.dIDOperation.update({ where: { id: opId }, data: { status: 'awaiting_signature' } });

    try {
      // We now send plain UTF-8 string and explicitly set encoding: 'utf8'
      const response: any = await this.wcService.requestMessageSignature(op.wcTopic, accountId, originalMessage);

      // response could be an object containing signatureMap or signature directly
      if (!response) throw new BadRequestException('Empty response from wallet');

      // Normalize possible shapes:
      // - { signatureMap: "<base64>" }
      // - "<base64SigMapString>"
      // - { signature: "<base64>" } (less likely)
      const signatureMapCandidate =
        response.signatureMap ?? response.signature ?? (typeof response === 'string' ? response : undefined);

      if (!signatureMapCandidate) {
        this.logger.error('Invalid signature response from wallet', response);
        throw new BadRequestException('Invalid signature response from wallet');
      }

      // Verify with verifier using the original plain UTF-8 message
      const storedPublicKey = await this.getPublicKey(op.did); // your method to get stored public key
      if (!storedPublicKey) throw new BadRequestException('No public key available to verify signature');

      const ok = await this.signatureVerifier.verifySignature(storedPublicKey, originalMessage, signatureMapCandidate);
      if (!ok) {
        await this.prisma.dIDOperation.update({ where: { id: opId }, data: { status: 'failed' } });
        throw new BadRequestException('Signature verification failed');
      }

      // Save signature and mark signed
      await this.prisma.dIDOperation.update({
        where: { id: opId },
        data: { signature: signatureMapCandidate, status: 'signed', signerPublicKey: storedPublicKey },
      });

      // Execute the intended operation (mocked)
      const txResult = await this.executeHederaOperation(op);

      await this.prisma.dIDOperation.update({ where: { id: opId }, data: { status: 'completed' } });

      this.logger.log(`=== Signing request completed successfully for op ${opId} ===`);
      return { success: true, opId, txResult, signature: signatureMapCandidate, publicKey: storedPublicKey };
    } catch (error) {
      this.logger.error('Signing request failed:', error);
      await this.prisma.dIDOperation.update({ where: { id: opId }, data: { status: 'failed' } });
      throw error;
    }
  }

  // Helper to retrieve stored key from DB (use existing method or implement accordingly)
  async getPublicKey(did: string): Promise<string | null> {
    const record = await this.prisma.userDID.findFirst({ where: { did }, select: { publicKey: true } });
    return record?.publicKey ?? null;
  }

  // executeHederaOperation same as you had (omitted for brevity)
  private async executeHederaOperation(operation: any) {
    switch (operation.operationType) {
      case 'create':
        return { message: 'DID created on Hedera network' };
      case 'update':
        return { message: 'DID document updated on Hedera network' };
      default:
        return { message: 'Operation executed successfully' };
    }
  }
}
