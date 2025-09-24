// src/did/dto/complete-operation.dto.ts
import { IsString, IsNotEmpty } from 'class-validator';

export class CompleteOperationDto {
  @IsString()
  @IsNotEmpty()
  operationId: string;  // Operation identifier from initiation

  @IsString()
  @IsNotEmpty()
  signature: string;    // User's cryptographic signature

  @IsString()
  @IsNotEmpty()
  signingPayload: string; // Original data that was signed

  @IsString()
  @IsNotEmpty()
  did: string;  // User's DID
}