// src/wallet-connect/wallet-connect.service.ts
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
      projectId: 'c574af18f76e568bc5848dbd8406275d',
      relayUrl: 'wss://relay.walletconnect.org',
      metadata: {
        name: 'Hedera DID Service',
        description: 'DID operations over WalletConnect',
        url: 'http://localhost:3000',
        icons: ['https://walletconnect.com/walletconnect-logo.png'],
      },
    });

    this.logger.log('WalletConnect SignClient initialized');

    // Basic logging handlers
    this.client.on('session_proposal', (p) => this.logger.log(`Session proposal received: ${p.id}`));
    this.client.on('session_connect', (ev) => this.logger.log(`Session connected: ${ev.session.topic}`));
    this.client.on('session_update', (ev) => this.logger.log(`Session updated: ${ev.topic}`));
    this.client.on('session_event', (ev) => this.logger.log(`Session event: ${ev.topic}`));
    this.client.on('session_delete', (ev) => this.logger.log(`Session deleted: ${ev.topic}`));
  }

  async createPairing(operationId: string) {
    if (!this.client) throw new Error('WalletConnect client not initialized');

    try {
      const { uri, approval } = await this.client.connect({
        requiredNamespaces: {
          hedera: {
            chains: ['hedera:testnet'],
            methods: [
              'hedera_signMessage',
              'hedera_signTransaction',
              'hedera_signAndExecuteQuery',
              'hedera_signAndExecuteTransaction',
            ],
            events: ['chainChanged', 'accountsChanged'],
          },
        },
      });

      if (!uri) throw new Error('Failed to generate pairing URI');
      this.logger.log(`Scan QR with wallet: ${uri}`);
      return { uri, approval: () => this.waitForSessionApproval(approval, operationId) };
    } catch (error) {
      this.logger.error('Failed to create pairing', error);
      throw error;
    }
  }

  private async waitForSessionApproval(
    approval: () => Promise<SessionTypes.Struct>,
    operationId: string,
  ): Promise<SessionTypes.Struct> {
    return new Promise(async (resolve, reject) => {
      try {
        const timeout = setTimeout(() => reject(new Error('Session approval timeout')), 5 * 60 * 1000);
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

  // Generic sendRequest (typed)
  async sendRequest(topic: string, method: string, params: any[]): Promise<any> {
    this.logger.log('=== WalletConnect Send Request ===');
    this.logger.log(`Topic: ${topic}`);
    this.logger.log(`Method: ${method}`);
    this.logger.log(`Params: ${JSON.stringify(params).slice(0, 1000)}...`);

    if (!this.client) throw new Error('WalletConnect client not initialized');
    const session = this.client.session.get(topic);
    if (!session) throw new Error(`No active session for topic ${topic}`);

    let chainId = 'hedera:testnet';
    try {
      const hederaNs = session.namespaces.hedera;
      if (hederaNs && hederaNs.chains && hederaNs.chains.length > 0) chainId = hederaNs.chains[0];
    } catch {
      // ignore
    }

    try {
      const result = await this.client.request({
        topic,
        chainId,
        request: {
          method,
          params: params.length === 1 ? params[0] : params,
        },
      });
      this.logger.log(`WalletConnect request successful: ${JSON.stringify(result).slice(0, 1000)}...`);
      return result;
    } catch (error) {
      this.logger.error(`WalletConnect request failed for method ${method}`, error);
      throw error;
    }
  }

  // Request a signature for a plain UTF-8 message (we send message as utf8 string)
  async requestMessageSignature(topic: string, accountId: string, message: string) {
    // message should be a plain UTF-8 string (not base64)
    return this.sendRequest(topic, 'hedera_signMessage', [
      {
        signerAccountId: accountId,
        message,
        encoding: 'utf8', // inform wallet we've sent utf8 string
      },
    ]);
  }

  async getPublicKey(topic: string, accountId: string): Promise<string> {
    if (!this.client) throw new Error('WalletConnect client not initialized');

    const session = this.client.session.get(topic);
    if (!session) throw new Error(`No active session for topic ${topic}`);

    try {
      const result = await this.client.request({
        topic,
        chainId: 'hedera:testnet',
        request: {
          method: 'hedera_getPublicKey',
          params: [{ accountId }],
        },
      });

      if (!result || typeof result !== 'string') {
        throw new Error('Invalid public key response from wallet');
      }
      this.logger.log(`✅ Received full public key: ${result}`);
      return result;
    } catch (error) {
      this.logger.error('Failed to fetch public key from wallet', error);
      throw error;
    }
  }

  // small helpers
  getSession(topic: string): SessionTypes.Struct | undefined {
    if (!this.client) return undefined;
    return this.client.session.get(topic);
  }

  extractAccountId(session: SessionTypes.Struct): string {
    try {
      const hederaAccounts = session.namespaces.hedera?.accounts;
      if (hederaAccounts && hederaAccounts.length > 0) {
        const accountParts = hederaAccounts[0].split(':');
        return accountParts[2] || '0.0.0';
      }
      return '0.0.0';
    } catch (err) {
      this.logger.warn('Failed to extract account ID from session', err);
      return '0.0.0';
    }
  }
}
