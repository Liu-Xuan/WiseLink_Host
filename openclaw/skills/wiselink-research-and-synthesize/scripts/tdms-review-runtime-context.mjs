import { isDeepStrictEqual } from 'node:util';
import {
  assertTdmsNativeProjection,
  assertTdmsNativeReadPacket,
  sameTdmsNativeEvidenceBody,
} from './tdms-native-context.mjs';

export const TDMS_REVIEW_RUNTIME_SCHEMA = 'wiselink.tdms-review-runtime-context.v1';
export const REVIEW_NATIVE_READ_TOOL = 'read_review_native_sources';

export function reviewNativeRuntime(task) {
  const addon = task.jobAidContext?.tdmsReviewContext;
  return addon?.schemaVersion === TDMS_REVIEW_RUNTIME_SCHEMA ? addon.runtimeContext : null;
}

/** Transport-only checks. The Host owns the reserved row and live authority. */
export function assertTdmsReviewRuntimeContext(context, directory, saved) {
  exact(context, ['schemaVersion', 'binding', 'selections', 'projection']);
  if (context.schemaVersion !== 'wiselink.tdms-runtime-context.v1') fail('CONTEXT_INVALID');
  exact(context.binding, ['tenantId', 'workItemId', 'documentVersionId', 'actorUserId', 'taskContextRef']);
  Object.values(context.binding).forEach(text);
  if (!Array.isArray(context.selections)) fail('CONTEXT_INVALID');
  const identities = new Set();
  for (const selection of context.selections) {
    exact(selection, ['scope', 'processingFamilyRef', 'setRevisionRef', 'generation', 'sourceRevisionRefs']);
    scope(selection.scope, context.binding.tenantId);
    text(selection.processingFamilyRef); text(selection.setRevisionRef);
    positive(selection.generation); refs(selection.sourceRevisionRefs);
    if (!selection.sourceRevisionRefs.length) fail('CONTEXT_INVALID');
    const key = JSON.stringify([selection.scope.tenantId, selection.scope.sourceKey,
      selection.scope.sourceInstanceId, selection.scope.scopeId, selection.processingFamilyRef]);
    if (identities.has(key)) fail('CONTEXT_INVALID');
    identities.add(key);
  }
  const native = directory.filter(item => item.kind === 'TDMS_NATIVE_RECORD');
  assertTdmsNativeProjection(context.projection, native);
  const projection = context.projection;
  if (projection.historicalCohortApprovedRefs.length ||
      projection.cohorts.length !== context.selections.length) fail('CONTEXT_INVALID');
  const expected = new Map(saved.map(item => [item.evidenceRef, {
    ref: item.evidenceRef, kind: item.kind, title: item.title, versionLabel: item.versionLabel,
    locator: item.nativeScope.fieldSelectors.map(field => field.fieldPath).join(', '),
  }]));
  for (const opinion of projection.opinions) {
    scope(opinion.scope, context.binding.tenantId);
    ['recordRef', 'sourceRevisionRef', 'sourceRecordId'].forEach(key => text(opinion.assessment[key]));
    text(opinion.sourceSelector); text(opinion.approval.captureRef);
    version(opinion.assessment.sourceVersion);
    if (opinion.assessment.businessVersion !== null) version(opinion.assessment.businessVersion);
    if (opinion.author !== null) {
      exact(opinion.author, ['sourcePersonId', 'name', 'role']);
      Object.values(opinion.author).forEach(nullableText);
    }
    if (opinion.lane !== null) {
      exact(opinion.lane, ['seriesRef', 'professionalScope', 'assertionRef']);
      text(opinion.lane.seriesRef); text(opinion.lane.assertionRef); nullableText(opinion.lane.professionalScope);
    }
    oneOf(opinion.approval.mode, ['EXACT_VERSION', 'OBJECT_OBSERVATION']);
    if (!projection.selectedSetApprovedRefs.includes(opinion.evidenceRef) || expected.has(opinion.evidenceRef)) continue;
    expected.set(opinion.evidenceRef, { ref: opinion.evidenceRef, kind: 'TDMS_NATIVE_RECORD',
      title: opinion.assessment.sourceRecordId, versionLabel: opinion.assessment.sourceVersion.rawRevision,
      locator: opinion.fieldPath });
  }
  if (native.length !== expected.size || native.some(item =>
    !isDeepStrictEqual(item, expected.get(item.ref)))) fail('DIRECTORY_INVALID');
  const selected = new Set(), used = new Set();
  for (const cohort of projection.cohorts) {
    scope(cohort.scope, context.binding.tenantId);
    ['setRevisionRef', 'processingFamilyRef', 'processingObservationRef'].forEach(key => text(cohort[key]));
    nullableText(cohort.cohortRef);
    for (const key of ['membershipCoverage', 'versionMappingCoverage', 'approvedBodyCaptureCoverage'])
      oneOf(cohort[key], ['COMPLETE', 'PARTIAL', 'UNKNOWN']);
    oneOf(cohort.approvalReadiness, ['ALL_APPROVED', 'PENDING', 'UNKNOWN']);
    oneOf(cohort.currentness, ['CURRENT', 'HISTORICAL', 'UNKNOWN']);
    refs(cohort.gaps);
    const selection = context.selections.filter(item =>
      isDeepStrictEqual(item.scope, cohort.scope) && item.setRevisionRef === cohort.setRevisionRef &&
      item.processingFamilyRef === cohort.processingFamilyRef);
    if (selection.length !== 1 || used.has(selection[0])) fail('CONTEXT_INVALID');
    used.add(selection[0]);
    for (const root of cohort.rootBindings) {
      exact(root, ['endpoint', 'fileProcessingAssertionRefs', 'applicabilityEvidenceRefs']);
      const key = root.endpoint?.kind === 'DOCUMENT_VERSION' ? 'documentVersionId' : 'sourceRevisionRef';
      exact(root.endpoint, ['kind', key]);
      if (!['DOCUMENT_VERSION', 'NATIVE_RECORD_REVISION'].includes(root.endpoint.kind)) fail('CONTEXT_INVALID');
      text(root.endpoint[key]); refs(root.fileProcessingAssertionRefs); refs(root.applicabilityEvidenceRefs);
    }
    if (selection[0].sourceRevisionRefs.some(ref => !cohort.rootBindings.some(root =>
      root.endpoint.sourceRevisionRef === ref))) fail('CONTEXT_INVALID');
    const statuses = new Map();
    const memberRefs = new Set();
    for (const member of cohort.members) {
      text(member.memberRef); nullableText(member.assessmentObservationRef);
      if (memberRefs.has(member.memberRef)) fail('CONTEXT_INVALID');
      memberRefs.add(member.memberRef);
      oneOf(member.membershipResolution, ['CONFIRMED', 'OBSERVED_ONLY', 'UNRESOLVED']);
      oneOf(member.status, ['APPROVED', 'QUALIFIED', 'REVOKED', 'METADATA_ONLY', 'UNKNOWN']);
      refs(member.opinionRefs);
      for (const key of ['contributorRefs', 'responsibilityRefs', 'ataScopes', 'evidenceRefs']) refs(member[key]);
      for (const contribution of member.opinionContributions) {
        if (!member.opinionRefs.includes(contribution.opinionRef)) fail('CONTEXT_INVALID');
        for (const key of ['contributorRefs', 'responsibilityRefs', 'ataScopes', 'assertionRefs']) refs(contribution[key]);
      }
      for (const ref of member.opinionRefs) {
        const opinion = projection.opinions.find(item => item.evidenceRef === ref);
        if (!opinion || !isDeepStrictEqual(opinion.scope, cohort.scope) ||
            member.assessmentObservationRef !== opinion.assessment.sourceRevisionRef || statuses.has(ref))
          fail('CONTEXT_INVALID');
        statuses.set(ref, member.status);
      }
    }
    for (const [key, status] of [['approvedOpinionRefs', 'APPROVED'],
      ['qualifiedOpinionRefs', 'QUALIFIED'], ['revokedOpinionRefs', 'REVOKED']]) {
      refs(cohort[key]);
      if (!sameRefs(cohort[key], [...statuses].filter(([, value]) => value === status).map(([ref]) => ref)))
        fail('CONTEXT_INVALID');
    }
    cohort.approvedOpinionRefs.forEach(ref => selected.add(ref));
  }
  if (!sameRefs(projection.selectedSetApprovedRefs, [...selected])) fail('CONTEXT_INVALID');
  if (projection.opinions.some(opinion => !projection.cohorts.some(cohort =>
    cohort.members.some(member => member.opinionRefs.includes(opinion.evidenceRef))))) fail('CONTEXT_INVALID');
  for (const conflict of projection.contradictions) {
    exact(conflict, ['assertionRef', 'opinionRef', 'againstRef']);
    Object.values(conflict).forEach(text);
    if (!projection.opinions.some(opinion => opinion.evidenceRef === conflict.opinionRef)) fail('CONTEXT_INVALID');
  }
}

