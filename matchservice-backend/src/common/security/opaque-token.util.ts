import { createHash, randomBytes } from 'crypto';

/**
 * Generates a high-entropy opaque token for refresh sessions, email
 * verification links and password-reset links. Only `hash` is ever
 * persisted (sha256 is fine here — unlike a password, this token is 256
 * bits of random data, not guessable, so no need for a slow KDF); `token`
 * is the one-time plaintext returned to the caller or embedded in a link.
 */
export function generateOpaqueToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('hex');
  return { token, hash: hashOpaqueToken(token) };
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
