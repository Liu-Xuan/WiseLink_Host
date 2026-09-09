import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

/** Short-lived user delegation, encrypted separately from the opaque Host cookie. */
export function ailyAgentId(): string | null {
  const value = process.env.WL_AILY_AGENT_ID;
  return value && /^agent_[a-zA-Z0-9]+$/u.test(value) ? value : null;
}

function key(): Buffer {
  const secret = process.env.FEISHU_OAUTH_CLIENT_SECRET;
  const clientId = process.env.FEISHU_OAUTH_CLIENT_ID;
  if (!secret || !clientId) throw new Error('AILY_USER_GRANT_NOT_CONFIGURED');
  return Buffer.from(
    hkdfSync('sha256', secret, clientId, 'wiselink:aily-user-grant:v1', 32),
  );
}

export function sealAilyUserGrant(
  accessToken: string,
  binding: string,
): string {
  if (!accessToken || !binding) throw new Error('AILY_USER_GRANT_INVALID');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), nonce);
  cipher.setAAD(Buffer.from(binding));
  const ciphertext = Buffer.concat([
    cipher.update(accessToken, 'utf8'),
    cipher.final(),
  ]);
  return [
    'v1',
    nonce.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function openAilyUserGrant(sealed: string, binding: string): string {
  try {
    const [version, nonce, tag, ciphertext, extra] = sealed.split('.');
    if (
      version !== 'v1' ||
      !nonce ||
      !tag ||
      !ciphertext ||
      extra !== undefined
    )
      throw new Error();
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key(),
      Buffer.from(nonce, 'base64url'),
    );
    decipher.setAAD(Buffer.from(binding));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('AILY_USER_GRANT_UNAVAILABLE');
  }
}
