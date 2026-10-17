import { getDataloom } from '@lark-apaas/client-toolkit/dataloom';
import { getDefaultBucketId } from '@lark-apaas/client-toolkit/tools/storage';
import { uploadFile } from '../components/business-ui/api/files/service';
import {
  readTdmsNativeReceiver, readTdmsUploadAssociation, stageTdmsUploadAssociation,
  preflightTdmsUpload, tdmsNativeError, tdmsNativeRequest,
} from '../api/tdms-source-native';
import type { TdmsNativeReceiverBinding, TdmsUploadSelectionAssociationReceipt, TdmsUploadSelectionPreflight } from '@shared/tdms-receiver.interface';

export const TDMS_NATIVE_BRIDGE_KEY = '__wiselinkTdmsNativeBridge';
const BRIDGE_SCHEMA = 'wiselink.tdms-native-host-bridge.v1';
const MAX_ORIGINAL_BYTES = 100 * 1024 * 1024;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 255)
    throw tdmsNativeError('TDMS_NATIVE_INPUT_INVALID', 400);
  return value;
}
const receiverKeys: readonly (keyof TdmsNativeReceiverBinding)[] = ['schemaVersion', 'receiverId', 'tenantRef', 'applicationRef', 'principalRef',
  'sourceSystem', 'sourceInstanceRef', 'authorityRevision', 'authorityEvidenceRef', 'sessionEvidenceRef', 'observedAt'];
function expectedReceiver(value: unknown): TdmsNativeReceiverBinding {
  if (!record(value) || Object.keys(value).length !== receiverKeys.length ||
      receiverKeys.some((key: keyof TdmsNativeReceiverBinding) => typeof value[key] !== 'string' || !value[key] || String(value[key]).length > 500) ||
      value.schemaVersion !== 'wiselink.tdms-native-host-receiver-binding.v1' ||
      value.applicationRef !== 'app_17bzc551rsg' || value.sourceSystem !== 'TDMS' ||
      !Number.isFinite(Date.parse(String(value.observedAt))))
    throw tdmsNativeError('TDMS_NATIVE_EXPECTED_RECEIVER_REQUIRED', 409);
  return value as unknown as TdmsNativeReceiverBinding;
}
async function assertCurrentReceiver(expected: TdmsNativeReceiverBinding): Promise<void> {
  const current: TdmsNativeReceiverBinding = await readTdmsNativeReceiver(expected.receiverId, expected);
  if (receiverKeys.some((key: keyof TdmsNativeReceiverBinding) => key !== 'observedAt' && current[key] !== expected[key]))
    throw tdmsNativeError('TDMS_NATIVE_RECEIVER_CHANGED', 409);
}
function unchangedAssociation(
  value: TdmsUploadSelectionAssociationReceipt, requestId: string,
  binding: Record<string, unknown>, preflight: TdmsUploadSelectionPreflight, packageId: unknown,
): TdmsUploadSelectionAssociationReceipt {
  if (value.schemaVersion !== 'wiselink.tdms-upload-selection-association.v1' ||
      value.status !== 'STAGED_CANDIDATE' || value.requestId !== requestId ||
      value.bindingId !== binding.bindingId || value.ownerSnapshotId !== binding.ownerSnapshotId ||
      value.sourceAttachmentId !== binding.sourceAttachmentId || value.sha256 !== binding.blobSha256 ||
      value.byteLength !== binding.byteLength || value.readbackVerified !== true || value.documentVersionId !== null ||
      value.receiverId !== preflight.receiverId || value.payloadDigest !== preflight.payloadDigest || value.packageId !== packageId)
    throw tdmsNativeError('TDMS_NATIVE_UPLOAD_ASSOCIATION_MISMATCH', 409);
  return value;
}

