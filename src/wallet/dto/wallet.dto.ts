import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class WithdrawDto {
  @IsNotEmpty()
  @IsString()
  currency: string;

  @IsNotEmpty()
  @IsString()
  network: string;

  @IsNotEmpty()
  @IsString()
  walletAddress: string;

  @IsNumber()
  @Min(0.00000001)
  amount: number;
}
