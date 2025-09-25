import { Module } from '@nestjs/common';
import { VerificationService } from './verification.service';
import { VerificationController } from './verification.controller';
import { DidService } from 'src/did/did.service';
import { HashingService } from 'src/crypto/hashing.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { WalletConnectService } from 'src/wallet-connect/wallet-connect.service';

@Module({
  controllers: [VerificationController],
  providers: [VerificationService, DidService, PrismaService, HashingService, WalletConnectService],
})
export class VerificationModule {}