export function assertTdmsReviewRuntimeBinding(task, envelope) {
  const runtime = reviewNativeRuntime(task);
  if (!runtime) return;
  for (const key of ['tenantId', 'workItemId', 'documentVersionId'])
    if (runtime.binding[key] !== envelope[key]) fail('TASK_BINDING_INVALID');
  if (runtime.binding.taskContextRef !== envelope.operationRef) fail('TASK_BINDING_INVALID');
}

export function reviewNativeDirectoryRefs(task) {
  return reviewNativeRuntime(task) ? task.jobAidContext.modelInput.availableSources
    .filter(item => item.kind === 'TDMS_NATIVE_RECORD').map(item => item.ref) : [];
}

/** Validate original packet before any model projection or read registration. */
export function assertTdmsReviewReadObservation(task, observation) {
  const runtime = reviewNativeRuntime(task), packet = observation?.packet;
  const requested = observation?.requestedRefs;
  if (!runtime || !Array.isArray(requested) || requested.length < 1 || requested.length > 96 ||
      new Set(requested).size !== requested.length ||
      requested.some(ref => !reviewNativeDirectoryRefs(task).includes(ref)) ||
      !['wiselink.jobaid-source-read.v2', 'wiselink.jobaid-source-read.v3'].includes(packet?.schemaVersion) ||
      packet.status !== 'AVAILABLE' || packet.scope !== 'EXACT' || packet.completeRequestedScope !== true ||
      !sameRefs(packet.sourceRefs, requested) || !Array.isArray(packet.evidence) ||
      packet.evidence.length !== requested.length || !sameRefs(packet.evidence.map(item => item.evidenceRef), requested))
    fail('READ_PACKET_INVALID');
  assertTdmsNativeReadPacket(packet);
  if (new Set(packet.nativeReadReceipts.map(receipt => receipt.receiptRef)).size !== requested.length)
    fail('READ_PACKET_INVALID');
  // The actual v3 builder derives statements/contexts only from requested
  // ordinary PRIOR_RESULT refs. This tool requests native refs exclusively.
  if (packet.schemaVersion === 'wiselink.jobaid-source-read.v3' &&
      (!Array.isArray(packet.sourceStatements) || packet.sourceStatements.length ||
       !Array.isArray(packet.activityContexts) || packet.activityContexts.length)) fail('READ_PACKET_INVALID');
  for (const item of packet.evidence) {
    if (item.kind !== 'TDMS_NATIVE_RECORD' ||
        item.nativeReadReceipt.taskContextRef !== runtime.binding.taskContextRef) fail('READ_BINDING_INVALID');
    const opinion = runtime.projection.opinions.find(row => row.evidenceRef === item.evidenceRef);
    const selected = item.nativeScope.processingSetBinding;
    const cohort = runtime.projection.cohorts.find(row => isDeepStrictEqual(row.scope, selected.scope) &&
      row.setRevisionRef === selected.setRevisionRef && row.processingFamilyRef === selected.processingFamilyRef);
    const selection = runtime.selections.find(row => isDeepStrictEqual(row.scope, selected.scope) &&
      row.setRevisionRef === selected.setRevisionRef && row.processingFamilyRef === selected.processingFamilyRef);
    const member = cohort?.members.find(row => row.memberRef === selected.memberRef);
    if (!opinion || !runtime.projection.selectedSetApprovedRefs.includes(item.evidenceRef) || !selection ||
        !member?.opinionRefs.includes(item.evidenceRef) || member.status !== 'APPROVED' ||
        !isDeepStrictEqual(selected.scope, opinion.scope) || selected.generation !== selection.generation ||
        selected.cohortRef !== cohort.cohortRef || selected.processingObservationRef !== cohort.processingObservationRef ||
        selected.assessmentObservationRef !== member.assessmentObservationRef ||
        item.nativeSource.sourceKey !== opinion.scope.sourceKey ||
        item.nativeSource.sourceInstanceId !== opinion.scope.sourceInstanceId ||
        ['recordRef', 'sourceRevisionRef', 'sourceRecordId', 'sourceVersion'].some(key =>
          !isDeepStrictEqual(item.nativeSource[key], opinion.assessment[key])) ||
        !isDeepStrictEqual(item.nativeScope.fieldSelectors, [{fieldPath: opinion.fieldPath, selector: opinion.sourceSelector}]) ||
        item.nativeScope.approval.captureRef !== opinion.approval.captureRef ||
        item.nativeScope.approval.evidencePath !== opinion.approval.evidencePath) fail('READ_BINDING_INVALID');
  }
}

