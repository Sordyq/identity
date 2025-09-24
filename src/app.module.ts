// src/app.module.ts
import { Module } from '@nestjs/common';
import { DidModule } from './did/did.module';
import { VerificationModule } from './verification/verification.module';
import { PrismaService } from './prisma/prisma.service';
import { HashingService } from './crypto/hashing.service';

@Module({
  imports: [DidModule, VerificationModule],
  providers: [PrismaService, HashingService],
})
export class AppModule {}