import { createHash } from "crypto";
import { 
  Transaction, 
  LockingScript, 
  UnlockingScript, 
  TransactionSignature, 
  Utils, 
  PublicKey 
} from "@bsv/sdk";
import { 
  SignatureRequest, 
  UTXO,
  FireblocksSignature,
  HashWithIndex
} from "../config/types.js";
import { CosignTemplate } from "../templates/CosignTemplate.js";
import { FireblocksService } from "./fireblocks.service.js";
import { createDERSignature } from "../utils/crypto.utils.js";
import { satoshisToTokens } from "../utils/token.utils.js";
import { Logger } from "../utils/logger.js";

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
    utxos: UTXO[], 
    amountNeeded: number
  ): { 
    selectedUtxos: UTXO[]; 
    signingAddresses: string[]; 
    tokensIn: number 
  } {
    this.logger.info(`Selecting UTXOs to cover ${amountNeeded} tokens`);
    const selectedUtxos: UTXO[] = [];
    const signingAddresses: string[] = [];
    let tokensIn = 0;
    
    // Create a copy of the utxos array to avoid modifying the original
    const utxosCopy = [...utxos];
    
    // Sort UTXOs by amount (descending) to try to use fewer inputs
    utxosCopy.sort((a, b) => b.data.bsv21.amt - a.data.bsv21.amt);
    
    while (tokensIn < amountNeeded && utxosCopy.length > 0) {
      // Try to find a suitable UTXO
      let selectedIndex = -1;
      
      // First, look for a UTXO that would be a perfect match
      for (let i = 0; i < utxosCopy.length; i++) {
        if (utxosCopy[i].data.bsv21.amt === amountNeeded - tokensIn) {
          selectedIndex = i;
          break;
        }
      }
      
      // If no perfect match, look for the smallest UTXO that's big enough
      if (selectedIndex === -1) {
        for (let i = utxosCopy.length - 1; i >= 0; i--) {
          if (utxosCopy[i].data.bsv21.amt >= amountNeeded - tokensIn) {
            selectedIndex = i;
            break;
          }
        }
      }
      
      // If still no match, take the largest available UTXO
      if (selectedIndex === -1) {
        selectedIndex = 0;
      }
      
      const utxo = utxosCopy.splice(selectedIndex, 1)[0];
      selectedUtxos.push(utxo);
      signingAddresses.push(utxo.owners[0]);
      tokensIn += utxo.data.bsv21.amt;
      
      this.logger.debug(`Selected UTXO with ${utxo.data.bsv21.amt} tokens (total now: ${tokensIn} of ${amountNeeded} needed)`);
    }
    
    if (tokensIn < amountNeeded) {
      this.logger.error(`Insufficient MNEE tokens: have ${tokensIn}, need ${amountNeeded}`);
      throw new Error(`Insufficient MNEE tokens: have ${tokensIn}, need ${amountNeeded}`);
    }
    
    this.logger.info(`Selected ${selectedUtxos.length} UTXOs with a total of ${tokensIn} tokens`);
    return { selectedUtxos, signingAddresses, tokensIn };
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
   * Create inscription data object
   * @param tokenId Token ID
   * @param amount Amount to inscribe
   * @returns Base64 encoded inscription data
   */
  createInscriptionData(tokenId: string, amount: number): string {
    this.logger.debug(`Creating inscription data for token ${tokenId}, amount ${amount}`);
    const inscriptionData = {
      p: "bsv-20",
      op: "transfer",
      id: tokenId,
      amt: amount.toString(),
    };
    return Buffer.from(JSON.stringify(inscriptionData)).toString("base64");
  }

  /**
   * Get signatures for transaction inputs
   * @param rawtx Raw transaction in hex
   * @param sigRequests Signature requests for each input
   * @param destination Destination address
   * @param vaultAccountId Vault account ID to sign with
   * @param amount Amount in MNEE tokens to include in the note
   * @returns Promise resolving to array of signatures
   */
  async getSignatures(
    rawtx: string,
    sigRequests: SignatureRequest[],
    destination: string,
    vaultAccountId: string,  // Add vaultAccountId parameter
    amount?: number
  ): Promise<Array<{ inputIndex: number; sig: string; pubKey: string }>> {
    try {
      this.logger.info(`Getting signatures for ${sigRequests.length} inputs from vault ${vaultAccountId}`);
      const tx = Transaction.fromHex(rawtx);
      
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
        vaultAccountId  // Pass the vault account ID
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

  /**
   * Apply signatures to a transaction
   * @param tx Transaction to sign
   * @param signatures Signatures to apply
   * @returns Transaction with applied signatures
   */
  applySignatures(
    tx: Transaction,
    signatures: Array<{ inputIndex: number; sig: string; pubKey: string }>
  ): Transaction {
    const cosignTemplate = new CosignTemplate();

    this.logger.info(`Applying ${signatures.length} signatures to transaction`);
    for (const sigResponse of signatures) {
      const { inputIndex, sig, pubKey } = sigResponse;
      const unlockingScriptCreator = cosignTemplate.userUnlock(
        sig,
        pubKey,
        "all",
        true
      );

      const unlockingScript = unlockingScriptCreator.getUnlockingScript();
      tx.inputs[inputIndex].unlockingScript = unlockingScript;

      this.logger.debug(`Applied signature to input ${inputIndex}`);
      this.logger.debug(`Unlocking script length: ${unlockingScript.toBinary().length}`);
    }

    if (tx.inputs.length > 0) {
      this.logger.debug(
        "First input unlocking script:",
        tx.inputs[0].unlockingScript.toHex()
      );
    }

    return tx;
  }

  /**
   * Prepare signature requests for a transaction
   * @param tx Transaction
   * @param signingAddresses Addresses for signing
   * @param bip44AddressIndexes Optional BIP44 address indexes for each address
   * @returns Array of signature requests
   */
  prepareSignatureRequests(
    tx: Transaction, 
    signingAddresses: string[], 
    bip44AddressIndexes?: number[]
  ): SignatureRequest[] {
    this.logger.info("Preparing signature requests");
    const sigRequests: SignatureRequest[] = [];
    
    for (const [index, input] of tx.inputs.entries()) {
      if (!input.sourceTransaction || !input.sourceTXID) {
        this.logger.error("Source transaction not found");
        throw new Error("Source transaction not found");
      }

      const addressToUse = signingAddresses[index];
      const bip44AddressIndex = bip44AddressIndexes?.[index] || 0;
      
      this.logger.debug(`Signing address for input ${index}: ${addressToUse} (BIP44 address index: ${bip44AddressIndex})`);

      sigRequests.push({
        prevTxid: input.sourceTXID,
        outputIndex: input.sourceOutputIndex,
        inputIndex: index,
        address: addressToUse,
        bip44AddressIndex: bip44AddressIndex,  // Include BIP44 address index
        script: input.sourceTransaction.outputs[input.sourceOutputIndex].lockingScript.toHex(),
        satoshis: input.sourceTransaction.outputs[input.sourceOutputIndex].satoshis || 1,
        sigHashType: TransactionSignature.SIGHASH_ALL | 
                     TransactionSignature.SIGHASH_ANYONECANPAY | 
                     TransactionSignature.SIGHASH_FORKID,
      });
    }

    return sigRequests;
  }
}