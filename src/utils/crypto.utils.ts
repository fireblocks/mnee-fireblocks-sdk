import { createHash } from "crypto";
import { FireblocksSignature } from "../config/types.js";
import { Logger } from "./logger.js";

// Create a logger instance
const logger = new Logger('CryptoUtils');

/**
 * Converts buffer to DER format
 * @param buffer Buffer to convert
 * @returns DER formatted buffer
 */
export function toDER(buffer: Buffer): Buffer {
  let i = 0;
  while (buffer[i] === 0) ++i;
  if (i === buffer.length) 
    return Buffer.alloc(1);
  buffer = buffer.slice(i);
  if (buffer[0] & 0x80)
    return Buffer.concat([Buffer.alloc(1), buffer], 1 + buffer.length);
  
  return buffer;
}

/**
 * Encodes r and s values into DER signature format
 * @param r R value as Buffer
 * @param s S value as Buffer
 * @returns DER encoded signature
 */
export function encodeDER(r: Buffer, s: Buffer): Buffer {
  const lenR = r.length;
  const lenS = s.length;
  
  if (lenR === 0) throw new Error('R length is zero');
  if (lenS === 0) throw new Error('S length is zero');
  if (lenR > 33) throw new Error('R length is too long');
  if (lenS > 33) throw new Error('S length is too long');
  if (r[0] & 0x80) throw new Error('R value is negative');
  if (s[0] & 0x80) throw new Error('S value is negative');
  if (lenR > 1 && (r[0] === 0x00) && !(r[1] & 0x80)) 
    throw new Error('R value excessively padded');
  if (lenS > 1 && (s[0] === 0x00) && !(s[1] & 0x80)) 
    throw new Error('S value excessively padded');
  
  const signature = Buffer.allocUnsafe(6 + lenR + lenS);
  
  signature[0] = 0x30;
  signature[1] = signature.length - 2;
  signature[2] = 0x02;
  signature[3] = lenR;
  r.copy(signature, 4);
  signature[4 + lenR] = 0x02;
  signature[5 + lenR] = lenS;
  s.copy(signature, 6 + lenR);
  
  return signature;
}

/**
 * Create DER encoded signature with sighash type
 * @param signature Signature from Fireblocks
 * @param sigHashType Signature hash type
 * @returns DER signature with hash type appended
 */
export function createDERSignature(
  signature: FireblocksSignature,
  sigHashType: number
): string {
  try {
    // Convert hex strings to BigInts for validation
    const r = BigInt('0x' + signature.r);
    const s = BigInt('0x' + signature.s);
    
    // Curve order N (specific to secp256k1)
    const n = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
    const halfN = n / BigInt(2);
    
    // Normalize S value (ensure it's in the lower half of the curve)
    let normalizedS = s;
    if (s > halfN) {
      logger.debug('Normalizing S value to lower half of curve');
      normalizedS = n - s;
    }
    
    // Convert r and normalized S to Buffer for DER encoding
    const rBuffer = Buffer.from(r.toString(16).padStart(64, '0'), 'hex');
    const sBuffer = Buffer.from(normalizedS.toString(16).padStart(64, '0'), 'hex');
    
    // Use DER encoding functions
    const processedR = toDER(rBuffer);
    const processedS = toDER(sBuffer);
    
    // Encode to DER format
    const derSig = encodeDER(processedR, processedS);
    
    // Convert to hex and append sighash type
    const derHex = derSig.toString('hex');
    const sigHashHex = sigHashType.toString(16).padStart(2, '0');
    
    const fullSig = derHex + sigHashHex;
    logger.debug(`Created DER signature: ${fullSig.substring(0, 24)}...`);
    return fullSig;
  } catch (error) {
    logger.error('Error creating DER signature:', error);
    throw error;
  }
}

/**
 * Create a double SHA-256 hash of a buffer
 * @param buffer Data to hash
 * @returns Double SHA-256 hash
 */
export function doubleHash(buffer: Buffer): Buffer {
  return createHash("sha256").update(buffer).digest();
}