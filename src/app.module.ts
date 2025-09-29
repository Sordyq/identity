// src/app.module.ts
import { Module } from '@nestjs/common';
import { DidModule } from './did/did.module';
import { PrismaService } from './prisma/prisma.service';
import { HashingService } from './crypto/hashing.service';
import { WalletConnectModule } from './wallet-connect/wallet-connect.module';
import { WalletConnectService } from './wallet-connect/wallet-connect.service';
import { SignatureVerifier } from './signature/signature-verifier.service';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [DidModule, WalletConnectModule, WalletModule],
  providers: [PrismaService, HashingService, WalletConnectService, SignatureVerifier],
  exports:[WalletConnectService, SignatureVerifier]
})
export class AppModule {}