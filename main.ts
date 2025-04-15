import express from 'express';
import cors from 'cors';
import { MNEEFireblocksSDK } from './src/MNEEFireblocksSDK.js';
import { Logger, LogLevel } from './src/utils/logger.js';
import { configureRoutes } from './server/routes.js';
import 'dotenv/config';

const logLevel = process.env.MNEE_LOG_LEVEL || 'INFO';
Logger.setLogLevel(LogLevel[logLevel as keyof typeof LogLevel] || LogLevel.INFO);
const logger = new Logger('Express-Server');

let sdk: MNEEFireblocksSDK;
try {
  sdk = new MNEEFireblocksSDK(
    process.env.MNEE_COSIGNER_URL!,
    process.env.FIREBLOCKS_SECRET_KEY_PATH!,
    process.env.FIREBLOCKS_API_KEY!
  );
  logger.info('SDK initialized successfully');
} catch (error) {
  logger.error('Failed to initialize SDK:', error);
  process.exit(1);
}


const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);


app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Apply routes
app.use(configureRoutes(sdk));

// Start server
app.listen(PORT, () => {
  logger.info(`MNEE-BSV API server running on port ${PORT}`);
});

// Handle process termination
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down');
  process.exit(0);
});