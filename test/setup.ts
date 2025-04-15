import dotenv from 'dotenv';
import { Logger, LogLevel } from '../src/utils/logger.js';
import fs from 'fs';
import path from 'path';
import { afterAll } from '@jest/globals';

// Load environment variables from .env
dotenv.config();

// Set logger to minimal level for tests unless overridden
Logger.setLogLevel(process.env.TEST_LOG_LEVEL ? 
  (LogLevel[process.env.TEST_LOG_LEVEL as keyof typeof LogLevel] || LogLevel.ERROR) : 
  LogLevel.ERROR);

// Create a temp directory for tests if it doesn't exist
const tempDir = path.join(process.cwd(), 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

// Mock environment variables if not set
process.env.MNEE_COSIGNER_URL = process.env.MNEE_COSIGNER_URL || 'https://test-cosigner.example.com/v1';
process.env.FIREBLOCKS_SECRET_KEY_PATH = process.env.FIREBLOCKS_SECRET_KEY_PATH || path.join(tempDir, 'mock_fireblocks_key.key');
process.env.FIREBLOCKS_API_KEY = process.env.FIREBLOCKS_API_KEY || 'test-api-key';
process.env.MNEE_COSIGNER_AUTH_TOKEN = process.env.MNEE_COSIGNER_AUTH_TOKEN || 'test-auth-token';
process.env.FIREBLOCKS_VAULT_ACCOUNT = process.env.FIREBLOCKS_VAULT_ACCOUNT || '23';

// Create a mock Fireblocks secret key file if it doesn't exist
if (!fs.existsSync(process.env.FIREBLOCKS_SECRET_KEY_PATH)) {
  fs.writeFileSync(process.env.FIREBLOCKS_SECRET_KEY_PATH, 'mock-fireblocks-secret-key-for-testing');
}

// Use Jest's afterAll for cleanup
afterAll(() => {
  if (fs.existsSync(tempDir) && process.env.KEEP_TEST_FILES !== 'true') {
    fs.rmSync(tempDir, { recursive: true });
  }
});