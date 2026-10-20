import type { TdmsDocumentUploadBinding } from '../document-management/src/hosted/nest/document-upload-authority';
import { storedDailyCapture } from './tdms-daily-metadata.readback';
import { sameScope } from './tdms-source.authorization';
import { canonical } from './tdms-source.validation';
import { tdmsError, type TdmsPublicActor, type TdmsSourceScope, type TdmsTransaction } from './tdms-source.types';

/** Join existing DM provenance to the exact original capture's native retention.
 * No capture/record is rewritten and no number, latest head or relation is guessed. */
export async function documentBoundSourceRevisions(
  actor: TdmsPublicActor,
  scope: TdmsSourceScope,
  bindings: TdmsDocumentUploadBinding[],
  transaction: TdmsTransaction,
): Promise<string[]> {
  const refs = new Set<string>();
  for (const binding of bindings) {
    if (!binding.scope || !sameScope(binding.scope, scope)) continue;
    if (binding.applicationScopeId !== actor.applicationScopeId ||
        binding.schemaVersion !== 'wiselink.tdms-formal-document-binding.v1')
      throw tdmsError('TDMS_DOCUMENT_SOURCE_BINDING_MISMATCH', 409);
    const capture = await transaction.capture(scope, binding.requestId);
    // Registration can precede capture retention; absence is not a source record.
    if (!capture) continue;
    const saved = storedDailyCapture(capture, actor, scope, false);
    const owners = saved.envelope.package.records.filter(record => record.snapshotId === binding.ownerSnapshotId);
    const artifacts = saved.envelope.package.artifactBindings.filter(artifact => artifact.bindingId === binding.bindingId);
    const retained = capture.dailyMetadata?.nativeRetention?.records.filter(record => record.snapshotId === binding.ownerSnapshotId);
    const owner = owners[0], artifact = artifacts[0], native = retained?.[0];
    if (saved.payloadDigest !== binding.payloadDigest || owners.length !== 1 || artifacts.length !== 1 ||
        retained?.length !== 1 || !native || owner.kind !== 'MANUFACTURER_FILE' ||
        owner.sourceRecordId !== binding.sourceRecordId || owner.number !== binding.number ||
        canonical(owner.sourceVersion) !== canonical(binding.sourceVersion) ||
        canonical(owner.businessVersion) !== canonical(binding.businessVersion) ||
        artifact.ownerSnapshotId !== owner.snapshotId || artifact.sourceAttachmentId !== binding.sourceAttachmentId ||
        !['primary', 'PRIMARY'].includes(artifact.role) || artifact.mediaType !== binding.mediaType ||
        artifact.blobSha256 !== binding.sha256 || artifact.byteLength !== binding.byteLength ||
        native.sourceRecordId !== owner.sourceRecordId || native.nativeKind !== 'MANUFACTURER_FILE')
      throw tdmsError('TDMS_DOCUMENT_SOURCE_BINDING_MISMATCH', 409);
    const revision = await transaction.revision(actor.tenantId, native.sourceRevisionRef);
    if (!revision || !sameScope(revision.scope, scope) || revision.record.captureRef !== capture.receipt.captureRef ||
        revision.record.sourceRecordId !== owner.sourceRecordId ||
        canonical(revision.record.sourceVersion) !== canonical(owner.sourceVersion) ||
        canonical(revision.record.businessVersion) !== canonical(owner.businessVersion))
      throw tdmsError('TDMS_DOCUMENT_SOURCE_BINDING_MISMATCH', 409);
    refs.add(native.sourceRevisionRef);
  }
  return [...refs];
}
