// src/did/dto/create-did.dto.ts
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class CreateDidDto {
  // @IsString()  // Must be a string
  // @Matches(/^302a300506032b6570032100[a-fA-F0-9]{64}$/, {  // ED25519 public key format
  //   message: 'Invalid public key format. Expected ED25519 public key.'
  // })
  // publicKey: string;  // The user's public key
  @IsString()
  @IsNotEmpty()
  publicKey: string;
}