const crypto = require('crypto');
const { PublicKey, PrivateKey } = require("@hashgraph/sdk");

// Your generated keys from Step 1
const PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
YOUR_PRIVATE_KEY_HERE
-----END PRIVATE KEY-----`;

const MESSAGE = "YOUR_CHALLENGE_FROM_STEP_2"; // The challenge to sign

async function signMessage() {
  try {
    // Convert PEM to Hedera PrivateKey
    const privateKey = PrivateKey.fromString(PRIVATE_KEY_PEM);
    
    // Sign the message
    const signature = privateKey.sign(Buffer.from(MESSAGE));
    const signatureBase64 = signature.toString('base64');
    
    console.log('=== SIGNATURE GENERATED ===');
    console.log('Message:', MESSAGE);
    console.log('Signature (Base64):', signatureBase64);
    console.log('================================');
    
    return signatureBase64;
  } catch (error) {
    console.error('Signing error:', error);
  }
}

signMessage();