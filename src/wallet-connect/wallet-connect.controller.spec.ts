import { Test, TestingModule } from '@nestjs/testing';
import { WalletConnectController } from './wallet-connect.controller';
import { WalletConnectService } from './wallet-connect.service';

describe('WalletConnectController', () => {
  let controller: WalletConnectController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WalletConnectController],
      providers: [WalletConnectService],
    }).compile();

    controller = module.get<WalletConnectController>(WalletConnectController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
