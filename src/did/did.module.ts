import { Module } from '@nestjs/common';
import { DidService } from './did.service';
import { DidController } from './did.controller';
import { HashingService } from 'src/crypto/hashing.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { WalletConnectService } from 'src/wallet-connect/wallet-connect.service';
import { SignatureVerifier } from 'src/signature/signature-verifier.service';

@Module({
  controllers: [DidController],
  providers: [DidService, HashingService, PrismaService, WalletConnectService, SignatureVerifier],
})
export class DidModule {}
