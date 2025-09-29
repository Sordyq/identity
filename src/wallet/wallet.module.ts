import { Logger, Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  controllers: [WalletController],
  providers: [WalletService, PrismaService, Logger],
})
export class WalletModule {}
