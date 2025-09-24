// src/did/did.controller.ts
import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { DidService } from './did.service';
import { CreateDidDto } from './dto/create-did.dto';
import { InitiateOperationDto } from './dto/initiate-operation.dto';
import { CompleteOperationDto } from './dto/complete-operation.dto';

@Controller('did')
export class DidController {
  constructor(private readonly didService: DidService) {}

  @Post('create')
  async createDID(@Body() createDidDto: CreateDidDto) {
    const did = await this.didService.createDID(createDidDto.publicKey);
    return { did };
  }

  @Post('initiate-operation')
  async initiateOperation(@Body() initiateOperationDto: InitiateOperationDto) {
    return await this.didService.initiateDIDOperation(initiateOperationDto);
  }

  @Post('complete-operation')
  async completeOperation(@Body() completeOperationDto: CompleteOperationDto) {
    return await this.didService.completeDIDOperation(completeOperationDto);
  }

  @Get('operation-status/:operationId')
  async getOperationStatus(@Param('operationId') operationId: string) {
    return await this.didService.getOperationStatus(operationId);
  }

  @Get('public-key/:did')
  async getPublicKey(@Param('did') did: string) {
    const publicKey = await this.didService.getPublicKey(did);
    return { did, publicKey };
  }
}