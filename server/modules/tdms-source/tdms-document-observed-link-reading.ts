import type {
  TdmsDocumentObservedLink,
  TdmsDocumentObservedLinksRequest,
  TdmsDocumentObservedLinksResponse,
} from '@shared/tdms-source-reading.interface';
import type { TdmsReadContext } from '@shared/tdms-source.interface';
import { assertReceiverMembers } from './tdms-receiver-authorization.validation';
import { assertTdmsReceiverScope } from './tdms-receiver-sql-context';
import { assertReadGrantsCurrent, assertReadStoredMembers } from './tdms-read-member-scope';
import { captureClaims } from './tdms-processing-set-source-facts';
import { sourceBodyReadingProjection } from './tdms-assessment-body-policy';
import { documentBoundSourceRevisions } from './tdms-document-source-bindings';
import { sourceRecordReadReceipt, sourceRecordReadResponse } from './tdms-document-source-reading';
import { assertPublicActor, sameScope } from './tdms-source.authorization';
import { canonical, identifier, object, strict } from './tdms-source.validation';
import {
  assertOriginalMetadataOrigin,
  observedAssociation,
  observedParentProof,
  observedRetainedCapture,
  type ObservedRetainedCapture,
} from './tdms-document-observed-link.validation';
import {
  tdmsError,
  type TdmsDocumentAccess,
  type TdmsImportMemberClaims,
  type TdmsObservedParentIdentity,
  type TdmsPublicActor,
  type TdmsReadMemberAdmission,
  type TdmsRepository,
  type TdmsSourceAuthorization,
  type TdmsSourceGrant,
  type TdmsSourceScope,
  type TdmsTransaction,
} from './tdms-source.types';
import type { TdmsProcessingCaptureIndex } from './tdms-processing-set.types';
import type { TdmsReadReceipt } from '@shared/tdms-source.interface';

interface Dependencies {
  repository: TdmsRepository;
  authorization: TdmsSourceAuthorization;
  documents: TdmsDocumentAccess;
  assertGrant(grant: TdmsSourceGrant, scope?: TdmsSourceScope): void;
  recheck(grant: TdmsSourceGrant, action: 'READ_RECORD' | 'READ_RELATIONS', context: TdmsReadContext): Promise<unknown>;
  receipt(ref: string, grant: TdmsSourceGrant, context: TdmsReadContext): TdmsReadReceipt;
  limitations: readonly string[];
}
interface AdmittedCapture {
  index: TdmsProcessingCaptureIndex;
  claims: TdmsImportMemberClaims;
  admission: TdmsReadMemberAdmission;
}
interface ScopeRights {
  read: TdmsSourceGrant;
  relations: TdmsSourceGrant;
  permittedRecords: TdmsImportMemberClaims['records'];
}
const LIMITATIONS = [
  'OBSERVED_ASSOCIATION_NOT_SOURCE_CURRENTNESS_OR_APPLICABILITY',
  'SOURCE_MEMBER_COMPLETENESS_UNCONFIRMED',
  'PARENT_SOURCE_OPERATION_NOT_INDEPENDENTLY_RETAINED',
  'SOURCE_OBSERVATION_NON_ATOMIC',
];

