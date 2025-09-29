import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WithdrawDto } from './dto/wallet.dto';

@Controller('wallet')

export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  // GET /wallet/balance
  @Get('balance')
  async getBalance() {
    const user_id = "qwerty";
    return this.walletService.getBalance(user_id);
  }

  // GET /wallet/transactions
  @Get('transactions')
  async getTransactions() {
    const user_id = "qwerty";
    return this.walletService.getTransactions(user_id);
  }

  // POST /wallet/withdraw
  @Post('withdraw')
  async withdraw(
    @Body() dto: WithdrawDto,
  ) {
    const user_id = "qwerty";
    return this.walletService.withdraw(user_id, dto);
  }
}
