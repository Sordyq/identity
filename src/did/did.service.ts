// // src/did/did.service.ts
// import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';
// import { PrismaService } from '../prisma/prisma.service';
// import { HashingService } from '../crypto/hashing.service';
// import { CompleteOperationDto } from './dto/complete-operation.dto';
// import { InitiateOperationDto } from './dto/initiate-operation.dto';
// import { WalletConnectService } from '../wallet-connect/wallet-connect.service';
// import nacl from 'tweetnacl';
// import base64js from 'base64-js';
// import * as QRCode from 'qrcode';

// @Injectable()
// export class DidService {
//   private readonly logger = new Logger(DidService.name);

//   constructor(
//     private readonly prisma: PrismaService,
//     private readonly hashingService: HashingService,
//     private readonly wcService: WalletConnectService,
//   ) { }

//   // Create a new DID from a public key
//   async createDID(publicKey: string): Promise<string> {
//     const didSuffix = this.hashingService.createHash(publicKey).substring(0, 16);
//     const did = `did:hedera:testnet:${didSuffix}`;

//     await this.prisma.userDID.create({
//       data: { did, publicKey },
//     });

//     return did;
//   }

//   // Retrieve public key for a given DID
//   async getPublicKey(did: string): Promise<string | null> {
//     const userDID = await this.prisma.userDID.findUnique({
//       where: { did },
//       select: { publicKey: true },
//     });

//     return userDID?.publicKey || null;
//   }

//   /**
//    * Initiate a DID operation AND create a WalletConnect pairing URI.
//    * Returns { operationId, signingPayload, message, expiresAt, wcUri }.
//    */
//   async initiateDIDOperation(initiateOperationDto: InitiateOperationDto) {
//     const { did, operationType, operationData } = initiateOperationDto;

//     // verify DID exists
//     const userDID = await this.prisma.userDID.findUnique({ where: { did } });
//     if (!userDID) {
//       throw new NotFoundException(`DID ${did} not found`);
//     }

//     // canonical payload: deterministic JSON canonicalization
//     const canonical = this.canonicalize({ did, operationType, operationData });
//     const signingPayload = this.hashingService.createHash(`${canonical}:${Date.now()}`);

//     // persist DB record
//     const operation = await this.prisma.dIDOperation.create({
//       data: {
//         did,
//         operationType,
//         operationData,
//         signingPayload,
//         status: 'awaiting_signature',
//         expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
//       },
//     });

//     try {
//       // Create WalletConnect pairing
//       const { uri, session } = await this.wcService.createPairing();

//       // Generate QR code (base64 string)
//       const qrCodeDataUrl = await QRCode.toDataURL(uri);

//       // Save wcUri so frontend can scan it
//       await this.prisma.dIDOperation.update({
//         where: { id: operation.id },
//         data: { wcUri: uri },
//       });

//       // Handle session approval in background
//       (async () => {
//         try {
//           if (session?.topic) {
//             await this.prisma.dIDOperation.update({
//               where: { id: operation.id },
//               data: {
//                 wcTopic: session.topic,
//                 wcExpiry: new Date(Date.now() + 60 * 60 * 1000), // 1h
//               },
//             });
//             this.logger.log(`WC pairing approved for op ${operation.id}, topic=${session.topic}`);
//           } else {
//             this.logger.warn(`WC pairing for op ${operation.id} had no topic`);
//           }
//         } catch (err) {
//           this.logger.warn(`WalletConnect pairing not approved for op ${operation.id}`, err);
//         }
//       })();

//       return {
//         operationId: operation.id,
//         signingPayload,
//         message: canonical,
//         expiresAt: operation.expiresAt,
//         wcUri: uri,
//         wcQrCode: qrCodeDataUrl,
//       };
//     } catch (err) {
//       this.logger.error('Failed to create WalletConnect pairing URI', err);
//       return {
//         operationId: operation.id,
//         signingPayload,
//         message: canonical,
//         expiresAt: operation.expiresAt,
//         wcUri: null,
//       };
//     }
//   }

//   // Keep your existing complete flow (client-side POST signature) intact
//   async completeDIDOperation(completeOperationDto: CompleteOperationDto) {
//     const { operationId, signature, signingPayload, did } = completeOperationDto;