/** Same-origin SDK upload; neither cookies nor platform credentials leave this page. */
async function stageOriginal(input: Record<string, unknown>, expected: TdmsNativeReceiverBinding): Promise<TdmsUploadSelectionAssociationReceipt> {
  const requestId: string = text(input.requestId);
  const bindingId: string = text(input.bindingId);
  const pkg: unknown = input.package;
  if (!record(pkg) || !Array.isArray(pkg.artifactBindings))
    throw tdmsNativeError('TDMS_NATIVE_PACKAGE_REQUIRED', 400);
  const matches: Record<string, unknown>[] = pkg.artifactBindings.filter(
    (item: unknown): item is Record<string, unknown> => record(item) && item.bindingId === bindingId);
  if (matches.length !== 1) throw tdmsNativeError('TDMS_NATIVE_ARTIFACT_AMBIGUOUS', 409);
  const binding: Record<string, unknown> = matches[0];
  // Retention of these exact members is checked before any FileService I/O.
  // This is stateless validation; submission checks the current grant again.
  const preflight: TdmsUploadSelectionPreflight = await preflightTdmsUpload(requestId, bindingId, pkg, expected);
  if (preflight.status !== 'AUTHORIZED_UPLOAD' || preflight.requestId !== requestId ||
      preflight.bindingId !== bindingId || !preflight.receiverId ||
      requestId !== `TDMSIMPORT-${preflight.payloadDigest}`)
    throw tdmsNativeError('TDMS_NATIVE_UPLOAD_PREFLIGHT_MISMATCH', 409);
  try {
    return unchangedAssociation(await readTdmsUploadAssociation(requestId, bindingId, expected),
      requestId, binding, preflight, pkg.packageId);
  } catch (reason: unknown) {
    if (!record(reason) || reason.code !== 'TDMS_UPLOAD_SELECTION_UNAVAILABLE' ||
        reason.statusCode !== 404) throw reason;
    // The row may be absent or hidden. Only the package preflight above and
    // the current receiver checks below authorize a new original acquisition.
  }
  const digest: string = text(binding.blobSha256);
  const length: unknown = binding.byteLength;
  const mediaType: string = text(binding.mediaType);
  if (!/^[a-f0-9]{64}$/u.test(digest) || !Number.isSafeInteger(length) ||
      Number(length) < 1 || Number(length) > MAX_ORIGINAL_BYTES ||
      typeof input.bytesBase64 !== 'string' ||
      input.bytesBase64.length !== 4 * Math.ceil(Number(length) / 3) ||
      !/^[A-Za-z0-9+/]*={0,2}$/u.test(input.bytesBase64))
    throw tdmsNativeError('TDMS_NATIVE_ARTIFACT_BYTES_INVALID', 400);
  const decoded: string = atob(input.bytesBase64);
  const buffer: ArrayBuffer = new ArrayBuffer(decoded.length);
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(buffer);
  for (let index: number = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  const actual: string = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)),
    (value: number) => value.toString(16).padStart(2, '0')).join('');
  if (bytes.length !== length || actual !== digest)
    throw tdmsNativeError('TDMS_NATIVE_ARTIFACT_BYTES_INVALID', 400);
  const name: string = `${requestId}_${bindingId}`;
  const filePath: string = `tdms-source/uploads/${name}`;
  if (!/^[A-Za-z0-9_-]+$/u.test(name) || filePath.length > 255)
    throw tdmsNativeError('TDMS_NATIVE_UPLOAD_PATH_INVALID', 400);
  const bucketId: string | undefined = getDefaultBucketId();
  if (!bucketId) throw tdmsNativeError('TDMS_NATIVE_BUCKET_UNAVAILABLE');
  const bucket = (await getDataloom()).storage.from(bucketId);
  await assertCurrentReceiver(expected);
  // This exact deterministic name also reconciles a lost upload callback. It
  // never overwrites or blindly uploads again after an unknown physical result.
  const listing = await bucket.list('tdms-source/uploads', { search: name, limit: 200 });
  if (listing.error) throw tdmsNativeError('TDMS_NATIVE_UPLOAD_LOOKUP_FAILED');
  const existing = listing.data.filter((item) => item.name === name);
  if (existing.length > 1) throw tdmsNativeError('TDMS_NATIVE_UPLOAD_OBJECT_AMBIGUOUS', 409);
  let selection: { bucketId: string; filePath: string; expectedProviderObjectId: string };
  if (existing.length === 1) {
    selection = { bucketId, filePath, expectedProviderObjectId: existing[0].id };
  } else {
    if (listing.data.length === 200) throw tdmsNativeError('TDMS_NATIVE_UPLOAD_LOOKUP_INCOMPLETE', 409);
    await assertCurrentReceiver(expected);
    try {
      const uploaded = await uploadFile(new File([buffer], name, { type: mediaType }),
        { filePath, contentType: mediaType, upsert: false });
      if (uploaded.bucketId !== bucketId || uploaded.filePath.replace(/^\//u, '') !== filePath || !uploaded.id)
        throw tdmsNativeError('TDMS_NATIVE_UPLOAD_IDENTITY_MISMATCH', 409);
      selection = { bucketId, filePath, expectedProviderObjectId: uploaded.id };
    } catch (reason: unknown) {
      if (record(reason) && reason.code === 'TDMS_NATIVE_UPLOAD_IDENTITY_MISMATCH') throw reason;
      throw Object.assign(tdmsNativeError('TDMS_NATIVE_UPLOAD_OUTCOME_UNKNOWN'),
        { phase: 'UPLOAD', requestId, bindingId, filePath, nextAction: 'READ_EXACT_UPLOAD_AND_SELECTION' });
    }
  }
  await assertCurrentReceiver(expected);
  // Host freshly checks the Source grant, real upload owner, immutable object
  // and bytes before retaining this association. A client marker is no proof.
  return unchangedAssociation(await stageTdmsUploadAssociation(requestId, bindingId,
    { package: pkg, selection }, expected), requestId, binding, preflight, pkg.packageId);
}

export const tdmsNativeBrowserBridge = Object.freeze({
  schemaVersion: BRIDGE_SCHEMA,
  async invoke(value: unknown): Promise<unknown> {
    if (!record(value)) throw tdmsNativeError('TDMS_NATIVE_INPUT_INVALID', 400);
    if (value.operation === 'RECEIVER')
      return readTdmsNativeReceiver(value.receiverId === undefined ? undefined : text(value.receiverId),
        value.expectedReceiverBinding === undefined ? undefined : expectedReceiver(value.expectedReceiverBinding));
    const expected: TdmsNativeReceiverBinding = expectedReceiver(value.expectedReceiverBinding);
    await assertCurrentReceiver(expected);
    if (value.operation === 'PREFLIGHT')
      return preflightTdmsUpload(text(value.requestId), text(value.bindingId), value.package, expected);
    if (value.operation === 'FIND_STAGE')
      return readTdmsUploadAssociation(text(value.requestId), text(value.bindingId), expected);
    if (value.operation === 'STAGE') return stageOriginal(value, expected);
    if (value.operation === 'REQUEST' && (value.method === 'GET' || value.method === 'POST'))
      return tdmsNativeRequest(text(value.route), value.method, value.body, expected);
    throw tdmsNativeError('TDMS_NATIVE_OPERATION_FORBIDDEN', 400);
  },
});

/** Only an explicit native transport invokes this; mounting creates no job or request. */
export function installTdmsNativeHostBridge(): () => void {
  if (window.location.protocol !== 'https:' ||
      !window.location.pathname.startsWith('/app/app_17bzc551rsg/')) return () => undefined;
  const target: Window & { __wiselinkTdmsNativeBridge?: typeof tdmsNativeBrowserBridge } = window;
  Object.defineProperty(target, TDMS_NATIVE_BRIDGE_KEY,
    { configurable: true, writable: false, value: tdmsNativeBrowserBridge });
  return () => {
    if (target.__wiselinkTdmsNativeBridge === tdmsNativeBrowserBridge)
      delete target.__wiselinkTdmsNativeBridge;
  };
}
