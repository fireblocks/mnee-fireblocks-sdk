import { readFileSync } from "fs";
import { Transaction } from "@bsv/sdk";
import { BasePath, Fireblocks } from "@fireblocks/ts-sdk";
import {
  TransactionHashResponse,
  TransactionIdResponse,
  TransferOptions,
  WalletObject,
} from "./config/types.js";
import { CosignerService } from "./services/cosigner.service.js";
import { FireblocksService } from "./services/fireblocks.service.js";
import { TransactionService } from "./services/transaction.service.js";
import { Logger } from "./utils/logger.js";
import Mnee, { MNEEConfig, MNEEUtxo } from "@mnee/ts-sdk";

/**
 * MNEE Fireblocks SDK
 * Main class for interacting with MNEE tokens via Fireblocks
 */
export class MNEEFireblocksSDK {
  public cosignerService: CosignerService;
  public fireblocksService: FireblocksService;
  private transactionService: TransactionService;
  private tokenConfig: MNEEConfig | null = null;
  private logger: Logger;
  private mneeInstance: Mnee;
  /**
   * Initialize the MNEE Fireblocks SDK
   * @param cosignerEndpoint MNEE cosigner endpoint
   * @param fireblocksSecretKeyPath Path to Fireblocks secret key file
   * @param fireblocksApiKey Fireblocks API key
   * @param defaultVaultAccountId Optional default vault account ID
   */
  constructor(
    cosignerEndpoint: string,
    fireblocksSecretKeyPath: string,
    fireblocksApiKey: string,
    defaultVaultAccountId?: string
  ) {
    this.logger = new Logger("MNEEFireblocksSDK");
    // Validate required parameters
    if (!cosignerEndpoint) {
      this.logger.error("Cosigner endpoint (MNEE_COSIGNER_URL) is required");
      throw new Error("Cosigner endpoint (MNEE_COSIGNER_URL) is required");
    }

    if (!fireblocksSecretKeyPath) {
      this.logger.error(
        "Fireblocks secret key path (FIREBLOCKS_SECRET_KEY_PATH) is required"
      );
      throw new Error(
        "Fireblocks secret key path (FIREBLOCKS_SECRET_KEY_PATH) is required"
      );
    }

    if (!fireblocksApiKey) {
      this.logger.error("Fireblocks API key (FIREBLOCKS_API_KEY) is required");
      throw new Error("Fireblocks API key (FIREBLOCKS_API_KEY) is required");
    }

    // Check that the secret key file exists
    try {
      readFileSync(fireblocksSecretKeyPath, { encoding: "utf8" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.logger.error(
          `Fireblocks secret key file not found: ${fireblocksSecretKeyPath}`
        );
        throw new Error(
          `Fireblocks secret key file not found: ${fireblocksSecretKeyPath}`
        );
      } else {
        throw error;
      }
    }

    // Initialize the cosigner service
    this.cosignerService = new CosignerService(cosignerEndpoint);

    // Initialize the Fireblocks client and service
    const fireblocksSecretKey = readFileSync(fireblocksSecretKeyPath, "utf8");
    const fireblocksClient = new Fireblocks({
      apiKey: fireblocksApiKey,
      secretKey: fireblocksSecretKey,
      basePath: BasePath.US,
    });
    this.fireblocksService = new FireblocksService(fireblocksClient);

    // Initialize the transaction service
    this.transactionService = new TransactionService(this.fireblocksService);

    this.mneeInstance = this.cosignerService.mnee;

    this.logger.info(
      `MNEE Fireblocks SDK initialized${
        defaultVaultAccountId
          ? ` with default vault account ${defaultVaultAccountId}`
          : ""
      }`
    );
  }

  /**
   * Transfer MNEE tokens (private method called by transferTokensFromVault)
   * @param recipient Recipient address
   * @param amount Amount to transfer in satoshis
   * @param walletObject Wallet object with vaultAccountId and addressToBip44Map
   * @param utxos UTXOs to use for the transfer
   * @param options Options including grossAmount flag
   * @returns Promise resolving to transaction hash or transaction id
   */
  private async transferTokens(
    recipient: string,
    amount: number,
    walletObject: WalletObject,
    utxos: MNEEUtxo[],
    options: TransferOptions = {}
  ): Promise<TransactionHashResponse | TransactionIdResponse> {
    try {
      // Make sure walletObject contains a vaultAccountId
      if (!walletObject.vaultAccountId) {
        throw new Error("Vault account ID is required for transfers");
      }

      this.logger.info("Fetching MNEE config");
      if (!this.tokenConfig) {
        this.tokenConfig = await this.cosignerService.fetchConfig();
      }

      // Validate amount
      if (amount <= 0) {
        this.logger.error("Please enter a valid amount greater than 0");
        throw new Error("Please enter a valid amount greater than 0");
      }

      // Use all passed UTXOs (may be from multiple addresses in the vault)
      this.logger.info(
        `Using ${utxos.length} UTXOs from vault (may span multiple addresses)`
      );

      // Calculate total available tokens from all UTXOs
      const totalAvailableTokens = utxos.reduce(
        (sum, utxo) => sum + utxo.data.bsv21.amt,
        0
      );
      this.logger.info(
        `Total available tokens: ${this.mneeInstance.fromAtomicAmount(
          totalAvailableTokens
        )}`
      );

      // Determine if this is an empty-wallet transaction
      const isEmptyingWallet = Math.abs(totalAvailableTokens - amount) < 1; // Small tolerance for rounding
      this.logger.info(`Is emptying wallet: ${isEmptyingWallet}`);

      // Use grossAmount flag or auto-detect emptying wallet
      const useGrossAmount = options.grossAmount || isEmptyingWallet;
      this.logger.info(`Using gross amount: ${useGrossAmount}`);

      // Find the appropriate fee
      const fee = this.tokenConfig.fees.find(
        (fee) => amount >= fee.min && amount <= fee.max
      )?.fee;

      if (fee === undefined) {
        this.logger.error("Fee ranges inadequate");
        throw new Error("Fee ranges inadequate");
      }
      this.logger.info(`Fee: ${this.mneeInstance.fromAtomicAmount(fee)}`);

      // Calculate token amounts based on gross/net flag
      let tokenSatAmt: number;

      if (useGrossAmount) {
        // Gross amount - fee comes from the transferred amount
        tokenSatAmt = amount - fee;
        this.logger.info(
          `Gross transfer: ${this.mneeInstance.fromAtomicAmount(
            amount
          )} total with ${this.mneeInstance.fromAtomicAmount(
            fee
          )} fee, recipient gets ${this.mneeInstance.fromAtomicAmount(
            tokenSatAmt
          )}`
        );

        // Make sure the amount after fee is still positive
        if (tokenSatAmt <= 0) {
          this.logger.error(
            `Amount after fee (${this.mneeInstance.fromAtomicAmount(
              tokenSatAmt
            )}) is too small. Minimum transfer amount is ${this.mneeInstance.fromAtomicAmount(
              fee + 1
            )}`
          );
          throw new Error(
            `Amount after fee (${this.mneeInstance.fromAtomicAmount(
              tokenSatAmt
            )}) is too small. Minimum transfer amount is ${this.mneeInstance.fromAtomicAmount(
              fee + 1
            )}`
          );
        }
      } else {
        // Net amount - recipient gets the full amount, sender pays fee separately
        tokenSatAmt = amount;
        this.logger.info(
          `Net transfer: ${this.mneeInstance.fromAtomicAmount(
            tokenSatAmt
          )} to recipient, ${this.mneeInstance.fromAtomicAmount(
            fee
          )} fee, ${this.mneeInstance.fromAtomicAmount(
            tokenSatAmt + fee
          )} total`
        );
      }

      // Check if emptying wallet but not enough for fee
      if (isEmptyingWallet && totalAvailableTokens < fee) {
        this.logger.error(
          `Insufficient tokens to cover fee when emptying wallet. Have ${this.mneeInstance.fromAtomicAmount(
            totalAvailableTokens
          )}, need at least ${this.mneeInstance.fromAtomicAmount(fee)}`
        );
        throw new Error(
          `Insufficient tokens to cover fee when emptying wallet. Have ${this.mneeInstance.fromAtomicAmount(
            totalAvailableTokens
          )}, need at least ${this.mneeInstance.fromAtomicAmount(fee)}`
        );
      }

      this.logger.info("Building the transaction");

      // Calculate amount needed for UTXOs
      const amountNeeded = useGrossAmount ? amount : tokenSatAmt + fee;

      // Select UTXOs from all available UTXOs (may span multiple addresses)
      const { selectedUtxos, signingAddresses } =
        this.transactionService.selectUtxos(utxos, amountNeeded);

      this.logger.info(
        `Selected ${selectedUtxos.length} UTXOs from ${
          new Set(signingAddresses).size
        } address(es)`
      );

      // Determine change address - prefer the first signing address
      const changeAddress = signingAddresses[0];

      // Build unsigned transaction using MNEE SDK
      // The SDK automatically handles:
      // - Fetching source transactions for inputs
      // - Creating recipient output with inscription
      // - Creating fee output to feeAddress (automatic fee calculation)
      // - Creating change output if needed
      this.logger.info("Building unsigned transaction with MNEE SDK");
      const { transaction: tx, sigRequests: sdkSigRequests } =
        await this.mneeInstance.buildUnsignedMneeTransaction({
          inputs: selectedUtxos.map((utxo) => ({
            txid: utxo.txid,
            vout: utxo.vout,
          })),
          recipients: [
            {
              address: recipient,
              amount: this.mneeInstance.fromAtomicAmount(tokenSatAmt), // SDK expects decimal MNEE, not atomic units
            },
          ],
          changeAddress,
        });

      this.logger.info(
        `Addresses in vault map: ${Array.from(
          walletObject.addressToBip44Map.entries()
        )
          .map(([addr, idx]) => `${addr}:${idx}`)
          .join(", ")}`
      );
      this.logger.info(
        `Transaction built with ${tx.inputs.length} inputs and ${tx.outputs.length} outputs`
      );

      try {
        // Enrich SDK signature requests with BIP44 address indexes for Fireblocks signing
        // The SDK doesn't populate the address field, so we need to get it from the selected UTXOs
        // Each signature request corresponds to an input, and each input comes from a selected UTXO
        const sigRequests = sdkSigRequests.map((req) => {
          // Get the UTXO for this input by matching the input index
          const utxo = selectedUtxos[req.inputIndex];

          if (!utxo) {
            throw new Error(`No UTXO found for input index ${req.inputIndex}`);
          }

          // Get the address that owns this UTXO (the first owner in the multisig array)
          const address = Array.isArray(utxo.owners) ? utxo.owners[0] : utxo.owners;

          // Look up BIP44 index for this address from the map
          const bip44AddressIndex = walletObject.addressToBip44Map.get(address);

          if (bip44AddressIndex === undefined) {
            throw new Error(
              `Address ${address} for input ${req.inputIndex} not found in vault addresses. ` +
              `Available addresses: ${Array.from(walletObject.addressToBip44Map.keys()).join(', ')}`
            );
          }

          this.logger.debug(
            `Input ${req.inputIndex}: address=${address}, BIP44=${bip44AddressIndex}`
          );

          return {
            ...req,
            address, // Normalize to string
            bip44AddressIndex,
            // Ensure all required fields are present
            script: req.script || "",
            sigHashType: req.sigHashType || 0x41 | 0x40 | 0x01, // SIGHASH_ALL | ANYONECANPAY | FORKID
          };
        });

        this.logger.info(
          `Mapped ${sigRequests.length} signature requests to their correct BIP44 indexes`
        );

        // Pass the actual token amount (in MNEE tokens, not satoshis) that the recipient will receive
        const tokenAmountForNote =
          this.mneeInstance.fromAtomicAmount(tokenSatAmt);

        // Get signatures from Fireblocks
        this.logger.info("Getting signatures from Fireblocks");
        const signatures = await this.transactionService.getSignatures(
          tx,
          sigRequests,
          recipient,
          walletObject.vaultAccountId, // Pass the vault account ID
          tokenAmountForNote,
          options
        );

        if (!signatures || signatures.length === 0) {
          this.logger.error("Failed to get signatures");
          throw new Error("Failed to get signatures");
        }

        // Convert signatures to SDK format (add sigHashType field)
        const signatureResponses = signatures.map((sig) => ({
          ...sig,
          sigHashType:
            sigRequests.find((req) => req.inputIndex === sig.inputIndex)
              ?.sigHashType || 0x41 | 0x40 | 0x01,
        }));

        // Apply signatures to transaction using MNEE SDK
        const signedTx = this.mneeInstance.applySignatures(
          tx,
          signatureResponses
        );

        this.logger.info("Submitting signed transaction");

        // Submit transaction to cosigner
        const response = await this.cosignerService.submitTransaction(
          signedTx.toHex(),
          options
        );

        if ("ticketId" in response) {
          this.logger.info(`Transaction submitted with MNEE ticket ID: ${response.ticketId}`);
          return { transactionId: response.ticketId }; // Return ticket ID as transaction id if requested
        }

        const transactionHash = Transaction.fromHex(response.rawHex).id("hex");

        this.logger.info(`Transaction successful. Hash: ${transactionHash}`);

        return { transactionHash };
      } catch (error) {
        this.logger.error("Error in transferTokens:", error);
        throw error;
      }
    } catch (error) {
      this.logger.error("Error in transferTokens:", error);
      throw error;
    }
  }

  /**
   * Transfer MNEE tokens from a vault account to an address
   * @param sourceVaultAccountId Source vault account ID
   * @param recipientAddress Recipient address
   * @param amount Amount to transfer in MNEE tokens (e.g., 0.497 for 0.497 MNEE), or undefined to send full balance
   * @param options Options including grossAmount flag (note: grossAmount is automatically set to true when sending full balance)
   * @returns Promise resolving to transaction hash or transaction id
   */
  async transferTokensFromVault(
    sourceVaultAccountId: string,
    recipientAddress: string,
    amount?: number,
    options: TransferOptions = {}
  ): Promise<TransactionHashResponse | TransactionIdResponse> {
    // This method already takes sourceVaultAccountId as a parameter, so we just need to validate it
    if (!sourceVaultAccountId) {
      this.logger.error("Source vault account ID is required");
      throw new Error("Source vault account ID is required");
    }

    try {
      this.logger.info(
        `Preparing transfer from vault ${sourceVaultAccountId} to ${recipientAddress}`
      );

      // Get addresses with their BIP44 address indexes (updated to pass sourceVaultAccountId)
      const addressesWithIndexes =
        await this.fireblocksService.getVaultAddressesWithIndexes(
          sourceVaultAccountId
        );

      if (!addressesWithIndexes || addressesWithIndexes.length === 0) {
        this.logger.error(
          `No BSV addresses found for vault account ${sourceVaultAccountId}`
        );
        throw new Error(
          `No BSV addresses found for vault account ${sourceVaultAccountId}`
        );
      }

      this.logger.info(
        `Found ${addressesWithIndexes.length} addresses in vault account ${sourceVaultAccountId}`
      );

      // Extract just the addresses for cosigner API
      const addresses = addressesWithIndexes.map((item) => item.address);

      // Create a map of address to BIP44 address index for later use
      const addressToIndexMap = new Map<string, number>();
      addressesWithIndexes.forEach((item) => {
        addressToIndexMap.set(item.address, item.bip44AddressIndex);
      });

      // Determine amount to transfer first to optimize UTXO fetching
      let satoshiAmount: number;
      let utxos: MNEEUtxo[];

      if (amount === undefined) {
        // Full balance withdrawal - fetch all UTXOs
        this.logger.info(
          "Full balance withdrawal requested - fetching all UTXOs"
        );
        utxos = await this.cosignerService.fetchUtxos(addresses);

        const totalAvailableTokens = utxos.reduce(
          (sum, utxo) => sum + (utxo.data?.bsv21?.amt || 0),
          0
        );

        this.logger.info(
          `Fetched ${
            utxos.length
          } UTXOs totaling ${this.mneeInstance.fromAtomicAmount(
            totalAvailableTokens
          )} MNEE`
        );

        satoshiAmount = totalAvailableTokens;
        options.grossAmount = true; // Fee comes from the balance
      } else {
        // Specified amount transfer - only fetch enough UTXOs
        satoshiAmount = this.mneeInstance.toAtomicAmount(amount);
        this.logger.info(
          `Transfer ${this.mneeInstance.fromAtomicAmount(
            satoshiAmount
          )} MNEE requested - fetching optimized UTXOs`
        );

        utxos = await this.cosignerService.fetchEnoughUtxos(
          addresses,
          satoshiAmount
        );

        this.logger.info(
          `Optimized fetch: collected ${utxos.length} UTXOs (vs potentially all UTXOs)`
        );
      }

      // Create wallet object with ALL addresses and their BIP44 indexes for multi-address support
      const walletObject: WalletObject = {
        vaultAccountId: sourceVaultAccountId,
        addressToBip44Map: addressToIndexMap,
      };

      // Use the existing transferTokens method with our wallet object, UTXOs, and the satoshi amount
      return await this.transferTokens(
        recipientAddress,
        satoshiAmount,
        walletObject,
        utxos,
        options
      );
    } catch (error) {
      this.logger.error("Error in transferTokensFromVault:", error);
      throw error;
    }
  }

  /**
   * Calculate MNEE token balance for given addresses
   * @param addresses Array of BSV addresses to calculate balance for
   * @returns Promise resolving to total MNEE token amount in whole tokens
   */
  async calculateBalance(addresses: string[]): Promise<number> {
    try {
      if (!addresses || addresses.length === 0) {
        this.logger.error("No addresses provided");
        throw new Error("No addresses provided");
      }

      this.logger.info(`Calculating balance for ${addresses.length} addresses`);

      // Fetch balances using v2/balance endpoint
      const balances = await this.cosignerService.fetchBalance(addresses);

      // Sum up the token amounts
      const totalAvailableTokens = balances.reduce((sum, balance) => {
        return sum + balance.amount;
      }, 0);

      this.logger.info(
        `Total balance: ${this.mneeInstance.fromAtomicAmount(
          totalAvailableTokens
        )} MNEE tokens`
      );

      // Convert to token denomination for return value
      return this.mneeInstance.fromAtomicAmount(totalAvailableTokens);
    } catch (error) {
      this.logger.error("Error calculating balance:", error);
      throw error;
    }
  }

  /**
   * Get balance for a vault account
   * @param vaultAccountId Vault account ID
   * @returns Promise resolving to balance in MNEE tokens
   */
  async getBalanceForVaultAccount(vaultAccountId: string): Promise<number> {
    if (!vaultAccountId) {
      this.logger.error("Vault account ID is required");
      throw new Error("Vault account ID is required");
    }

    try {
      this.logger.info(`Getting balance for vault account ${vaultAccountId}`);

      // Get all BSV addresses associated with this vault account (updated)
      const addresses = await this.fireblocksService.getVaultAddresses(
        vaultAccountId
      );

      if (!addresses || addresses.length === 0) {
        this.logger.info("No addresses found for vault account");
        return 0;
      }

      this.logger.info(`Found ${addresses.length} addresses in vault account`);
      this.logger.info(`Addresses: ${addresses.join("\n")}`);

      // Use the calculateBalance method to get the total balance for these addresses
      return await this.calculateBalance(addresses);
    } catch (error) {
      this.logger.error("Error fetching vault account balance:", error);
      throw error;
    }
  }

  /**
   * Get balance for a specific address
   * @param address BSV address to check balance for
   * @returns Promise resolving to balance in MNEE tokens
   */
  async getAddressBalance(address: string): Promise<number> {
    try {
      if (!address) {
        this.logger.error("No address provided");
        throw new Error("No address provided");
      }

      return await this.calculateBalance([address]);
    } catch (error) {
      this.logger.error("Error fetching address balance:", error);
      throw error;
    }
  }
}
