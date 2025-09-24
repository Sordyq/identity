// src/crypto/signature-verification.ts
import { PublicKey } from "@hashgraph/sdk";  // Hedera SDK for crypto

export function verifySignature(publicKeyStr: string, message: string, signature: string): boolean {
  try {
    const publicKey = PublicKey.fromString(publicKeyStr); // Parse public key string
    const messageBuffer = Buffer.from(message);           // Convert message to buffer
    const signatureBuffer = Buffer.from(signature, 'base64'); // Decode base64 signature
    
    // Verify signature using public key cryptography
    return publicKey.verify(messageBuffer, signatureBuffer);
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;  // Return false on any error
  }
}