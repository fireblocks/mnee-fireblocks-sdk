import { LockingScript, UnlockingScript, OP, PublicKey, Utils } from "@bsv/sdk";

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

  /**
   * Creates a function that generates a P2PKH unlocking script along with its signature and length estimation.
   *
   * @param {string} userSignature - DER encoded signature with hash type
   * @param {string} userPubKey - User's public key in hex
   * @param {string} signOutputs - The signature scope for outputs
   * @param {boolean} anyoneCanPay - Flag indicating if the signature allows for other inputs to be added later
   * @returns {Object} - An object containing the `getUnlockingScript` and `estimateLength` functions
   */
  userUnlock(
    userSignature: string,
    userPubKey: string,
    signOutputs: 'all'|'none'|'single' = 'all',
    anyoneCanPay: boolean = false
  ): {
    getUnlockingScript: () => UnlockingScript;
    estimateLength: () => number;
  } {
    return {
      getUnlockingScript: (): UnlockingScript => {
        const unlockScript = new UnlockingScript();
        unlockScript.writeBin(Utils.toArray(userSignature, "hex"));
        unlockScript.writeBin(Utils.toArray(userPubKey, "hex"));
        return unlockScript;
      },
      estimateLength: (): number => {
        return 108;
      },
    };
  }
}