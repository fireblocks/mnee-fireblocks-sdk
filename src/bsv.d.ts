declare module 'bsv' {
  export class Transaction {
    static Input: {
      new(options: any): any;
    };
    static Output: {
      new(options: any): any;
    };
    
    inputs: Array<any>;
    outputs: Array<any>;
    
    constructor();
    
    addInput(input: any): this;
    addOutput(output: any): this;
    sighash(
      inputNumber: number, 
      subscript: any,
      satoshis: number,
      sigHashType: number
    ): Buffer;
    toString(format?: string): string;
  }

  export class Script {
    static fromHex(hex: string): any;
    static buildPublicKeyHashOut(address: any): any;
    static buildPublicKeyHashIn(publicKey: any, signature: Buffer | any): any;
    
    constructor();
    add(data: any): this;
    toHex(): string;
  }

  export class PrivateKey {
    static fromString(str: string): PrivateKey;
    static fromWIF(wif: string): PrivateKey;
    
    toPublicKey(): PublicKey;
    toString(): string;
    toWIF(): string;
    toAddress(): Address;
  }

  export class PublicKey {
    static fromString(str: string): PublicKey;
    static fromPrivateKey(privateKey: PrivateKey): PublicKey;
    
    toString(): string;
    toAddress(): Address;
  }

  export class Signature {
    static fromObject(obj: {r: Buffer, s: Buffer, nhashtype?: number}): Signature;
    
    toDER(): Buffer;
  }

  export class Address {
    static fromString(str: string): Address;
    static fromPublicKey(publicKey: PublicKey): Address;
    
    toString(): string;
    toScript(): Script;
  }

  export class Signature {
    static fromObject(obj: {r: Buffer, s: Buffer, nhashtype?: number}): Signature;
    static SIGHASH_ALL: number;
    static SIGHASH_NONE: number;
    static SIGHASH_SINGLE: number;
    static SIGHASH_FORKID: number;
    static SIGHASH_ANYONECANPAY: number;
    
    toDER(): Buffer;
  };
}