/** First carrier wins; every original packet/receipt remains in observations.
 * This catalog is local decision material, never a mutation of the sealed task. */
export function tdmsReviewDecisionCatalog(task, observations = []) {
  const catalog = new Map((task.jobAidContext?.sourceCatalog ?? []).map(item => [item.evidenceRef, item]));
  if (!Array.isArray(observations)) fail('READ_PACKET_INVALID');
  for (const observation of observations) {
    assertTdmsReviewReadObservation(task, observation);
    for (const item of observation.packet.evidence) {
      const prior = catalog.get(item.evidenceRef);
      if (prior && !sameTdmsNativeEvidenceBody(prior, item)) fail('BODY_CHANGED');
      catalog.set(item.evidenceRef, prior ?? item);
    }
  }
  return [...catalog.values()];
}

/** @typedef {import('../../../../shared/assessment-reading.interface').AssessmentEvidence &
 * {kind:'TDMS_NATIVE_RECORD'}} NativeCarrier
 * @typedef {Omit<NativeCarrier['nativeReadReceipt'], 'taskContextRef'>} ModelNativeReadReceipt
 */
/** Model-only display copy (ModelNativeReadReceipt); never feed it back into a
 * strict receipt parser, SAVE or authorization function. */
export function projectTdmsReviewReadSources(task, observation) {
  assertTdmsReviewReadObservation(task, observation);
  return observation.requestedRefs.map(ref => {
    const carrier = structuredClone(observation.packet.evidence.find(item => item.evidenceRef === ref));
    delete carrier.nativeReadReceipt.taskContextRef;
    delete carrier.nativeScope.processingSetBinding.scope.tenantId;
    return { sourceRefId: ref, ...carrier };
  });
}

