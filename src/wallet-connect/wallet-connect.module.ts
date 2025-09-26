import { Global, Module } from '@nestjs/common';
import { WalletConnectService } from './wallet-connect.service';
import { WalletConnectController } from './wallet-connect.controller';
import { DidService } from 'src/did/did.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { HashingService } from 'src/crypto/hashing.service';
import { SignatureVerifier } from 'src/signature/signature-verifier.service';

@Global()
@Module({
  controllers: [WalletConnectController],
  providers: [WalletConnectService, DidService, PrismaService,HashingService, SignatureVerifier],
})
export class WalletConnectModule {}
