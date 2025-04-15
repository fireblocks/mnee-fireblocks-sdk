import type { FireblocksSignature } from '../../src/config/types.js';
import { jest } from '@jest/globals';


export const mockCosignerService = {
  //@ts-ignore
  getBalanceForAddress: jest.fn().mockResolvedValue(10.0),
  //@ts-ignore
  getUTXOsForAddress: jest.fn().mockResolvedValue([]),
  //@ts-ignore
  getTokenConfig: jest.fn().mockResolvedValue({}),
  //@ts-ignore
  submitTransaction: jest.fn().mockResolvedValue({ transactionHash: 'mock-tx-hash' }),
  authenticate: jest.fn(),
};

export const mockFireblocksService = {
  //@ts-ignore
  signTransaction: jest.fn().mockResolvedValue({ 
    r: 'mock-r', 
    s: 'mock-s', 
    v: 0, 
    pubKey: 'mock-pub-key' 
  } as FireblocksSignature),
  //@ts-ignore
  getNativeOrdAddressForVaultAccount: jest.fn().mockResolvedValue('mock-address'),
};

export const mockTransactionService = {
  //@ts-ignore
  buildTransaction: jest.fn().mockResolvedValue({
    rawHex: 'mock-tx-hex',
    inputScripts: []
  }),
  //@ts-ignore
  broadcastTransaction: jest.fn().mockResolvedValue('mock-tx-hash'),
};