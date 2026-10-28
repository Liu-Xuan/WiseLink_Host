import { TdmsSourceController } from '@server/modules/tdms-source/tdms-source.controller';
import { TdmsSourceService } from '@server/modules/tdms-source/tdms-source.service';
import { MiaodaTdmsDocumentAccess } from '@server/modules/tdms-source/miaoda-tdms-document-access';
import { adaptTdmsDailySource } from '@server/modules/tdms-source/tdms-daily-source-adapter';
import {
  completeOwnedObservedEdges, completeOwnedRecord, completeOwnProfile,
} from '@server/modules/tdms-source/tdms-complete-owned-source.validation';
import { retainedCaptureIndex } from '@server/modules/tdms-source/tdms-processing-set-source-facts';
import { canonical, hash, object } from '@server/modules/tdms-source/tdms-source.validation';
import { sameScope } from '@server/modules/tdms-source/tdms-source.authorization';
import type { TdmsDailyMetadataEnvelope, TdmsDailyMetadataPackage, TdmsDailyMetadataRecord,
  TdmsDailyObservedEdge } from '@server/modules/tdms-source/tdms-daily-metadata-contract';
import type { TdmsSourceVersion } from '@shared/tdms-source.interface';
import type { TdmsCapture, TdmsObservedChildrenPage, TdmsRepository, TdmsSourceScope, TdmsTransaction } from '@server/modules/tdms-source/tdms-source.types';
import { syntheticFormalOriginal } from './tdms-receiver-legacy-original.fixture';
import { fixture } from './tdms-single-primary-formal-registration.fixture';
import { copyComplete, syntheticCompleteEnvelope, withCompleteRelation } from './tdms-complete-owned.fixture';
import { proofOfCurrent } from './tdms-current-contract.fixture';
import { syntheticAeoNativeView } from './tdms-source-t1-current-notice.fixture';

const operation = (digit: string) => `TDMSOP-${digit.repeat(8)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(12)}`;
const unknownVersion: TdmsSourceVersion = { rawRevision: null, rawIteration: null, confirmation: 'VERSION_UNCONFIRMED' };

/** Mirrors frozen packageFromCompleteOwnedObservation's Source fields and package ID.
 * The coordinator independently compares this synthetic observation with the frozen factory. */
