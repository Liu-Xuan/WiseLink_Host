import { isTdmsApprovedOpinionReference, TDMS_APPROVED_OPINION_REFERENCE_PREFIX } from './tdms-approved-opinion-reference';
import type { TdmsRecordSummary } from './tdms-source.interface';
import type { AssessmentEvidence, AssessmentTdmsNativeScope, AssessmentTdmsProcessingSetBinding, AssessmentTdmsApprovalProvenance } from './assessment-reading.interface';

/** New native consumer admission is intentionally narrower than the historical DTO. */
export type AssessmentTdmsNativeEvidence = Extract<AssessmentEvidence, { kind: 'TDMS_NATIVE_RECORD' }> & {
  nativeScope: AssessmentTdmsNativeScope & { processingSetBinding: AssessmentTdmsProcessingSetBinding; approval: AssessmentTdmsApprovalProvenance };
};

const fail = (): never => { throw new Error('ASSESSMENT_TDMS_NATIVE_EVIDENCE_INVALID'); };
function object(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const item = value as Record<string, unknown>;
  if (required.some(key => !Object.prototype.hasOwnProperty.call(item, key)) || Object.keys(item).some(key => !required.includes(key) && !optional.includes(key))) fail();
  return item;
}
function text(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) fail();
}
function identifier(value: unknown): asserts value is string {
  text(value);
  if (value.length > 255 || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) fail();
}
function nullableText(value: unknown): void { if (value !== null && typeof value !== 'string') fail(); }
function strings(value: unknown, unique = false): asserts value is string[] {
  if (!Array.isArray(value)) return fail();
  value.forEach(text);
  if (unique && new Set(value).size !== value.length) fail();
}
function time(value: unknown): void {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u.test(value) || !Number.isFinite(Date.parse(value))) fail();
  const date = (value as string).slice(0, 10);
  if (new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) fail();
}
function rawCode(value: unknown): Record<string, unknown> | null {
  if (value === null) return null;
  const code = object(value, ['rawCode', 'rawName'], ['controlledMapping']);
  nullableText(code.rawCode); nullableText(code.rawName);
  if (Object.prototype.hasOwnProperty.call(code, 'controlledMapping')) nullableText(code.controlledMapping);
  return code;
}
function version(value: unknown): void {
  const v = object(value, ['rawRevision', 'rawIteration', 'confirmation']);
  nullableText(v.rawRevision); nullableText(v.rawIteration);
  if (v.confirmation !== 'SOURCE_DECLARED' && v.confirmation !== 'VERSION_UNCONFIRMED') fail();
}
function selectors(value: unknown): Array<{fieldPath: string; selector: string}> {
  if (!Array.isArray(value) || !value.length) return fail();
  const result = value.map(value => {
    const item = object(value, ['fieldPath', 'selector']);
    identifier(item.fieldPath); identifier(item.selector);
    return { fieldPath: item.fieldPath, selector: item.selector };
  });
  if (new Set(result.map(item => item.fieldPath)).size !== result.length) fail();
  return result;
}

/** Approval-only gate for consumers before any native body accessor. It reads
 * only the five source metadata properties below, never enumerating, spreading,
 * cloning or dereferencing content on the supplied retained record. */
