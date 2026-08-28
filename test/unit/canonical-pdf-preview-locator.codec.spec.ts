import {
  PDF_PREVIEW_LOCATOR_TTL_MS,
  createCanonicalPdfPreviewLocatorCodec,
  type CanonicalPdfPreviewGrant,
  type CanonicalPdfPreviewLocatorCodec,
} from '../../server/modules/canonical-host/canonical-pdf-preview-locator.codec';

const ISSUED_AT_MS = 1_787_900_000_000;
const LOCATOR_KEY = Buffer.alloc(32, 0x31).toString('base64url');
const SAME_KEY_STANDARD_BASE64 = Buffer.alloc(32, 0x31).toString('base64');
const OTHER_LOCATOR_KEY = Buffer.alloc(32, 0x72).toString('base64url');

function grant(): CanonicalPdfPreviewGrant {
  return {
    version: 1,
    actorUserId: 'RAW-ACTOR-1001',
    tenantId: 'RAW-TENANT-2001',
    appId: 'RAW-APP-3001',
    env: 'preview',
    workItemId: 'RAW-WORKITEM-4001',
    requestId: 'RAW-REQUEST-5001',
    workItemRevision: 7,
    documentVersionId: 'RAW-DOCUMENT-VERSION-6001',
    sourceArtifactId: 'RAW-SOURCE-ARTIFACT-7001',
    sourceSha256:
      'add81922feb6f0ed745c5d4ca85ecce1c9fcbf97fe5ae8593d27949122cf0298',
    sourceByteLength: 1_060_000,
    providerObjectId: 'RAW-PROVIDER-OBJECT-8001',
    issuedAtMs: ISSUED_AT_MS,
    expiresAtMs: ISSUED_AT_MS + PDF_PREVIEW_LOCATOR_TTL_MS,
  };
}

describe('CanonicalPdfPreviewLocatorCodec', () => {
  it('allows a second codec instance with the same 32-byte key to authenticate and decrypt', () => {
    const issuer: CanonicalPdfPreviewLocatorCodec =
      createCanonicalPdfPreviewLocatorCodec(LOCATOR_KEY);
    const reader: CanonicalPdfPreviewLocatorCodec =
      createCanonicalPdfPreviewLocatorCodec(SAME_KEY_STANDARD_BASE64);
    const value: CanonicalPdfPreviewGrant = grant();
    const locator: string = issuer.encode(value);

    expect(issuer).not.toBe(reader);
    expect(reader.decode(locator, ISSUED_AT_MS + 1)).toEqual({
      status: 'VALID',
      grant: value,
    });
  });

  it('exposes only a version and AEAD ciphertext to the browser', () => {
    const codec: CanonicalPdfPreviewLocatorCodec =
      createCanonicalPdfPreviewLocatorCodec(LOCATOR_KEY);
    const value: CanonicalPdfPreviewGrant = grant();
    const locator: string = codec.encode(value);
    const serialized: string = JSON.stringify({ opaqueLocator: locator });

    expect(locator).toMatch(/^v1\.[A-Za-z0-9_-]+$/u);
    for (const rawValue of [
      value.actorUserId,
      value.tenantId,
      value.appId,
      value.workItemId,
      value.requestId,
      value.documentVersionId,
      value.sourceArtifactId,
      value.sourceSha256,
      value.providerObjectId,
      LOCATOR_KEY,
      SAME_KEY_STANDARD_BASE64,
    ]) {
      expect(serialized).not.toContain(rawValue);
    }
  });

  it('returns the same not-found result for a different key, tampering, unknown version, and malformed input', () => {
    const issuer: CanonicalPdfPreviewLocatorCodec =
      createCanonicalPdfPreviewLocatorCodec(LOCATOR_KEY);
    const otherKey: CanonicalPdfPreviewLocatorCodec =
      createCanonicalPdfPreviewLocatorCodec(OTHER_LOCATOR_KEY);
    const locator: string = issuer.encode(grant());
    const tampered: string = `${locator.slice(0, -1)}${
      locator.endsWith('A') ? 'B' : 'A'
    }`;

    for (const result of [
      otherKey.decode(locator, ISSUED_AT_MS + 1),
      issuer.decode(tampered, ISSUED_AT_MS + 1),
      issuer.decode(locator.replace(/^v1\./u, 'v2.'), ISSUED_AT_MS + 1),
      issuer.decode(` ${locator}`, ISSUED_AT_MS + 1),
      issuer.decode('v1.invalid*base64url', ISSUED_AT_MS + 1),
    ]) {
      expect(result).toEqual({ status: 'NOT_FOUND' });
    }
  });

  it('distinguishes an authenticated expired locator from invalid locators', () => {
    const codec: CanonicalPdfPreviewLocatorCodec =
      createCanonicalPdfPreviewLocatorCodec(LOCATOR_KEY);
    const locator: string = codec.encode(grant());

    expect(
      codec.decode(locator, ISSUED_AT_MS + PDF_PREVIEW_LOCATOR_TTL_MS),
    ).toEqual({ status: 'EXPIRED' });
  });

  it('rejects missing, malformed, whitespace-padded, and wrong-length keys', () => {
    for (const encodedKey of [
      undefined,
      '',
      'not-base64',
      ` ${LOCATOR_KEY}`,
      `${LOCATOR_KEY}\n`,
      Buffer.alloc(31, 0x31).toString('base64url'),
      Buffer.alloc(33, 0x31).toString('base64'),
    ]) {
      const codec: CanonicalPdfPreviewLocatorCodec =
        createCanonicalPdfPreviewLocatorCodec(encodedKey);
      expect(codec.configured).toBe(false);
      expect(codec.decode('v1.AAAA', ISSUED_AT_MS)).toEqual({
        status: 'NOT_FOUND',
      });
      expect(() => codec.encode(grant())).toThrow(
        'PDF_PREVIEW_LOCATOR_NOT_CONFIGURED',
      );
    }
  });
});