/** A user-supplied path names targets only; every hop is proved again from the DM root. */
export async function readDocumentObservedLinks(actor: TdmsPublicActor,
  raw: TdmsDocumentObservedLinksRequest, deps: Dependencies,
): Promise<TdmsDocumentObservedLinksResponse> {
  assertPublicActor(actor);
  const value = object(raw);
  strict(value, ['documentVersionId', 'rootRevisionRef', 'parentPath', 'after', 'limit']);
  const documentVersionId = identifier(value.documentVersionId), rootRef = identifier(value.rootRevisionRef);
  if (value.parentPath !== undefined && !Array.isArray(value.parentPath))
    throw tdmsError('TDMS_OBSERVED_PATH_INVALID');
  const path = (value.parentPath ?? [] as unknown[]) as unknown[];
  if (path.length > 4) throw tdmsError('TDMS_OBSERVED_PATH_INVALID');
  const parentPath = path.map(identifier), allRefs = [rootRef, ...parentPath];
  if (new Set(allRefs).size !== allRefs.length) throw tdmsError('TDMS_OBSERVED_PATH_INVALID');
  const after = value.after === undefined ? undefined : identifier(value.after);
  const limit = value.limit === undefined ? 20 : Number(value.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw tdmsError('TDMS_OBSERVED_LIMIT_INVALID');
  if (!deps.authorization.available || !deps.authorization.authorizeReadMembers)
    throw tdmsError('TDMS_READ_MEMBER_ADMISSION_UNCONFIGURED', 503);
  const context: TdmsReadContext = { documentVersionId };
  await deps.documents.assertRead(actor, documentVersionId);
  const bindings = deps.documents.sourceBindings
    ? await deps.documents.sourceBindings(actor, documentVersionId) : [];
  if (bindings.length > 64) throw tdmsError('TDMS_OBSERVED_ROOT_LIMIT', 409);
  const catalogue = await deps.authorization.catalogue(actor, context);
  const admitted: AdmittedCapture[] = [], rights: ScopeRights[] = [];

  const admit = async (scope: TdmsSourceScope, index: TdmsProcessingCaptureIndex, access: ScopeRights) => {
    if (!sameScope(index.scope, scope) || index.applicationScopeId !== actor.applicationScopeId)
      throw tdmsError('TDMS_OBSERVED_CAPTURE_INVALID', 409);
    const existing = admitted.find(row => row.index.captureRef === index.captureRef);
    if (existing) {
      if (!sameScope(existing.index.scope, index.scope) || canonical(existing.index) !== canonical(index))
        throw tdmsError('TDMS_OBSERVED_CAPTURE_INVALID', 409);
      return;
    }
    const allClaims = captureClaims([index]);
    const claims = { ...allClaims, relationIds: [] };
    const relationClaims = { records: allClaims.records, artifacts: [], relationIds: allClaims.relationIds };
    assertReceiverMembers(claims, access.read.permittedMembers!);
    assertReceiverMembers(relationClaims, access.relations.permittedMembers!);
    const grant = await deps.authorization.authorizeReadMembers!(actor, scope, 'READ_RECORD', claims);
    deps.assertGrant(grant, scope);
    if (!grant.retainedCaptureReadAllowed || !grant.authorityRef || !grant.validUntil ||
        grant.permissionRevision !== access.read.permissionRevision)
      throw tdmsError('TDMS_READ_MEMBER_SCOPE_ADMISSION_REQUIRED', 403);
    assertReceiverMembers(claims, grant.permittedMembers);
    assertReadGrantsCurrent([access.read, access.relations, grant]);
    admitted.push({ index, claims, admission: grant });
  };
  const checkCurrent = async () => {
    assertReadGrantsCurrent([
      ...rights.flatMap(value => [value.read, value.relations]),
      ...admitted.map(value => value.admission),
    ]);
    await deps.documents.assertRead(actor, documentVersionId);
    for (const access of rights) {
      await deps.recheck(access.read, 'READ_RECORD', context);
      await deps.recheck(access.relations, 'READ_RELATIONS', context);
    }
    for (const row of admitted) {
      const fresh = await deps.authorization.authorizeReadMembers!(actor, row.index.scope, 'READ_RECORD', row.claims);
      deps.assertGrant(fresh, row.index.scope);
      if (!fresh.retainedCaptureReadAllowed || fresh.authorityRef !== row.admission.authorityRef ||
          fresh.permissionRevision !== row.admission.permissionRevision || fresh.validUntil !== row.admission.validUntil ||
          canonical(fresh.permittedMembers) !== canonical(row.admission.permittedMembers))
        throw tdmsError('TDMS_SOURCE_PERMISSION_CHANGED', 409);
      assertReceiverMembers(row.claims, fresh.permittedMembers);
      assertReadGrantsCurrent([row.admission, fresh]);
    }
    assertReadGrantsCurrent(rights.flatMap(value => [value.read, value.relations]));
  };

  const result = await deps.repository.transaction(async tx => {
    if (!tx.observedCaptureIndex || !tx.observedChildren || !tx.observedAssertion)
      throw tdmsError('TDMS_OBSERVED_REPOSITORY_UNCONFIGURED', 503);
    const roots: Array<{ root: ObservedRetainedCapture; access: ScopeRights }> = [];
    for (const catalogueGrant of catalogue) {
      deps.assertGrant(catalogueGrant);
      if (catalogueGrant.scope.sourceKey !== 'TDMS') continue;
      const scope = catalogueGrant.scope;
      if (!bindings.some(binding => binding.scope && sameScope(binding.scope, scope))) continue;
      const prior = rights.find(value => sameScope(value.read.scope, scope));
      if (prior) {
        if (prior.read.permissionRevision !== catalogueGrant.permissionRevision)
          throw tdmsError('TDMS_SOURCE_PERMISSION_CHANGED', 409);
        continue;
      }
      await assertTdmsReceiverScope(scope);
      const matched = [] as Array<{ binding: (typeof bindings)[number]; index: TdmsProcessingCaptureIndex }>;
      for (const binding of bindings) {
        if (!binding.scope || !sameScope(binding.scope, scope)) continue;
        const index = await tx.observedCaptureIndex(scope, binding.requestId);
        if (index?.records.some(row => row.sourceRevisionRef === rootRef)) matched.push({ binding, index });
      }
      if (!matched.length) continue;
      const read = await deps.authorization.authorize(actor, scope, 'READ_RECORD', context);
      const relations = await deps.authorization.authorize(actor, scope, 'READ_RELATIONS', context);
      deps.assertGrant(read, scope); deps.assertGrant(relations, scope);
      if (!read.validUntil || !relations.validUntil || !read.permittedMembers || !relations.permittedMembers ||
          read.permissionRevision !== relations.permissionRevision || read.permissionRevision !== catalogueGrant.permissionRevision)
        throw tdmsError('TDMS_OBSERVED_CURRENT_AUTHORITY_REQUIRED', 403);
      const permittedRecords = read.permittedMembers.records.filter(record =>
        relations.permittedMembers!.records.some(other => other.recordKind === record.recordKind &&
          other.sourceRecordId === record.sourceRecordId));
      const access = { read, relations, permittedRecords };
      rights.push(access);
      assertReadGrantsCurrent([read, relations]);
      for (const { binding, index } of matched) {
        await admit(scope, index, access);
        const refs = await documentBoundSourceRevisions(actor, scope, [binding], tx);
        if (!refs.includes(rootRef)) throw tdmsError('TDMS_DOCUMENT_SOURCE_BINDING_MISMATCH', 409);
        const root = await observedRetainedCapture(tx, actor, scope, index, rootRef);
        if (root.revision.record.recordKind !== 'MANUFACTURER_FILE')
          throw tdmsError('TDMS_DOCUMENT_SOURCE_BINDING_MISMATCH', 409);
        assertReadStoredMembers(read, root.revision);
        roots.push({ root, access });
      }
    }
    if (roots.length !== 1) throw tdmsError(roots.length ? 'TDMS_OBSERVED_ROOT_AMBIGUOUS' : 'TDMS_SOURCE_NOT_FOUND', roots.length ? 409 : 404);
    const { root, access } = roots[0]!, scope = root.index.scope;
    let parent = root;

    const findChildren = (current: ObservedRetainedCapture, first: boolean,
      childRevisionRef?: string, cursor?: string, pageLimit = limit + 1) => {
      const pkg = current.capture.dailyMetadata!.envelope.package;
      const parent: TdmsObservedParentIdentity = {
        applicationScopeId: actor.applicationScopeId,
        ...(first ? {} : { originalPackageId: pkg.packageId, packageHash: current.capture.packageHash }),
        snapshotId: current.sourceRecord.snapshotId, sourceRecordId: current.sourceRecord.sourceRecordId,
        sourceVersion: current.sourceRecord.sourceVersion,
      };
      return tx.observedChildren!(scope, { parent, permittedRecords: access.permittedRecords,
        ...(childRevisionRef ? { childRevisionRef } : {}), ...(cursor ? { after: cursor } : {}), limit: pageLimit });
    };
    const loadChild = async (index: TdmsProcessingCaptureIndex, current: ObservedRetainedCapture,
      first: boolean): Promise<{ child: ObservedRetainedCapture; evidence: Awaited<ReturnType<typeof observedAssociation>> } | null> => {
      if (index.records.length !== 1) throw tdmsError('TDMS_OBSERVED_CAPTURE_INVALID', 409);
      await admit(scope, index, access);
      const child = await observedRetainedCapture(tx, actor, scope, index, index.records[0]!.sourceRevisionRef);
      assertReadStoredMembers(access.read, child.revision);
      for (const id of child.revision.record.relatedDocumentVersionIds) await deps.documents.assertRead(actor, id);
      let sourceParent = current;
      if (first) {
        const proof = observedParentProof(child);
        const metadataIndex = await tx.observedCaptureIndex!(scope, 'TDMSIMPORT-' + proof.packageSha256);
        if (!metadataIndex) return null;
        await admit(scope, metadataIndex, access);
        if (metadataIndex.records.length !== 1) throw tdmsError('TDMS_OBSERVED_CAPTURE_INVALID', 409);
        sourceParent = await observedRetainedCapture(tx, actor, scope, metadataIndex, metadataIndex.records[0]!.sourceRevisionRef);
        if (sourceParent.capture.packageHash !== proof.packageSha256 ||
            sourceParent.capture.dailyMetadata!.envelope.package.packageId !== proof.packageId)
          throw tdmsError('TDMS_OBSERVED_CAPTURE_INVALID', 409);
        assertOriginalMetadataOrigin(root, sourceParent, proof.operationId);
      }
      const evidence = await observedAssociation(tx, scope, rootRef, root.index.captureRef,
        current.revision.record.sourceRevisionRef, sourceParent, child);
      return { child, evidence };
    };

    for (const ref of parentPath) {
      if (sourceBodyReadingProjection(parent.revision.record).bodyReadPolicy.kind === 'METADATA_ONLY')
        throw tdmsError('TDMS_OBSERVED_PARENT_BODY_WITHHELD', 403);
      const candidates = await findChildren(parent, parent === root, ref, undefined, 2);
      if (candidates.length !== 1) throw tdmsError('TDMS_SOURCE_NOT_FOUND', 404);
      const loaded = await loadChild(candidates[0]!, parent, parent === root);
      if (!loaded) throw tdmsError('TDMS_OBSERVED_METADATA_NOT_RETAINED', 409);
      parent = loaded.child;
    }
    const parentRef = parent.revision.record.sourceRevisionRef;
    if (sourceBodyReadingProjection(parent.revision.record).bodyReadPolicy.kind === 'METADATA_ONLY') {
      await checkCurrent();
      return { response: { documentVersionId, rootRevisionRef: rootRef, parentPath, parentRevisionRef: parentRef,
        links: [], hasMore: false, nextAfter: null, diagnostic: 'PARENT_BODY_WITHHELD' as const,
        gaps: [], limitations: LIMITATIONS }, related: [] as string[] };
    }
    const candidates = await findChildren(parent, parent === root, undefined, after);
    if (new Set(candidates.map(row => row.captureRef)).size !== candidates.length)
      throw tdmsError('TDMS_OBSERVED_CAPTURE_INVALID', 409);
    const loaded = [] as Array<Awaited<ReturnType<typeof loadChild>>>;
    for (const index of candidates) loaded.push(await loadChild(index, parent, parent === root));
    await checkCurrent();
    const links: TdmsDocumentObservedLink[] = [], gaps: Array<'PARENT_METADATA_CAPTURE_NOT_RETAINED'> = [];
    const related: string[] = [];
    for (const item of loaded.slice(0, limit)) {
      if (!item) { if (!gaps.length) gaps.push('PARENT_METADATA_CAPTURE_NOT_RETAINED'); continue; }
      const record = item.child.revision.record;
      const receipt = sourceRecordReadReceipt(record, deps.receipt(record.sourceRevisionRef, access.read, context));
      await tx.saveReceipt({ scope, actorId: actor.canonicalSubject.id, receipt, context });
      links.push({ evidence: item.evidence, child: sourceRecordReadResponse(item.child.revision, receipt, deps.limitations) });
      related.push(...record.relatedDocumentVersionIds);
    }
    await checkCurrent();
    const hasMore = candidates.length > limit;
    return { response: { documentVersionId, rootRevisionRef: rootRef, parentPath, parentRevisionRef: parentRef,
      links, hasMore, nextAfter: hasMore ? candidates[limit - 1]!.captureRef : null,
      diagnostic: links.length || gaps.length || hasMore ? 'AVAILABLE' as const : 'NO_OBSERVED_LINKS' as const,
      gaps, limitations: LIMITATIONS }, related };
  });
  for (const id of result.related) await deps.documents.assertRead(actor, id);
  await checkCurrent();
  return result.response;
}
