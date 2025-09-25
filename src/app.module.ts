// src/app.module.ts
import { Module } from '@nestjs/common';
import { DidModule } from './did/did.module';
import { VerificationModule } from './verification/verification.module';
import { PrismaService } from './prisma/prisma.service';
import { HashingService } from './crypto/hashing.service';
import { WalletConnectModule } from './wallet-connect/wallet-connect.module';
import { WalletConnectService } from './wallet-connect/wallet-connect.service';

@Module({
  imports: [DidModule, VerificationModule, WalletConnectModule],
  providers: [PrismaService, HashingService, WalletConnectService],
  exports:[WalletConnectService]
})
export class AppModule {}