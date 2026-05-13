import { createHash } from "crypto";
import {
  Transaction,
  LockingScript,
  TransactionSignature,
  Utils,
} from "@bsv/sdk";
import {
  SignatureRequest,
  HashWithIndex,
  TransferOptions
} from "../config/types.js";
import { FireblocksService } from "./fireblocks.service.js";
import { createDERSignature } from "../utils/crypto.utils.js";
import { Logger } from "../utils/logger.js";
import { MNEEUtxo } from "@mnee/ts-sdk";

/**
 * Service for handling BSV transaction operations
 */
export class TransactionService {
  private fireblocksService: FireblocksService;
  private logger: Logger;

  /**
   * Initialize the transaction service
   * @param fireblocksService Fireblocks service instance
   */
  constructor(fireblocksService: FireblocksService) {
    this.fireblocksService = fireblocksService;
    this.logger = new Logger('TransactionService');
    this.logger.debug('Initialized');
  }

  /**
   * Select UTXOs to cover a required amount
   * @param utxos Available UTXOs
   * @param amountNeeded Amount needed
   * @returns Selected UTXOs, their owners, and the total token amount
   */
  selectUtxos(
    utxos: MNEEUtxo[],
    amountNeeded: number
  ): {
    selectedUtxos: MNEEUtxo[];
    signingAddresses: string[];
  } {
    this.logger.info(`Selecting UTXOs to cover ${amountNeeded} tokens`);

    // Sort UTXOs by amount (descending) to minimize number of inputs
    const sortedUtxos = [...utxos].sort((a, b) => b.data.bsv21.amt - a.data.bsv21.amt);

    const selectedUtxos: MNEEUtxo[] = [];
    const signingAddresses: string[] = [];
    let totalSelected = 0;

    // Greedy algorithm: select UTXOs until we have enough
    for (const utxo of sortedUtxos) {
      selectedUtxos.push(utxo);
      signingAddresses.push(utxo.owners[0]);
      totalSelected += utxo.data.bsv21.amt;

      this.logger.debug(
        `Selected UTXO with ${utxo.data.bsv21.amt} tokens (total: ${totalSelected}/${amountNeeded})`
      );

      if (totalSelected >= amountNeeded) {
        break;
      }
    }

    if (totalSelected < amountNeeded) {
      this.logger.error(
        `Insufficient MNEE tokens: have ${totalSelected}, need ${amountNeeded}`
      );
      throw new Error(
        `Insufficient MNEE tokens: have ${totalSelected}, need ${amountNeeded}`
      );
    }

    this.logger.info(
      `Selected ${selectedUtxos.length} UTXOs with total ${totalSelected} tokens`
    );
    return { selectedUtxos, signingAddresses };
  }

  /**
   * Create signature hash for a transaction input
   * @param tx Transaction
   * @param inputIndex Input index
   * @param lockingScript Locking script
   * @param satoshis Amount in satoshis
   * @param sigHashType Signature hash type
   * @returns Signature hash
   */
  createSignatureHash(
    tx: Transaction,
    inputIndex: number,
    lockingScript: string,
    satoshis: number,
    sigHashType: number
  ): string {
    const input = tx.inputs[inputIndex];
    const otherInputs = tx.inputs.filter((_, idx) => idx !== inputIndex);

    const preimage = TransactionSignature.format({
      sourceTXID: input.sourceTXID,
      sourceOutputIndex: input.sourceOutputIndex,
      sourceSatoshis: satoshis,
      transactionVersion: tx.version,
      otherInputs,
      inputIndex,
      outputs: tx.outputs,
      inputSequence: input.sequence || 0xffffffff,
      subscript: LockingScript.fromHex(lockingScript),
      lockTime: tx.lockTime,
      scope: sigHashType,
    });

    const hash = createHash("sha256").update(Buffer.from(preimage)).digest();
    const hashHex = Utils.toHex(Array.from(hash));
    this.logger.debug(`Created signature hash for input ${inputIndex}: ${hashHex.substring(0, 16)}...`);
    return hashHex;
  }


  /**
   * Get signatures for transaction inputs
   * @param tx Transaction object to sign
   * @param sigRequests Signature requests for each input
   * @param destination Destination address
   * @param vaultAccountId Vault account ID to sign with
   * @param amount Amount in MNEE tokens to include in the note
   * @returns Promise resolving to array of signatures
   */
  async getSignatures(
    tx: Transaction,
    sigRequests: SignatureRequest[],
    destination: string,
    vaultAccountId: string,  // Add vaultAccountId parameter
    amount?: number,
    options: TransferOptions = {}
  ): Promise<Array<{ inputIndex: number; sig: string; pubKey: string }>> {
    try {
      this.logger.info(`Getting signatures for ${sigRequests.length} inputs from vault ${vaultAccountId}`);

      // Prepare all hashes to be signed
      const hashesWithIndices: Array<HashWithIndex & { bip44AddressIndex?: number }> = sigRequests.map(request => {
        const sigHash = this.createSignatureHash(
          tx,
          request.inputIndex,
          request.script,
          request.satoshis,
          request.sigHashType
        );
        
        this.logger.debug(`Prepared hash for input ${request.inputIndex}: ${sigHash.substring(0, 16)}...`);
        
        return {
          hash: Buffer.from(sigHash, "hex"),
          inputIndex: request.inputIndex,
          sigHashType: request.sigHashType,
          bip44AddressIndex: request.bip44AddressIndex  // Include BIP44 address index
        };
      });

      this.logger.info(`Using amount for transaction note: ${amount} MNEE tokens`);
      
      // Sign all hashes in a single Fireblocks call
      // Pass the vaultAccountId directly to signMultipleHashes
      const signedResults = await this.fireblocksService.signMultipleHashes(
        hashesWithIndices,
        amount || 0,  // Use provided amount or default to 0
        destination,
        vaultAccountId,  // Pass the vault account ID
        options
      );

      // Process each signature and create DER format
      return signedResults.map(result => {
        const { inputIndex, signature } = result;
        const request = sigRequests.find(req => req.inputIndex === inputIndex);
        
        // Create DER signature
        const sigWithHashType = createDERSignature(
          signature,
          request.sigHashType
        );
        
        this.logger.debug(`DER signature for input ${inputIndex}: ${sigWithHashType.substring(0, 16)}...`);
        this.logger.debug(`Public key: ${signature.pubKey}`);

        return {
          inputIndex: inputIndex,
          sig: sigWithHashType,
          pubKey: signature.pubKey,
        };
      });
    } catch (error) {
      this.logger.error("Error getting signatures:", error);
      throw error;
    }
  }

}