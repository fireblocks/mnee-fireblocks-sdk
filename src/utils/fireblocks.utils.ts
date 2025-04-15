import {
  CreateTransactionResponse,
  Fireblocks,
  TransactionResponse,
  TransactionStateEnum,
} from "@fireblocks/ts-sdk";

/**
 * Wait for a transaction signature from Fireblocks
 * @param tx Transaction request response
 * @param fireblocksApiClient Fireblocks API client
 * @param pollingInterval Optional polling interval in ms
 * @returns Promise resolving to transaction response
 */
export const waitForSignature = async (
  tx: CreateTransactionResponse,
  fireblocksApiClient: Fireblocks,
  pollingInterval?: number
): Promise<TransactionResponse | undefined> => {
  let txResponse = await fireblocksApiClient.transactions.getTransaction({
    txId: tx.id,
  });
  let lastStatus = txResponse.data.status;

  console.log(
    `Transaction ${txResponse.data.id} is currently at status - ${txResponse.data.status}`
  );

  while (
    txResponse.data.status !== TransactionStateEnum.Completed &&
    txResponse.data.status !== TransactionStateEnum.Broadcasting
  ) {
    await new Promise((resolve) =>
      setTimeout(resolve, pollingInterval || 2000)
    );

    txResponse = await fireblocksApiClient.transactions.getTransaction({
      txId: tx.id,
    });

    if (txResponse.data.status !== lastStatus) {
      console.log(
        `Transaction ${txResponse.data.id} is currently at status - ${txResponse.data.status}`
      );
      lastStatus = txResponse.data.status;
    }

    switch (txResponse.data.status) {
      case TransactionStateEnum.Blocked:
      case TransactionStateEnum.Cancelled:
      case TransactionStateEnum.Failed:
      case TransactionStateEnum.Rejected:
        throw new Error(
          `Signing request failed/blocked/cancelled: Transaction: ${txResponse.data.id} status is ${txResponse.data.status}\nSub-Status: ${txResponse.data.subStatus}`
        );
      default:
        break;
    }
  }

  return txResponse.data;
};
