import { Injectable, Logger } from '@nestjs/common';
import SignClient from '@walletconnect/sign-client';
import { SessionTypes } from '@walletconnect/types';

@Injectable()
export class WalletConnectService {
    private client: SignClient;
    private activeSession?: SessionTypes.Struct;
    private readonly logger = new Logger(WalletConnectService.name);

    async onModuleInit() {
        await this.init();
    }

    private async init() {
        this.client = await SignClient.init({
            projectId: "fa9081baccf50d3976876018d3f83e06", // your WC projectId
            relayUrl: "wss://relay.walletconnect.org",
            metadata: {
                name: "Hedera DID Service",
                description: "DID operations over WalletConnect",
                url: "https://7t66jx57-3000.uks1.devtunnels.ms/",
                icons: ["https://your-backend.com/logo.png"],
            },
        });

        this.logger.log('WalletConnect SignClient initialized');
    }

    async createPairing() {
        if (!this.client) throw new Error('WalletConnect client not initialized');

        const { uri, approval } = await this.client.connect({
            requiredNamespaces: {
                hedera: {
                    chains: ["hedera:296"], // ✅ correct format for Hedera testnet
                    methods: [
                        "hedera_getAccount",
                        "hedera_signMessage",
                        "hedera_signTransaction",
                    ],
                    events: [],
                },
            },
        });

        if (uri) {
            this.logger.log(`Scan QR with wallet: ${uri}`);
        }

        const session = await approval(); // waits for wallet approval
        this.activeSession = session;
        this.logger.log(`WalletConnect pairing approved, topic=${session.topic}`);
        this.logger.debug(`Session namespaces: ${JSON.stringify(session.namespaces, null, 2)}`);

        return { uri, session };
    }

    async requestSignature(transactionBytes: string): Promise<string> {
        if (!this.activeSession) {
            throw new Error("No active WalletConnect session");
        }

        return await this.client.request({
            topic: this.activeSession.topic,
            chainId: "hedera:296", // ✅ always use correct chain format
            request: {
                method: "hedera_signMessage", // ✅ pick one, not an array
                params: [transactionBytes],   // should be base64 if signing raw payload
            },
        }) as string;
    }

    async sendRequest(topic: string, method: string, params: any[]): Promise<any> {
        if (!this.client) throw new Error('WalletConnect client not initialized');

        const session = this.client.session.get(topic);
        if (!session) throw new Error(`No active session for topic ${topic}`);

        // find namespace that supports the method
        let ns: any;
        for (const entry of Object.values(session.namespaces)) {
            if (entry.methods?.includes(method)) {
                ns = entry;
                break;
            }
        }
        if (!ns) {
            throw new Error(`Method ${method} not supported by session (topic ${topic})`);
        }

        // ✅ just pick hedera:296 instead of hedera:testnet
        const chainId = ns.chains?.find((c: string) => c === "hedera:296") || ns.chains?.[0];

        return await this.client.request({
            topic,
            chainId,
            request: { method, params },
        });
    }

    async disconnect() {
        if (!this.activeSession) return;

        await this.client.disconnect({
            topic: this.activeSession.topic,
            reason: { code: 6000, message: "User disconnected" },
        });

        this.logger.log(`Disconnected session: ${this.activeSession.topic}`);
        this.activeSession = undefined;
    }
}
