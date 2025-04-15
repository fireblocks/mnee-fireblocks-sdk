import axios, { AxiosInstance, AxiosError } from "axios";
import { Transaction, Utils } from "@bsv/sdk";
import { MNEEConfig, TransactionForAddress, UTXO } from "../config/types.js";
import { Logger } from "../utils/logger.js";
import 'dotenv/config.js';

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
    this.logger = new Logger('CosignerService');
    this.endpoint = endpoint;
    this.authToken = process.env.MNEE_COSIGNER_AUTH_TOKEN;

    if(!this.authToken) {
      this.logger.error("MNEE_COSIGNER_AUTH_TOKEN is not set in environment variables");
      throw new Error("MNEE_COSIGNER_AUTH_TOKEN is not set in environment variables");
    }

    this.axiosInstance = axios.create({
      params: {
        auth_token: this.authToken
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
      const response = await this.axiosInstance.get(`${this.endpoint}/config`);
      this.config = response.data;
      this.logger.debug("MNEE configuration fetched successfully");
      return this.config;
    } catch (error) {
      this.logger.error("Error fetching MNEE config:", error);
      throw error;
    }
  }

  /**
   * Fetch UTXOs for given addresses
   * @param addresses BSV addresses to get UTXOs for
   * @returns Promise resolving to array of UTXOs
   */
  async fetchUtxos(addresses: string[]): Promise<UTXO[]> {
    try {
      const response = await this.axiosInstance.post(
        `${this.endpoint}/utxos`,
        addresses
      );
      return response.data;
    } catch (error) {
      console.error("Error fetching UTXOs:", error);
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
        `${this.endpoint}/tx/${txid}`
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
      const response = await this.axiosInstance.post(
        `${this.endpoint}/transfer`,
        { rawtx: rawTxBase64 }
      );
      return response.data;
    } catch (error) {
      console.error("Error submitting transaction:", error);
      
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        const status = axiosError.response?.status;
        const errorData = axiosError.response?.data as any || {};

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

  async getTransactionsForAddresses(addresses: string[]): Promise<TransactionForAddress[]> {
    try {
      const response = await this.axiosInstance.post(
        `${this.endpoint}/sync`,
        addresses
      );
      return response.data;
    } catch (error) {
      console.error("Error fetching transactions:", error);
      throw error;
    }
  }
}