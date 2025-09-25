const { PrivateKey } = require("@hashgraph/sdk");

// Your generated private key from the output
const PRIVATE_KEY_HEX = "302e020100300506032b657004220420da04ac74a4a382387a4fb817b773701bc817eeb71b7b87712107a28c3241057a";

const MESSAGE = "cmfxw8kn200020mscamc9nmga"; // Your challenge from Postman

async function signMessage() {
  try {
    console.log('=== ATTEMPTING TO SIGN ===');
    console.log('Private Key:', PRIVATE_KEY_HEX.substring(0, 20) + '...');
    console.log('Message:', MESSAGE);
    
    // Convert hex private key to Hedera PrivateKey
    const privateKey = PrivateKey.fromString(PRIVATE_KEY_HEX);
    console.log('Private key loaded successfully');
    
    // Sign the message
    const signature = privateKey.sign(Buffer.from(MESSAGE));
    
    // ✅ CORRECT: Convert to Base64 string (what your API expects)
    const signatureBase64 = Buffer.from(signature).toString('base64');
    
    // ✅ ALTERNATIVE: Convert to Hex string (also acceptable)
    const signatureHex = Buffer.from(signature).toString('hex');
    
    console.log('\n=== SIGNATURE GENERATED ===');
    console.log('Message:', MESSAGE);
    console.log('Signature (Base64):', signatureBase64);
    console.log('Signature (Hex):', signatureHex);
    console.log('Signature Length:', signature.length, 'bytes');
    console.log('================================');
    
    return { base64: signatureBase64, hex: signatureHex };
  } catch (error) {
    console.error('Signing error:', error);
  }
}

signMessage();