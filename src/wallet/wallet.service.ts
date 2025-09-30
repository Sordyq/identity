import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountId, PrivateKey, Client, TransferTransaction, TokenId, AccountBalanceQuery } from '@hashgraph/sdk';
import { WithdrawDto } from './dto/wallet.dto';
import { Decimal } from '@prisma/client/runtime/library';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class WalletService {
    private client: Client;

    constructor(
        private readonly prisma: PrismaService,
        private readonly logger: Logger

    ) { }

    // Helper to create Hedera client (Testnet by default)
    private createHederaClient(): Client {
        // we do not set operator globally here (we will set per-user when signing)
        return Client.forTestnet();
    }

    // Use prisma.Decimal for arithmetic safety
    private toDecimal(n: number) {
        return new Decimal(n);
    }

    // Fetch balance
    async getBalance(bus_id: string, dto: { chain?: string; currency: string }) {
        // 1) Find wallet
        const chain = dto.chain ?? "HEDERA";
        const currency = dto.currency?.toUpperCase();

        if (!currency) {
            return { statusCode: "01", status: "error", message: "Currency required" };
        }

        const wallet = await this.prisma.wallets_tb.findFirst({
            where: { userid: bus_id, chain, currency },
        });

        if (!wallet) {
            return { statusCode: "01", status: "error", message: "Wallet not found for user" };
        }

        const userAccountId = wallet.address;
        if (!userAccountId) {
            return { statusCode: "01", status: "error", message: "User Hedera account not found" };
        }

        // 2) Map token symbol to tokenId
        const tokenMap: Record<string, string | undefined> = {
            USDT: process.env.USDT_TOKEN_ID_TESTNET ?? process.env.USDT_TOKEN_ID,
            USDC: process.env.USDC_TOKEN_ID_TESTNET ?? process.env.USDC_TOKEN_ID,
        };
        const tokenIdStr = tokenMap[currency];
        if (!tokenIdStr) {
            return { statusCode: "01", status: "error", message: "Unsupported currency" };
        }
        const tokenId = TokenId.fromString(tokenIdStr);

        // 3) Query Hedera for balance
        const client = this.createHederaClient();

        try {
            const balanceResult = await new AccountBalanceQuery()
                .setAccountId(AccountId.fromString(userAccountId))
                .execute(client);

            const tokenBalanceLong = balanceResult.tokens.get(tokenId) ?? 0;
            const tokenBalance = tokenBalanceLong.toString(); // Long → string

            return {
                statusCode: "00",
                status: "success",
                message: "Balance fetched",
                data: {
                    userid: bus_id,
                    chain,
                    currency,
                    accountId: userAccountId,
                    balance: tokenBalance,
                },
            };
        } catch (err) {
            return { statusCode: "01", status: "error", message: `Failed to fetch balance: ${err?.message ?? err}` };
        }
    }

    // Fetch transactions
    async getTransactions(bus_id: string) {
        const transactions = await this.prisma.transactions_tb.findMany({
            where: {  user_id: bus_id },
            orderBy: { created: 'desc' },
        });
        return {
            statusCode: "00",
            status: 'success',
            message: 'Transactions fetched successfully',
            transactions
        };
    }

    // Withdraw
    async withdraw(bus_id: string, dto: WithdrawDto) {
        // 1) Validate business/user
        const user = await this.prisma.business_tb.findFirst({
            where: { bus_id },
            select: { bus_id: true, privateKey: true, publicKey: true },
        });

        if (!user) {
            return { statusCode: "01", status: "error", message: "User not found" };
        }
        if (!user.privateKey) {
            return { statusCode: "01", status: "error", message: "No private key stored for this user" };
        }

        // 2) Get wallet row
        const chain = dto.network ?? "HEDERA";
        const currency = dto.currency?.toUpperCase();
        if (!currency) {
            return { statusCode: "01", status: "error", message: "Currency required" };
        }

        const wallet = await this.prisma.wallets_tb.findFirst({
            where: { userid: bus_id, chain, currency },
        });

        if (!wallet) {
            return { statusCode: "01", status: "error", message: "Wallet not found for user" };
        }

        // 3) Hedera account ID
        const userAccountId = wallet.address;
        if (!userAccountId) {
            return { statusCode: "01", status: "error", message: "User Hedera accountId not found" };
        }

        // 4) Token mapping
        const tokenMap: Record<string, string | undefined> = {
            USDT: process.env.USDT_TOKEN_ID_TESTNET ?? process.env.USDT_TOKEN_ID,
            USDC: process.env.USDC_TOKEN_ID_TESTNET ?? process.env.USDC_TOKEN_ID,
        };
        const tokenIdStr = tokenMap[currency];
        if (!tokenIdStr) {
            return { statusCode: "01", status: "error", message: "Unsupported currency" };
        }
        const tokenId = TokenId.fromString(tokenIdStr);

        // 5) Create Hedera client
        const client = this.createHederaClient();
        client.setOperator(AccountId.fromString(userAccountId), PrivateKey.fromString(user.privateKey));

        // 6) Check sender on-chain balance
        const balanceResult = await new AccountBalanceQuery()
            .setAccountId(AccountId.fromString(userAccountId))
            .execute(client);

        const tokenBalanceLong = balanceResult.tokens.get(tokenId) ?? 0;
        const tokenBalance = new Decimal(tokenBalanceLong.toString()); // FIXED: convert Long -> string

        const requested = new Decimal(dto.amount);

        if (tokenBalance.lt(requested)) {
            return { statusCode: "01", status: "error", message: "Insufficient on-chain balance" };
        }

        // 7) Ensure recipient has associated token
        try {
            const receiverBalanceResult = await new AccountBalanceQuery()
                .setAccountId(AccountId.fromString(dto.walletAddress))
                .execute(client);

            if (receiverBalanceResult.tokens.get(tokenId) === undefined) {
                return {
                    statusCode: "01",
                    status: "error",
                    message: "Recipient has not associated this token",
                };
            }
        } catch (err) {
            return { statusCode: "01", status: "error", message: "Recipient account not found" };
        }

        // 8) Create transaction record
        const transaction_id = uuidv4();
        await this.prisma.transactions_tb.create({
            data: {
                transaction_id,
                source_acct: userAccountId,
                destination_acct: dto.walletAddress,
                trans_type: "Withdraw",
                transaction_desc: `Withdraw ${requested.toString()} ${currency}`,
                transaction_amount: requested,
                response_code: "PENDING",
                payment_mode: "ON-CHAIN",
                posted_user: bus_id,
                created: new Date().toISOString(),
                chain,
            },
        });

        try {
            // 9) Build transfer transaction
            const transferTx = new TransferTransaction()
                .addTokenTransfer(tokenId, AccountId.fromString(userAccountId), requested.negated().toNumber())
                .addTokenTransfer(tokenId, AccountId.fromString(dto.walletAddress), requested.toNumber())
                .freezeWith(client);

            const signedTx = await transferTx.sign(PrivateKey.fromString(user.privateKey));
            const submit = await signedTx.execute(client);
            const receipt = await submit.getReceipt(client);
            const txHash = submit.transactionId?.toString();

            if (receipt.status.toString() !== "SUCCESS") {
                await this.prisma.transactions_tb.update({
                    where: { transaction_id },
                    data: { response_code: receipt.status.toString(), transaction_hash: txHash },
                });
                return {
                    statusCode: "01",
                    status: "error",
                    message: `Hedera transfer failed: ${receipt.status.toString()}`,
                };
            }

            // ✅ 10) Update success in DB
            const updates: any[] = [
                this.prisma.transactions_tb.update({
                    where: { transaction_id },
                    data: {
                        response_code: "00",
                        response_message: "Success",
                        transaction_hash: txHash,
                    },
                }),
            ];

            // If receiver is also internal user, update their balances
            const receiverWallet = await this.prisma.wallets_tb.findFirst({
                where: { address: dto.walletAddress, chain, currency },
            });

            if (receiverWallet) {
                // Fetch receiver balance after credit
                const newReceiverBalanceResult = await new AccountBalanceQuery()
                    .setAccountId(AccountId.fromString(dto.walletAddress))
                    .execute(client);

                const receiverTokenBalance = new Decimal(
                    (newReceiverBalanceResult.tokens.get(tokenId) ?? 0).toString()
                );

                updates.push(
                    this.prisma.transactions_tb.update({
                        where: { transaction_id },
                        data: {
                            receiver_initial_balance: receiverTokenBalance.minus(requested),
                            receiver_current_balance: receiverTokenBalance,
                        },
                    })
                );
            }

            await this.prisma.$transaction(updates);

            return {
                statusCode: "00",
                status: "success",
                message: "Withdrawal completed",
                transactionId: transaction_id,
                txHash,
            };
        } catch (err) {
            await this.prisma.transactions_tb.update({
                where: { transaction_id },
                data: { response_code: "ERR", response_message: String(err?.message ?? err) },
            }).catch(() => { });
            return { statusCode: "01", status: "error", message: `Withdrawal failed: ${err?.message ?? err}` };
        }
    }


}

