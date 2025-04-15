import { Request, Response } from 'express';
import { MNEEFireblocksSDK } from '../src/MNEEFireblocksSDK.js';
import { Logger } from '../src/utils/logger.js';

// Initialize logger for the controllers
const logger = new Logger('API-Controllers');

/**
 * Controller for health check endpoint
 */
export function healthCheck(req: Request, res: Response) {
  res.status(200).json({ status: 'ok' });
}

/**
 * Controller to get API server info
 */
export function getServerInfo(req: Request, res: Response) {
  res.status(200).json({
    name: 'MNEE-BSV API',
    version: '1.0.0',
    cosignerUrl: process.env.MNEE_COSIGNER_URL?.replace(/\/v\d+$/, '') || 'Not configured',
    defaultVaultAccount: process.env.FIREBLOCKS_VAULT_ACCOUNT || 'Not provided'
  });
}

/**
 * Controller to get vault account balance
 */
export async function getVaultAccountBalance(req: Request, res: Response, sdk: MNEEFireblocksSDK) {
  try {
    const vaultAccountId = req.params.vaultAccountId;
    logger.info(`Getting balance for vault account ${vaultAccountId}`);
    
    const balance = await sdk.getBalanceForVaultAccount(vaultAccountId);
    
    res.status(200).json({
      vaultAccountId,
      balance,
      unit: 'MNEE'
    });
  } catch (error: any) {
    logger.error('Error getting vault balance:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Controller to get address balance
 */
export async function getAddressBalance(req: Request, res: Response, sdk: MNEEFireblocksSDK) {
  try {
    const address = req.params.address;
    const balance = await sdk.getAddressBalance(address);
    
    res.status(200).json({
      address,
      balance,
      unit: 'MNEE'
    });
  } catch (error: any) {
    logger.error('Error getting address balance:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Controller to get vault account addresses
 */
export async function getVaultAddresses(req: Request, res: Response, sdk: MNEEFireblocksSDK) {
  try {
    const vaultAccountId = req.params.vaultAccountId;
    const addresses = await sdk.fireblocksService.getVaultAddressesWithIndexes(vaultAccountId);
    
    res.status(200).json({
      vaultAccountId,
      addresses
    });
  } catch (error: any) {
    logger.error('Error getting vault address:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Controller to transfer tokens
 */
export async function transferTokens(req: Request, res: Response, sdk: MNEEFireblocksSDK) {
  try {
    const { sourceVaultAccountId, recipientAddress, amount } = req.body;
    
    if (!sourceVaultAccountId) {
      return res.status(400).json({ error: 'sourceVaultAccountId is required' });
    }
    
    if (!recipientAddress) {
      return res.status(400).json({ error: 'recipientAddress is required' });
    }
    
    // Check balance before transfer
    const balanceBefore = await sdk.getBalanceForVaultAccount(sourceVaultAccountId);
    
    if (amount !== undefined && balanceBefore < Number(amount)) {
      return res.status(400).json({ 
        error: 'Insufficient balance',
        requested: Number(amount),
        available: balanceBefore
      });
    }
    
    // Execute the transfer
    const result = await sdk.transferTokensFromVault(
      sourceVaultAccountId,
      recipientAddress,
      amount !== undefined ? Number(amount) : undefined,
      { grossAmount: amount === undefined }
    );
    
    // Get final balance
    const balanceAfter = await sdk.getBalanceForVaultAccount(sourceVaultAccountId);
    
    res.status(200).json({
      transactionHash: result.transactionHash,
      sourceVaultAccountId,
      recipientAddress,
      amountTransferred: balanceBefore - balanceAfter,
      remainingBalance: balanceAfter,
      unit: 'MNEE',
      explorerUrl: `https://whatsonchain.com/tx/${result.transactionHash}`
    });
    
  } catch (error: any) {
    logger.error('Error transferring tokens:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Controller to get UTXOs for an address
 */
export async function getAddressUtxos(req: Request, res: Response, sdk: MNEEFireblocksSDK) {
  try {
    const address = req.params.address;
    const utxos = await sdk.cosignerService.fetchUtxos([address]);
    
    res.status(200).json({
      address,
      utxos
    });
  } catch (error: any) {
    logger.error('Error getting UTXOs:', error);
    res.status(500).json({ error: error.message });
  }
}