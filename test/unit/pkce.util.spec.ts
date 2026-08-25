import 'reflect-metadata';

import { generatePkcePair, isValidPkceVerifier } from '../../server/modules/identity/pkce.util';

describe('PKCE utility', () => {
  describe('generatePkcePair', () => {
    it('produces a pair with S256 method', () => {
      const pair = generatePkcePair();
      expect(pair.codeChallengeMethod).toBe('S256');
    });

    it('produces a verifier of valid length (43-128 chars)', () => {
      const pair = generatePkcePair();
      expect(pair.codeVerifier.length).toBeGreaterThanOrEqual(43);
      expect(pair.codeVerifier.length).toBeLessThanOrEqual(128);
    });

    it('produces a challenge of valid length (43-128 chars)', () => {
      const pair = generatePkcePair();
      expect(pair.codeChallenge.length).toBeGreaterThanOrEqual(43);
      expect(pair.codeChallenge.length).toBeLessThanOrEqual(128);
    });

    it('produces different verifiers on each call (random)', () => {
      const pair1 = generatePkcePair();
      const pair2 = generatePkcePair();
      const pair3 = generatePkcePair();
      expect(pair1.codeVerifier).not.toBe(pair2.codeVerifier);
      expect(pair2.codeVerifier).not.toBe(pair3.codeVerifier);
      expect(pair1.codeVerifier).not.toBe(pair3.codeVerifier);
    });

    it('produces a challenge that matches SHA256(verifier) base64url', async () => {
      const { createHash } = await import('node:crypto');
      const pair = generatePkcePair();
      const expected = createHash('sha256')
        .update(pair.codeVerifier)
        .digest('base64url');
      expect(pair.codeChallenge).toBe(expected);
    });

    it('uses only unreserved characters in verifier and challenge', () => {
      const pair = generatePkcePair();
      // RFC 7636: unreserved = [A-Za-z0-9-._~]
      const unreserved = /^[A-Za-z0-9._~-]+$/;
      expect(unreserved.test(pair.codeVerifier)).toBe(true);
      expect(unreserved.test(pair.codeChallenge)).toBe(true);
    });
  });

  describe('isValidPkceVerifier', () => {
    it('accepts a generated verifier', () => {
      const pair = generatePkcePair();
      expect(isValidPkceVerifier(pair.codeVerifier)).toBe(true);
    });

    it('rejects empty string', () => {
      expect(isValidPkceVerifier('')).toBe(false);
    });

    it('rejects a too-short verifier (< 43 chars)', () => {
      expect(isValidPkceVerifier('short')).toBe(false);
    });

    it('rejects a too-long verifier (> 128 chars)', () => {
      expect(isValidPkceVerifier('a'.repeat(129))).toBe(false);
    });

    it('rejects invalid characters (spaces, +, /)', () => {
      expect(isValidPkceVerifier('a'.repeat(40) + ' +/')).toBe(false);
    });
  });
});
