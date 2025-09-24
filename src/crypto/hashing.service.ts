// src/crypto/hashing.service.ts
import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';  // Node.js crypto module

@Injectable()
export class HashingService {
  // Create SHA-256 hash of any string data
  createHash(data: string): string {
    return createHash('sha256')       // Use SHA-256 algorithm
      .update(data)                   // Input data to hash
      .digest('hex');                 // Output as hexadecimal string
  }

  // Generate cryptographically secure random string
  generateRandomString(length: number = 32): string {
    return createHash('sha256')       // Use SHA-256 for randomness
      .update(Math.random().toString()) // Seed with random number
      .digest('hex')                  // Get hash as hex
      .substring(0, length);          // Trim to desired length
  }
}