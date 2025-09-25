import { Module } from '@nestjs/common';
import { DidService } from './did.service';
import { DidController } from './did.controller';
import { HashingService } from 'src/crypto/hashing.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { WalletConnectService } from 'src/wallet-connect/wallet-connect.service';

@Module({
  controllers: [DidController],
  providers: [DidService, HashingService, PrismaService, WalletConnectService],
})
export class DidModule {}