//     const operation = await this.prisma.dIDOperation.findUnique({ where: { id: operationId } });
//     if (!operation) throw new NotFoundException(`Operation ${operationId} not found`);
//     if (operation.status !== 'awaiting_signature') {
//       throw new BadRequestException(`Operation ${operationId} is not awaiting signature`);
//     }

//     if (new Date() > operation.expiresAt) {
//       await this.prisma.dIDOperation.update({ where: { id: operationId }, data: { status: 'expired' } });
//       throw new BadRequestException(`Operation ${operationId} has expired`);
//     }

//     if (operation.did !== did) throw new BadRequestException('DID mismatch');
//     if (operation.signingPayload !== signingPayload) throw new BadRequestException('Signing payload mismatch');

//     const publicKey = await this.getPublicKey(did);
//     if (!publicKey) throw new NotFoundException(`Public key for DID ${did} not found`);

//     const isValid = this.verifyEd25519Signature(publicKey, signingPayload, signature);
//     if (!isValid) {
//       await this.prisma.dIDOperation.update({ where: { id: operationId }, data: { status: 'failed' } });
//       throw new BadRequestException('Invalid signature');
//     }

//     await this.prisma.dIDOperation.update({
//       where: { id: operationId },
//       data: {
//         status: 'completed',
//         signature,
//       },
//     });

//     const operationResult = await this.executeHederaOperation(operation);
//     return { success: true, operationId, result: operationResult };
//   }

//   /**
//    * Push the signing request to the wallet via WalletConnect for opId.
//    * Frontend should call this after showing QR and pairing has been approved (wcTopic present).
//    */
//   async pushSigningRequestByOpId(opId: string, method = 'did_sign') {
//     const op = await this.prisma.dIDOperation.findUnique({ where: { id: opId } });
//     if (!op) throw new NotFoundException('Operation not found');
//     if (!op.wcTopic) throw new BadRequestException('No WalletConnect topic for this operation');
//     if (new Date() > op.expiresAt) throw new BadRequestException('Operation expired');

//     // ensure expected state
//     await this.prisma.dIDOperation.update({ where: { id: opId }, data: { status: 'awaiting_signature' } });

//     // build params - send base64 signing payload or agreed payload shape
//     const params = { message: op.signingPayload, operationId: opId };

//     try {
//       // send request through WalletConnectService; service must implement sendRequest(topic, method, params)
//       const response: any = await this.wcService.sendRequest(op.wcTopic, method, [params]);

//       // expected response shape: { signature: base64, publicKey: base64 }
//       if (!response?.signature || !response?.publicKey) {
//         await this.prisma.dIDOperation.update({ where: { id: opId }, data: { status: 'failed', signature: null } });
//         throw new BadRequestException('Invalid signature response from wallet');
//       }

//       // verify signature server-side
//       const verified = this.verifyEd25519Signature(response.publicKey, op.signingPayload, response.signature);
//       if (!verified) {
//         await this.prisma.dIDOperation.update({ where: { id: opId }, data: { status: 'failed' } });
//         throw new BadRequestException('Signature verification failed');
//       }

//       // persist signature + signerPublicKey
//       await this.prisma.dIDOperation.update({
//         where: { id: opId },
//         data: { signature: response.signature, status: 'signed', signerPublicKey: response.publicKey },
//       });

//       // submit to Hedera and update status
//       await this.prisma.dIDOperation.update({ where: { id: opId }, data: { status: 'submitting' } });
//       const txResult = await this.executeHederaOperation(op);

//       await this.prisma.dIDOperation.update({ where: { id: opId }, data: { status: 'completed' } });
//       return { success: true, opId, txResult };
//     } catch (err) {
//       this.logger.error('Failed to push signing request via WalletConnect', err);
//       await this.prisma.dIDOperation.update({ where: { id: opId }, data: { status: 'failed', signature: null } });
//       throw err;
//     }
//   }