export function parseAssessmentTdmsApprovalProvenance(value: unknown, source: Pick<TdmsRecordSummary,
  'sourceRecordId' | 'recordKind' | 'sourceVersion' | 'state' | 'observedAt'>): AssessmentTdmsApprovalProvenance {
  if (!source || typeof source !== 'object' || Array.isArray(source)) fail();
  identifier(source.sourceRecordId); version(source.sourceVersion); time(source.observedAt);
  const state = rawCode(source.state);
  if (source.recordKind !== 'ENGINEER_ASSESSMENT' || state?.rawName !== 'Estimated' || (state.rawCode !== null && state.rawCode !== 'Estimated')) fail();
  const approval = object(value, ['captureRef', 'evidencePath', 'mode', 'before', 'after', 'approvalSubject']);
  identifier(approval.captureRef);
  if (approval.evidencePath !== 'rawFields.opinionCollection' || approval.mode !== 'EXACT_VERSION') fail();
  const subject = object(approval.approvalSubject, ['sourceRecordId', 'sourceVersion']);
  const exactVersion = (value: unknown): void => {
    version(value);
    const v = value as Record<string, unknown>;
    identifier(v.rawRevision); identifier(v.rawIteration);
    const sourceVersion = source.sourceVersion;
    if (v.confirmation !== 'SOURCE_DECLARED' || v.rawRevision !== sourceVersion.rawRevision || v.rawIteration !== sourceVersion.rawIteration || v.confirmation !== sourceVersion.confirmation) fail();
  };
  if (subject.sourceRecordId !== source.sourceRecordId) fail();
  exactVersion(subject.sourceVersion);
  const observations = [approval.before, approval.after].map(value => {
    const observation = object(value, ['sourceRecordId', 'recordKind', 'sourceVersion', 'state', 'sourceModifiedAt', 'observedAt', 'identitySelector', 'stateSelector', 'versionSelector', 'objectBinding']);
    if (observation.sourceRecordId !== source.sourceRecordId || observation.recordKind !== 'ENGINEER_ASSESSMENT' || observation.objectBinding !== 'EXACT_CURRENT_DETAIL') fail();
    exactVersion(observation.sourceVersion);
    const state = rawCode(observation.state);
    if (state?.rawName !== 'Estimated' || (state.rawCode !== null && state.rawCode !== 'Estimated')) fail();
    if (observation.identitySelector !== '#infoPageIdentityObjectIdentifier' || observation.stateSelector !== '.attributePanel[oid] .attributePanel-label[State] => .attributePanel-value' || observation.versionSelector !== '.attributePanel[oid] .attributePanel-label[Version] => .attributePanel-value') fail();
    time(observation.observedAt);
    if (observation.sourceModifiedAt !== null) time(observation.sourceModifiedAt);
    return observation;
  });
  if (Date.parse(observations[0]!.observedAt as string) > Date.parse(observations[1]!.observedAt as string) || Date.parse(observations[1]!.observedAt as string) > Date.parse(source.observedAt as string) || observations[0]!.sourceModifiedAt !== observations[1]!.sourceModifiedAt) fail();
  return structuredClone(value) as AssessmentTdmsApprovalProvenance;
}

