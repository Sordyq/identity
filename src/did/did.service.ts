// src/did/did.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HashingService } from '../crypto/hashing.service';
import { verifySignature } from '../crypto/signature-verification';
import { CompleteOperationDto } from './dto/complete-operation.dto';
import { InitiateOperationDto } from './dto/initiate-operation.dto';

@Injectable()
export class DidService {
  constructor(
    private readonly prisma: PrismaService,      // Inject database service
    private readonly hashingService: HashingService, // Inject hashing service
  ) {}

  // Create a new DID from a public key
  async createDID(publicKey: string): Promise<string> {
    // Generate unique DID suffix from public key hash
    const didSuffix = this.hashingService.createHash(publicKey).substring(0, 16);
    const did = `did:hedera:testnet:${didSuffix}`;  // Full DID string

    // Store DID and public key in database
    await this.prisma.userDID.create({
      data: { did, publicKey },
    });

    return did;  // Return the created DID
  }

  // Retrieve public key for a given DID
  async getPublicKey(did: string): Promise<string | null> {
    const userDID = await this.prisma.userDID.findUnique({
      where: { did },
      select: { publicKey: true },
    });

    return userDID?.publicKey || null;  // Return public key or null if not found
  }

  // Initiate a DID operation that requires user signature
  async initiateDIDOperation(initiateOperationDto: InitiateOperationDto) {
    const { did, operationType, operationData } = initiateOperationDto;

    // Verify the DID exists in database
    const userDID = await this.prisma.userDID.findUnique({ where: { did } });
    if (!userDID) {
      throw new NotFoundException(`DID ${did} not found`);
    }

    // Create unique signing payload from operation details
    const signingPayload = this.hashingService.createHash(
      `${did}:${operationType}:${JSON.stringify(operationData)}:${Date.now()}`
    );

    // Store operation in database with 'awaiting_signature' status
    const operation = await this.prisma.dIDOperation.create({
      data: {
        did,
        operationType,
        operationData,
        signingPayload,
        status: 'awaiting_signature',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minute expiration
      },
    });

    return {
      operationId: operation.id,
      signingPayload,
      message: `Please sign to authorize ${operationType} operation for DID ${did}`,
      expiresAt: operation.expiresAt,
    };
  }

  // Complete a DID operation after signature verification
  async completeDIDOperation(completeOperationDto: CompleteOperationDto) {
    const { operationId, signature, signingPayload, did } = completeOperationDto;

    // Retrieve operation from database
    const operation = await this.prisma.dIDOperation.findUnique({
      where: { id: operationId },
    });

    if (!operation) {
      throw new NotFoundException(`Operation ${operationId} not found`);
    }

    // Validate operation state
    if (operation.status !== 'awaiting_signature') {
      throw new BadRequestException(`Operation ${operationId} is not awaiting signature`);
    }

    if (new Date() > operation.expiresAt) {
      await this.prisma.dIDOperation.update({
        where: { id: operationId },
        data: { status: 'expired' },
      });
      throw new BadRequestException(`Operation ${operationId} has expired`);
    }

    if (operation.did !== did) {
      throw new BadRequestException('DID mismatch');
    }

    if (operation.signingPayload !== signingPayload) {
      throw new BadRequestException('Signing payload mismatch');
    }

    // Get public key for signature verification
    const publicKey = await this.getPublicKey(did);
    if (!publicKey) {
      throw new NotFoundException(`Public key for DID ${did} not found`);
    }

    // Verify the cryptographic signature
    const isValid = verifySignature(publicKey, signingPayload, signature);
    if (!isValid) {
      await this.prisma.dIDOperation.update({
        where: { id: operationId },
        data: { status: 'failed' },
      });
      throw new BadRequestException('Invalid signature');
    }

    // Update operation status to completed
    await this.prisma.dIDOperation.update({
      where: { id: operationId },
      data: { 
        status: 'completed',
        signature,
      },
    });

    // Execute the actual Hedera network operation
    const operationResult = await this.executeHederaOperation(operation);

    return {
      success: true,
      operationId,
      result: operationResult,
    };
  }

  // Execute the actual Hedera network operation (placeholder implementation)
  private async executeHederaOperation(operation: any) {
    // This would contain actual Hedera SDK calls
    // For now, return mock responses based on operation type
    
    switch (operation.operationType) {
      case 'create':
        return { message: 'DID created on Hedera network' };
      case 'update':
        return { message: 'DID document updated on Hedera network' };
      case 'add_key':
        return { message: 'New verification method added to DID document' };
      case 'revoke_key':
        return { message: 'Verification method revoked from DID document' };
      default:
        return { message: 'Operation executed successfully' };
    }
  }

  // Check status of an operation
  async getOperationStatus(operationId: string) {
    const operation = await this.prisma.dIDOperation.findUnique({
      where: { id: operationId },
      select: {
        id: true,
        did: true,
        operationType: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!operation) {
      throw new NotFoundException(`Operation ${operationId} not found`);
    }

    return operation;
  }
}