//   // verify Ed25519 signature (pub key can be base64 or hex)
//   private verifyEd25519Signature(pubKeyBase64OrHex: string, messageBase64: string, signatureBase64: string): boolean {
//     try {
//       let pubKeyBytes: Uint8Array;
//       try {
//         pubKeyBytes = base64js.toByteArray(pubKeyBase64OrHex);
//       } catch {
//         pubKeyBytes = Uint8Array.from(Buffer.from(pubKeyBase64OrHex, 'hex'));
//       }
//       const msgBytes = base64js.toByteArray(messageBase64);
//       const sigBytes = base64js.toByteArray(signatureBase64);
//       return nacl.sign.detached.verify(msgBytes, sigBytes, pubKeyBytes);
//     } catch (err) {
//       this.logger.warn('Signature verification error', err);
//       return false;
//     }
//   }

//   // Execute the actual Hedera network operation (placeholder)
//   private async executeHederaOperation(operation: any) {
//     // Replace with actual Hedera SDK submit logic
//     switch (operation.operationType) {
//       case 'create':
//         return { message: 'DID created on Hedera network' };
//       case 'update':
//         return { message: 'DID document updated on Hedera network' };
//       case 'add_key':
//         return { message: 'New verification method added to DID document' };
//       case 'revoke_key':
//         return { message: 'Verification method revoked from DID document' };
//       default:
//         return { message: 'Operation executed successfully' };
//     }
//   }

//   // existing status lookup
//   async getOperationStatus(operationId: string) {
//     const operation = await this.prisma.dIDOperation.findUnique({
//       where: { id: operationId },
//       select: {
//         id: true,
//         did: true,
//         operationType: true,
//         status: true,
//         expiresAt: true,
//         createdAt: true,
//         updatedAt: true,
//         wcUri: true,
//         wcTopic: true,
//         signerPublicKey: true,
//       },
//     });

//     if (!operation) {
//       throw new NotFoundException(`Operation ${operationId} not found`);
//     }

//     return operation;
//   }

//   // canonicalize helper used to produce deterministic signing payload
//   private canonicalize(obj: any): string {
//     const sortKeys = (o: any): any => {
//       if (Array.isArray(o)) return o.map(sortKeys);
//       if (o && typeof o === 'object') {
//         return Object.keys(o).sort().reduce((acc, k) => {
//           acc[k] = sortKeys(o[k]);
//           return acc;
//         }, {} as any);
//       }
//       return o;
//     };
//     return JSON.stringify(sortKeys(obj));
//   }
// }

// src/did/did.service.ts
import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HashingService } from '../crypto/hashing.service';
import { CompleteOperationDto } from './dto/complete-operation.dto';
import { InitiateOperationDto } from './dto/initiate-operation.dto';
import { WalletConnectService } from '../wallet-connect/wallet-connect.service';
import nacl from 'tweetnacl';
import base64js from 'base64-js';
import * as QRCode from 'qrcode';
import base58 from 'bs58';

@Injectable()
export class DidService {
  private readonly logger = new Logger(DidService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashingService: HashingService,
    private readonly wcService: WalletConnectService,
  ) { }

