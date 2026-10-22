import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import { isTdmsApprovedOpinionReference } from '@shared/tdms-approved-opinion-reference';
import type { AssessmentTdmsNativeEvidence } from '@shared/assessment-tdms-evidence';
import type { CanonicalVerifiedServiceScope } from '../canonical-host/canonical-service-scope.authorization';
import type { TdmsProcessingCohortContext } from '../canonical-host/tdms-approved-opinion-context';
import { tdmsApprovedOpinionRef } from '../canonical-host/tdms-approved-opinion-context';
import type { TdmsSourceScope } from './tdms-source.types';
import { tdmsError } from './tdms-source.types';
import {
  canonical,
  identifier,
  object,
  strict,
} from './tdms-source.validation';

export const TDMS_RUNTIME_READER = Symbol('TDMS_RUNTIME_READER');
/** This is the actual Host service scope, not a synthesized transport/lease or public user. */
export interface TdmsRuntimePrincipal {
  scope: CanonicalVerifiedServiceScope;
  actorUserId: string;
}
export interface TdmsRuntimeTaskBinding {
  tenantId: string;
  workItemId: string;
  documentVersionId: string;
  actorUserId: string;
  taskContextRef: string;
}
export interface TdmsRuntimeSelection {
  scope: TdmsSourceScope;
  processingFamilyRef: string;
  setRevisionRef: string;
  generation: number;
  /** Independently verified exact mapping from this task's Host document to native roots. */
  sourceRevisionRefs: string[];
}
export interface TdmsRuntimeTaskContext {
  schemaVersion: 'wiselink.tdms-runtime-context.v1';
  binding: TdmsRuntimeTaskBinding;
  selections: TdmsRuntimeSelection[];
  /** Full cohort/sibling/contributor metadata. Discovery never contains opinion bodies. */
  projection: TdmsProcessingCohortContext;
}
export type TdmsRuntimeNativeEvidence = AssessmentTdmsNativeEvidence;
/** Historical carrier input is untrusted until the strict native parser accepts it. */
export type TdmsRuntimeSavedNativeEvidence = Extract<
  AssessmentEvidence,
  { kind: 'TDMS_NATIVE_RECORD' }
>;
export type TdmsRuntimeNativeReadReceipt =
  TdmsRuntimeNativeEvidence['nativeReadReceipt'];
export interface TdmsRuntimeReadRequest {
  context: TdmsRuntimeTaskContext;
  evidenceRefs: string[];
  purpose: 'JOB_AID_NATIVE_RECORD';
  taskContextRef: string;
}
export interface TdmsRuntimeReaderPort {
  discover(
    principal: TdmsRuntimePrincipal,
    binding: TdmsRuntimeTaskBinding,
  ): Promise<TdmsRuntimeTaskContext | null>;
  assertAuthorized(
    principal: TdmsRuntimePrincipal,
    context: TdmsRuntimeTaskContext,
  ): Promise<void>;
  read(
    principal: TdmsRuntimePrincipal,
    request: TdmsRuntimeReadRequest,
  ): Promise<{
    evidence: TdmsRuntimeNativeEvidence[];
    receipts: TdmsRuntimeNativeReadReceipt[];
  }>;
  /** Reauthorize and match saved bodies to exact retained records; never creates another READ. */
  verifyEvidence(
    principal: TdmsRuntimePrincipal,
    evidence: TdmsRuntimeSavedNativeEvidence[],
  ): Promise<void>;
}
export class UnconfiguredTdmsRuntimeReader implements TdmsRuntimeReaderPort {
  async discover(): Promise<never> {
    return unavailable();
  }
  async assertAuthorized(): Promise<never> {
    return unavailable();
  }
  async read(): Promise<never> {
    return unavailable();
  }
  async verifyEvidence(): Promise<never> {
    return unavailable();
  }
}
function unavailable(): never {
  throw tdmsError('TDMS_RUNTIME_CALLER_AUTHORIZATION_NOT_CONNECTED', 503);
}

