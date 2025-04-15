import { CreateTransactionResponse, Fireblocks, StatusStatusEnum, TransactionResponse } from "@fireblocks/ts-sdk";

/**
 * Interface representing a UTXO (Unspent Transaction Output)
 */
export interface UTXO {
  data: {
    bsv21: {
      amt: number;
      dec: number;
      icon: string;
      id: string;
      op: string;
      sym: string;
    };
    cosign: {
      address: string;
      cosigner: string;
    };
  };
  height: number;
  idx: number;
  outpoint: string;
  owners: [address: string];
  satoshis: number;
  score: number;
  script: string;
  txid: string;
  vout: number;
}

/**
 * Interface representing MNEE configuration
 */
export interface MNEEConfig {
  approver: string;
  burnAddress: string;
  decimals: number;
  feeAddress: string;
  fees: Array<{
    fee: number;
    max: number;
    min: number;
  }>;
  mintAddress: string;
  tokenId: string;
}

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
  bip44AddressIndex?: number;  // Add this field
  script: string;
  satoshis: number;
  sigHashType: number;
}

/**
 * Interface for wallet information
 */
export interface WalletObject {
  ordAddress: string;
  vaultAccountId: string;
  bip44AddressIndex?: number;
}

/**
 * Interface for transfer options
 */
export interface TransferOptions {
  grossAmount?: boolean;
}

/**
 * Interface for transaction hash response
 */
export interface TransactionHashResponse {
  transactionHash: string;
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

/**
 * Interface for submitted transaction response
 */
export interface TransactionForAddress {
  txId: string;
  outs: number[];
  height: number;
  idx: number;
  score: number;
  rawtx: string;
  senders: string[];
  receivers: string[];
}
