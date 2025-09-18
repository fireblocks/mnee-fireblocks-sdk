import axios, { AxiosInstance, AxiosError } from "axios";
import { Transaction, Utils } from "@bsv/sdk";
import {
  MNEEConfig,
  TransactionForAddress,
  UTXO_v2 as UTXO,
} from "../config/types.js";
import { Logger } from "../utils/logger.js";
import "dotenv/config.js";

/**
 * Service for interacting with MNEE cosigner
 */
export class CosignerService {
  private endpoint: string;
  private axiosInstance: AxiosInstance;
  private config: MNEEConfig | null = null;
  private authToken: string;
  private logger: Logger;

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

    this.logger.debug(`CosignerService initialized with endpoint: ${endpoint}`);
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
      const response = await this.axiosInstance.get(
        `${this.endpoint}/v1/config`
      );
      this.config = response.data;
      this.logger.debug("MNEE configuration fetched successfully");
      return this.config;
    } catch (error) {
      this.logger.error("Error fetching MNEE config:", error);
      throw error;
    }
  }

  /**
   * Retry a function with exponential backoff
   * @param fn Function to retry
   * @param maxRetries Maximum number of retries
   * @param baseDelay Base delay in milliseconds
   * @returns Promise resolving to the function result
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (attempt === maxRetries) {
          this.logger.error(`All ${maxRetries + 1} attempts failed:`, error);
          throw error;
        }

        const delay = baseDelay * Math.pow(2, attempt);
        this.logger.warn(
          `Attempt ${attempt + 1} failed, retrying in ${delay}ms:`,
          error
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  /**
   * Fetch UTXOs for given addresses
   * @param addresses BSV addresses to get UTXOs for
   * @param page Page number (1-based)
   * @param limit Number of UTXOs per page
   * @returns Promise resolving to array of UTXOs
   */
  async fetchUtxos(
    addresses: string[],
    page: number,
    limit: number = 100
  ): Promise<UTXO[]> {
    return this.retryWithBackoff(async () => {
      try {
        this.logger.debug(
          `Fetching UTXOs for ${addresses.length} addresses (page ${page}, limit ${limit})`
        );
        const response = await this.axiosInstance.post(
          `${this.endpoint}/v2/utxos?page=${page}&limit=${limit}&order=desc`,
          addresses
        );
        this.logger.debug(
          `Fetched ${response.data.length} UTXOs from page ${page}`
        );
        return response.data;
      } catch (error) {
        this.logger.error(
          `Error fetching UTXOs (page ${page}):`,
          error instanceof Error ? error.message : error
        );
        throw error;
      }
    });
  }

  async fetchBalancesForAddresses(
    addresses: string[]
  ): Promise<{ address: string; amt: number; precised: number }[]> {
    try {
      this.logger.debug(`Fetching balances for ${addresses.length} addresses`);
      const response = await this.axiosInstance.post(
        `${this.endpoint}/v2/balance`,
        addresses
      );

      return response.data;
    } catch (error) {
      this.logger.error("Error fetching balances:", error);
      throw error;
    }
  }

  /**
   * Fetch transaction by transaction ID
   * @param txid Transaction ID
   * @returns Promise resolving to Transaction object
   */
  async fetchTransaction(txid: string): Promise<Transaction> {
    try {
      const response = await this.axiosInstance.get(
        `${this.endpoint}/v1/tx/${txid}`
      );
      if (!response.data || !response.data.rawtx) {
        throw new Error("Failed to fetch transaction");
      }

      return Transaction.fromBinary(
        Utils.toArray(response.data.rawtx, "base64")
      );
    } catch (error) {
      console.error(`Error fetching transaction ${txid}:`, error);
      throw error;
    }
  }

  /**
   * Submit a signed transaction
   * @param rawTxBase64 Base64 encoded transaction
   * @returns Promise resolving to transaction response
   */
  async submitTransaction(rawTxBase64: string): Promise<{ rawtx: string }> {
    try {
      this.logger.info("Submitting transaction to v2 API");
      const response = await this.axiosInstance.post(
        `${this.endpoint}/v2/transfer`,
        { rawtx: rawTxBase64 }
      );

      // v2 API returns a ticket ID instead of immediate transaction result
      const ticketId = response.data;
      if (!ticketId) {
        throw new Error("No ticket ID received from v2 transfer API");
      }

      this.logger.info(
        `Transaction submitted, received ticket ID: ${ticketId}`
      );

      // Poll for transaction result
      return await this.pollTransactionResult(ticketId);
    } catch (error) {
      this.logger.error("Error submitting transaction:", error);

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

  /**
   * Poll for transaction result using ticket ID
   * @param ticketId Ticket ID from transaction submission
   * @returns Promise resolving to transaction response
   */
  private async pollTransactionResult(
    ticketId: string
  ): Promise<{ rawtx: string }> {
    const maxAttempts = 30; // Maximum polling attempts
    const pollInterval = 2000; // 2 seconds between polls

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        this.logger.debug(
          `Polling for transaction result (attempt ${attempt}/${maxAttempts})`
        );

        const response = await this.axiosInstance.get(
          `${this.endpoint}/v2/ticket`,
          {
            params: {
              ticketID: ticketId,
            },
          }
        );

        const status = response.data.status;
        this.logger.debug(`Transaction ticket ${ticketId} status: ${status}`);

        switch (status) {
          case "BROADCASTING":
            // Transaction is being broadcast to the network
            this.logger.debug(
              "Transaction is being broadcast, continuing to poll"
            );
            if (attempt < maxAttempts) {
              await new Promise((resolve) => setTimeout(resolve, pollInterval));
            }
            break;

          case "SUCCESS":
            if (!response.data.tx_hex) {
              throw new Error(
                "Transaction succeeded but no tx_hex in response"
              );
            }
            this.logger.info(
              `Transaction completed successfully after ${attempt} poll(s)`
            );
            // Convert hex to base64 to match expected format
            const txHex = response.data.tx_hex;
            const txBase64 = Buffer.from(txHex, "hex").toString("base64");
            return { rawtx: txBase64 };

          case "FAILURE":
            const errorMessage =
              response.data.error ||
              response.data.message ||
              "Transaction failed";
            this.logger.error(`Transaction failed: ${errorMessage}`);
            throw new Error(`Transaction failed: ${errorMessage}`);

          case "PENDING":
          case "PROCESSING":
            // Continue polling
            if (attempt < maxAttempts) {
              this.logger.debug(
                `Transaction still processing, waiting ${pollInterval}ms before next poll`
              );
              await new Promise((resolve) => setTimeout(resolve, pollInterval));
            }
            break;

          default:
            this.logger.warn(`Unknown transaction status: ${status}`);
            if (attempt < maxAttempts) {
              await new Promise((resolve) => setTimeout(resolve, pollInterval));
            }
            break;
        }
      } catch (error) {
        if (attempt === maxAttempts) {
          this.logger.error(
            `Failed to get transaction result after ${maxAttempts} attempts:`,
            error
          );
          throw new Error(`Failed to get transaction result: ${error.message}`);
        }

        this.logger.warn(
          `Polling attempt ${attempt} failed, retrying:`,
          error.message
        );
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }
    }

    throw new Error(
      `Transaction polling timed out after ${maxAttempts} attempts`
    );
  }

  async getTransactionsForAddresses(
    addresses: string[]
  ): Promise<TransactionForAddress[]> {
    try {
      const response = await this.axiosInstance.post(
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