function sourcePackage(env: TdmsDailyMetadataEnvelope): TdmsDailyMetadataPackage {
  const p = proofOfCurrent(env);
  const observation = { schemaVersion: p.schemaVersion, requestedCriteria: p.requestedCriteria,
    documentIdentity: p.documentIdentity, nativeReloadProvenance: p.nativeReloadProvenance, reads: p.reads };
  const record = completeOwnedRecord(observation, observation.requestedCriteria) as unknown as TdmsDailyMetadataRecord;
  const profile = completeOwnProfile(observation.requestedCriteria.scopeId);
  return { schemaVersion: 'wiselink.tdms-daily-package.v1',
    packageId: 'TDMSCOMPLETEOWNPKG-' + hash(observation), sourceSystem: 'TDMS',
    observedAt: record.observedAt, coverage: record.coverage,
    query: { requestedCriteria: { documentCode: observation.requestedCriteria.documentCode,
      sourceObjectRef: observation.requestedCriteria.sourceObjectRef,
      objectType: profile.objectType || object(record.rawFields.storageType).rawName, nativeClass: profile.nativeClass },
    actualCriteria: null, scopeMatch: 'UNKNOWN', scopeComplete: false },
    records: [record], edges: completeOwnedObservedEdges(record) as unknown as TdmsDailyObservedEdge[],
    artifactBindings: [], readFailures: [] };
}
export function observedEnvelope(pkg: TdmsDailyMetadataPackage): TdmsDailyMetadataEnvelope {
  return { requestId: 'TDMSIMPORT-' + hash(pkg), package: pkg };
}
function relationTargets(env: TdmsDailyMetadataEnvelope, targets: string[], targetVersion = unknownVersion) {
  const value = withCompleteRelation(env), p = proofOfCurrent(value), sample = p.reads[1].relationTables[0];
  const rows = targets.map((target, index) => {
    const row = copyComplete(sample.rows[0]);
    row.occurrenceId = `row-${index}`; row.globalIndex = index; row.nativeRowId = `native-row-${index}`;
    row.observedVersion = copyComplete(targetVersion);
    Object.assign(row.sourceLinks[0], { targetRef: target, rawHref: '/infoPage?oid=' + target,
      locator: `#relations row-${index} Number` });
    return row;
  });
  Object.assign(sample, { rows, reportedTotal: rows.length });
  sample.countEvidence.rawText = `(${rows.length} object${rows.length === 1 ? '' : 's'})`;
  sample.windows[0].rowOccurrenceIds = rows.map(row => row.occurrenceId);
  sample.windows[0].globalIndices = rows.map(row => row.globalIndex);
  sample.windows[0].reportedTotal = rows.length;
  sample.terminal.total = rows.length; sample.terminal.captured = rows.length;
  for (const read of p.reads) read.relationTables = [copyComplete(sample)];
  return value;
}
function bindChild(env: TdmsDailyMetadataEnvelope, parent: TdmsDailyMetadataPackage,
  target: string, operationId: string) {
  const p = proofOfCurrent(env), record = parent.records[0];
  const occurrences = (record.rawFields.completeOwnedSource as { targetOccurrences: Array<Record<string, unknown>> }).targetOccurrences;
  const occurrence = occurrences.find(item => item.targetRef === target);
  if (!occurrence) throw new Error('SYNTHETIC_SOURCE_TARGET_MISSING');
  const classificationOperationId = p.requestedCriteria.sourceProof.classificationOperationId;
  p.requestedCriteria.sourceProof = { kind: 'REQUIRED_RELATION_TARGET', parentOperationId: operationId,
    parentPackageId: parent.packageId, parentPackageSha256: hash(parent), parentSnapshotId: record.snapshotId,
    parentSourceRecordId: record.sourceRecordId, parentSourceVersion: record.sourceVersion,
    tableId: occurrence.tableId, occurrenceId: occurrence.occurrenceId, linkIndex: occurrence.linkIndex, targetRef: target,
    ...(classificationOperationId ? { classificationOperationId } : {}) };
  for (const read of p.reads) read.owner.scopeEvidence.nativeTypeOrigin = 'REQUIRED_RELATION_TARGET';
  return sourcePackage(env);
}

