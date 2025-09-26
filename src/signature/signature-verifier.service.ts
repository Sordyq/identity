// src/signature/signature-verifier.service.ts
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ed25519 } from '@noble/curves/ed25519';
import { proto } from '@hashgraph/proto';

@Injectable()
export class SignatureVerifier {
  private readonly logger = new Logger(SignatureVerifier.name);

  // Build Hedera prefixed message: "\x19Hedera Signed Message:\n" + length + original
  private buildHederaPrefixedMessage(original: Buffer): Buffer {
    const prefix = Buffer.from('\x19Hedera Signed Message:\n', 'utf8');
    const length = Buffer.from(String(original.length), 'utf8'); // decimal ascii
    return Buffer.concat([prefix, length, original]);
  }

  /**
   * Accepts:
   *  - publicKeyHex: hex string of ed25519 public key (64 chars)
   *  - message: the original message as string (utf8)
   *  - signatureMapInput: either a base64-encoded SignatureMap, or already-parsed object
   *
   * Returns true if signature verifies, otherwise throws BadRequestException.
   */
  async verifySignature(
    publicKeyHex: string,
    message: string,
    signatureMapInput: string | Uint8Array | any,
  ): Promise<boolean> {
    try {
      // 1) Prepare public key
      if (!publicKeyHex || publicKeyHex.length !== 64) {
        throw new BadRequestException('Invalid public key length');
      }
      const storedPubKey = Buffer.from(publicKeyHex, 'hex');

      // 2) Normalize/parse signatureMap
      let sigMapObj: any;
      if (!signatureMapInput) {
        throw new BadRequestException('No signature map provided');
      }

      if (typeof signatureMapInput === 'string') {
        // Could be base64 of SignatureMap OR JSON string of SignatureMap object.
        // Try base64 decode -> proto decode. If fails, try JSON.parse.
        try {
          const buf = Buffer.from(signatureMapInput, 'base64');
          sigMapObj = proto.SignatureMap.decode(buf);
        } catch (eBase64) {
          try {
            sigMapObj = JSON.parse(signatureMapInput);
          } catch (eJson) {
            throw new BadRequestException('Invalid signatureMap string (neither base64-proto nor JSON)');
          }
        }
      } else if (signatureMapInput instanceof Uint8Array || Buffer.isBuffer(signatureMapInput)) {
        // raw bytes of SignatureMap
        sigMapObj = proto.SignatureMap.decode(signatureMapInput);
      } else {
        // assume already-parsed object (e.g. sigMap)
        sigMapObj = signatureMapInput;
      }

      if (!sigMapObj || !sigMapObj.sigPair || sigMapObj.sigPair.length === 0) {
        throw new BadRequestException('SignatureMap has no sigPair entries');
      }

      // Use first signature pair (HashPack normally returns 1)
      const sigPair = sigMapObj.sigPair[0];

      // ed25519 signature bytes
      const signatureBytes: Uint8Array = sigPair.ed25519 ?? sigPair.ed25519Signature ?? sigPair.signature ?? null;
      const pubKeyPrefix: Uint8Array = sigPair.pubKeyPrefix ?? new Uint8Array();

      if (!signatureBytes || signatureBytes.length === 0) {
        throw new BadRequestException('No ed25519 signature found in sigPair');
      }

      // Validate pubKeyPrefix matches stored public key prefix
      if (pubKeyPrefix && pubKeyPrefix.length > 0) {
        const storedPrefix = storedPubKey.subarray(0, pubKeyPrefix.length);
        if (!Buffer.from(storedPrefix).equals(Buffer.from(pubKeyPrefix))) {
          throw new BadRequestException('Public key prefix mismatch between stored key and signatureMap');
        }
      }

      // prepare candidate message bytes
      const rawMessage = Buffer.from(message, 'utf8');
      const prefixedMessage = this.buildHederaPrefixedMessage(rawMessage);
      const base64MessageBytes = Buffer.from(rawMessage.toString('base64'), 'utf8'); // if wallet signed base64 ascii

      this.logger.log('=== Signature Verification Debug ===');
      this.logger.log(`Original message (utf8, len=${rawMessage.length}): ${rawMessage.toString('utf8').slice(0, 200)}`);
      this.logger.log(`Stored public key (hex): ${storedPubKey.toString('hex')}`);
      this.logger.log(`Signature (hex, first64): ${Buffer.from(signatureBytes).toString('hex').slice(0,64)}...`);
      this.logger.log(`PubKey prefix (hex): ${Buffer.from(pubKeyPrefix || []).toString('hex')}`);

      const signatureUint8 = new Uint8Array(signatureBytes);

      // Try 1: raw message first (HashPack common)
      try {
        if (ed25519.verify(signatureUint8, rawMessage, new Uint8Array(storedPubKey))) {
          this.logger.log('✅ Signature verified with raw UTF-8 message (HashPack style)');
          return true;
        }
      } catch (e) {
        this.logger.debug('Raw message verification threw: ' + (e?.message ?? e));
      }

      // Try 2: Hedera-prefixed message
      try {
        if (ed25519.verify(signatureUint8, prefixedMessage, new Uint8Array(storedPubKey))) {
          this.logger.log('✅ Signature verified with Hedera prefixed message');
          return true;
        }
      } catch (e) {
        this.logger.debug('Prefixed message verification threw: ' + (e?.message ?? e));
      }

      // Try 3: Wallet might have signed the base64-string representation
      try {
        if (ed25519.verify(signatureUint8, base64MessageBytes, new Uint8Array(storedPubKey))) {
          this.logger.log('✅ Signature verified with base64-string of message');
          return true;
        }
      } catch (e) {
        this.logger.debug('Base64-as-string verification threw: ' + (e?.message ?? e));
      }

      this.logger.error('❌ Signature verification failed for all attempts');
      throw new BadRequestException('Signature verification failed');
    } catch (err) {
      // If it's already a BadRequestException rethrow, otherwise wrap
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(`Signature verification failed: ${String(err?.message ?? err)}`);
    }
  }
}
