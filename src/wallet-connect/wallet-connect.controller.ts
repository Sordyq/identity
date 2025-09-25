import { Controller } from '@nestjs/common';
import { WalletConnectService } from './wallet-connect.service';

@Controller('wallet-connect')
export class WalletConnectController {
  constructor(private readonly walletConnectService: WalletConnectService) {}
}
