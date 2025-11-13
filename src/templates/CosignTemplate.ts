import { LockingScript, OP, PublicKey, Utils } from "@bsv/sdk";

/**
 * Cosigning template for MNEE tokens
 */
export class CosignTemplate {
  /**
   * Creates a locking script for cosigned transactions
   * @param {string} userPKHash - Address or PKH of the user
   * @param {PublicKey} approverPubKey - Public key of the approver
   * @returns {LockingScript} - Locking script
   */
  lock(
    userPKHash: string | number[],
    approverPubKey: PublicKey
  ): LockingScript {
    let pkhash: number[] = [];
    if (typeof userPKHash === "string") {
      const hash = Utils.fromBase58Check(userPKHash);
      if (hash.prefix[0] !== 0x00 && hash.prefix[0] !== 0x6f)
        throw new Error("only P2PKH is supported");
      console.log("Valid Dest Address");
      pkhash = hash.data as number[];
    } else {
      pkhash = userPKHash;
    }

    const lockingScript = new LockingScript();
    lockingScript
      .writeOpCode(OP.OP_DUP)
      .writeOpCode(OP.OP_HASH160)
      .writeBin(pkhash)
      .writeOpCode(OP.OP_EQUALVERIFY)
      .writeOpCode(OP.OP_CHECKSIGVERIFY)
      .writeBin(Array.from(approverPubKey.encode(true) as number[]))
      .writeOpCode(OP.OP_CHECKSIG);

    return lockingScript;
  }
}