export function sourceFactoryCase(options: { mismatchedRootTargetVersion?: boolean; includeAeo?: boolean } = {}) {
  const base = syntheticFormalOriginal();
  const raw = { requestId: '', package: copyComplete(base.package) } as TdmsDailyMetadataEnvelope;
  const binding = copyComplete(raw.package.artifactBindings[0]);
  const marker = copyComplete(raw.package.query.originalAcquisition);
  delete raw.package.query.originalAcquisition;
  raw.package.artifactBindings = [];
  raw.package.observedAt = raw.package.records[0].observedAt;
  const processingRef = 'OR:wt.change2.WTChangeRequest2:910';
  const metadata = sourcePackage(relationTargets(raw, [processingRef], options.mismatchedRootTargetVersion
    ? { rawRevision: 'A', rawIteration: '1', confirmation: 'SOURCE_DECLARED' }
    : unknownVersion));
  binding.ownerSnapshotId = metadata.records[0].snapshotId;
  const { bindingId: _bindingId, observedAt: _time, ...identity } = binding;
  binding.bindingId = 'TDMSBIND-' + hash(identity);
  const original: TdmsDailyMetadataPackage = { ...copyComplete(metadata),
    observedAt: [metadata.records[0].observedAt, binding.observedAt].sort().at(-1)!,
    records: [copyComplete(metadata.records[0])],
    edges: metadata.edges.filter(edge => edge.fromSnapshotId === metadata.records[0].snapshotId),
    artifactBindings: [binding], readFailures: [],
    query: { ...metadata.query, originalAcquisition: marker },
    packageId: 'TDMSORIGINALPKG-' + hash({ metadataPackageId: metadata.packageId,
      owner: metadata.records[0], binding }) };
  const processing = syntheticCompleteEnvelope('SB_PROCESSING_FORM', 910);
  const assessmentRefs = ['OR:wt.change2.WTChangeOrder2:920', 'OR:wt.change2.WTChangeOrder2:921'];
  const aeoEnvelope: TdmsDailyMetadataEnvelope | null = options.includeAeo ? syntheticAeoNativeView() : null;
  const aeoRef = aeoEnvelope?.package.records[0].sourceRecordId;
  relationTargets(processing, [...assessmentRefs, ...(aeoRef ? [aeoRef] : [])]);
  const processingPackage = bindChild(processing, metadata, processingRef, String((marker as { ownOperationId: string }).ownOperationId));
  const assessmentPackages = assessmentRefs.map((ref, index) => {
    const env = syntheticCompleteEnvelope('SB_ASSESSMENT_FORM', 920 + index), p = proofOfCurrent(env);
    for (const read of p.reads) {
      if (index === 0) Object.assign(read.fields[0].value, { actualLabel: '评估意见:',
        rawValue: 'Synthetic approved opinion', observedTotalCodepoints: 26 });
      else {
        read.owner.stateRaw = 'Estimating';
        for (const field of read.fields) Object.assign(field.value, { state: 'NOT_APPLICABLE', rawValue: null, observedTotalCodepoints: 0 });
        read.fields[0].value.actualLabel = '评估意见:';
      }
    }
    return bindChild(env, processingPackage, ref, operation('5'));
  });
  const engineering = aeoEnvelope && aeoRef ? bindChild(aeoEnvelope, processingPackage, aeoRef, operation('5')) : null;
  return { bytes: base.bytes, metadata, original, processing: processingPackage, assessments: assessmentPackages, engineering };
}
export function laterProcessingObservation(pkg: TdmsDailyMetadataPackage): TdmsDailyMetadataPackage {
  const env = observedEnvelope(copyComplete(pkg)), proof = proofOfCurrent(env);
  for (const read of proof.reads) {
    read.observedAt = '2026-10-13T00:00:03.000Z';
    read.owner.observedAt = '2026-10-13T00:00:03.000Z';
  }
  return sourcePackage(env);
}
export function alternateParentChain(metadata: TdmsDailyMetadataPackage, processing: TdmsDailyMetadataPackage) {
  const laterMetadata = laterProcessingObservation(metadata);
  const env = observedEnvelope(copyComplete(processing));
  const proof = proofOfCurrent(env).requestedCriteria.sourceProof;
  return { metadata: laterMetadata, processing: bindChild(env, laterMetadata,
    processing.records[0].sourceRecordId, String(proof.parentOperationId)) };
}

