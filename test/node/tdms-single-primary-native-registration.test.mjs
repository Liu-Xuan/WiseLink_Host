import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoundNativeTransport } from '../../server/modules/tdms-source/tdms-native-host-transport.mjs';

function fixture() {
  const payloadDigest = 'a'.repeat(64), requestId = `TDMSIMPORT-${payloadDigest}`;
  const bindingId = `TDMSBIND-${'b'.repeat(64)}`;
  const receiver = { schemaVersion: 'wiselink.tdms-native-host-receiver-binding.v1', receiverId: 'synthetic-receiver',
    tenantRef: 'synthetic-tenant', applicationRef: 'app_17bzc551rsg', principalRef: 'synthetic-user', sourceSystem: 'TDMS',
    sourceInstanceRef: 'synthetic-source', authorityRevision: 'synthetic-rev', authorityEvidenceRef: 'synthetic-proof',
    sessionEvidenceRef: 'synthetic-session', observedAt: '2026-10-20T00:00:00Z' };
  const artifact = { bindingId, ownerSnapshotId: 'synthetic-owner', sourceAttachmentId: 'synthetic-primary',
    role: 'PRIMARY', mediaType: 'application/pdf', blobSha256: 'c'.repeat(64), byteLength: 9 };
  const pkg = { packageId: 'synthetic-package', query: { originalAcquisition: {} },
    records: [{ kind: 'MANUFACTURER_FILE', snapshotId: artifact.ownerSnapshotId }], edges: [], artifactBindings: [artifact] };
  const registration = { schemaVersion: 'wiselink.tdms-formal-document-registration.v1', requestId, bindingId,
    payloadDigest, receiverId: receiver.receiverId, documentUploadRequestId: 'synthetic-upload',
    sourceAttachmentId: artifact.sourceAttachmentId, sourceAttachmentVersion: null, status: 'COMMITTED',
    documentVersionId: 'DV-synthetic-exact', preflightId: 'synthetic-preflight', sha256: artifact.blobSha256,
    byteLength: artifact.byteLength, readbackVerified: true, mappedAt: '2026-10-20T00:00:00Z' };
  const candidate = { requestId, payloadDigest, status: 'IMPORTED', documentVersionMappings: [{ bindingId,
    sourceRef: `TDMS:ARTIFACT:${bindingId}`, status: 'REVIEW_REQUIRED', documentVersionId: null, preflightId: null,
    sha256: artifact.blobSha256, byteLength: artifact.byteLength, readbackVerified: false, mappedAt: null }] };
  const projected = () => ({ ...candidate, documentVersionMappings: [{ ...candidate.documentVersionMappings[0],
    status: registration.status, documentVersionId: registration.documentVersionId, preflightId: registration.preflightId,
    readbackVerified: registration.readbackVerified, mappedAt: registration.mappedAt }] });
  const state = { posts: 0, registers: 0, registered: false, lostRegister: false, missingRegistration: false,
    wrongDvi: false, operations: [] };
  const transport = createBoundNativeTransport({ sourceStateDirectory: '/must-not-read-local-bytes' }, async input => {
    state.operations.push([input.operation, input.method]);
    if (input.operation === 'RECEIVER') return receiver;
    assert.deepEqual(input.expectedReceiverBinding, receiver);
    if (input.operation === 'PREFLIGHT') return { requestId, bindingId, receiverId: receiver.receiverId,
      payloadDigest, status: 'AUTHORIZED_UPLOAD' };
    if (input.operation === 'FIND_STAGE') return { status: 'STAGED_CANDIDATE', requestId, bindingId,
      receiverId: receiver.receiverId, payloadDigest, packageId: pkg.packageId, sha256: artifact.blobSha256,
      byteLength: artifact.byteLength, readbackVerified: true, documentVersionId: null };
    if (input.operation === 'REGISTER') {
      assert.equal(state.posts, 1);
      assert.equal(input.package, pkg);
      state.registers++; state.registered = true;
      if (state.lostRegister) throw Object.assign(new Error('synthetic lost REGISTER'), { code: 'TDMS_HOST_RECEIPT_UNKNOWN' });
      return registration;
    }
    assert.equal(input.operation, 'REQUEST');
    if (input.method === 'POST') { state.posts++; return candidate; }
    if (input.route.endsWith('/registration')) {
      if (state.missingRegistration) throw Object.assign(new Error('unavailable'),
        { code: 'TDMS_FORMAL_REGISTRATION_UNAVAILABLE', statusCode: 404 });
      return registration;
    }
    assert.equal(input.route, `/api/tdms-source-imports/${requestId}`);
    const receipt = projected();
    if (state.wrongDvi) receipt.documentVersionMappings[0].documentVersionId = 'DV-other-version';
    return { receipt, package: pkg };
  });
  const submit = () => transport.request('/api/tdms-source-imports', { method: 'POST', body: { requestId, package: pkg } });
  return { submit, state, registration, candidate, projected };
}

test('normal single PRIMARY transport registers after retention and returns the exact original request readback', async () => {
  const f = fixture();
  assert.deepEqual(await f.submit(), f.projected());
  assert.equal(f.state.posts, 1); assert.equal(f.state.registers, 1);
  assert.equal(f.candidate.documentVersionMappings[0].status, 'REVIEW_REQUIRED');
  assert.deepEqual(f.state.operations, [['RECEIVER', undefined], ['PREFLIGHT', undefined], ['FIND_STAGE', undefined],
    ['REQUEST', 'POST'], ['REGISTER', undefined], ['REQUEST', 'GET']]);
});

test('lost REGISTER outcome is reconciled by GET only; neither daily POST nor REGISTER is repeated', async () => {
  const f = fixture(); f.state.lostRegister = true;
  await assert.rejects(f.submit(), { code: 'TDMS_HOST_RECEIPT_UNKNOWN' });
  assert.deepEqual(await f.submit(), f.projected());
  assert.equal(f.state.posts, 1); assert.equal(f.state.registers, 1);
});

test('unavailable registration after an unknown result never authorizes another write', async () => {
  const f = fixture(); f.state.lostRegister = true;
  await assert.rejects(f.submit());
  f.state.missingRegistration = true;
  await assert.rejects(f.submit(), { code: 'TDMS_FORMAL_REGISTRATION_UNAVAILABLE' });
  await assert.rejects(f.submit(), { code: 'TDMS_FORMAL_REGISTRATION_UNAVAILABLE' });
  assert.equal(f.state.posts, 1); assert.equal(f.state.registers, 1);
});

test('historical review remains a candidate and does not acquire a formal document id', async () => {
  const f = fixture();
  Object.assign(f.registration, { status: 'REVIEW_REQUIRED', documentVersionId: null, readbackVerified: false, mappedAt: null });
  assert.equal((await f.submit()).documentVersionMappings[0].documentVersionId, null);
});

test('a mismatched exact DVI readback is not accepted as successful formal registration', async () => {
  const f = fixture(); f.state.wrongDvi = true;
  await assert.rejects(f.submit(), { code: 'TDMS_NATIVE_REGISTRATION_READBACK_MISMATCH' });
  assert.equal(f.state.registers, 1);
});
