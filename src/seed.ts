import { PrismaClient } from '@prisma/client';
import {
    Client,
    PrivateKey,
    AccountCreateTransaction,
    TokenAssociateTransaction,
    Hbar,
} from '@hashgraph/sdk';
import { randomUUID } from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config();
const prisma = new PrismaClient();

async function main() {
    // 1. Setup Hedera operator client
    const operatorId = process.env.HEDERA_OPERATOR_ID;
    const operatorKey = process.env.HEDERA_OPERATOR_KEY;
    if (!operatorId || !operatorKey) {
        throw new Error('Missing HEDERA_OPERATOR_ID or HEDERA_OPERATOR_KEY in .env');
    }

    const client = Client.forTestnet().setOperator(operatorId, PrivateKey.fromString(operatorKey));

    // 2. Generate keypair for new user
    const userPrivateKey = PrivateKey.generateED25519();
    const userPublicKey = userPrivateKey.publicKey;

    console.log('Generated user keypair:');
    console.log('PrivateKey:', userPrivateKey.toString());
    console.log('PublicKey:', userPublicKey.toString());

    // 3. Create Hedera testnet account
    const tx = await new AccountCreateTransaction()
        .setKey(userPublicKey)
        .setInitialBalance(new Hbar(10)) // give 10 HBAR for gas fees
        .execute(client);

    const receipt = await tx.getReceipt(client);
    const newAccountId = receipt.accountId?.toString();

    if (!newAccountId) throw new Error('Account creation failed, no accountId returned');

    console.log('New Hedera account created:', newAccountId);

    // 4. Associate USDT & USDC tokens
    const usdtTokenId = process.env.USDT_TOKEN_ID;
    const usdcTokenId = process.env.USDC_TOKEN_ID;

    if (!usdtTokenId || !usdcTokenId) {
        throw new Error('Missing USDT_TOKEN_ID or USDC_TOKEN_ID in .env');
    }

    const associateTx = await new TokenAssociateTransaction()
        .setAccountId(newAccountId)
        .setTokenIds([usdtTokenId, usdcTokenId])
        .freezeWith(client)
        .sign(userPrivateKey);

    const assocSubmit = await associateTx.execute(client);
    const assocReceipt = await assocSubmit.getReceipt(client);
    console.log('Token association status:', assocReceipt.status.toString());

    // 5. Create dummy user + wallet in DB
    const userId = 'user_' + randomUUID().slice(0, 8);
    const walletId = 'wallet_' + randomUUID().slice(0, 8);

    const user = await prisma.business_tb.create({
        data: {
            bus_id: userId,
            business_email: `${userId}@test.com`,
            publicKey: userPublicKey.toString(),
            privateKey: userPrivateKey.toString(),
        },
    });

    const wallet = await prisma.wallets_tb.create({
        data: {
            userid: userId,
            currency: 'USDT',
            address: newAccountId,
            chain: 'HEDERA',
            publickey: walletId,
        },
    });

    console.log('✅ Seeded user and wallet:');
    console.log(user);
    console.log(wallet);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
