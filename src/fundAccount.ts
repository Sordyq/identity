import { Client, TokenId, TransferTransaction, PrivateKey, AccountId } from "@hashgraph/sdk";
import * as dotenv from "dotenv";

dotenv.config();

async function fundAccount() {
    const operatorId = AccountId.fromString(process.env.HEDERA_OPERATOR_ID!);
    const operatorKey = PrivateKey.fromString(process.env.HEDERA_OPERATOR_KEY!);
    const client = Client.forTestnet().setOperator(operatorId, operatorKey);

    const usdtId = TokenId.fromString(process.env.USDT_TOKEN_ID!);

    const sender = process.env.HEDERA_OPERATOR_ID!;   // treasury
    const recipient = "0.0.6925379";                  // user account

    const tx = await new TransferTransaction()
        .addTokenTransfer(usdtId, sender, -5000)        // deduct from treasury
        .addTokenTransfer(usdtId, recipient, 5000)      // credit to user
        .execute(client);

    const receipt = await tx.getReceipt(client);
    console.log("Funding transaction status:", receipt.status.toString());
}

fundAccount().catch(console.error);
