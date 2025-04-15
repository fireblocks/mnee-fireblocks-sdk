import { Router, Request, Response } from 'express';
import { MNEEFireblocksSDK } from '../src/MNEEFireblocksSDK.js';
import * as controllers from './controllers.js';

/**
 * Configure and return all API routes
 * @param sdk Initialized MNEEFireblocksSDK instance
 * @returns Express Router with all routes configured
 */
export function configureRoutes(sdk: MNEEFireblocksSDK): Router {
  const router = Router();
  
  // Health check endpoint
  router.get('/health', controllers.healthCheck);
  
  // Server info endpoint
  router.get('/api/info', controllers.getServerInfo);
  
  // Get vault account balance
  router.get('/api/balance/vault/:vaultAccountId', (req: Request, res: Response) => {
    controllers.getVaultAccountBalance(req, res, sdk);
  });
  
  // Get address balance
  router.get('/api/balance/address/:address', (req: Request, res: Response) => {
    controllers.getAddressBalance(req, res, sdk);
  });
  
  // Get vault account addresses
  router.get('/api/address/vault/:vaultAccountId', (req: Request, res: Response) => {
    controllers.getVaultAddresses(req, res, sdk);
  });
  
  // Transfer tokens
  router.post('/api/transfer', (req: Request, res: Response) => {
    controllers.transferTokens(req, res, sdk);
  });
  
  // Get UTXOs for address
  router.get('/api/utxos/:address', (req: Request, res: Response) => {
    controllers.getAddressUtxos(req, res, sdk);
  });
    
  return router;
}