// src/verification/verification.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DidService } from '../did/did.service';
import { verifySignature } from '../crypto/signature-verification';
import { HashingService } from '../crypto/hashing.service';
import { VerifySignatureDto } from './dto/verify-signature.dto';

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly didService: DidService,
    private readonly hashingService: HashingService,
  ) {}

  async createChallenge(): Promise<{ challenge: string; expiresAt: Date }> {
    const challenge = this.hashingService.generateRandomString(32);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await this.prisma.verificationChallenge.create({
      data: {
        challenge,
        expiresAt,
      },
    });

    return { challenge, expiresAt };
  }

  async verifySignature(verifySignatureDto: VerifySignatureDto): Promise<boolean> {
    const { did, challenge, signature } = verifySignatureDto;

    // Check if challenge is valid and not expired
    const storedChallenge = await this.prisma.verificationChallenge.findFirst({
      where: {
        challenge,
        expiresAt: { gt: new Date() },
      },
    });

    if (!storedChallenge) {
      return false;
    }

    // Get the public key for the DID
    const publicKey = await this.didService.getPublicKey(did);
    if (!publicKey) {
      return false;
    }

    // Verify the signature
    const isValid = verifySignature(publicKey, challenge, signature);

    // Update the challenge with the DID if verification is successful
    if (isValid) {
      await this.prisma.verificationChallenge.update({
        where: { id: storedChallenge.id },
        data: { did },
      });
    }

    return isValid;
  }

  async cleanupExpiredChallenges() {
    await this.prisma.verificationChallenge.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });
  }
}