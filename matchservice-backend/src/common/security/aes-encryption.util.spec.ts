import { AesEncryption } from './aes-encryption.util';

describe('AesEncryption', () => {
  it('round-trips plaintext through encrypt/decrypt', () => {
    const enc = new AesEncryption('a-sufficiently-long-test-secret');
    const plaintext = JSON.stringify({ ip: '203.0.113.5', deviceId: 'abc-123', gpsCountryHint: 'US' });

    const ciphertext = enc.encrypt(plaintext);

    expect(ciphertext).not.toEqual(plaintext);
    expect(enc.decrypt(ciphertext)).toEqual(plaintext);
  });

  it('produces different ciphertext for the same plaintext each call (random IV)', () => {
    const enc = new AesEncryption('a-sufficiently-long-test-secret');
    const a = enc.encrypt('same input');
    const b = enc.encrypt('same input');
    expect(a).not.toEqual(b);
  });

  it('fails to decrypt with the wrong key', () => {
    const encA = new AesEncryption('secret-key-number-one-long-enough');
    const encB = new AesEncryption('secret-key-number-two-long-enough');
    const ciphertext = encA.encrypt('sensitive fraud payload');
    expect(() => encB.decrypt(ciphertext)).toThrow();
  });

  it('rejects a secret shorter than 16 characters', () => {
    expect(() => new AesEncryption('too-short')).toThrow(/at least 16 characters/);
  });
});
