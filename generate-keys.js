const { PrivateKey } = require("@hashgraph/sdk");

async function generateKeys() {
  try {
    // Generate Ed25519 private key using Hedera SDK - CORRECT METHOD
    const privateKey = PrivateKey.generate(); // This generates Ed25519 by default
    const publicKey = privateKey.publicKey;
    
    console.log('=== HEDERA ED25519 TEST KEYS ===');
    console.log('Private Key (Hex):', privateKey.toString());
    console.log('Public Key (Hedera Format):', publicKey.toString());
    console.log('================================');
    
    // Also show the keys in different formats for testing
    console.log('\n=== FORMATS FOR TESTING ===');
    console.log('1. Public Key for DID creation:', publicKey.toString());
    console.log('2. Private Key for signing:', privateKey.toString());
    console.log('3. Public Key Raw (64 chars):', publicKey.toStringRaw());
    console.log('4. Private Key Raw:', privateKey.toStringRaw());
    
    return { privateKey, publicKey };
  } catch (error) {
    console.error('Error generating keys:', error);
  }
}

generateKeys();