// src/verification/verification.controller.ts
import { Controller, Post, Body } from '@nestjs/common';
import { VerificationService } from './verification.service';
import { VerifySignatureDto } from './dto/verify-signature.dto';

@Controller('verification')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @Post('challenge')
  async createChallenge() {
    const { challenge, expiresAt } = await this.verificationService.createChallenge();
    return { challenge, expiresAt };
  }

  @Post('verify')
  async verifySignature(@Body() verifySignatureDto: VerifySignatureDto) {
    const isValid = await this.verificationService.verifySignature(verifySignatureDto);
    return { verified: isValid };
  }
}