/** Validate saved bytes, never infer approval, currentness, a cohort, or a new receipt. */
export function parseAssessmentTdmsEvidence(value: unknown): AssessmentTdmsNativeEvidence {
  const item = object(value, ['kind', 'evidenceRef', 'title', 'versionLabel', 'excerpt', 'nativeSource', 'nativeScope', 'nativeReadReceipt'], ['dialogueSource']);
  if (item.kind !== 'TDMS_NATIVE_RECORD') fail();
  // Preserve historical opaque aliases; generated tuple locators have their own
  // bounded canonical grammar rather than an atomic identifier's 255-unit limit.
  if (typeof item.evidenceRef === 'string' && item.evidenceRef.startsWith(TDMS_APPROVED_OPINION_REFERENCE_PREFIX)) {
    if (!isTdmsApprovedOpinionReference(item.evidenceRef)) fail();
  } else identifier(item.evidenceRef);
  text(item.title); text(item.excerpt);
  if (item.versionLabel !== null) text(item.versionLabel);
  if (Object.prototype.hasOwnProperty.call(item, 'dialogueSource')) {
    const dialogue = object(item.dialogueSource, ['requestRef', 'contributionRef', 'revision', 'contextWorkItemIds']);
    identifier(dialogue.requestRef); identifier(dialogue.contributionRef); strings(dialogue.contextWorkItemIds, true);
    if (!Number.isSafeInteger(dialogue.revision) || Number(dialogue.revision) < 1) fail();
  }
  const source = object(item.nativeSource, ['recordRef', 'sourceRevisionRef', 'recordKind', 'sourceRecordId', 'sourceKey', 'sourceInstanceId', 'title', 'fileType', 'sourceVersion', 'state', 'authors', 'observedAt', 'capturedAt', 'coverage', 'relatedDocumentVersionIds', 'fieldSelectors', 'sourceVerification', 'currentness'], ['businessVersion']);
  for (const key of ['recordRef', 'sourceRevisionRef', 'sourceRecordId', 'sourceKey', 'sourceInstanceId']) identifier(source[key]);
  text(source.title); rawCode(source.fileType); version(source.sourceVersion);
  if (Object.prototype.hasOwnProperty.call(source, 'businessVersion') && source.businessVersion !== null) version(source.businessVersion);
  const state = rawCode(source.state);
  // Parent processing approval, a mapped label and technical R00 cannot approve a child.
  if (source.recordKind !== 'ENGINEER_ASSESSMENT' || state?.rawName !== 'Estimated' || (state.rawCode !== null && state.rawCode !== 'Estimated')) fail();
  if (!Array.isArray(source.authors)) fail();
  for (const value of source.authors as unknown[]) {
    const person = object(value, ['sourcePersonId', 'name', 'role']);
    Object.values(person).forEach(nullableText);
  }
  time(source.observedAt); time(source.capturedAt);
  const coverage = object(source.coverage, ['status', 'gaps', 'readback']);
  if (!['COMPLETE', 'PARTIAL', 'UNKNOWN'].includes(String(coverage.status)) || !['CONSISTENT', 'NON_ATOMIC', 'NOT_VERIFIED'].includes(String(coverage.readback))) fail();
  strings(coverage.gaps); strings(source.relatedDocumentVersionIds, true);
  const sourceSelectors = selectors(source.fieldSelectors);
  if (source.sourceVerification !== 'DECLARED_ONLY' || source.currentness !== 'SELECTED_HOST_OBSERVATION') fail();
  const scope = object(item.nativeScope, ['sourceRevisionRef', 'fieldSelectors', 'grouping', 'limitations', 'processingSetBinding', 'approval'], ['opinionContribution']);
  if (scope.sourceRevisionRef !== source.sourceRevisionRef || !['SOURCE_DECLARED_BLOCK', 'TRANSPARENT_FIELDS'].includes(String(scope.grouping))) fail();
  strings(scope.limitations);
  if (Object.prototype.hasOwnProperty.call(scope, 'opinionContribution')) {
    const contribution = object(scope.opinionContribution, ['opinionRef', 'contributorRefs', 'responsibilityRefs', 'ataScopes', 'assertionRefs']);
    if (contribution.opinionRef !== item.evidenceRef) fail();
    for (const key of ['contributorRefs', 'responsibilityRefs', 'ataScopes', 'assertionRefs']) strings(contribution[key], true);
    if (!(contribution.assertionRefs as string[]).length) fail();
  }
  const selected = selectors(scope.fieldSelectors);
  if (selected.some(item => !sourceSelectors.some(source => source.fieldPath === item.fieldPath && source.selector === item.selector))) fail();
  const binding = object(scope.processingSetBinding, ['scope', 'setRevisionRef', 'generation', 'processingFamilyRef', 'cohortRef', 'processingObservationRef', 'memberRef', 'assessmentObservationRef']);
  const sourceScope = object(binding.scope, ['tenantId', 'sourceKey', 'sourceInstanceId', 'scopeId']);
  Object.values(sourceScope).forEach(identifier);
  for (const key of ['setRevisionRef', 'processingFamilyRef', 'cohortRef', 'processingObservationRef', 'memberRef', 'assessmentObservationRef']) identifier(binding[key]);
  if (!Number.isSafeInteger(binding.generation) || Number(binding.generation) < 1 || binding.assessmentObservationRef !== source.sourceRevisionRef || sourceScope.sourceKey !== source.sourceKey || sourceScope.sourceInstanceId !== source.sourceInstanceId) fail();
  parseAssessmentTdmsApprovalProvenance(scope.approval, {
    sourceRecordId: source.sourceRecordId as string, recordKind: source.recordKind as TdmsRecordSummary['recordKind'],
    sourceVersion: source.sourceVersion as TdmsRecordSummary['sourceVersion'], state: source.state as TdmsRecordSummary['state'],
    observedAt: source.observedAt as string,
  });
  const receipt = object(item.nativeReadReceipt, ['receiptRef', 'sourceRevisionRef', 'readAt', 'purpose', 'fieldPaths', 'taskContextRef', 'readPerformed', 'permissionRevision', 'engineeringAdoption', 'executionVerified']);
  for (const key of ['receiptRef', 'taskContextRef']) identifier(receipt[key]);
  // Shared-source permission revisions are structured canonical decision snapshots,
  // not 255-character source identifiers. Preserve the complete current provenance.
  text(receipt.permissionRevision);
  time(receipt.readAt); strings(receipt.fieldPaths, true);
  const fieldPaths = receipt.fieldPaths;
  if (receipt.sourceRevisionRef !== source.sourceRevisionRef || receipt.purpose !== 'JOB_AID_NATIVE_RECORD' || receipt.readPerformed !== true || receipt.engineeringAdoption !== 'NOT_CREATED' || receipt.executionVerified !== false || fieldPaths.length !== selected.length || selected.some(item => !fieldPaths.includes(item.fieldPath))) fail();
  // Deep-copy without canonicalizing strings, dates, order or omitted optional fields.
  return structuredClone(value) as AssessmentTdmsNativeEvidence;
}
