import { createHash, webcrypto } from 'node:crypto';
import type { TdmsNativeReceiverBinding, TdmsUploadSelectionAssociationReceipt } from '@shared/tdms-receiver.interface';

const request = jest.fn();
const sourceRequest = jest.fn();
const upload = jest.fn();
const list = jest.fn();
const defaultBucket = jest.fn(() => 'synthetic-bucket');
const getDataloom = jest.fn(async () => ({ storage: { from: () => ({ list }) } }));
jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({ axiosForBackend: request }));
jest.mock('@lark-apaas/client-toolkit/tools/storage', () => ({ getDefaultBucketId: defaultBucket }));
jest.mock('@lark-apaas/client-toolkit/dataloom', () => ({ getDataloom }));
jest.mock('@client/src/components/business-ui/api/files/service', () => ({ uploadFile: upload }));

import { assertTdmsNativeRoute, tdmsExpectedReceiverHeader, tdmsNativeRequest } from '@client/src/api/tdms-source-native';
import { tdmsNativeBrowserBridge, installTdmsNativeHostBridge } from '@client/src/utils/tdms-native-host-bridge';

const raw = Buffer.from('synthetic original PDF');
const hash = createHash('sha256').update(raw).digest('hex');
const payloadDigest = 'a'.repeat(64);
const requestId = `TDMSIMPORT-${payloadDigest}`;
const bindingId = `TDMSBIND-${'b'.repeat(64)}`;
const storageName = `${requestId}_${bindingId}`;
const filePath = `tdms-source/uploads/${storageName}`;
const binding = { bindingId, ownerSnapshotId: `TDMSSNAP-${'c'.repeat(64)}`,
  sourceAttachmentId: 'synthetic-application-data', filename: 'original.pdf', mediaType: 'application/pdf',
  blobSha256: hash, byteLength: raw.length };
const pkg = { packageId: 'synthetic-package', artifactBindings: [binding] };
const receiver: TdmsNativeReceiverBinding = {
  schemaVersion: 'wiselink.tdms-native-host-receiver-binding.v1', receiverId: 'synthetic-receiver',
  tenantRef: 'synthetic-tenant', applicationRef: 'app_17bzc551rsg', principalRef: 'synthetic-user',
  sourceSystem: 'TDMS', sourceInstanceRef: 'synthetic-source', authorityRevision: 'synthetic-revision-1',
  authorityEvidenceRef: 'synthetic-authority-proof', sessionEvidenceRef: 'synthetic-session-1',
  observedAt: '2026-01-01T00:00:00.000Z',
};
type HttpInput = { url: string; method: string; data?: unknown; headers: Record<string, string> };
let currentReceiver: TdmsNativeReceiverBinding;
let beforeServerAuthorization: ((input: HttpInput) => void) | undefined;
const preflight = { status: 'AUTHORIZED_UPLOAD', requestId, bindingId, receiverId: 'synthetic-receiver', payloadDigest };
const association: TdmsUploadSelectionAssociationReceipt = {
  schemaVersion: 'wiselink.tdms-upload-selection-association.v1', requestId, bindingId,
  receiverId: preflight.receiverId, packageId: pkg.packageId, payloadDigest, status: 'STAGED_CANDIDATE',
  selection: { bucketId: 'synthetic-bucket', filePath, expectedProviderObjectId: 'synthetic-object' },
  sourceAttachmentId: binding.sourceAttachmentId, ownerSnapshotId: binding.ownerSnapshotId,
  sha256: hash, byteLength: raw.length, readbackVerified: true, documentVersionId: null,
};
const unavailable = () => ({ response: { status: 404,
  data: { error: { code: 'TDMS_UPLOAD_SELECTION_UNAVAILABLE' } } } });
const stage = (bytesBase64: string | null = raw.toString('base64')) =>
  tdmsNativeBrowserBridge.invoke({ operation: 'STAGE', requestId, bindingId, package: pkg,
    expectedReceiverBinding: receiver, ...(bytesBase64 === null ? {} : { bytesBase64 }) });

