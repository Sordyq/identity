// src/verification/dto/verify-signature.dto.ts
import { IsString, IsNotEmpty } from 'class-validator';

export class VerifySignatureDto {
  @IsString()
  @IsNotEmpty()
  did: string;

  @IsString()
  @IsNotEmpty()
  challenge: string;

  @IsString()
  @IsNotEmpty()
  signature: string;
}