 // Create a new DID from either a Hedera account ID or raw public key
async createDID(input: string): Promise<string> {
  let publicKey: string;

  // If user passed account ID (e.g., 0.0.6892842), fetch from Hedera Mirror Node
  if (input.startsWith("0.0.")) {
    const mirrorNodeUrl = `https://testnet.mirrornode.hedera.com/api/v1/accounts/${input}`;
    const res = await fetch(mirrorNodeUrl);
    if (!res.ok) {
      throw new BadRequestException(`Failed to fetch account from mirror node`);
    }
    const accountData = await res.json();
    if (!accountData.key?.key) {
      throw new BadRequestException(`No public key found for account ${input}`);
    }
    publicKey = accountData.key.key;
  } else {
    // Otherwise treat it as a raw public key
    publicKey = input;
  }

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
   * Initiate a DID operation AND create a WalletConnect pairing URI (and QR).
   */
  async initiateDIDOperation(initiateOperationDto: InitiateOperationDto) {
    const { did, operationType, operationData } = initiateOperationDto;

    // verify DID exists
    const userDID = await this.prisma.userDID.findUnique({ where: { did } });
    if (!userDID) {
      throw new NotFoundException(`DID ${did} not found`);
    }

    // canonical payload: deterministic JSON canonicalization
    const canonical = this.canonicalize({ did, operationType, operationData });
    const signingPayload = this.hashingService.createHash(`${canonical}:${Date.now()}`);

    // persist DB record
    const operation = await this.prisma.dIDOperation.create({
      data: {
        did,
        operationType,
        operationData,
        signingPayload,
        status: 'awaiting_signature',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
      },
    });

    try {
      // Create WalletConnect pairing (service returns { uri, session })
      const { uri, session } = await this.wcService.createPairing();

      // Save wcUri so frontend can use it
      await this.prisma.dIDOperation.update({
        where: { id: operation.id },
        data: { wcUri: uri },
      });

      // Handle session in background if already approved
      (async () => {
        try {
          if (session?.topic) {
            await this.prisma.dIDOperation.update({
              where: { id: operation.id },
              data: {
                wcTopic: session.topic,
                wcExpiry: new Date(Date.now() + 60 * 60 * 1000), // 1h
              },
            });
            this.logger.log(`WC pairing approved for op ${operation.id}, topic=${session.topic}`);

            // Auto request signature
            await this.autoRequestSignatureAfterPairing(
              operation.id,
              session.topic,
              signingPayload,
              userDID.publicKey,
            );
          } else {
            this.logger.log(`WC pairing created for op ${operation.id} but no immediate session topic`);
          }
        } catch (err) {
          this.logger.warn(`WalletConnect pairing background handler error for op ${operation.id}`, err);
        }
      })();

      return {
        operationId: operation.id,
        signingPayload,
        message: canonical,
        expiresAt: operation.expiresAt,
        wcUri: uri, 
      };
    } catch (err) {
      this.logger.error('Failed to create WalletConnect pairing URI', err);
      return {
        operationId: operation.id,
        signingPayload,
        message: canonical,
        expiresAt: operation.expiresAt,
        wcUri: null,
      };
    }
  }

  /**
   * After pairing approval, optionally auto-send hedera_signMessage to the wallet,
   * verify the returned signature and update operation status.
   */
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
      const verified = this.verifyEd25519SignatureFlexible(
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

    const isValid = this.verifyEd25519SignatureFlexible(publicKey, signingPayload, signature);
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
  async pushSigningRequestByOpId(opId: string, method = 'hedera_signMessage') {
    const op = await this.prisma.dIDOperation.findUnique({ where: { id: opId } });
    if (!op) throw new NotFoundException('Operation not found');
    if (!op.wcTopic) throw new BadRequestException('No WalletConnect topic for this operation');
    if (new Date() > op.expiresAt) throw new BadRequestException('Operation expired');

    // ensure expected state
    await this.prisma.dIDOperation.update({ where: { id: opId }, data: { status: 'awaiting_signature' } });

    // build params - we send the payload as an array per JSON-RPC param style
    const params = [op.signingPayload];

    try {
      // send request through WalletConnectService
      const response: any = await this.wcService.sendRequest(op.wcTopic, method, params);

      // normalize response (string or object)
      let signature: string | undefined;
      let walletPubKey: string | undefined;

      if (typeof response === 'string') {
        signature = response;
      } else if (response && typeof response === 'object') {
        signature = response.signature ?? response.sig ?? undefined;
        walletPubKey = response.publicKey ?? response.pubKey ?? response.public_key ?? undefined;
      }

      if (!signature) {
        await this.prisma.dIDOperation.update({ where: { id: opId }, data: { status: 'failed', signature: null } });
        throw new BadRequestException('Invalid signature response from wallet');
      }

      // choose verification key: wallet provided publicKey else signerPublicKey from DB else DID public key
      const didPubKey = await this.getPublicKey(op.did);
      const verifierPubKey = walletPubKey ?? op.signerPublicKey ?? didPubKey;
      if (!verifierPubKey) {
        await this.prisma.dIDOperation.update({ where: { id: opId }, data: { status: 'failed' } });
        throw new InternalServerErrorException('No public key available for verification');
      }

      // verify signature server-side (message is hex)
      const verified = this.verifyEd25519SignatureFlexible(verifierPubKey, op.signingPayload, signature);
      if (!verified) {
        await this.prisma.dIDOperation.update({ where: { id: opId }, data: { status: 'failed' } });
        throw new BadRequestException('Signature verification failed');
      }

      // persist signature + signerPublicKey if available
      await this.prisma.dIDOperation.update({
        where: { id: opId },
        data: { signature, status: 'signed', signerPublicKey: walletPubKey ?? op.signerPublicKey ?? null },
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

  // Flexible Ed25519 verification helper:
  // - accepts pubKey DER hex, raw hex (64), base64, or base58/multibase (z...).
  // - accepts messageHex (hex string) or base64 (we expect your signing payload is hex)
  // - accepts signature in base64 or hex
  
  

  // Parse various public key encodings into raw 32-byte Ed25519 public key bytes
  private parsePublicKeyToRaw32(input: string): Uint8Array | null {
    try {
      if (!input) return null;
      input = input.trim();

      // 1) If multibase Base58 (starts with 'z'), decode to bytes (multibase removes 'z')
      if (input.startsWith('z')) {
        // decode base58 (multibase). Use base58-js via Buffer if available:
        // attempt using bs58 if installed
        try {
          // dynamic import to avoid forcing dependency if not installed
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const bs58 = require('bs58');
          const decoded = bs58.decode(input.slice(1)); // remove 'z'
          // last 32 bytes (for many multibase pubkeys) - but we try to detect
          if (decoded.length >= 32) {
            return decoded.slice(decoded.length - 32);
          }
        } catch (e) {
          this.logger.warn('bs58 not available to decode multibase public key');
        }
      }

      // 2) If input looks like base64
      if (/^[A-Za-z0-9+/=]+$/.test(input) && (input.length % 4 === 0)) {
        try {
          const bytes = base64js.toByteArray(input);
          if (bytes.length === 32) return bytes;
          // if DER style (longer), try to extract last 32 bytes
          if (bytes.length > 32) return bytes.slice(bytes.length - 32);
        } catch { /* continue */ }
      }

      // 3) If hex string
      if (/^[0-9a-fA-F]+$/.test(input)) {
        const buf = Buffer.from(input, 'hex');
        // common Hedera public key DER prefix length = 12 bytes (0x302a300506032b6570032100)
        // so raw 32 bytes are at the end
        if (buf.length === 32) return Uint8Array.from(buf);
        if (buf.length > 32) {
          return Uint8Array.from(buf.slice(buf.length - 32));
        }
      }

      // 4) If looks like Hedera DER pem-like string with headers (unlikely) - try extracting hex inside
      // fallback
      this.logger.warn('Public key format unrecognized for parse, returning null');
      return null;
    } catch (err) {
      this.logger.warn('parsePublicKeyToRaw32 error', err);
      return null;
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

  verifyEd25519SignatureFlexible(
    messageBase64: string,
    signatureBase64OrHex: string,
    publicKeyBase64OrHexOrMultibase58: string,
  ): boolean {
    let signatureBytes: Uint8Array;
    try {
      if (/^[0-9a-fA-F]+$/.test(signatureBase64OrHex)) {
        signatureBytes = Buffer.from(signatureBase64OrHex, 'hex');
      } else {
        signatureBytes = base64js.toByteArray(signatureBase64OrHex);
      }
    } catch {
      this.logger.error('Invalid signature encoding');
      return false;
    }

    const msgBytes = base64js.toByteArray(messageBase64);

    let publicKeyBytes: Uint8Array;
    try {
      if (/^[0-9a-fA-F]+$/.test(publicKeyBase64OrHexOrMultibase58)) {
        publicKeyBytes = Buffer.from(publicKeyBase64OrHexOrMultibase58, 'hex');
      } else if (
        publicKeyBase64OrHexOrMultibase58.startsWith('z') &&
        publicKeyBase64OrHexOrMultibase58.length === 49
      ) {
        publicKeyBytes = base58.decode(publicKeyBase64OrHexOrMultibase58.substring(1));
      } else {
        publicKeyBytes = base64js.toByteArray(publicKeyBase64OrHexOrMultibase58);
      }
    } catch {
      this.logger.error('Invalid public key encoding');
      return false;
    }

    try {
      return nacl.sign.detached.verify(msgBytes, signatureBytes, publicKeyBytes);
    } catch (err) {
      this.logger.error(`Signature verification failed: ${err.message}`);
      return false;
    }
  }
}