describe('same-origin native Source upload transport (synthetic external ports)', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
    request.mockReset(); sourceRequest.mockReset(); upload.mockReset(); list.mockReset(); getDataloom.mockClear(); defaultBucket.mockClear();
    currentReceiver = structuredClone(receiver);
    beforeServerAuthorization = undefined;
    list.mockResolvedValue({ error: null, data: [] });
    upload.mockResolvedValue({ id: 'synthetic-object', filePath, bucketId: 'synthetic-bucket', url: 'unused' });
    sourceRequest.mockImplementation(async (input: HttpInput) => {
      if (input.url.endsWith('/preflight')) return { status: 200, data: preflight };
      if (input.method === 'GET') throw unavailable();
      return { status: 200, data: association };
    });
    // This synthetic HTTP port models the server condition, not a browser
    // credential or a Source grant. Actual authorization has separate PG tests.
    request.mockImplementation(async (input: HttpInput) => {
      beforeServerAuthorization?.(input);
      const expected: TdmsNativeReceiverBinding = JSON.parse(Buffer.from(
        input.headers['X-WiseLink-TDMS-Expected-Receiver'], 'base64url').toString('utf8'));
      if (Object.keys(receiver).some((key: string) => key !== 'observedAt' &&
          expected[key as keyof TdmsNativeReceiverBinding] !== currentReceiver[key as keyof TdmsNativeReceiverBinding]))
        throw { response: { status: 409, data: { error: { code: 'TDMS_RECEIVER_IDENTITY_CHANGED' } } } };
      if (input.url.split('?')[0] === '/api/tdms-source-imports/receiver/binding')
        return { status: 200, data: structuredClone(currentReceiver) };
      return sourceRequest(input);
    });
  });

  it('does not provide an arbitrary authenticated route/method/body proxy', async () => {
    for (const route of ['/api/admin', '//evil.invalid/api/tdms-source-imports',
      '/api/../admin', '/api/tdms-source-imports?actor=other',
      '/api/tdms-source-refs?sourceRef=TDMS:ARTIFACT:x&actor=other'])
      expect(() => assertTdmsNativeRoute(route, 'POST')).toThrow('TDMS_NATIVE_ROUTE_FORBIDDEN');
    await expect(tdmsNativeRequest('/api/tdms-source-imports/original', 'GET', {}))
      .rejects.toMatchObject({ code: 'TDMS_NATIVE_GET_BODY_FORBIDDEN' });
    expect(request).not.toHaveBeenCalled();
  });

  it('requires exact member retention before any FileService lookup/upload', async () => {
    sourceRequest.mockRejectedValue({ response: { status: 403, data: { error: { code: 'TDMS_IMPORT_MEMBER_SCOPE_ADMISSION_REQUIRED' } } } });
    await expect(stage()).rejects.toMatchObject({ code: 'TDMS_IMPORT_MEMBER_SCOPE_ADMISSION_REQUIRED', statusCode: 403 });
    expect(getDataloom).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled();
  });

  it('does not treat an unrelated Source 404 as permission to acquire an original', async () => {
    sourceRequest.mockResolvedValueOnce({ status: 200, data: preflight })
      .mockRejectedValueOnce({ response: { status: 404, data: { error: { code: 'TDMS_SOURCE_NOT_FOUND' } } } });
    await expect(stage()).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND', statusCode: 404 });
    expect(list).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled();
  });

  it('stops before FileService when authority changes after an unavailable association', async () => {
    sourceRequest.mockImplementation(async (input: HttpInput) => {
      if (input.url.endsWith('/preflight')) return { status: 200, data: preflight };
      currentReceiver = { ...receiver, authorityRevision: 'synthetic-revision-2' };
      throw unavailable();
    });
    await expect(stage()).rejects.toMatchObject({ code: 'TDMS_RECEIVER_IDENTITY_CHANGED', statusCode: 409 });
    expect(list).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled();
  });

  it('uploads exact verified bytes through the existing official SDK and then associates the unchanged package', async () => {
    expect(await stage()).toEqual(association);
    expect(upload).toHaveBeenCalledTimes(1);
    const [file, options] = upload.mock.calls[0];
    expect(Buffer.from(await file.arrayBuffer())).toEqual(raw);
    expect(options).toEqual({ filePath, contentType: 'application/pdf', upsert: false });
    const call = request.mock.calls.find(([input]) => input.method === 'POST' && !input.url.endsWith('/preflight'))?.[0];
    expect(call.data.package).toBe(pkg);
    expect(call.data.selection).toEqual(association.selection);
    expect(Object.keys(call.data)).toEqual(['package', 'selection']);
    expect(association.documentVersionId).toBeNull();
    expect(sourceRequest.mock.calls[0][0].url).toMatch(/\/selection\/preflight$/u);
    for (const [input] of request.mock.calls)
      expect(JSON.parse(Buffer.from(input.headers['X-WiseLink-TDMS-Expected-Receiver'], 'base64url').toString('utf8'))).toEqual(receiver);
  });

  it('returns an exact retained candidate without requiring original bytes or another upload', async () => {
    sourceRequest.mockResolvedValueOnce({ status: 200, data: preflight }).mockResolvedValueOnce({ status: 200, data: association });
    expect(await stage(null)).toEqual(association);
    expect(upload).not.toHaveBeenCalled(); expect(defaultBucket).not.toHaveBeenCalled();
  });

  it('reconciles a lost SDK callback from the unique deterministic object without overwriting', async () => {
    list.mockResolvedValue({ error: null, data: [{ id: 'synthetic-object', name: storageName }] });
    expect(await stage()).toEqual(association);
    expect(upload).not.toHaveBeenCalled();
    expect(request.mock.calls.filter(([input]) => input.method === 'POST' && !input.url.endsWith('/preflight'))).toHaveLength(1);
  });

  it('rejects hash or length changes before FileService I/O', async () => {
    await expect(stage(Buffer.alloc(raw.length, 0).toString('base64')))
      .rejects.toMatchObject({ code: 'TDMS_NATIVE_ARTIFACT_BYTES_INVALID' });
    expect(list).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled();
  });

  it('keeps an unknown association POST single and recovers by the same request GET', async () => {
    let committed = false;
    sourceRequest.mockImplementation(async (input: HttpInput) => {
      if (input.url.endsWith('/preflight')) return { status: 200, data: preflight };
      if (input.method === 'GET') {
        if (!committed) throw unavailable();
        return { status: 200, data: association };
      }
      committed = true;
      throw { code: 'ECONNABORTED' };
    });
    await expect(stage()).rejects.toMatchObject({ code: 'TDMS_HOST_RECEIPT_UNKNOWN' });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(await stage(null)).toEqual(association);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.filter(([input]) => input.method === 'POST' && !input.url.endsWith('/preflight'))).toHaveLength(1);
  });

  it('does not retry an unknown physical upload', async () => {
    upload.mockRejectedValue(new Error('synthetic lost upload callback'));
    await expect(stage()).rejects.toMatchObject({ code: 'TDMS_NATIVE_UPLOAD_OUTCOME_UNKNOWN',
      phase: 'UPLOAD', requestId, bindingId, nextAction: 'READ_EXACT_UPLOAD_AND_SELECTION' });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.filter(([input]) => input.method === 'POST' && !input.url.endsWith('/preflight'))).toHaveLength(0);
  });

  it('does not hide a post-upload Source revocation or promote an orphan upload', async () => {
    sourceRequest.mockImplementation(async (input: HttpInput) => {
      if (input.url.endsWith('/preflight')) return { status: 200, data: preflight };
      if (input.method === 'GET') throw unavailable();
      throw { response: { status: 403, data: { error: { code: 'TDMS_SOURCE_PERMISSION_CHANGED' } } } };
    });
    await expect(stage()).rejects.toMatchObject({ code: 'TDMS_SOURCE_PERMISSION_CHANGED', statusCode: 403 });
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('refuses an association for different bytes or package despite a success marker', async () => {
    sourceRequest.mockResolvedValueOnce({ status: 200, data: preflight })
      .mockResolvedValueOnce({ status: 200, data: { ...association, packageId: 'wrong-package' } });
    await expect(stage()).rejects.toMatchObject({ code: 'TDMS_NATIVE_UPLOAD_ASSOCIATION_MISMATCH', statusCode: 409 });
    expect(upload).not.toHaveBeenCalled();
  });

  it('mounting publishes only a local callable bridge and performs no login, job or upload', () => {
    const old = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const target = { location: { protocol: 'https:', pathname: '/app/app_17bzc551rsg/library' } };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
    try {
      const cleanup = installTdmsNativeHostBridge();
      expect(Object.getOwnPropertyDescriptor(target, '__wiselinkTdmsNativeBridge')?.value).toBe(tdmsNativeBrowserBridge);
      expect(request).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled();
      cleanup(); expect(Object.hasOwn(target, '__wiselinkTdmsNativeBridge')).toBe(false);
    } finally {
      if (old) Object.defineProperty(globalThis, 'window', old);
      else Reflect.deleteProperty(globalThis, 'window');
    }
  });

  it('requires the original full receiver binding before any non-initial operation', async () => {
    await expect(tdmsNativeBrowserBridge.invoke({ operation: 'REQUEST', method: 'POST',
      route: '/api/tdms-source-imports', body: { requestId, package: pkg } }))
      .rejects.toMatchObject({ code: 'TDMS_NATIVE_EXPECTED_RECEIVER_REQUIRED', statusCode: 409 });
    expect(request).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled();
  });

  it('encodes all eleven receiver fields losslessly as a conditional header', () => {
    const expected = { ...receiver, authorityEvidenceRef: 'synthetic-授权依据' };
    const header = tdmsExpectedReceiverHeader(expected);
    expect(header).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(JSON.parse(Buffer.from(header, 'base64url').toString('utf8'))).toEqual(expected);
    expect(Object.keys(expected)).toHaveLength(11);
  });

  it('rejects a different actor at the actual POST after the preliminary receiver check', async () => {
    beforeServerAuthorization = (input: HttpInput) => {
      if (input.url === '/api/tdms-source-imports' && input.method === 'POST')
        currentReceiver = { ...receiver, principalRef: 'synthetic-user-B', sessionEvidenceRef: 'synthetic-session-B' };
    };
    await expect(tdmsNativeBrowserBridge.invoke({ operation: 'REQUEST', method: 'POST',
      route: '/api/tdms-source-imports', body: { requestId, package: { artifactBindings: [] } },
      expectedReceiverBinding: receiver }))
      .rejects.toMatchObject({ code: 'TDMS_RECEIVER_IDENTITY_CHANGED', statusCode: 409 });
    expect(request).toHaveBeenCalledTimes(2);
    expect(sourceRequest).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled();
  });

  it('stops an upload association when the session changes during the physical upload', async () => {
    upload.mockImplementation(async () => {
      currentReceiver = { ...receiver, sessionEvidenceRef: 'synthetic-new-session' };
      return { id: 'synthetic-object', filePath, bucketId: 'synthetic-bucket' };
    });
    await expect(stage()).rejects.toMatchObject({ code: 'TDMS_RECEIVER_IDENTITY_CHANGED', statusCode: 409 });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(sourceRequest.mock.calls.filter(([input]) => input.method === 'POST' && !input.url.endsWith('/preflight'))).toHaveLength(0);
  });

  const registered = {
    schemaVersion: 'wiselink.tdms-formal-document-registration.v1', requestId, bindingId,
    receiverId: receiver.receiverId, payloadDigest, documentUploadRequestId: 'synthetic-upload',
    sourceAttachmentId: binding.sourceAttachmentId, sourceAttachmentVersion: null,
    status: 'COMMITTED', documentVersionId: 'synthetic-real-port-dvi', preflightId: 'synthetic-preflight',
    sha256: hash, byteLength: raw.length, readbackVerified: true, mappedAt: '2026-10-18T00:00:00.000Z',
  };
  const registrationMissing = () => ({ response: { status: 404,
    data: { code: 'TDMS_FORMAL_REGISTRATION_UNAVAILABLE' } } });
  const register = () => tdmsNativeBrowserBridge.invoke({ operation: 'REGISTER', requestId, bindingId,
    package: pkg, expectedReceiverBinding: receiver });

  it('registers once then reads the original formal receipt without another upload', async () => {
    let saved = false;
    sourceRequest.mockImplementation(async (input: HttpInput) => {
      expect(input.url).toMatch(/\/registration$/u);
      if (input.method === 'POST') { saved = true; return { data: registered }; }
      if (!saved) throw registrationMissing();
      return { data: registered };
    });
    expect(await register()).toEqual(registered);
    expect(sourceRequest.mock.calls.map(([input]) => input.method)).toEqual(['GET', 'POST', 'GET']);
    expect(upload).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled();
  });

  it('only reads an existing formal registration; does not repeat REGISTER POST', async () => {
    sourceRequest.mockResolvedValue({ data: registered });
    expect(await register()).toEqual(registered);
    expect(sourceRequest.mock.calls.map(([input]) => input.method)).toEqual(['GET']);
    expect(upload).not.toHaveBeenCalled();
  });

  it('keeps a successful REGISTER POST read-only when its confirmation GET is lost and a later GET is404', async () => {
    let reads = 0;
    sourceRequest.mockImplementation(async (input: HttpInput) => {
      if (input.method === 'POST') return { status: 200, data: registered };
      reads++;
      if (reads === 2) throw new Error('synthetic lost GET after successful REGISTER');
      if (reads >= 4) return { status: 200, data: registered };
      throw registrationMissing();
    });
    await expect(register()).rejects.toMatchObject({ code: 'TDMS_HOST_RECEIPT_UNKNOWN', statusCode: 503 });
    const second = await register().then((value: unknown) => ({ value }), (error: unknown) => ({ error }));
    expect(sourceRequest.mock.calls.filter(([input]) => input.method === 'POST')).toHaveLength(1);
    expect(second).toMatchObject({ error: { code: 'TDMS_HOST_RECEIPT_UNKNOWN', phase: 'REGISTER' } });
    expect(await register()).toEqual(registered);
    expect(sourceRequest.mock.calls.map(([input]) => input.method)).toEqual(['GET', 'POST', 'GET', 'GET', 'GET']);
    expect(upload).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled();
  });

  it.each(['POST', 'GET'] as const)('preserves a business403 from %s after REGISTER issuance and still forbids a second POST', async (phase) => {
    let issued = false, refused = false;
    sourceRequest.mockImplementation(async (input: HttpInput) => {
      if (input.method === 'POST') issued = true;
      if (issued && !refused && input.method === phase) {
        refused = true;
        throw { response: { status: 403, data: { code: 'TDMS_SOURCE_PERMISSION_CHANGED' } } };
      }
      if (input.method === 'POST') return { status: 200, data: registered };
      throw registrationMissing();
    });
    await expect(register()).rejects.toMatchObject({ code: 'TDMS_SOURCE_PERMISSION_CHANGED', statusCode: 403 });
    await expect(register()).rejects.toMatchObject({ code: 'TDMS_HOST_RECEIPT_UNKNOWN', phase: 'REGISTER' });
    expect(sourceRequest.mock.calls.filter(([input]) => input.method === 'POST')).toHaveLength(1);
    sourceRequest.mockResolvedValue({ status: 200, data: registered });
    expect(await register()).toEqual(registered);
    expect(upload).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled();
  });

  it('keeps a lost REGISTER outcome read-only until the same registration is actually visible', async () => {
    sourceRequest.mockImplementation(async (input: HttpInput) => {
      if (input.method === 'POST') throw new Error('synthetic lost REGISTER response');
      throw registrationMissing();
    });
    await expect(register()).rejects.toMatchObject({ code: 'TDMS_HOST_RECEIPT_UNKNOWN', phase: 'REGISTER' });
    await expect(register()).rejects.toMatchObject({ code: 'TDMS_HOST_RECEIPT_UNKNOWN', phase: 'REGISTER' });
    expect(sourceRequest.mock.calls.filter(([input]) => input.method === 'POST')).toHaveLength(1);
    sourceRequest.mockResolvedValue({ data: registered });
    expect(await register()).toEqual(registered);
    expect(upload).not.toHaveBeenCalled();
  });
});