/** Actual receiver, registration, Source service and controller; SQL/catalog/storage are external doubles. */
export async function observedFixture(options: { mismatchedRootTargetVersion?: boolean; includeAeo?: boolean; noRelationOriginal?: boolean } = {}) {
  const data = sourceFactoryCase(options), original = options.noRelationOriginal
    ? syntheticFormalOriginal() : { bytes: data.bytes, package: data.original };
  const f = fixture(original);
  const originalPackage = original.package;
  const children = options.noRelationOriginal ? [] : [data.processing, ...data.assessments, ...(data.engineering ? [data.engineering] : [])];
  const packages = options.noRelationOriginal ? [originalPackage] : [data.metadata, originalPackage, ...children];
  const claims = packages.map(pkg => adaptTdmsDailySource(observedEnvelope(pkg)).memberClaims);
  const unique = <T>(values: T[]): T[] => [...new Map(values.map(value => [canonical(value), value])).values()];
  for (const action of Object.values(f.f.actions)) {
    action.permittedMembers = { records: unique(claims.flatMap(value => value.records)),
      artifacts: unique(claims.flatMap(value => value.artifacts)),
      relationIds: [...new Set(claims.flatMap(value => value.relationIds))], relatedDocumentVersionIds: [] };
  }
  f.f.actions.READ_RELATIONS.allowed = true;
  if (!options.noRelationOriginal) await f.dailyController.submit(f.request, observedEnvelope(data.metadata), {});
  await f.stage();
  await f.dailyController.submit(f.request, observedEnvelope(originalPackage), {});
  const registration = await f.register();
  if (!registration.documentVersionId) throw new Error('SYNTHETIC_FORMAL_REGISTRATION_REQUIRED');
  for (const pkg of children)
    await f.dailyController.submit(f.request, observedEnvelope(pkg), {});

  const indexOf = (c: TdmsCapture) => retainedCaptureIndex({ scope: c.scope, packageId: c.packageId,
    packageHash: c.packageHash, captureRef: c.receipt.captureRef,
    applicationScopeId: c.dailyMetadata?.applicationScopeId, ...c.dailyMetadata?.nativeRetention,
    recordRevisionRefs: c.receipt.recordRevisionRefs, assertionRefs: c.receipt.assertionRefs });
  const matching = (c: TdmsCapture, scope: TdmsSourceScope, page: TdmsObservedChildrenPage) => {
    const index = indexOf(c), record = c.dailyMetadata!.envelope.package.records[0];
    const own = record.rawFields.completeOwnedSource as { requestedCriteria: { sourceProof: Record<string, unknown> } };
    const proof = own.requestedCriteria.sourceProof, parent = page.parent;
    return sameScope(c.scope, scope) && index.applicationScopeId === parent.applicationScopeId &&
      record.snapshotId === index.records[0].snapshotId && record.sourceRecordId === index.records[0].sourceRecordId &&
      record.kind === index.records[0].sourceKind &&
      proof.kind === 'REQUIRED_RELATION_TARGET' && proof.parentSnapshotId === parent.snapshotId &&
      proof.parentSourceRecordId === parent.sourceRecordId && canonical(proof.parentSourceVersion) === canonical(parent.sourceVersion) &&
      (parent.originalPackageId === undefined || proof.parentPackageId === parent.originalPackageId && proof.parentPackageSha256 === parent.packageHash) &&
      (!page.after || c.receipt.captureRef > page.after) &&
      (!page.childRevisionRef || index.records[0].sourceRevisionRef === page.childRevisionRef) &&
      page.permittedRecords.some(member => member.recordKind === index.records[0].nativeKind && member.sourceRecordId === index.records[0].sourceRecordId);
  };
  const repository: TdmsRepository = { transaction: <T>(run: (tx: TdmsTransaction) => Promise<T>) =>
    f.repository.transaction(tx => run({ ...tx,
      observedCaptureIndex: async (scope, packageId) => {
        const row = f.repository.state.captures.find(value => sameScope(value.scope, scope) && value.packageId === packageId);
        return row ? indexOf(row) : null;
      },
      observedChildren: async (scope, page) => f.repository.state.captures
        .filter(value => matching(value, scope, page)).map(indexOf)
        .sort((a, b) => a.captureRef.localeCompare(b.captureRef)).slice(0, page.limit),
      observedAssertion: async (scope, ref) => f.repository.state.assertions.find(value =>
        sameScope(value.scope, scope) && value.assertion.assertionRef === ref) ?? null,
    })) };
  const authorizer = Reflect.get(f.documents, 'authorizer');
  const documents = new MiaodaTdmsDocumentAccess(authorizer, f.catalog as never);
  const service = new TdmsSourceService(repository, Reflect.get(f.service, 'authorization'),
    Reflect.get(f.service, 'artifacts'), documents, f.formal);
  const controller = new TdmsSourceController(service);
  const originalCapture = f.repository.state.captures.find(value => value.packageId === observedEnvelope(originalPackage).requestId)!;
  const rootRef = originalCapture.dailyMetadata!.nativeRetention!.records[0].sourceRevisionRef;
  return { ...f, data, observedRepository: repository, controller, registration, rootRef };
}
