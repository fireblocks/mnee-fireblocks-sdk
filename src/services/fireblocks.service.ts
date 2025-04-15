import { createHash } from "crypto";
import {
  Fireblocks,
  TransactionOperation,
  TransferPeerPathType,
} from "@fireblocks/ts-sdk";
import {
  waitForSignature,
} from "../utils/fireblocks.utils.js";

import {
  FireblocksSignature,
  HashWithIndex,
} from "../config/types.js"
import { doubleHash } from "../utils/crypto.utils.js";
import { Logger } from "../utils/logger.js";

/**
 * Service for interacting with Fireblocks API
 */
export class FireblocksService {
  private client: Fireblocks;
  private logger: Logger;

  /**
   * Initialize the Fireblocks service
   * @param client Fireblocks client instance
   */
  constructor(client: Fireblocks) {
    this.logger = new Logger('FireblocksService');
    this.client = client;
    this.logger.debug('Initialized FireblocksService');
  }

  /**
   * Sign multiple hashes using Fireblocks API in a single call
   * @param sigHashesWithIndex Array of hash buffers with their input indices and BIP44 address indexes
   * @param amount Amount in MNEE tokens to include in the transaction note
   * @param destination Destination address
   * @param vaultAccountId Vault account ID to sign with
   * @returns Promise resolving to array of signatures matched to input indices
   */
  async signMultipleHashes(
    sigHashesWithIndex: Array<HashWithIndex & { bip44AddressIndex?: number }>,
    amount: number,
    destination: string,
    vaultAccountId: string
  ): Promise<Array<{ inputIndex: number; signature: FireblocksSignature }>> {
    if (!vaultAccountId) {
      throw new Error("Vault account ID is required for signing");
    }

    try {
      // Format transaction note with proper token amount display
      const formattedNote = `Sending ${amount.toFixed(5)} MNEE tokens to ${destination}`;
      this.logger.info(`Transaction note: "${formattedNote}"`);

      // Prepare an array of messages for the Fireblocks API
      const messages = sigHashesWithIndex.map(({ hash, inputIndex, bip44AddressIndex = 0 }) => {
        // Apply a second hash to match the local signing behavior
        const doubleHashValue = doubleHash(hash);
        const doubleHashHex = doubleHashValue.toString("hex");

        this.logger.debug(
          `[Input ${inputIndex}] Original hash: ${hash.toString("hex")}`
        );
        this.logger.debug(
          `[Input ${inputIndex}] Double hash for Fireblocks: ${doubleHashHex}`
        );
        this.logger.debug(
          `[Input ${inputIndex}] Using BIP44 address index: ${bip44AddressIndex}`
        );

        return {
          content: doubleHashHex,
          bip44addressIndex: bip44AddressIndex,  // Use the provided bip44AddressIndex
          bip44change: 0,
        };
      });

      this.logger.info(
        `Sending ${messages.length} hashes to Fireblocks for signing in a single request`
      );

      // Send all hashes for signing in a single request
      const txResult = await this.client.transactions.createTransaction({
        transactionRequest: {
          operation: TransactionOperation.Raw,
          assetId: "BSV",
          source: {
            type: TransferPeerPathType.VaultAccount,
            id: vaultAccountId,
          },
          note: formattedNote,
          extraParameters: {
            rawMessageData: {
              messages: messages,
            },
          },
        },
      });

      const sigResponse = await waitForSignature(txResult.data, this.client);

      if (
        !sigResponse?.signedMessages ||
        sigResponse.signedMessages.length === 0
      ) {
        throw new Error("No signed messages returned from Fireblocks");
      }

      this.logger.info(
        `Received ${sigResponse.signedMessages.length} signatures from Fireblocks`
      );

      // Match signatures to their corresponding input indices
      const signaturesWithIndices = sigHashesWithIndex.map(
        ({ hash, inputIndex }) => {
          const doubleHashValue = doubleHash(hash);
          const doubleHashHex = doubleHashValue.toString("hex");

          // Find the matching signature in the response
          const matchingSignature = sigResponse.signedMessages.find(
            (signedMsg) => signedMsg.content === doubleHashHex
          );

          if (!matchingSignature) {
            throw new Error(
              `Could not find matching signature for input ${inputIndex}`
            );
          }

          return {
            inputIndex,
            signature: {
              r: matchingSignature.signature.r,
              s: matchingSignature.signature.s,
              v: matchingSignature.signature.v,
              pubKey: matchingSignature.publicKey,
            },
          };
        }
      );

      return signaturesWithIndices;
    } catch (error) {
      this.logger.error("Error signing multiple hashes with Fireblocks:", error);
      throw error;
    }
  }

  /**
   * Get all BSV addresses for the vault account with their BIP44 address indexes
   * @param vaultAccountId Vault account ID
   * @returns Promise resolving to array of address objects with address and bip44AddressIndex
   */
  async getVaultAddressesWithIndexes(vaultAccountId: string): Promise<Array<{ address: string; bip44AddressIndex: number; }>> {
    if (!vaultAccountId) {
      throw new Error("Vault account ID is required");
    }
    
    try {
      const allAddressesWithIndexes: Array<{ address: string; bip44AddressIndex: number }> = [];
      let hasMore = true;
      let cursor: string | undefined = undefined;
      
      this.logger.info(`Fetching BSV addresses for vault account ${vaultAccountId}`);
      
      // Continue fetching pages until we've retrieved all addresses
      while (hasMore) {
        const response = await this.client.vaults.getVaultAccountAssetAddressesPaginated({
          vaultAccountId: vaultAccountId,
          assetId: "BSV",
          after: cursor
        });
        
        // Process the addresses in this page
        if (response.data && response.data.addresses && response.data.addresses.length > 0) {
          // Extract the address and bip44AddressIndex from each address object
          const pageAddressesWithIndexes = response.data.addresses.map(addr => ({
            address: addr.address,
            bip44AddressIndex: addr.bip44AddressIndex || 0  // Default to 0 if not provided
          }));
          
          allAddressesWithIndexes.push(...pageAddressesWithIndexes);
          
          this.logger.debug(`Retrieved ${pageAddressesWithIndexes.length} BSV addresses for vault account`);
        }
        
        // Check if there are more pages
        if (response.data?.paging?.after) {
          cursor = response.data.paging.after;
          this.logger.debug('More addresses available, fetching next page...');
        } else {
          hasMore = false;
        }
      }
      
      this.logger.info(`Total BSV addresses retrieved: ${allAddressesWithIndexes.length}`);
      return allAddressesWithIndexes;
    } catch (error) {
      this.logger.error("Error fetching vault addresses with indexes:", error);
      throw error;
    }
  }

  /**
   * Get all BSV addresses for the vault account (just the address strings)
   * @param vaultAccountId Vault account ID
   * @returns Promise resolving to array of BSV addresses
   */
  async getVaultAddresses(vaultAccountId: string): Promise<string[]> {
    const addressesWithIndexes = await this.getVaultAddressesWithIndexes(vaultAccountId);
    return addressesWithIndexes.map(item => item.address);
  }

  async getVaultAddressesWithIndex(vaultAccountId: string): Promise<{}> {
    const addressesWithIndexes = await this.getVaultAddressesWithIndexes(vaultAccountId);
    return addressesWithIndexes;
  }
}
