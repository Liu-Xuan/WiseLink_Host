import { createHash, randomBytes } from 'node:crypto';

/**
 * PKCE (Proof Key for Code Exchange) utilities.
 *
 * The server generates the code_verifier and derives the code_challenge
 * with S256. The code_verifier is stored server-side (in the opaque state
 * store) and sent only to the token endpoint — never to the browser.
 * The code_challenge is sent in the authorize redirect URL.
 *
 * R08: no caller-constructible identity field is involved here. PKCE
 * prevents authorization-code interception; it is not an identity proof.
 */
export interface PkcePair {
  /** Server-generated random verifier — sent only to the token endpoint. */
  codeVerifier: string;
  /** Base64url(SHA256(code_verifier)) — sent in the authorize URL. */
  codeChallenge: string;
  /** Always S256. */
  codeChallengeMethod: 'S256';
}

export function generatePkcePair(): PkcePair {
  // 32 random bytes → 43-char base64url string (RFC 7636 recommends 43-128).
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(
    createHash('sha256').update(codeVerifier).digest(),
  );
  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: 'S256',
  };
}

/**
 * Validate that a code_verifier / code_challenge pair is well-formed.
 * Used defensively on the token-exchange path; the state store already
 * holds the verifier, but the adapter must be safe in isolation.
 */
export function isValidPkceVerifier(value: string): boolean {
  // RFC 7636: 43-128 chars, unreserved base64url [A-Za-z0-9-._~]
  return (
    value.length >= 43 &&
    value.length <= 128 &&
    /^[A-Za-z0-9._~-]+$/.test(value)
  );
}

function base64url(bytes: Buffer): string {
  return bytes.toString('base64url');
}
