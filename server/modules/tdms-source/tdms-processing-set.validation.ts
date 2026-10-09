import {
  TDMS_PROCESSING_SET_SCHEMA,
  type TdmsProcessingRevisionSet,
} from '@shared/tdms-processing-set.interface';
import {
  canonical,
  identifier,
  object,
  strict,
} from './tdms-source.validation';
import { tdmsError } from './tdms-source.types';

export const TDMS_SET_MAX_MEMBERS = 1024;
export const TDMS_SET_MAX_BYTES = 512 * 1024;
function list(value: unknown, max = 1024): void {
  if (!Array.isArray(value) || value.length > max)
    throw tdmsError('TDMS_SET_LIST_INVALID');
  value.forEach(identifier);
  if (new Set(value).size !== value.length)
    throw tdmsError('TDMS_SET_DUPLICATE_REF');
}
function nullable(value: unknown): void {
  if (value !== null) identifier(value);
}
function enumValue(value: unknown, options: string[]): void {
  if (typeof value !== 'string' || !options.includes(value))
    throw tdmsError('TDMS_SET_ENUM_INVALID');
}
export function processingSet(value: unknown): TdmsProcessingRevisionSet {
  const o = object(value);
  strict(o, [
    'schemaVersion',
    'scope',
    'setRevisionRef',
    'processingFamilyRef',
    'cohortRef',
    'processingObservationRef',
    'familyIdentityEvidenceRefs',
    'cohortIdentityEvidenceRefs',
    'predecessorCohortRef',
    'successionEvidenceRefs',
    'supersedesSetRevisionRef',
    'rootBindings',
    'rosterEvidenceRefs',
    'sourceRosterRevision',
    'captureRefs',
    'observationWindow',
    'membershipCoverage',
    'versionMappingCoverage',
    'approvedBodyCaptureCoverage',
    'approvalReadiness',
    'sourceConsistency',
    'sourceTransactionRef',
    'currentness',
    'currentnessEvidenceRefs',
    'objectContextBindings',
    'members',
    'gaps',
  ]);
  if (o.schemaVersion !== TDMS_PROCESSING_SET_SCHEMA)
    throw tdmsError('TDMS_SET_CONTRACT_UNSUPPORTED');
  const s = object(o.scope);
  strict(s, ['tenantId', 'sourceKey', 'sourceInstanceId', 'scopeId']);
  for (const k of ['tenantId', 'sourceKey', 'sourceInstanceId', 'scopeId'])
    identifier(s[k]);
  for (const k of [
    'setRevisionRef',
    'processingFamilyRef',
    'processingObservationRef',
  ])
    identifier(o[k]);
  for (const k of [
    'cohortRef',
    'predecessorCohortRef',
    'supersedesSetRevisionRef',
    'sourceRosterRevision',
    'sourceTransactionRef',
  ])
    nullable(o[k]);
  for (const k of [
    'familyIdentityEvidenceRefs',
    'cohortIdentityEvidenceRefs',
    'successionEvidenceRefs',
    'rosterEvidenceRefs',
    'captureRefs',
    'currentnessEvidenceRefs',
    'gaps',
  ])
    list(o[k]);
  for (const k of [
    'membershipCoverage',
    'versionMappingCoverage',
    'approvedBodyCaptureCoverage',
  ]) {
    enumValue(o[k], ['COMPLETE', 'PARTIAL', 'UNKNOWN']);
  }
  enumValue(o.approvalReadiness, ['ALL_APPROVED', 'PENDING', 'UNKNOWN']);
  enumValue(o.sourceConsistency, ['ATOMIC', 'NON_ATOMIC', 'UNKNOWN']);
  enumValue(o.currentness, ['CURRENT', 'HISTORICAL', 'UNKNOWN']);
  const window = object(o.observationWindow);
  strict(window, ['before', 'after']);
  for (const k of ['before', 'after']) {
    if (
      typeof window[k] !== 'string' ||
      !Number.isFinite(Date.parse(window[k] as string))
    ) {
      throw tdmsError('TDMS_SET_WINDOW_INVALID');
    }
  }
  if (Date.parse(String(window.before)) > Date.parse(String(window.after)))
    throw tdmsError('TDMS_SET_WINDOW_INVALID');
  if (!Array.isArray(o.rootBindings) || o.rootBindings.length > 16)
    throw tdmsError('TDMS_SET_ROOT_INVALID');
  for (const r of o.rootBindings) {
    const root = object(r);
    strict(root, [
      'endpoint',
      'fileProcessingAssertionRefs',
      'applicabilityEvidenceRefs',
    ]);
    list(root.fileProcessingAssertionRefs);
    list(root.applicabilityEvidenceRefs);
    const e = object(root.endpoint);
    if (e.kind === 'NATIVE_RECORD_REVISION') {
      strict(e, ['kind', 'sourceRevisionRef']);
      identifier(e.sourceRevisionRef);
    } else if (e.kind === 'DOCUMENT_VERSION') {
      strict(e, ['kind', 'documentVersionId']);
      identifier(e.documentVersionId);
    } else throw tdmsError('TDMS_SET_ROOT_INVALID');
  }
  if (!Array.isArray(o.members) || o.members.length > TDMS_SET_MAX_MEMBERS)
    throw tdmsError('TDMS_SET_MEMBER_LIMIT');
  const refs = new Set<string>(),
    business = new Set<string>(),
    observations = new Set<string>();
  for (const v of o.members) {
    const m = object(v);
    strict(m, [
      'memberRef',
      'assessmentFamilyRef',
      'assessmentBusinessRevisionKey',
      'assessmentObservationRef',
      'membershipResolution',
      'processingAssessmentAssertionRefs',
      'cohortMembershipEvidenceRefs',
      'assessmentSuccessionEvidenceRefs',
      'expectedSourceRecordId',
      'gaps',
    ]);
    const ref = identifier(m.memberRef);
    if (refs.has(ref)) throw tdmsError('TDMS_SET_DUPLICATE_MEMBER');
    refs.add(ref);
    for (const k of [
      'assessmentFamilyRef',
      'assessmentBusinessRevisionKey',
      'assessmentObservationRef',
      'expectedSourceRecordId',
    ])
      nullable(m[k]);
    enumValue(m.membershipResolution, [
      'CONFIRMED',
      'OBSERVED_ONLY',
      'UNRESOLVED',
    ]);
    for (const k of [
      'processingAssessmentAssertionRefs',
      'cohortMembershipEvidenceRefs',
      'assessmentSuccessionEvidenceRefs',
      'gaps',
    ])
      list(m[k]);
    if (m.assessmentBusinessRevisionKey !== null) {
      if (m.assessmentFamilyRef === null)
        throw tdmsError('TDMS_SET_MEMBER_IDENTITY_UNBOUND');
      const key = canonical([
        m.assessmentFamilyRef,
        m.assessmentBusinessRevisionKey,
      ]);
      if (business.has(key)) throw tdmsError('TDMS_SET_DUPLICATE_MEMBER');
      business.add(key);
    }
    if (m.assessmentObservationRef !== null) {
      const obs = identifier(m.assessmentObservationRef);
      if (observations.has(obs)) throw tdmsError('TDMS_SET_DUPLICATE_MEMBER');
      observations.add(obs);
    } else if (
      m.expectedSourceRecordId === null ||
      !(m.gaps as string[]).length
    ) {
      throw tdmsError('TDMS_SET_EXPECTED_MEMBER_GAP_REQUIRED');
    }
    if (
      m.membershipResolution === 'CONFIRMED' &&
      (o.cohortRef === null ||
        !(m.cohortMembershipEvidenceRefs as string[]).length)
    ) {
      throw tdmsError('TDMS_SET_COHORT_PROOF_REQUIRED');
    }
  }
  const set = o as unknown as TdmsProcessingRevisionSet;
  if (o.objectContextBindings !== undefined) {
    if (
      !Array.isArray(o.objectContextBindings) ||
      o.objectContextBindings.length > TDMS_SET_MAX_MEMBERS
    ) {
      throw tdmsError('TDMS_SET_OWNER_LIMIT');
    }
    const owners = new Set<string>();
    for (const v of o.objectContextBindings) {
      const c = object(v);
      strict(c, [
        'ownerObservationRef',
        'attachmentRelationAssertionRefs',
        'sourceContainerEvidenceRefs',
        'businessClassificationEvidenceRefs',
        'productEligibility',
        'gaps',
      ]);
      const owner = identifier(c.ownerObservationRef);
      if (owners.has(owner)) throw tdmsError('TDMS_SET_DUPLICATE_OWNER');
      owners.add(owner);
      for (const k of [
        'attachmentRelationAssertionRefs',
        'sourceContainerEvidenceRefs',
        'businessClassificationEvidenceRefs',
        'gaps',
      ])
        list(c[k]);
      if (c.productEligibility !== 'UNKNOWN')
        throw tdmsError('TDMS_SET_ELIGIBILITY_UNCONFIGURED');
    }
  }
  if (
    set.cohortRef === null &&
    (set.cohortIdentityEvidenceRefs.length || set.predecessorCohortRef !== null)
  ) {
    throw tdmsError('TDMS_SET_COHORT_UNBOUND');
  }
  if (
    set.membershipCoverage === 'COMPLETE' &&
    (!set.rosterEvidenceRefs.length ||
      !set.cohortRef ||
      !set.familyIdentityEvidenceRefs.length ||
      !set.cohortIdentityEvidenceRefs.length ||
      set.members.some(
        (m) =>
          !m.assessmentObservationRef || m.membershipResolution !== 'CONFIRMED',
      ))
  ) {
    throw tdmsError('TDMS_SET_MEMBERSHIP_INCOMPLETE');
  }
  if (
    set.sourceConsistency === 'ATOMIC' &&
    (!set.sourceTransactionRef || !set.sourceRosterRevision)
  ) {
    throw tdmsError('TDMS_SET_ATOMIC_PROOF_REQUIRED');
  }
  if (set.currentness !== 'UNKNOWN' && !set.currentnessEvidenceRefs.length)
    throw tdmsError('TDMS_SET_CURRENTNESS_PROOF_REQUIRED');
  if (Buffer.byteLength(canonical(set), 'utf8') > TDMS_SET_MAX_BYTES)
    throw tdmsError('TDMS_SET_SIZE_LIMIT');
  // Defensive detached copy; a concurrent caller cannot mutate validated pins.
  return JSON.parse(JSON.stringify(set)) as TdmsProcessingRevisionSet;
}
