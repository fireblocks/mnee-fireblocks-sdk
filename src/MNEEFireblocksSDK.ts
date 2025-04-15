import { readFileSync } from "fs";
import {
  Transaction,
  UnlockingScript,
  PublicKey,
  Utils,
  LockingScript,
} from "@bsv/sdk";
import { BasePath, Fireblocks } from "@fireblocks/ts-sdk";
import {
  MNEEConfig,
  TransactionHashResponse,
  TransferOptions,
  WalletObject,
} from "./config/types.js";
import { loadOneSatOrd } from "./utils/oneSatOrdLoader.js";
import { CosignerService } from "./services/cosigner.service.js";
import { FireblocksService } from "./services/fireblocks.service.js";
import { TransactionService } from "./services/transaction.service.js";
import { CosignTemplate } from "./templates/CosignTemplate.js";
import {
  satoshisToTokens,
  tokensToSatoshis,
  formatTokenAmount,
} from "./utils/token.utils.js";
import { Logger } from "./utils/logger.js";

/**
 * MNEE Fireblocks SDK
 * Main class for interacting with MNEE tokens via Fireblocks
 */
export class MNEEFireblocksSDK {
  public cosignerService: CosignerService;
  public fireblocksService: FireblocksService;
  private transactionService: TransactionService;
  private oneSatOrd: any = null;
  private tokenConfig: MNEEConfig | null = null;
  private vaultAccountId: string;
  private logger: Logger;

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
    this.logger = new Logger('MNEEFireblocksSDK');

    // Validate required parameters
    if (!cosignerEndpoint) {
      this.logger.error("Cosigner endpoint (MNEE_COSIGNER_URL) is required");
      throw new Error("Cosigner endpoint (MNEE_COSIGNER_URL) is required");
    }
    
    if (!fireblocksSecretKeyPath) {
      this.logger.error("Fireblocks secret key path (FIREBLOCKS_SECRET_KEY_PATH) is required");
      throw new Error("Fireblocks secret key path (FIREBLOCKS_SECRET_KEY_PATH) is required");
    }
    
    if (!fireblocksApiKey) {
      this.logger.error("Fireblocks API key (FIREBLOCKS_API_KEY) is required");
      throw new Error("Fireblocks API key (FIREBLOCKS_API_KEY) is required");
    }
    
    // Check that the secret key file exists
    try {
      readFileSync(fireblocksSecretKeyPath, { encoding: 'utf8' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.logger.error(`Fireblocks secret key file not found: ${fireblocksSecretKeyPath}`);
        throw new Error(`Fireblocks secret key file not found: ${fireblocksSecretKeyPath}`);
      } else {
        throw error;
      }
    }

    // Initialize the vault account ID if provided (as default)
    this.vaultAccountId = defaultVaultAccountId || '';

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

    // Load the oneSatOrd module
    (async () => {
      this.oneSatOrd = await loadOneSatOrd();
    })();

    this.logger.info(`MNEE Fireblocks SDK initialized${defaultVaultAccountId ? ` with default vault account ${defaultVaultAccountId}` : ''}`);
  }

  /**
   * Apply inscription to a locking script
   * @param lockingScript Locking script or address
   * @param options Options containing dataB64 and contentType
   * @returns Promise resolving to modified locking script
   */
  private async applyInscription(
    lockingScript: LockingScript | string,
    options: { dataB64: string; contentType: string }
  ): Promise<LockingScript> {
    // Make sure module is loaded
    if (!this.oneSatOrd) {
      this.oneSatOrd = await loadOneSatOrd();
    }

    // Make sure token config is loaded
    if (!this.tokenConfig) {
      this.tokenConfig = await this.cosignerService.fetchConfig();
    }

    // Apply inscription
    if (lockingScript instanceof LockingScript) {
      return this.oneSatOrd.applyInscription(lockingScript, options);
    } else {
      return this.oneSatOrd.applyInscription(
        new CosignTemplate().lock(
          lockingScript,
          PublicKey.fromString(this.tokenConfig.approver)
        ),
        options
      );
    }
  }

