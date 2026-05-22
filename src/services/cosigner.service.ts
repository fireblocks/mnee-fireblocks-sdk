import axios, { AxiosInstance, AxiosError } from "axios";
import Mnee, {
  MNEEBalance,
  TransferStatus,
  MNEEConfig,
  MNEEUtxo,
  MneeSync,
} from "@mnee/ts-sdk";
import { Logger } from "../utils/logger.js";
import "dotenv/config.js";
import { Utils } from "@bsv/sdk";
import { TransferOptions } from "../config/types.js";

/**
 * Service for interacting with MNEE cosigner
 */
export class CosignerService {
  private endpoint: string;
  private axiosInstance: AxiosInstance;
  private config: MNEEConfig | null = null;
  private authToken: string;
  private logger: Logger;
  public mnee: Mnee;

  /**
   * Initialize the cosigner service
   * @param endpoint Cosigner API endpoint
   */
  constructor(endpoint: string) {
    this.logger = new Logger("CosignerService");
    this.endpoint = endpoint;
    this.authToken = process.env.MNEE_COSIGNER_AUTH_TOKEN;

    if (!this.authToken) {
      this.logger.error(
        "MNEE_COSIGNER_AUTH_TOKEN is not set in environment variables"
      );
      throw new Error(
        "MNEE_COSIGNER_AUTH_TOKEN is not set in environment variables"
      );
    }

    this.axiosInstance = axios.create({
      params: {
        auth_token: this.authToken,
      },
      headers: {
        "Content-Type": "application/json",
      },
    });

    // Initialize @mnee/ts-sdk
    const environment = endpoint.includes("sandbox") ? "sandbox" : "production";
    this.mnee = new Mnee({
      environment,
      apiKey: this.authToken,
    });

    this.logger.debug(
      `CosignerService initialized with endpoint: ${endpoint}, environment: ${environment}`
    );
  }

  /**
   * Fetch MNEE configuration
   * @returns Promise resolving to MNEE configuration
   */
  async fetchConfig(): Promise<MNEEConfig> {
    try {
      if (this.config) {
        this.logger.debug("Using cached MNEE config");
        return this.config;
      }

      this.logger.info("Fetching MNEE configuration");
      const response = await this.mnee.config();
      this.config = response;
      this.logger.debug("MNEE configuration fetched successfully");
      return this.config;
    } catch (error) {
      this.logger.error("Error fetching MNEE config:", error);
      throw error;
    }
  }

