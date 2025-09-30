import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
  Param,
  Query,
} from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WithdrawDto } from './dto/wallet.dto';

@Controller('wallet')

export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  // GET /wallet/balance
  @Get(":bus_id/balance")
  async getBalance(
    @Param("bus_id") bus_id: string,
    @Query("chain") chain?: string,
    @Query("currency") currency?: string
  ) {
    return this.walletService.getBalance(bus_id, { chain, currency });
  }

  // GET /wallet/transactions
  @Get('transactions')
  async getTransactions() {
    const user_id = "user_86669960";
    return this.walletService.getTransactions(user_id);
  }

  // POST /wallet/withdraw
  @Post('withdraw')
  async withdraw(
    @Body() dto: WithdrawDto,
  ) {
    const user_id = "user_86669960";
    return this.walletService.withdraw(user_id, dto);
  }
}