  /**
   * Transfer MNEE tokens
   * @param recipient Recipient address
   * @param amount Amount to transfer in satoshis
   * @param walletObject Wallet object with ordAddress and vaultAccountId
   * @param options Options including grossAmount flag
   * @returns Promise resolving to transaction hash
   */
  private async transferTokens(
    recipient: string,
    amount: number,
    walletObject: WalletObject,
    options: TransferOptions = {}
  ): Promise<TransactionHashResponse> {
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

      // Get sender address
      const senderAddress = walletObject.ordAddress;

      // Fetch UTXOs to determine total tokens available
      this.logger.info("Fetching MNEE UTXOs");
      const utxos = await this.cosignerService.fetchUtxos([senderAddress]);

      // Calculate total available tokens
      const totalAvailableTokens = utxos.reduce(
        (sum, utxo) => sum + utxo.data.bsv21.amt,
        0
      );
      this.logger.info(
        `Total available tokens: ${formatTokenAmount(totalAvailableTokens)}`
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
      this.logger.info(`Fee: ${formatTokenAmount(fee)}`);

      // Calculate token amounts based on gross/net flag
      let tokenSatAmt: number;

      if (useGrossAmount) {
        // Gross amount - fee comes from the transferred amount
        tokenSatAmt = amount - fee;
        this.logger.info(
          `Gross transfer: ${formatTokenAmount(
            amount
          )} total with ${formatTokenAmount(
            fee
          )} fee, recipient gets ${formatTokenAmount(tokenSatAmt)}`
        );

        // Make sure the amount after fee is still positive
        if (tokenSatAmt <= 0) {
          this.logger.error(
            `Amount after fee (${formatTokenAmount(
              tokenSatAmt
            )}) is too small. Minimum transfer amount is ${formatTokenAmount(
              fee + 1
            )}`
          );
          throw new Error(
            `Amount after fee (${formatTokenAmount(
              tokenSatAmt
            )}) is too small. Minimum transfer amount is ${formatTokenAmount(
              fee + 1
            )}`
          );
        }
      } else {
        // Net amount - recipient gets the full amount, sender pays fee separately
        tokenSatAmt = amount;
        this.logger.info(
          `Net transfer: ${formatTokenAmount(
            tokenSatAmt
          )} to recipient, ${formatTokenAmount(fee)} fee, ${formatTokenAmount(
            tokenSatAmt + fee
          )} total`
        );
      }

      // Check if emptying wallet but not enough for fee
      if (isEmptyingWallet && totalAvailableTokens < fee) {
        this.logger.error(
          `Insufficient tokens to cover fee when emptying wallet. Have ${formatTokenAmount(
            totalAvailableTokens
          )}, need at least ${formatTokenAmount(fee)}`
        );
        throw new Error(
          `Insufficient tokens to cover fee when emptying wallet. Have ${formatTokenAmount(
            totalAvailableTokens
          )}, need at least ${formatTokenAmount(fee)}`
        );
      }

      this.logger.info("Building the transaction");

      // Build the transaction
      const tx = new Transaction();
      tx.version = 1;

      // Calculate amount needed for UTXOs
      const amountNeeded = useGrossAmount ? amount : tokenSatAmt + fee;

      // Select UTXOs
      const { selectedUtxos, signingAddresses, tokensIn } =
        this.transactionService.selectUtxos(utxos, amountNeeded);

      // Add inputs to transaction
      for (const [index, utxo] of selectedUtxos.entries()) {
        this.logger.info(`Adding input #${index} from UTXO ${utxo.txid}:${utxo.vout}`);
        const sourceTransaction = await this.cosignerService.fetchTransaction(
          utxo.txid
        );

        tx.addInput({
          sourceTXID: utxo.txid,
          sourceOutputIndex: utxo.vout,
          sourceTransaction,
          unlockingScript: new UnlockingScript(),
        });
      }

      // Add recipient output
      this.logger.info("Creating recipient output");
      const recipientDataB64 = this.transactionService.createInscriptionData(
        this.tokenConfig.tokenId,
        tokenSatAmt
      );

      tx.addOutput({
        lockingScript: await this.applyInscription(
          new CosignTemplate().lock(
            recipient,
            PublicKey.fromString(this.tokenConfig.approver)
          ),
          {
            dataB64: recipientDataB64,
            contentType: "application/bsv-20",
          }
        ),
        satoshis: 1,
      });

      // Add fee output
      this.logger.info("Creating fee output");
      const feeDataB64 = this.transactionService.createInscriptionData(
        this.tokenConfig.tokenId,
        fee
      );

      tx.addOutput({
        lockingScript: await this.applyInscription(
          new CosignTemplate().lock(
            this.tokenConfig.feeAddress,
            PublicKey.fromString(this.tokenConfig.approver)
          ),
          {
            dataB64: feeDataB64,
            contentType: "application/bsv-20",
          }
        ),
        satoshis: 1,
      });

      // Add change output if needed
      const changeTokenSatAmt = tokensIn - amountNeeded;
      if (changeTokenSatAmt > 0) {
        this.logger.info(`Adding change output with ${changeTokenSatAmt} tokens`);
        const changeDataB64 = this.transactionService.createInscriptionData(
          this.tokenConfig.tokenId,
          changeTokenSatAmt
        );

        tx.addOutput({
          lockingScript: await this.applyInscription(
            new CosignTemplate().lock(
              senderAddress,
              PublicKey.fromString(this.tokenConfig.approver)
            ),
            {
              dataB64: changeDataB64,
              contentType: "application/bsv-20",
            }
          ),
          satoshis: 1,
        });
      }

      try {
        // Prepare signature requests
        // Extract bip44AddressIndex from walletObject, if present
        const bip44AddressIndex = walletObject.bip44AddressIndex || 0;
        // Create an array of BIP44 address indexes for each signing address
        const bip44AddressIndexes = signingAddresses.map(() => bip44AddressIndex);

        // Update the prepareSignatureRequests call
        const sigRequests = this.transactionService.prepareSignatureRequests(
          tx,
          signingAddresses,
          bip44AddressIndexes
        );

        // Convert transaction to hex for signing
        const rawtx = tx.toHex();

        // Pass the actual token amount (in MNEE tokens, not satoshis) that the recipient will receive
        const tokenAmountForNote = satoshisToTokens(tokenSatAmt);

        // Get signatures from Fireblocks
        this.logger.info("Getting signatures from Fireblocks");
        const signatures = await this.transactionService.getSignatures(
          rawtx,
          sigRequests,
          recipient,
          walletObject.vaultAccountId,  // Pass the vault account ID
          tokenAmountForNote 
        );

        if (!signatures || signatures.length === 0) {
          this.logger.error("Failed to get signatures");
          throw new Error("Failed to get signatures");
        }

        // Apply signatures to transaction
        this.transactionService.applySignatures(tx, signatures);

        // Convert signed transaction to base64
        this.logger.info("Submitting signed transaction");
        const rawTxBase64 = Utils.toBase64(tx.toBinary());

        // Submit transaction to cosigner
        const response = await this.cosignerService.submitTransaction(
          rawTxBase64
        );

        // Parse transaction hash from response
        const hexTransaction = Buffer.from(response.rawtx, "base64").toString(
          "hex"
        );
        const txObj = Transaction.fromHex(hexTransaction);
        const transactionHash = Buffer.from(txObj.id()).toString("hex");

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
   * @returns Promise resolving to transaction hash
   */
  async transferTokensFromVault(
    sourceVaultAccountId: string,
    recipientAddress: string,
    amount?: number,
    options: TransferOptions = {}
  ): Promise<TransactionHashResponse> {
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

      // Fetch UTXOs for all addresses in the vault
      const utxos = await this.cosignerService.fetchUtxos(addresses);

      // Calculate total available tokens across all addresses
      const totalAvailableTokens = utxos.reduce((sum, utxo) => {
        if (utxo.data?.bsv21?.amt) {
          return sum + utxo.data.bsv21.amt;
        }
        return sum;
      }, 0);

      // If no amount is specified, use the total available balance (full withdrawal)
      const isFullBalanceWithdrawal = amount === undefined;
      let satoshiAmount: number;

      if (isFullBalanceWithdrawal) {
        // Convert from satoshis to token denomination for logging
        this.logger.info(
          `Full balance withdrawal requested. Available: ${formatTokenAmount(
            totalAvailableTokens
          )}`
        );

        // When sending full balance, we need to make sure we have enough for fees
        if (!this.tokenConfig) {
          this.tokenConfig = await this.cosignerService.fetchConfig();
        }

        // Find the appropriate fee tier for the total balance
        const fee = this.tokenConfig.fees.find(
          (fee) =>
            totalAvailableTokens >= fee.min && totalAvailableTokens <= fee.max
        )?.fee;

        if (fee === undefined) {
          this.logger.error("Fee ranges inadequate for total balance");
          throw new Error("Fee ranges inadequate for total balance");
        }

        // Verify there's enough balance to cover at least the fee
        if (totalAvailableTokens <= fee) {
          this.logger.error(
            `Insufficient balance to cover fee. Have ${formatTokenAmount(
              totalAvailableTokens
            )}, ` + `need at least ${formatTokenAmount(fee)} for fee`
          );
          throw new Error(
            `Insufficient balance to cover fee. Have ${formatTokenAmount(
              totalAvailableTokens
            )}, ` + `need at least ${formatTokenAmount(fee)} for fee`
          );
        }

        // Use the total available tokens as the amount
        satoshiAmount = totalAvailableTokens;

        // Force the gross amount flag to true for full balance withdrawals
        options.grossAmount = true;

        this.logger.info(
          `Full balance withdrawal: ${formatTokenAmount(
            satoshiAmount
          )} (gross amount: true)`
        );
      } else {
        // Regular specified amount transfer
        // Convert from token denomination to satoshis for internal use
        satoshiAmount = tokensToSatoshis(amount);
        this.logger.info(
          `Preparing to transfer ${formatTokenAmount(
            satoshiAmount
          )} from vault ${sourceVaultAccountId} to ${recipientAddress}`
        );

        // Check if we have enough tokens in the vault (considering fees)
        if (!this.tokenConfig) {
          this.tokenConfig = await this.cosignerService.fetchConfig();
        }

        const fee = this.tokenConfig.fees.find(
          (fee) => satoshiAmount >= fee.min && satoshiAmount <= fee.max
        )?.fee;

        if (fee === undefined) {
          this.logger.error("Fee ranges inadequate");
          throw new Error("Fee ranges inadequate");
        }

        const totalRequired = options.grossAmount
          ? satoshiAmount
          : satoshiAmount + fee;

        if (totalAvailableTokens < totalRequired) {
          this.logger.error(
            `Insufficient balance in vault ${sourceVaultAccountId}. ` +
              `Required: ${formatTokenAmount(totalRequired)}, ` +
              `Available: ${formatTokenAmount(totalAvailableTokens)}`
          );
          throw new Error(
            `Insufficient balance in vault ${sourceVaultAccountId}. ` +
              `Required: ${formatTokenAmount(totalRequired)}, ` +
              `Available: ${formatTokenAmount(totalAvailableTokens)}`
          );
        }
      }

      // Find an appropriate address with UTXOs to use
      // Starting with addresses that have UTXOs (active addresses)
      const addressesWithUtxos = new Set(utxos.map((utxo) => utxo.owners[0]));

      // If we found addresses with UTXOs, use the first one
      // Otherwise, use the first address in the vault (which might be empty)
      const selectedAddress =
        addressesWithUtxos.size > 0
          ? Array.from(addressesWithUtxos)[0]
          : addresses[0];

      // Get the BIP44 address index for the selected address
      const selectedBip44AddressIndex =
        addressToIndexMap.get(selectedAddress) || 0;

      this.logger.info(
        `Selected source address: ${selectedAddress} (BIP44 address index: ${selectedBip44AddressIndex})`
      );

      // Create wallet object with selected address and its BIP44 address index
      const walletObject: WalletObject = {
        ordAddress: selectedAddress,
        vaultAccountId: sourceVaultAccountId,
        bip44AddressIndex: selectedBip44AddressIndex,
      };

      // Use the existing transferTokens method with our wallet object and the satoshi amount
      return await this.transferTokens(
        recipientAddress,
        satoshiAmount,
        walletObject,
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

      // Fetch UTXOs for the provided addresses
      const utxos = await this.cosignerService.fetchUtxos(addresses);

      // Sum up the token amounts
      const totalAvailableTokens = utxos.reduce((sum, utxo) => {
        // Make sure bsv21 data exists before trying to access amt
        if (utxo.data?.bsv21?.amt) {
          return sum + utxo.data.bsv21.amt;
        }
        return sum;
      }, 0);

      this.logger.info(
        `Total balance: ${satoshisToTokens(totalAvailableTokens)} MNEE tokens`
      );

      // Convert to token denomination for return value
      return satoshisToTokens(totalAvailableTokens);
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
      const addresses = await this.fireblocksService.getVaultAddresses(vaultAccountId);

      if (!addresses || addresses.length === 0) {
        this.logger.info("No addresses found for vault account");
        return 0;
      }

      this.logger.info(`Found ${addresses.length} addresses in vault account`);

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
