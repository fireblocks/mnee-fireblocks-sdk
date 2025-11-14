import axios, { AxiosInstance, AxiosError } from "axios";
import Mnee, {
  MNEEBalance,
  TransferStatus,
  MNEEConfig,
  MNEEUtxo,
  MneeSync,
} from "mnee";
import { Logger } from "../utils/logger.js";
import "dotenv/config.js";
import { Utils } from "@bsv/sdk";

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
      const rateLimitPerSecond = 10;
      const delay = 1000 / rateLimitPerSecond;
      const collectedUtxos: MNEEUtxo[] = [];
      let totalCollected = 0;

      this.logger.debug(
        `Fetching enough UTXOs for ${addresses.length} addresses to cover ${requiredAmount} atomic units`
      );

      for (const address of addresses) {
        const remainingNeeded = requiredAmount - totalCollected;
        const utxos = await this.mnee.getEnoughUtxos(address, remainingNeeded);

        utxos.forEach((utxo) => {
          collectedUtxos.push(utxo);
          totalCollected += utxo.data.bsv21.amt;
        });

        this.logger.debug(
          `Address ${address}: +${utxos.length} UTXOs, total: ${totalCollected}/${requiredAmount}`
        );

        if (totalCollected >= requiredAmount) {
          this.logger.info(
            `Sufficient UTXOs found after ${addresses.indexOf(address) + 1}/${
              addresses.length
            } addresses`
          );
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      if (totalCollected < requiredAmount) {
        this.logger.error(
          `Insufficient tokens across all addresses: have ${totalCollected}, need ${requiredAmount}`
        );
        throw new Error(
          `Insufficient tokens: have ${this.mnee.fromAtomicAmount(
            totalCollected
          )}, ` + `need ${this.mnee.fromAtomicAmount(requiredAmount)} MNEE`
        );
      }

      this.logger.info(
        `Collected ${collectedUtxos.length} UTXOs totaling ${totalCollected} atomic units`
      );
      return collectedUtxos;
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
  async submitTransaction(rawHex: string): Promise<{ rawHex: string }> {
    try {
      const response = await this.mnee.submitRawTx(rawHex);
      const ticketId = response.ticketId;
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
