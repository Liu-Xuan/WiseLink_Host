import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import type { Provider } from '@nestjs/common';

export const CANONICAL_PDF_PREVIEW_LOCATOR_CODEC = Symbol(
  'CANONICAL_PDF_PREVIEW_LOCATOR_CODEC',
);
export const PDF_PREVIEW_LOCATOR_KEY_ENV = 'WISELINK_PDF_PREVIEW_LOCATOR_KEY';
export const PDF_PREVIEW_LOCATOR_TTL_MS = 12 * 60 * 1000;
export const PDF_PREVIEW_MAX_SOURCE_BYTES = 25 * 1024 * 1024;

const LOCATOR_VERSION = 'v1';
const PAYLOAD_VERSION = 1;
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const MAX_LOCATOR_BINARY_BYTES = 6 * 1024;
const MAX_LOCATOR_TEXT_BYTES = 8 * 1024;
const LOCATOR_AAD = Buffer.from(
  'wiselink.canonical-pdf-preview.locator.v1',
  'utf8',
);

export interface CanonicalPdfPreviewGrant {
  version: 1;
  actorUserId: string;
  tenantId: string;
  appId: string;
  env: string;
  workItemId: string;
  requestId: string;
  workItemRevision: number;
  documentVersionId: string;
  sourceArtifactId: string;
  sourceSha256: string;
  sourceByteLength: number;
  providerObjectId: string;
  issuedAtMs: number;
  expiresAtMs: number;
}

export type CanonicalPdfPreviewLocatorReadResult =
  | { status: 'VALID'; grant: CanonicalPdfPreviewGrant }
  | { status: 'NOT_FOUND' }
  | { status: 'EXPIRED' };

export interface CanonicalPdfPreviewLocatorCodec {
  readonly configured: boolean;
  encode(grant: CanonicalPdfPreviewGrant): string;
  decode(
    opaqueLocator: string,
    nowMs: number,
  ): CanonicalPdfPreviewLocatorReadResult;
}

export function createCanonicalPdfPreviewLocatorCodec(
  encodedKey: string | undefined,
): CanonicalPdfPreviewLocatorCodec {
  const key: Buffer | null = strictLocatorKey(encodedKey);
  return {
    configured: key !== null,
    encode(grant: CanonicalPdfPreviewGrant): string {
      if (!key) throw new Error('PDF_PREVIEW_LOCATOR_NOT_CONFIGURED');
      const validated: CanonicalPdfPreviewGrant | null = validGrant(grant);
      if (!validated) throw new Error('PDF_PREVIEW_LOCATOR_PAYLOAD_INVALID');
      const nonce: Buffer = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, nonce, {
        authTagLength: AUTH_TAG_BYTES,
      });
      cipher.setAAD(LOCATOR_AAD);
      const ciphertext: Buffer = Buffer.concat([
        cipher.update(JSON.stringify(validated), 'utf8'),
        cipher.final(),
      ]);
      const locatorBytes: Buffer = Buffer.concat([
        nonce,
        ciphertext,
        cipher.getAuthTag(),
      ]);
      if (locatorBytes.byteLength > MAX_LOCATOR_BINARY_BYTES) {
        throw new Error('PDF_PREVIEW_LOCATOR_PAYLOAD_TOO_LARGE');
      }
      return `${LOCATOR_VERSION}.${locatorBytes.toString('base64url')}`;
    },
    decode(
      opaqueLocator: string,
      nowMs: number,
    ): CanonicalPdfPreviewLocatorReadResult {
      if (!key) return { status: 'NOT_FOUND' };
      const locatorBytes: Buffer | null = strictLocatorBytes(opaqueLocator);
      if (!locatorBytes) return { status: 'NOT_FOUND' };
      try {
        const nonce: Buffer = locatorBytes.subarray(0, NONCE_BYTES);
        const authTag: Buffer = locatorBytes.subarray(-AUTH_TAG_BYTES);
        const ciphertext: Buffer = locatorBytes.subarray(
          NONCE_BYTES,
          -AUTH_TAG_BYTES,
        );
        const decipher = createDecipheriv('aes-256-gcm', key, nonce, {
          authTagLength: AUTH_TAG_BYTES,
        });
        decipher.setAAD(LOCATOR_AAD);
        decipher.setAuthTag(authTag);
        const plaintext: Buffer = Buffer.concat([
          decipher.update(ciphertext),
          decipher.final(),
        ]);
        const grant: CanonicalPdfPreviewGrant | null = validGrant(
          JSON.parse(plaintext.toString('utf8')),
        );
        if (!grant) return { status: 'NOT_FOUND' };
        if (nowMs >= grant.expiresAtMs) return { status: 'EXPIRED' };
        return { status: 'VALID', grant };
      } catch {
        return { status: 'NOT_FOUND' };
      }
    },
  };
}

