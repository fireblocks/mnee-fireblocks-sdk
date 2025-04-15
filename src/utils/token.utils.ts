/**
 * Utility functions for token amount conversions
 */

// MNEE tokens have 5 decimal places
const MNEE_DECIMALS = 5;
const MNEE_DIVISOR = Math.pow(10, MNEE_DECIMALS);

/**
 * Convert MNEE token amount from satoshis to whole tokens
 * @param satoshiAmount Amount in satoshis (smallest unit)
 * @returns Amount in whole tokens with decimal precision
 */
export function satoshisToTokens(satoshiAmount: number): number {
  return satoshiAmount / MNEE_DIVISOR;
}

/**
 * Convert MNEE token amount from whole tokens to satoshis
 * @param tokenAmount Amount in whole tokens
 * @returns Amount in satoshis (smallest unit)
 */
export function tokensToSatoshis(tokenAmount: number): number {
  // Round to ensure we get whole satoshi amounts
  return Math.round(tokenAmount * MNEE_DIVISOR);
}

/**
 * Format token amount for display
 * @param satoshiAmount Amount in satoshis
 * @returns Formatted token amount string (e.g. "0.49700 MNEE")
 */
export function formatTokenAmount(satoshiAmount: number): string {
  return `${satoshisToTokens(satoshiAmount).toFixed(MNEE_DECIMALS)} MNEE`;
}