  /**
   * Fetch all UTXOs for given addresses using @mnee/ts-sdk
   * @param addresses BSV addresses to get UTXOs for
   * @returns Promise resolving to array of all UTXOs
   */
  async fetchUtxos(addresses: string[]): Promise<MNEEUtxo[]> {
    try {
      const rateLimitPerSecond = 10;
      const delay = 1000 / rateLimitPerSecond;
      const allUtxos: MNEEUtxo[] = [];
      for (const address of addresses) {
        const utxos = await this.mnee.getAllUtxos(address);
        utxos.forEach((utxo) => allUtxos.push(utxo));
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      this.logger.debug(`Fetching all UTXOs for ${addresses.length} addresses`);

      return allUtxos;
    } catch (error) {
      this.logger.error("Error fetching UTXOs:", error);
      throw error;
    }
  }

  /**
   * Fetch enough UTXOs to cover a specific amount across multiple addresses
   * Optimized to minimize API calls by using early exit strategy
   * @param addresses BSV addresses to get UTXOs from
   * @param requiredAmount Required token amount in atomic units (satoshis)
   * @returns Promise resolving to array of enough UTXOs
   */
  async fetchEnoughUtxos(
    addresses: string[],
    requiredAmount: number
  ): Promise<MNEEUtxo[]> {
    try {
      const uniqueAddresses = [...new Set(addresses.filter(Boolean))];

      this.logger.debug(
        `Fetching enough UTXOs across ${uniqueAddresses.length} addresses to cover ${requiredAmount} atomic units`
      );

      if (uniqueAddresses.length === 0) {
        throw new Error("No valid addresses provided");
      }

      const config = this.config || (await this.fetchConfig());
      if (!config) {
        throw new Error("Config not fetched");
      }

      const feeConfig = config.fees.find(
        (fee) => requiredAmount >= fee.min && requiredAmount <= fee.max
      );
      if (!feeConfig) {
        throw new Error("Fee not found");
      }

      const feeAmount = feeConfig.fee;

      const totalRequiredAmount = requiredAmount + feeAmount;

      const balances = await this.fetchBalance(uniqueAddresses);
      const combinedBalance = balances.reduce(
        (sum, balance) => sum + balance.amount,
        0
      );

      if (combinedBalance < totalRequiredAmount) {
        const maxTransferAmount = this.mnee.fromAtomicAmount(
          Math.max(combinedBalance - feeAmount, 0)
        );
        throw new Error(
          `Insufficient MNEE balance. Max transfer amount: ${maxTransferAmount}`
        );
      }

      let page = 1;
      const size = 100;
      const collectedUtxos: MNEEUtxo[] = [];
      let runningTotal = 0;

      while (runningTotal < totalRequiredAmount) {
        const pageUtxos = await this.mnee.getUtxos(uniqueAddresses, page, size);

        if (pageUtxos.length === 0) {
          const maxTransferAmount = this.mnee.fromAtomicAmount(
            Math.max(runningTotal - feeAmount, 0)
          );
          throw new Error(
            `Not enough UTXOs to cover required amount. Collected ${runningTotal} atomic units. Max transfer amount: ${maxTransferAmount}`
          );
        }

        collectedUtxos.push(...pageUtxos);
        runningTotal += pageUtxos.reduce(
          (sum, utxo) => sum + utxo.data.bsv21.amt,
          0
        );
        page++;
      }

      collectedUtxos.sort((a, b) => b.data.bsv21.amt - a.data.bsv21.amt);
      const selectedUtxos: MNEEUtxo[] = [];
      let selectedTotal = 0;

      for (const utxo of collectedUtxos) {
        selectedUtxos.push(utxo);
        selectedTotal += utxo.data.bsv21.amt;

        if (selectedTotal >= totalRequiredAmount) {
          break;
        }
      }

      this.logger.info(
        `Collected ${selectedUtxos.length} UTXOs totaling ${selectedTotal} atomic units`
      );
      return selectedUtxos;
    } catch (error) {
      this.logger.error("Error fetching enough UTXOs:", error);
      throw error;
    }
  }

  /**
   * Fetch balances for given addresses using mnee sdk
   * @param addresses BSV addresses to get balances for
   * @returns Promise resolving to array of balance data
   */
  async fetchBalance(addresses: string[]): Promise<MNEEBalance[]> {
    try {
      this.logger.debug(`Fetching balances for ${addresses.length} addresses`);
      const balances = await this.mnee.balances(addresses);
      const fundedBalances = balances.filter((balance) => balance.amount > 0);

      this.logger.debug(
        `Fetched balances for ${fundedBalances.length} addresses with balance`
      );
      return fundedBalances;
    } catch (error) {
      this.logger.error("Error fetching balances:", error);
      throw error;
    }
  }

  /**
   * Submit a signed transaction
   * @param rawHex Base64 encoded transaction
   * @returns Promise resolving to transaction response
   */
  async submitTransaction(rawHex: string, options: TransferOptions = {}): Promise<{ rawHex: string } | { ticketId: string }> {
    try {
      const response = await this.mnee.submitRawTx(rawHex);
      const ticketId = response.ticketId;
      if (options.returnMneeTxId) {
        return { ticketId: ticketId };
      }
      this.logger.info(`Ticket ID: ${ticketId}`);
      const result = await this.waitForV2Completion(
        ticketId,
        Date.now(),
        25000
      );

      if (result.status === "FAILED") {
        throw new Error(`Transaction failed: ${result.errors}`);
      }

      return { rawHex: result.tx_hex };
    } catch (error) {
      console.error("Error submitting transaction:", error);

      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        const status = axiosError.response?.status;
        const errorData = (axiosError.response?.data as any) || {};

        switch (status) {
          case 423:
            if (errorData.message?.includes("frozen")) {
              throw new Error(
                "Your address is currently frozen and cannot send tokens"
              );
            } else if (errorData.message?.includes("blacklisted")) {
              throw new Error(
                "The recipient address is blacklisted and cannot receive tokens"
              );
            } else {
              throw new Error("Transaction blocked by cosigner");
            }
          case 503:
            if (errorData.message?.includes("cosigner is paused")) {
              throw new Error(
                "Token transfers are currently paused by the administrator"
              );
            }
            throw new Error("Cosigning service temporarily unavailable");
          default:
            throw new Error(
              errorData.message || "Transaction rejected by cosigner"
            );
        }
      }
      throw error;
    }
  }

  private async waitForV2Completion(
    ticketId: string,
    startTime: number,
    maxWaitTime: number
  ): Promise<TransferStatus> {
    const checkInterval = 1000; // Check every second

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const response = await this.mnee.getTxStatus(ticketId);
        this.logger.info(`Ticket ID: ${ticketId} status: ${response.status}`);
        if (response.status === "SUCCESS" || response.status === "MINED") {
          return response;
        }

        if (response.status === "FAILED") {
          return response;
        }
      } catch (error) {
        this.logger.warn(`Error checking status for ${ticketId}:`, error);
      }

      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    this.logger.error(
      `Transaction ${ticketId} timed out after ${maxWaitTime}ms`
    );
    throw new Error(`Transaction ${ticketId} timed out after ${maxWaitTime}ms`);
  }

  async getTransactionsForAddresses(addresses: string[]): Promise<MneeSync[]> {
    try {
      const response = await this.axiosInstance.post<MneeSync[]>(
        `${this.endpoint}/v1/sync`,
        addresses
      );
      return response.data;
    } catch (error) {
      console.error("Error fetching transactions:", error);
      throw error;
    }
  }
}
