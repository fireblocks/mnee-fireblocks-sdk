
/**
 * Interface for the Fireblocks signature
 */
export interface FireblocksSignature {
  r: string;
  s: string;
  v: number;
  pubKey: string;
}

/**
 * Signature request for a specific input
 */
export interface SignatureRequest {
  prevTxid: string;
  outputIndex: number;
  inputIndex: number;
  address: string;
  bip44AddressIndex?: number; // Add this field
  script: string;
  satoshis: number;
  sigHashType: number;
}

/**
 * Interface for wallet information
 */
export interface WalletObject {
  vaultAccountId: string;
  addressToBip44Map: Map<string, number>; // Maps each address to its BIP44 derivation index
}

/**
 * Interface for transfer options
 */
export interface TransferOptions {
  grossAmount?: boolean;
  externalTxId?: string;
  note?: string;
  returnMneeTxId?: boolean;
}

/**
 * Interface for transaction hash response
 */
export interface TransactionHashResponse {
  transactionHash: string;
}

/**
 * Interface for transaction id response
 */
export interface TransactionIdResponse {
  transactionId: string;
}

/**
 * Interface for hash with input index
 */
export interface HashWithIndex {
  hash: Buffer;
  inputIndex: number;
  sigHashType: number;
  bip44AddressIndex?: number;
}
