import { isDeepStrictEqual } from 'node:util';
import { assertTdmsNativeReadPacket } from './tdms-native-context.mjs';
import { assertTdmsReviewRuntimeContext, TDMS_REVIEW_RUNTIME_SCHEMA } from './tdms-review-runtime-context.mjs';

const CONTEXT_KEYS = [
  'schemaVersion', 'mode', 'reviewConversationRef', 'reviewTurnRef',
  'requestId', 'inputRevision', 'workRevisionRef', 'workRevision', 'evidenceRefs',
];

/** Saved-carrier transport checks only. Host separately verifies the historical
 * receipt and current caller/source authority; this addon grants no new READ. */
export function assertTdmsReviewSavedContext(task) {
  const jobAid = task.jobAidContext;
  const model = jobAid?.modelInput ?? task.context?.problemAssessment;
  const wrapperHasContext = has(jobAid, 'tdmsReviewContext');
  const modelHasContext = has(model, 'tdmsReviewContext');
  if (!jobAid) {
    if (wrapperHasContext || modelHasContext) fail('PURPOSE_INVALID');
    return;
  }
  if (has(jobAid, 'tdmsContext') || has(model, 'tdmsContext')) fail('CONTEXT_MIXED');
  const catalog = nativeRows(jobAid.sourceCatalog);
  const saved = nativeRows(jobAid.previousWork?.content?.evidence);
  const delivered = nativeRows(model?.deliveredEvidence);
  const directory = nativeRows(model?.availableSources);
  if (!wrapperHasContext && !modelHasContext) {
    if (catalog.length || saved.length || delivered.length || directory.length) fail('CONTEXT_REQUIRED');
    return;
  }
  if (!wrapperHasContext || !modelHasContext ||
      task.schemaVersion !== 'wiselink.3_1.review_turn_task.v1.c5' ||
      task.context?.purpose !== 'UPDATE_ASSESSMENT' || model?.purpose !== 'PROBLEM_REVIEW')
    fail('PURPOSE_INVALID');
  const context = jobAid.tdmsReviewContext;
  const runtime = context?.schemaVersion === TDMS_REVIEW_RUNTIME_SCHEMA;
  const keys = runtime ? [...CONTEXT_KEYS.slice(0, -1), 'savedEvidenceRefs', 'runtimeContext'] : CONTEXT_KEYS;
  if (!record(context) || Object.keys(context).length !== keys.length ||
      keys.some(key => !Object.hasOwn(context, key)) ||
      (runtime ? context.mode !== 'BOUNDED_NATIVE_READ' :
        context.schemaVersion !== 'wiselink.tdms-review-saved-context.v1' || context.mode !== 'SAVED_EVIDENCE_ONLY') ||
      !isDeepStrictEqual(context, model.tdmsReviewContext)) fail('CONTEXT_INVALID');
  for (const key of ['reviewConversationRef', 'reviewTurnRef', 'requestId']) {
    if (!text(context[key]) || context[key] !== task[key]) fail('TURN_BINDING_INVALID');
  }
  if (!Number.isSafeInteger(context.inputRevision) || context.inputRevision < 0 ||
      context.inputRevision !== task.inputRevision) fail('TURN_BINDING_INVALID');
  if (!text(context.workRevisionRef) || !Number.isSafeInteger(context.workRevision) ||
      context.workRevision < 1 || model.expectedWorkRevision !== context.workRevision ||
      [jobAid.previousWork, model.previousWork].some(previous =>
        previous?.workRevisionRef !== context.workRevisionRef ||
        previous?.workRevision !== context.workRevision)) fail('WORK_BINDING_INVALID');
  const refs = runtime ? context.savedEvidenceRefs : context.evidenceRefs;
  if (!Array.isArray(refs) || (!runtime && !refs.length) || refs.length > 4096 || refs.some(ref => !text(ref)) ||
      new Set(refs).size !== refs.length ||
      !sameRefs(refs, saved.map(item => item.evidenceRef)) ||
      !sameRefs(refs, catalog.map(item => item.evidenceRef)) ||
      !sameRefs(refs, delivered.map(item => item.evidenceRef)) ||
      (!runtime && !sameRefs(refs, directory.map(item => item.ref))) ||
      !Array.isArray(jobAid.initiallyDeliveredRefs) ||
      refs.some(ref => !jobAid.initiallyDeliveredRefs.includes(ref))) fail('EVIDENCE_REFS_INVALID');
  for (const item of catalog) {
    const previous = saved.find(value => value.evidenceRef === item.evidenceRef);
    if (!isDeepStrictEqual(item, previous)) fail('SAVED_CARRIER_DRIFT');
  }
  // Use the original carrier and original receipt together. Do not replace its
  // taskContextRef, permissionRevision, readAt, selector or processing binding.
  assertTdmsNativeReadPacket({
    sourceRefs: refs,
    evidence: catalog,
    nativeReadReceipts: catalog.map(item => item.nativeReadReceipt),
  });
  if (runtime) assertTdmsReviewRuntimeContext(context.runtimeContext, model.availableSources, catalog);
}

/** Extend the existing legacy/statement projection without changing ordinary
 * fields or manufacturing a receipt for the current Review. */
export function tdmsReviewSavedEvidenceFields(item) {
  return item.kind === 'TDMS_NATIVE_RECORD' ? {
    nativeSource: structuredClone(item.nativeSource),
    nativeScope: structuredClone(item.nativeScope),
    nativeReadReceipt: structuredClone(item.nativeReadReceipt),
  } : {};
}

/** Project only the validated saved-native model view. The sealed task, saved
 * carriers and Host context retain every identity and original receipt field. */
export function projectTdmsReviewSavedModelContext(task, context) {
  const jobAid = task.jobAidContext;
  if (!has(jobAid, 'tdmsReviewContext')) {
    if (has(context?.problemAssessment, 'tdmsReviewContext')) fail('MODEL_CONTEXT_DRIFT');
    return context;
  }
  assertTdmsReviewSavedContext(task);
  if (!isDeepStrictEqual(context?.problemAssessment, jobAid.modelInput)) fail('MODEL_CONTEXT_DRIFT');
  const projected = structuredClone(context);
  if (jobAid.tdmsReviewContext.schemaVersion === TDMS_REVIEW_RUNTIME_SCHEMA) {
    const original = jobAid.tdmsReviewContext;
    const projection = structuredClone(original.runtimeContext.projection);
    // Only the validated, known scope paths have tenant control metadata.
    for (const row of [...projection.opinions, ...projection.cohorts]) delete row.scope.tenantId;
    projected.problemAssessment.tdmsReviewContext = {
      schemaVersion: original.schemaVersion, mode: original.mode, projection,
    };
  } else delete projected.problemAssessment.tdmsReviewContext;
  for (const item of nativeRows(projected.problemAssessment.deliveredEvidence)) {
    const scope = item.nativeScope?.processingSetBinding?.scope;
    if (!record(scope)) fail('MODEL_SCOPE_INVALID');
    delete scope.tenantId;
  }
  return projected;
}

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function has(value, key) { return record(value) && Object.hasOwn(value, key); }
function text(value) { return typeof value === 'string' && value.trim() !== ''; }
function nativeRows(rows) { return Array.isArray(rows) ? rows.filter(row => row?.kind === 'TDMS_NATIVE_RECORD') : []; }
function sameRefs(expected, actual) {
  return actual.length === expected.length && new Set(actual).size === actual.length &&
    expected.every(ref => actual.includes(ref));
}
function fail(code) { throw new Error(`REVIEW_JOBAID_TDMS_${code}`); }
