import {
    Client,
    PrivateKey,
    TokenCreateTransaction,
    TokenType,
    TokenSupplyType,
    Hbar,
} from "@hashgraph/sdk";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
    const operatorId = process.env.HEDERA_OPERATOR_ID;
    const operatorKey = process.env.HEDERA_OPERATOR_KEY;
    if (!operatorId || !operatorKey) {
        throw new Error("Missing HEDERA_OPERATOR_ID or HEDERA_OPERATOR_KEY in .env");
    }

    const client = Client.forTestnet().setOperator(operatorId, PrivateKey.fromString(operatorKey));
    const treasuryKey = PrivateKey.fromString(operatorKey);

    // --- Create USDC Test Token ---
    const usdcTx = await new TokenCreateTransaction()
        .setTokenName("Test USD Coin")
        .setTokenSymbol("USDC")
        .setTreasuryAccountId(operatorId)
        .setInitialSupply(1_000_000) // 1 million test tokens
        .setDecimals(6)
        .setAdminKey(treasuryKey)
        .setSupplyKey(treasuryKey)
        .setTokenType(TokenType.FungibleCommon)
        .setSupplyType(TokenSupplyType.Infinite)
        .setMaxTransactionFee(new Hbar(5))
        .freezeWith(client)
        .sign(treasuryKey);

    const usdcSubmit = await usdcTx.execute(client);
    const usdcReceipt = await usdcSubmit.getReceipt(client);
    console.log("✅ Created Test USDC token:", usdcReceipt.tokenId?.toString());

    // --- Create USDT Test Token ---
    const usdtTx = await new TokenCreateTransaction()
        .setTokenName("Test Tether USD")
        .setTokenSymbol("USDT")
        .setTreasuryAccountId(operatorId)
        .setInitialSupply(1_000_000) // 1 million test tokens
        .setDecimals(6)
        .setAdminKey(treasuryKey)
        .setSupplyKey(treasuryKey)
        .setTokenType(TokenType.FungibleCommon)
        .setSupplyType(TokenSupplyType.Infinite)
        .setMaxTransactionFee(new Hbar(5))
        .freezeWith(client)
        .sign(treasuryKey);

    const usdtSubmit = await usdtTx.execute(client);
    const usdtReceipt = await usdtSubmit.getReceipt(client);
    console.log("✅ Created Test USDT token:", usdtReceipt.tokenId?.toString());
}

main().catch(console.error);
