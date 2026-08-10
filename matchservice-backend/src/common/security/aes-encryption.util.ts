import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, the GCM-recommended size
const KEY_LENGTH = 32; // 256-bit key

/**
 * AES-256-GCM encrypt/decrypt for sensitive payloads that must be encrypted
 * at rest (device fingerprints, IP/geolocation hints — see FraudCheckLog).
 * Output is a single base64 string: iv || authTag || ciphertext, so callers
 * only ever handle one opaque string per field.
 *
 * FRAUD_ENCRYPTION_KEY is an arbitrary-length secret from .env — scrypt
 * derives a proper 256-bit key from it rather than requiring the operator to
 * hand-generate exactly 32 bytes.
 */
export class AesEncryption {
  private readonly key: Buffer;

  constructor(secret: string) {
    if (!secret || secret.length < 16) {
      throw new Error('FRAUD_ENCRYPTION_KEY must be set to a secret of at least 16 characters');
    }
    // Static salt is acceptable here: we're deriving one long-lived
    // application key from one long-lived secret, not hashing many
    // low-entropy user-supplied values (which is what a per-value salt
    // protects against).
    this.key = scryptSync(secret, 'matchservice-fraud-log-salt', KEY_LENGTH);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
  }

  decrypt(payload: string): string {
    const raw = Buffer.from(payload, 'base64');
    const iv = raw.subarray(0, IV_LENGTH);
    const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
    const ciphertext = raw.subarray(IV_LENGTH + 16);

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