export function canonicalPdfPreviewLocatorCodecProvider(): Provider {
  return {
    provide: CANONICAL_PDF_PREVIEW_LOCATOR_CODEC,
    useFactory: (): CanonicalPdfPreviewLocatorCodec =>
      createCanonicalPdfPreviewLocatorCodec(
        process.env[PDF_PREVIEW_LOCATOR_KEY_ENV],
      ),
  };
}

function strictLocatorKey(value: string | undefined): Buffer | null {
  const normalized: string = value ?? '';
  if (/^[A-Za-z0-9_-]{43}$/u.test(normalized)) {
    const key: Buffer = Buffer.from(normalized, 'base64url');
    return key.byteLength === 32 && key.toString('base64url') === normalized
      ? key
      : null;
  }
  if (/^[A-Za-z0-9+/]{43}=$/u.test(normalized)) {
    const key: Buffer = Buffer.from(normalized, 'base64');
    return key.byteLength === 32 && key.toString('base64') === normalized
      ? key
      : null;
  }
  return null;
}

function strictLocatorBytes(value: string): Buffer | null {
  const normalized: string = value;
  if (
    normalized.length > MAX_LOCATOR_TEXT_BYTES ||
    !normalized.startsWith(`${LOCATOR_VERSION}.`)
  ) {
    return null;
  }
  const encoded: string = normalized.slice(LOCATOR_VERSION.length + 1);
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) return null;
  const locatorBytes: Buffer = Buffer.from(encoded, 'base64url');
  if (
    locatorBytes.toString('base64url') !== encoded ||
    locatorBytes.byteLength <= NONCE_BYTES + AUTH_TAG_BYTES ||
    locatorBytes.byteLength > MAX_LOCATOR_BINARY_BYTES
  ) {
    return null;
  }
  return locatorBytes;
}

function validGrant(value: unknown): CanonicalPdfPreviewGrant | null {
  if (!isRecord(value)) return null;
  const keys = [
    'version',
    'actorUserId',
    'tenantId',
    'appId',
    'env',
    'workItemId',
    'requestId',
    'workItemRevision',
    'documentVersionId',
    'sourceArtifactId',
    'sourceSha256',
    'sourceByteLength',
    'providerObjectId',
    'issuedAtMs',
    'expiresAtMs',
  ] as const;
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !(key in value))
  ) {
    return null;
  }
  const stringKeys = [
    'actorUserId',
    'tenantId',
    'appId',
    'env',
    'workItemId',
    'requestId',
    'documentVersionId',
    'sourceArtifactId',
    'sourceSha256',
    'providerObjectId',
  ] as const;
  if (
    value.version !== PAYLOAD_VERSION ||
    stringKeys.some((key) => !boundedString(value[key])) ||
    !nonNegativeSafeInteger(value.workItemRevision) ||
    !positiveSafeInteger(value.sourceByteLength) ||
    Number(value.sourceByteLength) > PDF_PREVIEW_MAX_SOURCE_BYTES ||
    !positiveSafeInteger(value.issuedAtMs) ||
    !positiveSafeInteger(value.expiresAtMs) ||
    Number(value.expiresAtMs) - Number(value.issuedAtMs) !==
      PDF_PREVIEW_LOCATOR_TTL_MS
  ) {
    return null;
  }
  return value as unknown as CanonicalPdfPreviewGrant;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown): boolean {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= 2 * 1024
  );
}

function positiveSafeInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeSafeInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
