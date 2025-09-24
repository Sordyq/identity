import { Module } from '@nestjs/common';
import { DidService } from './did.service';
import { DidController } from './did.controller';
import { HashingService } from 'src/crypto/hashing.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  controllers: [DidController],
  providers: [DidService, HashingService, PrismaService],
})
export class DidModule {}