function version(value) {
  exact(value, ['rawRevision', 'rawIteration', 'confirmation']);
  nullableText(value.rawRevision); nullableText(value.rawIteration);
  oneOf(value.confirmation, ['SOURCE_DECLARED', 'VERSION_UNCONFIRMED']);
}
function scope(value, tenantId) {
  exact(value, ['tenantId', 'sourceKey', 'sourceInstanceId', 'scopeId']);
  Object.values(value).forEach(text);
  if (value.tenantId !== tenantId) fail('CONTEXT_INVALID');
}
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail('CONTEXT_INVALID');
}
function text(value) { if (typeof value !== 'string' || !value.trim()) fail('CONTEXT_INVALID'); }
function nullableText(value) { if (value !== null && typeof value !== 'string') fail('CONTEXT_INVALID'); }
function oneOf(value, values) { if (!values.includes(value)) fail('CONTEXT_INVALID'); }
function positive(value) { if (!Number.isSafeInteger(value) || value < 1) fail('CONTEXT_INVALID'); }
function refs(value) {
  if (!Array.isArray(value) || new Set(value).size !== value.length) fail('CONTEXT_INVALID');
  value.forEach(text);
}
function sameRefs(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
    new Set(left).size === left.length && left.every(ref => right.includes(ref));
}
function fail(code) { throw new Error(`REVIEW_JOBAID_TDMS_${code}`); }
