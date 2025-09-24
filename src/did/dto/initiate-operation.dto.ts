// src/did/dto/initiate-operation.dto.ts
import { IsString, IsObject, IsIn } from 'class-validator';

export class InitiateOperationDto {
  @IsString()
  @IsIn(['create', 'update', 'add_key', 'revoke_key', 'add_service', 'revoke_service'])
  operationType: string;  // Type of DID operation
  
  @IsObject()
  operationData: Record<string, any>;  // Operation-specific data
  
  @IsString()
  did: string;  // The DID being operated on
}