/** Strict, metadata-only storage decoder. Authorization is always a separate live operation. */
export function assertTdmsRuntimeTaskContext(
  value: unknown,
): TdmsRuntimeTaskContext {
  const context = exact(value, [
    'schemaVersion',
    'binding',
    'selections',
    'projection',
  ]);
  if (context.schemaVersion !== 'wiselink.tdms-runtime-context.v1') invalid();
  const binding = exact(context.binding, [
    'tenantId',
    'workItemId',
    'documentVersionId',
    'actorUserId',
    'taskContextRef',
  ]);
  Object.values(binding).forEach(identifier);
  const selections = array(context.selections);
  const identities = new Set<string>();
  for (const value of selections) {
    const selection = exact(value, [
      'scope',
      'processingFamilyRef',
      'setRevisionRef',
      'generation',
      'sourceRevisionRefs',
    ]);
    scope(selection.scope, binding.tenantId);
    identifier(selection.processingFamilyRef);
    identifier(selection.setRevisionRef);
    if (
      !Number.isSafeInteger(selection.generation) ||
      Number(selection.generation) < 1
    )
      invalid();
    refs(selection.sourceRevisionRefs);
    if (!(selection.sourceRevisionRefs as unknown[]).length) invalid();
    const key = canonical([selection.scope, selection.processingFamilyRef]);
    if (identities.has(key)) invalid();
    identities.add(key);
  }
  const projection = exact(context.projection, [
    'opinions',
    'contradictions',
    'selectedSetApprovedRefs',
    'historicalCohortApprovedRefs',
    'cohorts',
    'readPerformed',
    'interpretation',
  ]);
  if (
    projection.readPerformed !== false ||
    projection.interpretation !==
      'APPROVED_PROFESSIONAL_JUDGMENT_NOT_INFALLIBLE'
  )
    invalid();
  const opinions = array(projection.opinions);
  const opinionRefs = new Set<string>();
  for (const value of opinions) {
    const opinion = exact(value, [
      'evidenceRef',
      'scope',
      'assessment',
      'fieldPath',
      'sourceSelector',
      'author',
      'lane',
      'approval',
      'sourceVerification',
      'readPerformed',
      'engineeringAdoption',
      'executionVerified',
    ]);
    scope(opinion.scope, binding.tenantId);
    const assessment = exact(opinion.assessment, [
      'recordRef',
      'sourceRevisionRef',
      'sourceRecordId',
      'sourceVersion',
      'businessVersion',
    ]);
    ['recordRef', 'sourceRevisionRef', 'sourceRecordId'].forEach((key) =>
      identifier(assessment[key]),
    );
    version(assessment.sourceVersion);
    if (assessment.businessVersion !== null)
      version(assessment.businessVersion);
    const match = /^content\.opinions\[(\d+)\]$/u.exec(
      String(opinion.fieldPath),
    );
    if (
      !match ||
      opinion.evidenceRef !==
        tdmsApprovedOpinionRef({
          scope: opinion.scope as unknown as TdmsSourceScope,
          sourceRevisionRef: String(assessment.sourceRevisionRef),
          opinionIndex: Number(match[1]),
        })
    )
      invalid();
    identifier(opinion.sourceSelector);
    if (opinionRefs.has(String(opinion.evidenceRef))) invalid();
    opinionRefs.add(String(opinion.evidenceRef));
    if (opinion.author !== null) {
      const person = exact(opinion.author, ['sourcePersonId', 'name', 'role']);
      for (const value of Object.values(person)) nullableText(value);
    }
    if (opinion.lane !== null) {
      const lane = exact(opinion.lane, [
        'seriesRef',
        'professionalScope',
        'assertionRef',
      ]);
      identifier(lane.seriesRef);
      identifier(lane.assertionRef);
      nullableText(lane.professionalScope);
    }
    const approval = exact(opinion.approval, [
      'captureRef',
      'evidencePath',
      'mode',
    ]);
    identifier(approval.captureRef);
    if (
      approval.evidencePath !== 'rawFields.opinionCollection' ||
      !['EXACT_VERSION', 'OBJECT_OBSERVATION'].includes(String(approval.mode))
    )
      invalid();
    if (
      opinion.sourceVerification !== 'DECLARED_ONLY' ||
      opinion.readPerformed !== false ||
      opinion.engineeringAdoption !== 'NOT_CREATED' ||
      opinion.executionVerified !== false
    )
      invalid();
  }
  const cohorts = array(projection.cohorts);
  if (cohorts.length !== selections.length) invalid();
  const selectedApproved: string[] = [];
  const used = new Set<string>();
  for (const value of cohorts) {
    const cohort = exact(value, [
      'scope',
      'setRevisionRef',
      'processingFamilyRef',
      'cohortRef',
      'processingObservationRef',
      'rootBindings',
      'selection',
      'membershipCoverage',
      'versionMappingCoverage',
      'approvedBodyCaptureCoverage',
      'approvalReadiness',
      'currentness',
      'members',
      'approvedOpinionRefs',
      'qualifiedOpinionRefs',
      'revokedOpinionRefs',
      'gaps',
    ]);
    scope(cohort.scope, binding.tenantId);
    [
      'setRevisionRef',
      'processingFamilyRef',
      'processingObservationRef',
    ].forEach((key) => identifier(cohort[key]));
    nullableText(cohort.cohortRef);
    if (cohort.selection !== 'HOST_SELECTED') invalid();
    const matches = selections.filter(
      (selection) =>
        canonical(selection.scope) === canonical(cohort.scope) &&
        selection.setRevisionRef === cohort.setRevisionRef &&
        selection.processingFamilyRef === cohort.processingFamilyRef,
    );
    if (
      matches.length !== 1 ||
      used.has(canonical([cohort.scope, cohort.setRevisionRef]))
    )
      invalid();
    used.add(canonical([cohort.scope, cohort.setRevisionRef]));
    for (const key of [
      'membershipCoverage',
      'versionMappingCoverage',
      'approvedBodyCaptureCoverage',
    ])
      oneOf(cohort[key], ['COMPLETE', 'PARTIAL', 'UNKNOWN']);
    oneOf(cohort.approvalReadiness, ['ALL_APPROVED', 'PENDING', 'UNKNOWN']);
    oneOf(cohort.currentness, ['CURRENT', 'HISTORICAL', 'UNKNOWN']);
    const roots = array(cohort.rootBindings);
    for (const value of roots) {
      const root = exact(value, [
        'endpoint',
        'fileProcessingAssertionRefs',
        'applicabilityEvidenceRefs',
      ]);
      refs(root.fileProcessingAssertionRefs);
      refs(root.applicabilityEvidenceRefs);
      const endpoint = object(root.endpoint);
      if (endpoint.kind === 'NATIVE_RECORD_REVISION') {
        exact(endpoint, ['kind', 'sourceRevisionRef']);
        identifier(endpoint.sourceRevisionRef);
      } else if (endpoint.kind === 'DOCUMENT_VERSION') {
        exact(endpoint, ['kind', 'documentVersionId']);
        identifier(endpoint.documentVersionId);
      } else invalid();
    }
    if (
      (matches[0]!.sourceRevisionRefs as string[]).some(
        (ref) =>
          !roots.some(
            (root) => object(root.endpoint).sourceRevisionRef === ref,
          ),
      )
    )
      invalid();
    const members = array(cohort.members),
      memberRefs = new Set<string>();
    const statuses = new Map<string, string>();
    for (const value of members) {
      const member = exact(value, [
        'memberRef',
        'assessmentObservationRef',
        'membershipResolution',
        'opinionRefs',
        'contributorRefs',
        'responsibilityRefs',
        'ataScopes',
        'evidenceRefs',
        'opinionContributions',
        'status',
      ]);
      identifier(member.memberRef);
      nullableText(member.assessmentObservationRef);
      if (memberRefs.has(String(member.memberRef))) invalid();
      memberRefs.add(String(member.memberRef));
      oneOf(member.membershipResolution, [
        'CONFIRMED',
        'OBSERVED_ONLY',
        'UNRESOLVED',
      ]);
      oneOf(member.status, [
        'APPROVED',
        'QUALIFIED',
        'REVOKED',
        'METADATA_ONLY',
        'UNKNOWN',
      ]);
      refs(member.opinionRefs, opinionReference);
      for (const key of [
        'contributorRefs',
        'responsibilityRefs',
        'ataScopes',
        'evidenceRefs',
      ])
        refs(member[key]);
      for (const ref of member.opinionRefs as string[]) {
        const opinion = opinions.find((opinion) => opinion.evidenceRef === ref);
        if (
          !opinion ||
          canonical(opinion.scope) !== canonical(cohort.scope) ||
          object(opinion.assessment).sourceRevisionRef !==
            member.assessmentObservationRef ||
          statuses.has(ref)
        )
          invalid();
        statuses.set(ref, String(member.status));
      }
      for (const value of array(member.opinionContributions)) {
        const contribution = exact(value, [
          'opinionRef',
          'contributorRefs',
          'responsibilityRefs',
          'ataScopes',
          'assertionRefs',
        ]);
        if (
          !(member.opinionRefs as string[]).includes(
            String(contribution.opinionRef),
          )
        )
          invalid();
        for (const key of [
          'contributorRefs',
          'responsibilityRefs',
          'ataScopes',
          'assertionRefs',
        ])
          refs(contribution[key]);
      }
    }
    for (const [key, status] of [
      ['approvedOpinionRefs', 'APPROVED'],
      ['qualifiedOpinionRefs', 'QUALIFIED'],
      ['revokedOpinionRefs', 'REVOKED'],
    ]) {
      refs(cohort[key!], opinionReference);
      if (
        canonical([...(cohort[key!] as string[])].sort()) !==
        canonical(
          [...statuses]
            .filter(([, s]) => s === status)
            .map(([ref]) => ref)
            .sort(),
        )
      )
        invalid();
    }
    selectedApproved.push(...(cohort.approvedOpinionRefs as string[]));
    refs(cohort.gaps);
  }
  refs(projection.selectedSetApprovedRefs, opinionReference);
  refs(projection.historicalCohortApprovedRefs, opinionReference);
  if (
    (projection.historicalCohortApprovedRefs as unknown[]).length ||
    canonical([...(projection.selectedSetApprovedRefs as string[])].sort()) !==
      canonical([...new Set(selectedApproved)].sort())
  )
    invalid();
  if (
    opinions.some(
      (opinion) =>
        !cohorts.some((cohort) =>
          array(cohort.members).some((member) =>
            (member.opinionRefs as string[]).includes(
              String(opinion.evidenceRef),
            ),
          ),
        ),
    )
  )
    invalid();
  for (const value of array(projection.contradictions)) {
    const conflict = exact(value, ['assertionRef', 'opinionRef', 'againstRef']);
    identifier(conflict.assertionRef);
    opinionReference(conflict.opinionRef);
    if (opinionRefs.has(String(conflict.againstRef)))
      opinionReference(conflict.againstRef);
    else identifier(conflict.againstRef);
    if (!opinionRefs.has(String(conflict.opinionRef))) invalid();
  }
  return value as TdmsRuntimeTaskContext;
}
function invalid(): never {
  throw tdmsError('TDMS_RUNTIME_CONTEXT_INVALID', 409);
}
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  const o = object(value);
  strict(o, keys);
  if (keys.some((key) => !Object.hasOwn(o, key))) invalid();
  return o;
}
function array(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > 4096) invalid();
  return value as Record<string, unknown>[];
}
function refs(
  value: unknown,
  validate: (value: unknown) => unknown = identifier,
): void {
  if (
    !Array.isArray(value) ||
    value.length > 4096 ||
    new Set(value).size !== value.length
  )
    invalid();
  value.forEach(validate);
}
function opinionReference(value: unknown): void {
  if (!isTdmsApprovedOpinionReference(value)) invalid();
}
function scope(value: unknown, tenantId: unknown): void {
  const s = exact(value, [
    'tenantId',
    'sourceKey',
    'sourceInstanceId',
    'scopeId',
  ]);
  Object.values(s).forEach(identifier);
  if (s.tenantId !== tenantId) invalid();
}
function nullableText(value: unknown): void {
  if (value !== null && typeof value !== 'string') invalid();
}
function oneOf(value: unknown, allowed: string[]): void {
  if (!allowed.includes(String(value))) invalid();
}
function version(value: unknown): void {
  const v = exact(value, ['rawRevision', 'rawIteration', 'confirmation']);
  nullableText(v.rawRevision);
  nullableText(v.rawIteration);
  oneOf(v.confirmation, ['SOURCE_DECLARED', 'VERSION_UNCONFIRMED']);
}
