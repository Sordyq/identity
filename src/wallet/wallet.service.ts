import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountId, PrivateKey, Client, TransferTransaction, TokenId } from '@hashgraph/sdk';
import { WithdrawDto } from './dto/wallet.dto';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class WalletService {
    private client: Client;

    constructor(
        private readonly prisma: PrismaService,
        private readonly logger: Logger

    ) {}

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
    async getBalance(user_id: string) {
        const wallet = await this.prisma.wallet_tb.findUnique({
            where: { user_id },
        });
        if (!wallet) {
            return {
                statusCode: "01",
                status: 'error',
                message: 'Wallet not found',
            }
        }
        return {
            statusCode: "00",
            status: 'success',
            message: 'Balance fetched successfully',
            balance: wallet.balance.toNumber(),
            currency: 'USDT', // Assuming USDT for this example
        };
    }

    // Fetch transactions
    async getTransactions(user_id: string) {
        const transactions = await this.prisma.transaction_tb.findMany({
            where: { user_id },
            orderBy: { createdAt: 'desc' },
        });
        return {
            statusCode: "00",
            status: 'success',
            message: 'Transactions fetched successfully',
            transactions
        };
    }

    // Withdraw
    async withdraw(user_id: string, dto: WithdrawDto) {
        // 1) Validate user exists and get privateKey
        const user = await this.prisma.userdata_tb.findFirst({
            where: { user_id },
            select: { user_id: true, privateKey: true, pubKey: true },
        });

        if (!user) {
            return { statusCode: "01", status: "error", message: "User not found" };
        }
        if (!user.privateKey) {
            return { statusCode: "01", status: "error", message: "No private key stored for this user" };
        }

        // 2) Fetch wallet row
        const wallet = await this.prisma.wallet_tb.findFirst({ where: { user_id } });
        if (!wallet) {
            return { statusCode: "01", status: "error", message: "Wallet not found for user" };
        }

        // 3) Check balance
        const requested = new Decimal(dto.amount);
        const currentBalance = wallet.balance as Decimal;
        if (currentBalance.lt(requested)) {
            return { statusCode: "01", status: "error", message: "Insufficient balance" };
        }

        // 4) Create pending tx record
        const txRecord = await this.prisma.transaction_tb.create({
            data: {
                user_id,
                type: "Withdraw",
                status: "Pending",
                amount: requested,
                currency: dto.currency,
                network: dto.network,
                walletAddress: dto.walletAddress,
            },
        });

        // 5) Hedera account check
        const userAccountId = wallet.accountId;
        if (!userAccountId) {
            return { statusCode: "01", status: "error", message: "User Hedera accountId not present" };
        }

        try {
            // 6) Token mapping
            const tokenMap: Record<string, string> = {
                USDT: process.env.USDT_TOKEN_ID_TESTNET ?? process.env.USDT_TOKEN_ID,
                USDC: process.env.USDC_TOKEN_ID_TESTNET ?? process.env.USDC_TOKEN_ID,
            };
            const tokenIdStr = tokenMap[dto.currency];
            if (!tokenIdStr) {
                return { statusCode: "01", status: "error", message: "Unsupported currency" };
            }
            const tokenId = TokenId.fromString(tokenIdStr);

            // 7) Create client with user operator
            const client = this.createHederaClient();
            client.setOperator(AccountId.fromString(userAccountId), PrivateKey.fromString(user.privateKey));

            // 8) Build transfer tx
            const transfer = new TransferTransaction()
                .addTokenTransfer(tokenId, AccountId.fromString(userAccountId), requested.negated().toNumber())
                .addTokenTransfer(tokenId, AccountId.fromString(dto.walletAddress), requested.toNumber())
                .freezeWith(client);

            // 9) Sign + execute
            const userKey = PrivateKey.fromString(user.privateKey);
            const signedTx = await transfer.sign(userKey);
            const submit = await signedTx.execute(client);
            const receipt = await submit.getReceipt(client);
            const txId = submit.transactionId?.toString();

            if (receipt.status.toString() !== "SUCCESS") {
                await this.prisma.transaction_tb.update({
                    where: { id: txRecord.id },
                    data: { status: "Failed", txHash: txId ?? null },
                });
                return {
                    statusCode: "01",
                    status: "error",
                    message: `Hedera transfer failed: ${receipt.status.toString()}`,
                };
            }

            // ✅ 10) Update DB: sender always, receiver only if exists in DB
            const txs: any[] = [
                this.prisma.wallet_tb.update({
                    where: { user_id },
                    data: { balance: { decrement: requested } },
                }),
                this.prisma.transaction_tb.update({
                    where: { id: txRecord.id },
                    data: { status: "Success", txHash: txId },
                }),
            ];

            const receiverWallet = await this.prisma.wallet_tb.findFirst({
                where: { accountId: dto.walletAddress },
            });
            if (receiverWallet) {
                txs.push(
                    this.prisma.wallet_tb.update({
                        where: { accountId: dto.walletAddress },
                        data: { balance: { increment: requested } },
                    })
                );
            }

            await this.prisma.$transaction(txs);

            return {
                statusCode: "00",
                status: "success",
                message: "Withdrawal completed",
                transactionId: txRecord.id,
                txHash: txId,
            };
        } catch (err) {
            this.logger.error("Withdraw failed", err);
            try {
                await this.prisma.transaction_tb.update({
                    where: { id: txRecord.id },
                    data: { status: "Failed" },
                });
            } catch (e) {
                return { statusCode: "01", status: "error", message: "Failed to update tx status" };
            }
            return { statusCode: "01", status: "error", message: `Withdrawal failed: ${err?.message ?? err}` };
        }
    }

}
