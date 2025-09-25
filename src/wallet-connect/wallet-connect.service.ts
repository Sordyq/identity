import { Injectable, Logger } from '@nestjs/common';
import SignClient from '@walletconnect/sign-client';
import { SessionTypes, SignClientTypes } from '@walletconnect/types';

@Injectable()
export class WalletConnectService {
    private client: SignClient;
    private readonly logger = new Logger(WalletConnectService.name);

    async onModuleInit() {
        await this.init();
    }

    private async init() {
        this.client = await SignClient.init({
            projectId: "c574af18f76e568bc5848dbd8406275d",
            relayUrl: "wss://relay.walletconnect.org",
            metadata: {
                name: "Hedera DID Service",
                description: "DID operations over WalletConnect",
                url: "http://localhost:3000",
                icons: ["https://walletconnect.com/walletconnect-logo.png"],
            },
        });

        this.logger.log('WalletConnect SignClient initialized');

        // ✅ Correct event handling with proper types
        this.client.on("session_proposal", (proposal: SignClientTypes.EventArguments['session_proposal']) => {
            this.logger.log(`Session proposal received: ${proposal.id}`);
        });

        this.client.on("session_delete", (event: SignClientTypes.EventArguments['session_delete']) => {
            this.logger.log(`Session deleted: ${event.topic}`);
        });

        // ✅ Correct event name and type for session connection
        this.client.on("session_connect", (event: SignClientTypes.EventArguments['session_connect']) => {
            this.logger.log(`Session connected: ${event.session.topic}`);
        });

        this.client.on("session_update", (event: SignClientTypes.EventArguments['session_update']) => {
            this.logger.log(`Session updated: ${event.topic}`);
        });

        // ✅ Handle connection state changes
        this.client.on("session_event", (event: SignClientTypes.EventArguments['session_event']) => {
            this.logger.log(`Session event: ${event.topic}`);
        });

        // Pairing events like "pairing_delete" are not supported by SignClient and should be removed.
    }

    async createPairing(operationId: string) {
        if (!this.client) throw new Error('WalletConnect client not initialized');

        try {
            const { uri, approval } = await this.client.connect({
                requiredNamespaces: {
                    hedera: {
                        chains: ["hedera:testnet"],
                        methods: [
                            "hedera_signMessage",
                            "hedera_signTransaction",
                        ],
                        events: ["chainChanged", "accountsChanged"],
                    },
                },
            });

            if (!uri) {
                throw new Error('Failed to generate pairing URI');
            }

            this.logger.log(`Scan QR with wallet: ${uri}`);

            // Return URI immediately, approval can be called separately
            return {
                uri,
                approval: () => this.waitForSessionApproval(approval, operationId)
            };

        } catch (error) {
            this.logger.error('Failed to create pairing', error);
            throw error;
        }
    }

    private async waitForSessionApproval(
        approval: () => Promise<SessionTypes.Struct>,
        operationId: string
    ): Promise<SessionTypes.Struct> {
        return new Promise(async (resolve, reject) => {
            try {
                // Set timeout for approval (5 minutes)
                const timeout = setTimeout(() => {
                    reject(new Error('Session approval timeout'));
                }, 5 * 60 * 1000);

                const session = await approval();
                clearTimeout(timeout);

                this.logger.log(`WalletConnect pairing approved, topic=${session.topic}`);
                resolve(session);

            } catch (error) {
                this.logger.error('Session approval failed', error);
                reject(error);
            }
        });
    }

    async requestSignature(topic: string, message: string): Promise<string> {
        if (!this.client) {
            throw new Error('WalletConnect client not initialized');
        }

        const session = this.client.session.get(topic);
        if (!session) {
            throw new Error(`No active session for topic ${topic}`);
        }

        try {
            // Extract account ID from session
            const accountId = this.extractAccountId(session);

            const signature = await this.client.request({
                topic,
                chainId: "hedera:testnet",
                request: {
                    method: "hedera_signMessage",
                    params: {
                        message: message,
                        signerAccountId: accountId
                    },
                },
            });

            return signature as string;
        } catch (error) {
            this.logger.error('Signature request failed', error);
            throw error;
        }
    }

    // ✅ Fixed sendRequest method with proper typing
    async sendRequest(topic: string, method: string, params: any[]): Promise<any> {
        if (!this.client) throw new Error('WalletConnect client not initialized');

        const session = this.client.session.get(topic);
        if (!session) throw new Error(`No active session for topic ${topic}`);

        try {
            // Find the appropriate chainId
            let chainId = "hedera:testnet";
            const hederaNamespace = session.namespaces.hedera;
            if (hederaNamespace && hederaNamespace.chains && hederaNamespace.chains.length > 0) {
                chainId = hederaNamespace.chains[0];
            }

            const result = await this.client.request({
                topic,
                chainId,
                request: {
                    method,
                    params: params.length === 1 ? params[0] : params,
                },
            });

            return result;
        } catch (error) {
            this.logger.error(`Request failed for method ${method}`, error);
            throw error;
        }
    }

    private extractAccountId(session: SessionTypes.Struct): string {
        try {
            const hederaAccounts = session.namespaces.hedera?.accounts;
            if (hederaAccounts && hederaAccounts.length > 0) {
                // Account format: "hedera:testnet:0.0.123456"
                const accountParts = hederaAccounts[0].split(':');
                return accountParts[2] || '0.0.0';
            }
            return '0.0.0';
        } catch (error) {
            this.logger.warn('Failed to extract account ID from session', error);
            return '0.0.0';
        }
    }

    async disconnect(topic: string) {
        if (!this.client) return;

        try {
            await this.client.disconnect({
                topic,
                reason: { code: 6000, message: "User disconnected" },
            });
            this.logger.log(`Disconnected session: ${topic}`);
        } catch (error) {
            this.logger.error('Failed to disconnect session', error);
        }
    }

    // ✅ Helper method to get active sessions
    getActiveSessions(): SessionTypes.Struct[] {
        if (!this.client) return [];
        return this.client.session.getAll();
    }

    // ✅ Helper method to check if session exists
    hasActiveSession(topic: string): boolean {
        if (!this.client) return false;
        return !!this.client.session.get(topic);
    }

    // ✅ Helper to get session by topic
    getSession(topic: string): SessionTypes.Struct | undefined {
        if (!this.client) return undefined;
        return this.client.session.get(topic);
    }
}