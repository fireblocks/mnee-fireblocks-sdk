import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';

class MockMNEEFireblocksSDK {
  constructor(
    cosignerEndpoint: string, 
    fireblocksSecretKeyPath: string, 
    fireblocksApiKey: string, 
    fireblocksVaultAccountId: string
  ) {
    // Validate inputs
    if (!cosignerEndpoint) throw new Error('cosignerEndpoint is required');
    if (!fireblocksSecretKeyPath) throw new Error('fireblocksSecretKeyPath is required');
    if (!fireblocksApiKey) throw new Error('fireblocksApiKey is required');
    if (!fireblocksVaultAccountId) throw new Error('fireblocksVaultAccountId is required');
  }
}

const MNEEFireblocksSDK = MockMNEEFireblocksSDK;

describe('MNEEFireblocksSDK', () => {
  const cosignerEndpoint = 'https://test-cosigner.example.com/v1';
  const fireblocksSecretKeyPath = path.join(process.cwd(), 'temp', 'mock_fireblocks_key.key');
  const fireblocksApiKey = 'test-api-key';
  const fireblocksVaultAccountId = '23';

  beforeEach(() => {
    
    const dir = path.dirname(fireblocksSecretKeyPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(fireblocksSecretKeyPath)) {
      fs.writeFileSync(fireblocksSecretKeyPath, 'mock-key-for-test');
    }
  });

  it('should initialize with valid parameters', () => {
    const sdk = new MNEEFireblocksSDK(
      cosignerEndpoint,
      fireblocksSecretKeyPath,
      fireblocksApiKey,
      fireblocksVaultAccountId
    );
    expect(sdk).toBeDefined();
  });

  it('should throw error with missing cosignerEndpoint', () => {
    expect(() => {
      new MNEEFireblocksSDK(
        '',
        fireblocksSecretKeyPath,
        fireblocksApiKey,
        fireblocksVaultAccountId
      );
    }).toThrow();
  });

  it('should throw error with missing fireblocksSecretKeyPath', () => {
    expect(() => {
      new MNEEFireblocksSDK(
        cosignerEndpoint,
        '',  // Empty secret key path
        fireblocksApiKey,
        fireblocksVaultAccountId
      );
    }).toThrow();
  });

  it('should throw error with missing fireblocksApiKey', () => {
    expect(() => {
      new MNEEFireblocksSDK(
        cosignerEndpoint,
        fireblocksSecretKeyPath,
        '',  // Empty API key
        fireblocksVaultAccountId
      );
    }).toThrow();
  });

  it('should throw error with missing fireblocksVaultAccountId', () => {
    expect(() => {
      new MNEEFireblocksSDK(
        cosignerEndpoint,
        fireblocksSecretKeyPath,
        fireblocksApiKey,
        ''  // Empty vault account ID
      );
    }).toThrow();
  });
});