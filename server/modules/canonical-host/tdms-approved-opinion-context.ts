import type {
  TdmsCoverage,
  TdmsPerson,
  TdmsRawCode,
  TdmsRecordRevision,
  TdmsRelationAssertion,
  TdmsSourceVersion,
} from '@shared/tdms-source.interface';
import type {
  TdmsProcessingRevisionSet,
  TdmsProcessingSetMember,
} from '@shared/tdms-processing-set.interface';
import type { TdmsSourceScope } from '../tdms-source/tdms-source.types';
import { tdmsError } from '../tdms-source/tdms-source.types';
import { canonical, identifier } from '../tdms-source/tdms-source.validation';

/** Inactive domain seam, NOT a consumer/runtime version or an authorization boundary.
 * A Host adapter must supply only currently authorized facts and exact immutable
 * locators, after existing collection validation. Never pass HTTP claims or bodies.
 * This function does no IO, does not establish access, and does not record a READ.
 */
type NativeIdentity = Pick<
  TdmsRecordRevision,
  'recordRef' | 'sourceRevisionRef' | 'sourceRecordId' | 'sourceVersion'
> & { businessVersion: TdmsSourceVersion | null };
type Scope = Readonly<TdmsSourceScope>;
export interface TdmsOpinionSourceFact {
  scope: Scope;
  recordRef: string;
  versions: ReadonlyArray<NativeIdentity>;
  latestness: ReadonlyArray<{
    assertionRef: string;
    basis:
      | 'SOURCE_VERSION_DIRECTORY'
      | 'SOURCE_EXPLICIT_REVISION_CHAIN'
      | 'VERIFIED_HOST_MAPPING';
    recordRef: string;
    sourceRevisionRef: string;
    coverage: TdmsCoverage;
  }>;
  /** Each roster is for this exact source version, not the whole scope catalogue. */
  assessmentCoverage: ReadonlyArray<{
    sourceRevisionRef: string;
    assertionRef: string;
    assessmentRevisionRefs: readonly string[];
    coverage: TdmsCoverage;
  }>;
}
interface ApprovalSubject {
  sourceRecordId: string;
  sourceVersion: TdmsSourceVersion;
  businessVersion?: TdmsSourceVersion;
}
interface ApprovalObservation extends ApprovalSubject {
  recordKind: 'ENGINEER_ASSESSMENT';
  objectBinding: 'EXACT_CURRENT_DETAIL';
  state: TdmsRawCode;
  sourceModifiedAt: string | null;
  sourceModifiedRaw?: string;
  observedAt: string;
}
export interface TdmsOpinionAssessmentFact extends NativeIdentity {
  scope: Scope;
  recordKind: 'ENGINEER_ASSESSMENT';
  state: TdmsRawCode | null;
  captureRef: string;
  observedAt: string;
  sourceModifiedAt: string | null;
  sourceModifiedRaw?: string;
  coverage: TdmsCoverage;
  /** Normalized metadata from this revision's validated opinionCollection. */
  approval: {
    mode: 'ESTIMATED_OPINION' | 'METADATA_ONLY';
    reason: string;
    approvalSubject: ApprovalSubject | null;
    before: ApprovalObservation | null;
    after: ApprovalObservation | null;
  } | null;
  /** A current source validity fact, separate from immutable capture approval.
   * assertionRef can identify the exact retained native state observation. */
  validity: {
    status: 'ACTIVE' | 'REVOKED' | 'UNKNOWN';
    assertionRef: string | null;
  };
  /** No inferred discipline taxonomy, grouping by author/title, or timestamp order. */
  lane: {
    seriesRef: string;
    professionalScope: string | null;
    assertionRef: string;
  } | null;
  /** Host-verified immutable locators only; never text/conditions/actions. Read
   * only AFTER the assessment's own before/after approval gate has passed. */
  opinionFields: ReadonlyArray<{
    index: number;
    sourceSelector: string;
    author: TdmsPerson | null;
  }>;
}
type MappingRelation = Pick<
  TdmsRelationAssertion,
  | 'assertionRef'
  | 'controlledKind'
  | 'from'
  | 'to'
  | 'authority'
  | 'coverage'
  | 'scope'
> & { nativeScope: Scope };
export interface TdmsOpinionMappingFact {
  scope: Scope;
  sourceRevisionRef: string;
  assessmentRevisionRef: string;
  /** The finite path.scope shape is a future Host-normalized applicability fact:
   * { kind: 'EXACT_SOURCE_VERSION_ASSESSMENT', sourceRevisionRef, assessmentRevisionRef }.
   * Populate it ONLY from source-explicit scope proof, never just graph adjacency.
   * Existing empty/unversioned source scopes must remain mapping gaps.
   * Supported exact path: FILE_PROCESSING then PROCESSING_ASSESSMENT.
   * A bare REFERENCES relation or an unversioned link is never applicability. */
  path: ReadonlyArray<MappingRelation>;
}
export interface TdmsOpinionSuccessorFact {
  scope: Scope;
  olderAssessmentRevisionRef: string;
  newerAssessmentRevisionRef: string;
  assertionRef: string;
  authority: 'SOURCE_EXPLICIT';
  coverage: TdmsCoverage;
}
export interface TdmsOpinionLocator {
  scope: Scope;
  sourceRevisionRef: string;
  opinionIndex: number;
}
export interface TdmsOpinionContradictionFact {
  scope: Scope;
  assertionRef: string;
  opinion: TdmsOpinionLocator;
  against:
    | { kind: 'OPINION'; opinion: TdmsOpinionLocator }
    | { kind: 'SOURCE_EVIDENCE'; evidenceRef: string };
}
export interface TdmsApprovedOpinionContextInput {
  sources: ReadonlyArray<TdmsOpinionSourceFact>;
  assessments: ReadonlyArray<TdmsOpinionAssessmentFact>;
  mappings: ReadonlyArray<TdmsOpinionMappingFact>;
  successors: ReadonlyArray<TdmsOpinionSuccessorFact>;
  /** Already authorized, explicit conflict facts. No text classification here. */
  contradictions: ReadonlyArray<TdmsOpinionContradictionFact>;
}
export type TdmsOpinionGapCode =
  | 'SOURCE_CURRENTNESS_UNKNOWN'
  | 'SOURCE_CURRENTNESS_CONFLICT'
  | 'SOURCE_VERSION_UNCONFIRMED'
  | 'MAPPING_UNCONFIRMED'
  | 'APPROVAL_UNCONFIRMED'
  | 'ASSESSMENT_NOT_APPROVED'
  | 'APPROVAL_REVOKED'
  | 'APPROVAL_VALIDITY_UNKNOWN'
  | 'TECHNICAL_VERSION_UNEXPOSED'
  | 'OPINION_FIELDS_UNAVAILABLE'
  | 'COVERAGE_INCOMPLETE'
  | 'NO_APPROVED_OPINION_FOR_LATEST_SOURCE_VERSION'
  | 'ASSESSMENT_ORDER_UNCONFIRMED'
  | 'ASSESSMENT_SUCCESSION_CONFLICT'
  | 'NEWER_ASSESSMENT_NOT_APPROVED'
  | 'CONTRADICTION_UNRESOLVED';
interface ContextGap {
  code: TdmsOpinionGapCode;
  sourceRevisionRef: string | null;
  assessmentRevisionRefs: string[];
}
export interface TdmsApprovedOpinionReference {
  evidenceRef: string;
  scope: TdmsSourceScope;
  assessment: NativeIdentity;
  fieldPath: string;
  sourceSelector: string;
  author: TdmsPerson | null;
  lane: TdmsOpinionAssessmentFact['lane'];
  approval: {
    captureRef: string;
    evidencePath: 'rawFields.opinionCollection';
    mode: 'EXACT_VERSION' | 'OBJECT_OBSERVATION';
  };
  sourceVerification: 'DECLARED_ONLY';
  readPerformed: false;
  engineeringAdoption: 'NOT_CREATED';
  executionVerified: false;
}
export interface TdmsApprovedOpinionSourceContext {
  scope: TdmsSourceScope;
  recordRef: string;
  latestSourceRevisionRef: string | null;
  latestnessAssertionRefs: string[];
  currentVersionApprovedRefs: string[];
  historicalSourceApprovedRefs: string[];
  supersededAssessmentRefs: string[];
  revokedOpinionRefs: string[];
  qualifiedObservationRefs: string[];
  /** Authorized assessment revision metadata refs, never unapproved body refs. */
  unresolvedRefs: string[];
  mappings: Array<{
    sourceRevisionRef: string;
    assessmentRevisionRef: string;
    assertionRefs: string[];
    path: MappingRelation[];
  }>;
  coverage: Array<{
    sourceRevisionRef: string;
    assertionRefs: string[];
    status: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
  }>;
  validityNotices: Array<{
    assessmentRevisionRef: string;
    status: 'ACTIVE' | 'REVOKED' | 'UNKNOWN';
    assertionRef: string | null;
  }>;
  successionAssertionRefs: string[];
  competingApprovalSets: Array<{
    sourceRevisionRef: string;
    seriesRef: string | null;
    professionalScope: string | null;
    opinionRefs: string[];
  }>;
  gaps: ContextGap[];
}
export interface TdmsApprovedOpinionContext {
  opinions: TdmsApprovedOpinionReference[];
  sources: TdmsApprovedOpinionSourceContext[];
  contradictions: Array<{
    assertionRef: string;
    opinionRef: string;
    againstRef: string;
  }>;
  interpretation: 'APPROVED_PROFESSIONAL_JUDGMENT_NOT_INFALLIBLE';
  readPerformed: false;
}

/** New source-v2 facts only. The old single-author field remains unchanged.
 * These refs may be emitted only when a separate collector/Host validator has
 * confirmed source field provenance; absence means unknown, not one person.
 */
export interface TdmsOpinionContributionFact {
  scope: Scope;
  assessmentObservationRef: string;
  opinionIndex: number;
  contributorRefs: readonly string[];
  responsibilityRefs: readonly string[];
  ataScopes: readonly string[];
  assertionRefs: readonly string[];
}
export interface TdmsProcessingCohortContextInput {
  /** Authorized, immutable set facts. A source observation UUID is only a
   * capture pin, never proof of processing business version or membership. */
  sets: ReadonlyArray<TdmsProcessingRevisionSet>;
  /** Host-selected immutable sets; never calculated from capture time. */
  selectedSetRevisionRefs: readonly string[];
  sources: ReadonlyArray<TdmsOpinionSourceFact>;
  assessments: ReadonlyArray<TdmsOpinionAssessmentFact>;
  mappings: ReadonlyArray<TdmsOpinionMappingFact>;
  contributions: ReadonlyArray<TdmsOpinionContributionFact>;
  /** Already authorized, explicit conflicts; no body classification or winner selection. */
  contradictions?: ReadonlyArray<TdmsOpinionContradictionFact>;
}
export interface TdmsProcessingCohortContext {
  opinions: TdmsApprovedOpinionReference[];
  contradictions: TdmsApprovedOpinionContext['contradictions'];
  selectedSetApprovedRefs: string[];
  historicalCohortApprovedRefs: string[];
  cohorts: Array<{
    scope: TdmsSourceScope;
    setRevisionRef: string;
    processingFamilyRef: string;
    cohortRef: string | null;
    processingObservationRef: string;
    rootBindings: TdmsProcessingRevisionSet['rootBindings'];
    selection: 'HOST_SELECTED' | 'HISTORICAL';
    membershipCoverage: TdmsProcessingRevisionSet['membershipCoverage'];
    versionMappingCoverage: TdmsProcessingRevisionSet['versionMappingCoverage'];
    approvedBodyCaptureCoverage: TdmsProcessingRevisionSet['approvedBodyCaptureCoverage'];
    approvalReadiness: TdmsProcessingRevisionSet['approvalReadiness'];
    currentness: TdmsProcessingRevisionSet['currentness'];
    members: Array<{
      memberRef: string;
      assessmentObservationRef: string | null;
      membershipResolution: TdmsProcessingSetMember['membershipResolution'];
      opinionRefs: string[];
      contributorRefs: string[];
      responsibilityRefs: string[];
      ataScopes: string[];
      evidenceRefs: string[];
      opinionContributions: Array<{
        opinionRef: string;
        contributorRefs: string[];
        responsibilityRefs: string[];
        ataScopes: string[];
        assertionRefs: string[];
      }>;
      status:
        | 'APPROVED'
        | 'METADATA_ONLY'
        | 'QUALIFIED'
        | 'REVOKED'
        | 'UNKNOWN';
    }>;
    approvedOpinionRefs: string[];
    qualifiedOpinionRefs: string[];
    revokedOpinionRefs: string[];
    gaps: string[];
  }>;
  readPerformed: false;
  interpretation: 'APPROVED_PROFESSIONAL_JUDGMENT_NOT_INFALLIBLE';
}

function scopeKey(scope: Scope): string {
  return [
    scope.tenantId,
    scope.sourceKey,
    scope.sourceInstanceId,
    scope.scopeId,
  ]
    .map((v) => encodeURIComponent(identifier(v)))
    .join(':');
}
function scoped(scope: Scope, ref: string): string {
  return `${scopeKey(scope)}:${encodeURIComponent(identifier(ref))}`;
}
/** Reuses Host's percent-escaped reference component convention; no new hash or
 * reader/task/session/receipt-dependent identity. Index is immutable per revision. */
export function tdmsApprovedOpinionRef(locator: TdmsOpinionLocator): string {
  if (!Number.isSafeInteger(locator.opinionIndex) || locator.opinionIndex < 0)
    throw tdmsError('TDMS_OPINION_LOCATOR_INVALID');
  return `TDMS_APPROVED_OPINION:${scoped(locator.scope, locator.sourceRevisionRef)}:${locator.opinionIndex}`;
}
function exactVersion(version: TdmsSourceVersion): boolean {
  return (
    version.confirmation === 'SOURCE_DECLARED' &&
    !!version.rawRevision?.trim() &&
    !!version.rawIteration?.trim()
  );
}
function complete(coverage: TdmsCoverage): boolean {
  return (
    coverage.status === 'COMPLETE' &&
    coverage.readback === 'CONSISTENT' &&
    coverage.gaps.length === 0
  );
}
function estimated(state: TdmsRawCode | null): boolean {
  return (
    state?.rawName === 'Estimated' &&
    (state.rawCode === null || state.rawCode === 'Estimated')
  );
}
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}
function identity(value: NativeIdentity): NativeIdentity {
  return {
    recordRef: identifier(value.recordRef),
    sourceRevisionRef: identifier(value.sourceRevisionRef),
    sourceRecordId: identifier(value.sourceRecordId),
    sourceVersion: versionCopy(value.sourceVersion),
    businessVersion: value.businessVersion
      ? versionCopy(value.businessVersion)
      : null,
  };
}
function versionCopy(version: TdmsSourceVersion): TdmsSourceVersion {
  return {
    rawRevision: version.rawRevision,
    rawIteration: version.rawIteration,
    confirmation: version.confirmation,
  };
}
function scopeCopy(scope: Scope): TdmsSourceScope {
  scopeKey(scope);
  return {
    tenantId: scope.tenantId,
    sourceKey: scope.sourceKey,
    sourceInstanceId: scope.sourceInstanceId,
    scopeId: scope.scopeId,
  };
}
function approvalMode(
  a: TdmsOpinionAssessmentFact,
): 'EXACT_VERSION' | 'OBJECT_OBSERVATION' | null {
  const p = a.approval;
  if (
    a.recordKind !== 'ENGINEER_ASSESSMENT' ||
    !p ||
    p.mode !== 'ESTIMATED_OPINION' ||
    !estimated(a.state) ||
    !p.approvalSubject ||
    !p.before ||
    !p.after
  )
    return null;
  const observed = p.reason === 'APPROVED_CURRENT_OBJECT_OBSERVATION';
  if (!observed && p.reason !== 'APPROVED_CURRENT_EXACT_VERSION') return null;
  if (
    observed
      ? a.sourceVersion.confirmation !== 'VERSION_UNCONFIRMED' ||
        a.sourceVersion.rawRevision !== null ||
        a.sourceVersion.rawIteration !== null ||
        a.businessVersion?.confirmation !== 'SOURCE_DECLARED' ||
        !a.businessVersion.rawRevision?.trim() ||
        a.businessVersion.rawIteration !== null ||
        a.sourceModifiedAt !== null ||
        !a.sourceModifiedRaw ||
        a.coverage.status !== 'PARTIAL' ||
        a.coverage.readback !== 'NON_ATOMIC' ||
        !a.coverage.gaps.includes('TECHNICAL_VERSION_UNEXPOSED')
      : !exactVersion(a.sourceVersion)
  )
    return null;
  const subjectMatches = (s: ApprovalSubject) =>
    s.sourceRecordId === a.sourceRecordId &&
    canonical(s.sourceVersion) === canonical(a.sourceVersion) &&
    (observed
      ? canonical(s.businessVersion) === canonical(a.businessVersion)
      : s.businessVersion === undefined);
  if (!subjectMatches(p.approvalSubject)) return null;
  for (const o of [p.before, p.after]) {
    if (
      !subjectMatches(o) ||
      o.recordKind !== 'ENGINEER_ASSESSMENT' ||
      o.objectBinding !== 'EXACT_CURRENT_DETAIL' ||
      !estimated(o.state) ||
      canonical(o.state) !== canonical(a.state) ||
      o.sourceModifiedAt !== a.sourceModifiedAt ||
      (observed && o.sourceModifiedRaw !== a.sourceModifiedRaw) ||
      !Number.isFinite(Date.parse(o.observedAt))
    )
      return null;
  }
  if (
    !Number.isFinite(Date.parse(a.observedAt)) ||
    a.observedAt !== p.after.observedAt ||
    Date.parse(p.before.observedAt) > Date.parse(p.after.observedAt)
  )
    return null;
  return observed ? 'OBJECT_OBSERVATION' : 'EXACT_VERSION';
}
function exactMapping(m: TdmsOpinionMappingFact): boolean {
  const [first, second] = m.path;
  if (
    m.path.length !== 2 ||
    !first ||
    !second ||
    first.controlledKind !== 'FILE_PROCESSING' ||
    second.controlledKind !== 'PROCESSING_ASSESSMENT'
  )
    return false;
  for (const r of m.path) {
    if (
      scopeKey(r.nativeScope) !== scopeKey(m.scope) ||
      !r.scope ||
      Object.keys(r.scope).sort().join(',') !==
        'assessmentRevisionRef,kind,sourceRevisionRef' ||
      r.scope.kind !== 'EXACT_SOURCE_VERSION_ASSESSMENT' ||
      r.scope.sourceRevisionRef !== m.sourceRevisionRef ||
      r.scope.assessmentRevisionRef !== m.assessmentRevisionRef
    )
      return false;
    if (
      !r.assertionRef ||
      r.authority !== 'SOURCE_EXPLICIT' ||
      !complete(r.coverage) ||
      r.from.kind !== 'NATIVE_RECORD_REVISION' ||
      r.to.kind !== 'NATIVE_RECORD_REVISION'
    )
      return false;
    identifier(r.assertionRef);
  }
  return (
    first.from.kind === 'NATIVE_RECORD_REVISION' &&
    first.to.kind === 'NATIVE_RECORD_REVISION' &&
    second.from.kind === 'NATIVE_RECORD_REVISION' &&
    second.to.kind === 'NATIVE_RECORD_REVISION' &&
    first.from.sourceRevisionRef === m.sourceRevisionRef &&
    first.to.sourceRevisionRef === second.from.sourceRevisionRef &&
    second.to.sourceRevisionRef === m.assessmentRevisionRef
  );
}

export function projectTdmsApprovedOpinionContext(
  input: TdmsApprovedOpinionContextInput,
): TdmsApprovedOpinionContext {
  const assessments = new Map<string, TdmsOpinionAssessmentFact>();
  const modes = new Map<string, ReturnType<typeof approvalMode>>();
  const opinionRefs = new Map<string, string[]>();
  const opinions = new Map<string, TdmsApprovedOpinionReference>();
  const sourceKeys = new Set<string>();
  const sourceRevisionOwners = new Map<string, string>();
  // Fail closed on conflicting duplicate identities, rather than order-dependent overwrite.
  for (const source of input.sources) {
    const key = scoped(source.scope, source.recordRef);
    if (sourceKeys.has(key)) throw tdmsError('TDMS_OPINION_DUPLICATE_SOURCE');
    sourceKeys.add(key);
    const nativeIds = unique(source.versions.map((v) => v.sourceRecordId));
    if (nativeIds.length > 1)
      throw tdmsError('TDMS_OPINION_SOURCE_IDENTITY_MISMATCH');
    for (const v of source.versions) {
      const revisionKey = scoped(source.scope, v.sourceRevisionRef);
      const value = canonical(identity(v));
      const owner = sourceRevisionOwners.get(revisionKey);
      if (owner && owner !== value)
        throw tdmsError('TDMS_OPINION_SOURCE_VERSION_CONFLICT');
      sourceRevisionOwners.set(revisionKey, value);
    }
  }
  const relevantScopes = new Set(input.sources.map((s) => scopeKey(s.scope)));
  for (const a of input.assessments) {
    if (!relevantScopes.has(scopeKey(a.scope))) continue;
    const key = scoped(a.scope, a.sourceRevisionRef);
    if (assessments.has(key))
      throw tdmsError('TDMS_OPINION_DUPLICATE_ASSESSMENT');
    assessments.set(key, a);
    modes.set(key, approvalMode(a));
  }
  const result: TdmsApprovedOpinionContext = {
    opinions: [],
    sources: [],
    contradictions: [],
    interpretation: 'APPROVED_PROFESSIONAL_JUDGMENT_NOT_INFALLIBLE',
    readPerformed: false,
  };
  // Build locators lazily only for assessments relevant to an explicit mapping
  // candidate and after approval. No opinionFields access on metadata-only facts.
  function refs(a: TdmsOpinionAssessmentFact): string[] {
    const key = scoped(a.scope, a.sourceRevisionRef);
    const cached = opinionRefs.get(key);
    if (cached) return cached;
    const mode = modes.get(key);
    if (!mode) return [];
    const output: string[] = [];
    for (const field of a.opinionFields) {
      const evidenceRef = tdmsApprovedOpinionRef({
        scope: a.scope,
        sourceRevisionRef: a.sourceRevisionRef,
        opinionIndex: field.index,
      });
      const descriptor: TdmsApprovedOpinionReference = {
        evidenceRef,
        scope: scopeCopy(a.scope),
        assessment: identity(a),
        fieldPath: `content.opinions[${field.index}]`,
        sourceSelector: identifier(field.sourceSelector),
        author: field.author
          ? {
              sourcePersonId: field.author.sourcePersonId,
              name: field.author.name,
              role: field.author.role,
            }
          : null,
        lane: a.lane
          ? {
              seriesRef: identifier(a.lane.seriesRef),
              professionalScope: a.lane.professionalScope,
              assertionRef: identifier(a.lane.assertionRef),
            }
          : null,
        approval: {
          captureRef: identifier(a.captureRef),
          evidencePath: 'rawFields.opinionCollection',
          mode,
        },
        sourceVerification: 'DECLARED_ONLY',
        readPerformed: false,
        engineeringAdoption: 'NOT_CREATED',
        executionVerified: false,
      };
      const previous = opinions.get(evidenceRef);
      if (previous && canonical(previous) !== canonical(descriptor))
        throw tdmsError('TDMS_OPINION_LOCATOR_CONFLICT');
      opinions.set(evidenceRef, descriptor);
      output.push(evidenceRef);
    }
    const sorted = unique(output);
    opinionRefs.set(key, sorted);
    return sorted;
  }
  for (const source of input.sources) {
    const scope = scopeKey(source.scope);
    const versions = new Map<string, NativeIdentity>();
    for (const version of source.versions) {
      if (version.recordRef !== source.recordRef)
        throw tdmsError('TDMS_OPINION_SOURCE_IDENTITY_MISMATCH');
      const known = versions.get(version.sourceRevisionRef);
      if (known && canonical(identity(known)) !== canonical(identity(version)))
        throw tdmsError('TDMS_OPINION_SOURCE_VERSION_CONFLICT');
      versions.set(version.sourceRevisionRef, identity(version));
    }
    const context: TdmsApprovedOpinionSourceContext = {
      scope: scopeCopy(source.scope),
      recordRef: identifier(source.recordRef),
      latestSourceRevisionRef: null,
      latestnessAssertionRefs: [],
      currentVersionApprovedRefs: [],
      historicalSourceApprovedRefs: [],
      supersededAssessmentRefs: [],
      revokedOpinionRefs: [],
      qualifiedObservationRefs: [],
      unresolvedRefs: [],
      mappings: [],
      coverage: [],
      validityNotices: [],
      successionAssertionRefs: [],
      competingApprovalSets: [],
      gaps: [],
    };
    const gap = (
      code: TdmsOpinionGapCode,
      sourceRevisionRef: string | null,
      assessmentRevisionRefs: string[] = [],
    ) => {
      context.gaps.push({
        code,
        sourceRevisionRef,
        assessmentRevisionRefs: unique(assessmentRevisionRefs),
      });
    };
    const latest = source.latestness.filter(
      (fact) =>
        fact.recordRef === source.recordRef &&
        fact.assertionRef &&
        [
          'SOURCE_VERSION_DIRECTORY',
          'SOURCE_EXPLICIT_REVISION_CHAIN',
          'VERIFIED_HOST_MAPPING',
        ].includes(fact.basis) &&
        complete(fact.coverage) &&
        versions.has(fact.sourceRevisionRef) &&
        exactVersion(versions.get(fact.sourceRevisionRef)!.sourceVersion),
    );
    const latestVersions = unique(latest.map((f) => f.sourceRevisionRef));
    if (
      latestVersions.length === 1 &&
      latest.length === source.latestness.length
    ) {
      context.latestSourceRevisionRef = latestVersions[0]!;
      context.latestnessAssertionRefs = unique(
        latest.map((f) => identifier(f.assertionRef)),
      );
    } else
      gap(
        latestVersions.length > 1
          ? 'SOURCE_CURRENTNESS_CONFLICT'
          : 'SOURCE_CURRENTNESS_UNKNOWN',
        null,
      );
    const rosterIds = unique(
      source.assessmentCoverage.flatMap((c) => [...c.assessmentRevisionRefs]),
    );
    const candidateMappings = input.mappings.filter(
      (m) => scopeKey(m.scope) === scope && versions.has(m.sourceRevisionRef),
    );
    const relevant = new Map<string, TdmsOpinionAssessmentFact>();
    for (const id of rosterIds) {
      const a = assessments.get(scoped(source.scope, id));
      if (a) relevant.set(id, a);
    }
    for (const m of candidateMappings) {
      const a = assessments.get(scoped(source.scope, m.assessmentRevisionRef));
      if (a) relevant.set(a.sourceRevisionRef, a);
      if (
        !a ||
        !exactMapping(m) ||
        !exactVersion(versions.get(m.sourceRevisionRef)!.sourceVersion)
      ) {
        gap(
          'MAPPING_UNCONFIRMED',
          m.sourceRevisionRef,
          a ? [a.sourceRevisionRef] : [],
        );
        if (a) context.unresolvedRefs.push(a.sourceRevisionRef);
      } else
        context.mappings.push({
          sourceRevisionRef: m.sourceRevisionRef,
          assessmentRevisionRef: m.assessmentRevisionRef,
          assertionRefs: m.path.map((r) => identifier(r.assertionRef)),
          path: m.path.map((r) => ({
            assertionRef: r.assertionRef,
            controlledKind: r.controlledKind,
            from: {
              kind: 'NATIVE_RECORD_REVISION',
              sourceRevisionRef:
                r.from.kind === 'NATIVE_RECORD_REVISION'
                  ? r.from.sourceRevisionRef
                  : '',
            },
            to: {
              kind: 'NATIVE_RECORD_REVISION',
              sourceRevisionRef:
                r.to.kind === 'NATIVE_RECORD_REVISION'
                  ? r.to.sourceRevisionRef
                  : '',
            },
            authority: r.authority,
            nativeScope: scopeCopy(r.nativeScope),
            coverage: {
              status: r.coverage.status,
              readback: r.coverage.readback,
              gaps: [],
            },
            scope: {
              kind: r.scope.kind,
              sourceRevisionRef: r.scope.sourceRevisionRef,
              assessmentRevisionRef: r.scope.assessmentRevisionRef,
            },
          })),
        });
    }
    context.mappings = [
      ...new Map(context.mappings.map((m) => [canonical(m), m])).values(),
    ].sort((a, b) => compare(canonical(a), canonical(b)));
    for (const version of versions.values()) {
      const versionRef = version.sourceRevisionRef;
      const coverageFacts = source.assessmentCoverage.filter(
        (c) => c.sourceRevisionRef === versionRef,
      );
      const rosterSets = unique(
        coverageFacts.map((c) =>
          canonical(unique([...c.assessmentRevisionRefs])),
        ),
      );
      const expectedIds = unique(
        coverageFacts.flatMap((c) => [...c.assessmentRevisionRefs]),
      );
      const mappedIds = unique(
        context.mappings
          .filter((m) => m.sourceRevisionRef === versionRef)
          .map((m) => m.assessmentRevisionRef),
      );
      const rosterMatches = canonical(expectedIds) === canonical(mappedIds);
      const coverageComplete =
        coverageFacts.length > 0 &&
        rosterSets.length === 1 &&
        rosterMatches &&
        coverageFacts.every((c) => !!c.assertionRef && complete(c.coverage));
      for (const id of expectedIds.filter((id) => !mappedIds.includes(id))) {
        const a = relevant.get(id);
        gap('MAPPING_UNCONFIRMED', versionRef, a ? [a.sourceRevisionRef] : []);
        if (a) context.unresolvedRefs.push(a.sourceRevisionRef);
      }
      context.coverage.push({
        sourceRevisionRef: versionRef,
        assertionRefs: unique(
          coverageFacts.map((c) => c.assertionRef).filter(Boolean),
        ),
        status: coverageComplete
          ? 'COMPLETE'
          : coverageFacts.some((c) => c.coverage.status !== 'UNKNOWN')
            ? 'PARTIAL'
            : 'UNKNOWN',
      });
      if (!coverageComplete) gap('COVERAGE_INCOMPLETE', versionRef);
      if (!exactVersion(version.sourceVersion))
        gap('SOURCE_VERSION_UNCONFIRMED', versionRef);
      const mapped = mappedIds.map((id) => relevant.get(id)!);
      const active: TdmsOpinionAssessmentFact[] = [];
      let uncertain = context.gaps.some(
        (g) =>
          g.sourceRevisionRef === versionRef &&
          g.code === 'MAPPING_UNCONFIRMED',
      );
      for (const a of mapped) {
        context.validityNotices.push({
          assessmentRevisionRef: a.sourceRevisionRef,
          status: a.validity.status,
          assertionRef: a.validity.assertionRef,
        });
        const mode = modes.get(scoped(a.scope, a.sourceRevisionRef));
        if (!mode) {
          const knownUnapproved =
            a.approval?.mode === 'METADATA_ONLY' &&
            a.approval.reason === 'STATE_NOT_ESTIMATED' &&
            a.state !== null &&
            !estimated(a.state);
          gap(
            knownUnapproved
              ? 'ASSESSMENT_NOT_APPROVED'
              : 'APPROVAL_UNCONFIRMED',
            versionRef,
            [a.sourceRevisionRef],
          );
          context.unresolvedRefs.push(a.sourceRevisionRef);
          uncertain ||= !knownUnapproved;
          continue;
        }
        const approvedRefs = refs(a);
        if (!approvedRefs.length) {
          gap('OPINION_FIELDS_UNAVAILABLE', versionRef, [a.sourceRevisionRef]);
          uncertain = true;
        }
        if (a.validity.status === 'REVOKED' && a.validity.assertionRef) {
          context.revokedOpinionRefs.push(...approvedRefs);
          gap('APPROVAL_REVOKED', versionRef, [a.sourceRevisionRef]);
          continue;
        }
        if (a.validity.status !== 'ACTIVE' || !a.validity.assertionRef) {
          context.unresolvedRefs.push(a.sourceRevisionRef);
          gap('APPROVAL_VALIDITY_UNKNOWN', versionRef, [a.sourceRevisionRef]);
          uncertain = true;
          continue;
        }
        if (mode === 'OBJECT_OBSERVATION') {
          context.qualifiedObservationRefs.push(...approvedRefs);
          gap('TECHNICAL_VERSION_UNEXPOSED', versionRef, [a.sourceRevisionRef]);
          uncertain = true;
          continue;
        }
        active.push(a);
      }
      const edges = new Map<string, string[]>();
      for (const s of input.successors.filter(
        (f) =>
          scopeKey(f.scope) === scope &&
          mappedIds.includes(f.olderAssessmentRevisionRef),
      )) {
        const older = relevant.get(s.olderAssessmentRevisionRef),
          newer = relevant.get(s.newerAssessmentRevisionRef);
        if (
          !newer ||
          !mappedIds.includes(s.newerAssessmentRevisionRef) ||
          !older?.lane ||
          !newer.lane ||
          older.lane.seriesRef !== newer.lane.seriesRef ||
          older.lane.professionalScope !== newer.lane.professionalScope ||
          !older.lane.assertionRef ||
          !newer.lane.assertionRef ||
          !s.assertionRef ||
          s.authority !== 'SOURCE_EXPLICIT' ||
          !complete(s.coverage)
        ) {
          gap('ASSESSMENT_ORDER_UNCONFIRMED', versionRef, [
            s.olderAssessmentRevisionRef,
          ]);
          continue;
        }
        context.successionAssertionRefs.push(identifier(s.assertionRef));
        edges.set(older.sourceRevisionRef, [
          ...(edges.get(older.sourceRevisionRef) ?? []),
          newer.sourceRevisionRef,
        ]);
      }
      const reachable = (start: string): Set<string> => {
        const visited = new Set<string>(),
          pending = [...(edges.get(start) ?? [])];
        while (pending.length) {
          const next = pending.pop()!;
          if (visited.has(next)) continue;
          visited.add(next);
          pending.push(...(edges.get(next) ?? []));
        }
        return visited;
      };
      const cycleNodes = new Set(
        mappedIds.filter((id) => reachable(id).has(id)),
      );
      const cycleAffected = (id: string) =>
        cycleNodes.has(id) ||
        [...reachable(id)].some((next) => cycleNodes.has(next)) ||
        [...cycleNodes].some((cycle) => reachable(cycle).has(id));
      const affectedIds = mappedIds.filter(cycleAffected);
      if (affectedIds.length)
        gap('ASSESSMENT_SUCCESSION_CONFLICT', versionRef, affectedIds);
      const retained: TdmsOpinionAssessmentFact[] = [];
      for (const a of active) {
        const newer = reachable(a.sourceRevisionRef);
        if (
          !cycleAffected(a.sourceRevisionRef) &&
          active.some((b) => newer.has(b.sourceRevisionRef))
        )
          context.supersededAssessmentRefs.push(...refs(a));
        else retained.push(a);
        if (
          mapped.some(
            (b) =>
              newer.has(b.sourceRevisionRef) &&
              b.approval?.mode === 'METADATA_ONLY' &&
              b.approval.reason === 'STATE_NOT_ESTIMATED' &&
              b.state !== null &&
              !estimated(b.state),
          )
        )
          gap('NEWER_ASSESSMENT_NOT_APPROVED', versionRef, [
            a.sourceRevisionRef,
          ]);
      }
      for (const a of retained) {
        if (!context.latestSourceRevisionRef)
          context.unresolvedRefs.push(a.sourceRevisionRef);
        else if (versionRef === context.latestSourceRevisionRef)
          context.currentVersionApprovedRefs.push(...refs(a));
        else context.historicalSourceApprovedRefs.push(...refs(a));
      }
      // Unknown lanes are not merged. Same declared lane with no accepted order
      // remains a competing set, never a timestamp winner or semantic conflict.
      const ambiguous = retained.filter(
        (a) =>
          !a.lane ||
          cycleAffected(a.sourceRevisionRef) ||
          retained.some(
            (b) =>
              b !== a &&
              b.lane?.seriesRef === a.lane?.seriesRef &&
              b.lane?.professionalScope === a.lane?.professionalScope,
          ),
      );
      if (ambiguous.length) {
        gap(
          'ASSESSMENT_ORDER_UNCONFIRMED',
          versionRef,
          ambiguous.map((a) => a.sourceRevisionRef),
        );
        const groups = new Map<string, TdmsOpinionAssessmentFact[]>();
        for (const a of ambiguous) {
          const key = canonical(
            a.lane ? [a.lane.seriesRef, a.lane.professionalScope] : null,
          );
          groups.set(key, [...(groups.get(key) ?? []), a]);
        }
        for (const group of groups.values())
          context.competingApprovalSets.push({
            sourceRevisionRef: versionRef,
            seriesRef: group[0]!.lane?.seriesRef ?? null,
            professionalScope: group[0]!.lane?.professionalScope ?? null,
            opinionRefs: unique(group.flatMap(refs)),
          });
      }
      if (
        versionRef === context.latestSourceRevisionRef &&
        !retained.some((a) => refs(a).length) &&
        coverageComplete &&
        !uncertain
      )
        gap('NO_APPROVED_OPINION_FOR_LATEST_SOURCE_VERSION', versionRef);
    }
    // Invalid mappings retain only authorized metadata; an approved locator is
    // discoverable but cannot be promoted to a document-specific approved set.
    for (const a of relevant.values())
      if (modes.get(scoped(a.scope, a.sourceRevisionRef))) refs(a);
    for (const key of [
      'currentVersionApprovedRefs',
      'historicalSourceApprovedRefs',
      'supersededAssessmentRefs',
      'revokedOpinionRefs',
      'qualifiedObservationRefs',
      'unresolvedRefs',
    ] as const)
      context[key] = unique(context[key]);
    context.coverage.sort((a, b) =>
      compare(a.sourceRevisionRef, b.sourceRevisionRef),
    );
    context.competingApprovalSets.sort((a, b) =>
      compare(canonical(a), canonical(b)),
    );
    context.validityNotices = [
      ...new Map(
        context.validityNotices.map((n) => [canonical(n), n]),
      ).values(),
    ].sort((a, b) => compare(canonical(a), canonical(b)));
    context.successionAssertionRefs = unique(context.successionAssertionRefs);
    result.sources.push(context);
  }
  for (const fact of input.contradictions) {
    if (scopeKey(fact.scope) !== scopeKey(fact.opinion.scope)) continue;
    const opinionRef = tdmsApprovedOpinionRef(fact.opinion);
    if (!opinions.has(opinionRef)) continue;
    const againstRef =
      fact.against.kind === 'OPINION'
        ? tdmsApprovedOpinionRef(fact.against.opinion)
        : identifier(fact.against.evidenceRef);
    if (
      fact.against.kind === 'OPINION' &&
      (scopeKey(fact.scope) !== scopeKey(fact.against.opinion.scope) ||
        !opinions.has(againstRef))
    )
      continue;
    result.contradictions.push({
      assertionRef: identifier(fact.assertionRef),
      opinionRef,
      againstRef,
    });
    for (const source of result.sources.filter(
      (s) => scopeKey(s.scope) === scopeKey(fact.scope),
    )) {
      if (
        source.mappings.some(
          (m) => m.assessmentRevisionRef === fact.opinion.sourceRevisionRef,
        )
      )
        source.gaps.push({
          code: 'CONTRADICTION_UNRESOLVED',
          sourceRevisionRef: null,
          assessmentRevisionRefs: [fact.opinion.sourceRevisionRef],
        });
    }
  }
  const stable = <T>(values: T[]) =>
    [...new Map(values.map((v) => [canonical(v), v])).entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, v]) => v);
  result.opinions = [...opinions.values()].sort((a, b) =>
    a.evidenceRef < b.evidenceRef ? -1 : a.evidenceRef > b.evidenceRef ? 1 : 0,
  );
  result.sources = stable(
    result.sources.map((s) => ({ ...s, gaps: stable(s.gaps) })),
  );
  result.contradictions = stable(result.contradictions);
  return result;
}

/** Inactive v3 projection. The v2 entry point above remains byte-compatible.
 * Authorization, frozen set selection, and ACL filtering belong to the caller;
 * this pure function never substitutes a member from another cohort. The v2
 * projector supplies the single approval-gated locator registry and mapping
 * verifier; its lane ordering output is intentionally not a v3 ordering fact.
 */
export function projectTdmsProcessingCohortContext(
  input: TdmsProcessingCohortContextInput,
): TdmsProcessingCohortContext {
  const registry = projectTdmsApprovedOpinionContext({
    sources: input.sources,
    assessments: input.assessments,
    mappings: input.mappings,
    successors: [],
    contradictions: input.contradictions ?? [],
  });
  const available = new Map(
    registry.opinions.map((opinion) => [opinion.evidenceRef, opinion]),
  );
  const assessments = new Map<string, TdmsOpinionAssessmentFact>();
  for (const assessment of input.assessments) {
    const key = scoped(assessment.scope, assessment.sourceRevisionRef);
    if (assessments.has(key))
      throw tdmsError('TDMS_OPINION_DUPLICATE_ASSESSMENT');
    assessments.set(key, assessment);
  }
  const sourceVersions = new Map<string, NativeIdentity>();
  for (const source of input.sources)
    for (const version of source.versions)
      sourceVersions.set(
        scoped(source.scope, version.sourceRevisionRef),
        version,
      );
  const sets = new Map<string, TdmsProcessingRevisionSet>();
  for (const set of input.sets) {
    const key = scoped(set.scope, set.setRevisionRef);
    if (sets.has(key)) throw tdmsError('TDMS_PROCESSING_SET_DUPLICATE');
    sets.set(key, set);
  }
  const selected = new Set(input.selectedSetRevisionRefs);
  if (selected.size !== input.selectedSetRevisionRefs.length)
    throw tdmsError('TDMS_PROCESSING_SELECTION_DUPLICATE');
  for (const setRef of selected)
    if (
      [...sets.values()].filter((set) => set.setRevisionRef === setRef)
        .length !== 1
    )
      throw tdmsError('TDMS_PROCESSING_SELECTION_UNKNOWN');
  const selectedFamilies = new Set<string>();
  const used = new Map<string, TdmsApprovedOpinionReference>();
  const cohorts: TdmsProcessingCohortContext['cohorts'] = [];
  for (const set of input.sets) {
    const selection = selected.has(set.setRevisionRef)
      ? 'HOST_SELECTED'
      : 'HISTORICAL';
    const familyKey = scoped(set.scope, set.processingFamilyRef);
    if (selection === 'HOST_SELECTED') {
      if (selectedFamilies.has(familyKey))
        throw tdmsError('TDMS_PROCESSING_SELECTION_CONFLICT');
      selectedFamilies.add(familyKey);
    }
    const gaps = [...set.gaps];
    if (
      !set.cohortRef ||
      !set.familyIdentityEvidenceRefs.length ||
      !set.cohortIdentityEvidenceRefs.length
    )
      gaps.push('COHORT_IDENTITY_UNCONFIRMED');
    if (set.membershipCoverage !== 'COMPLETE')
      gaps.push('MEMBERSHIP_COVERAGE_INCOMPLETE');
    if (set.versionMappingCoverage !== 'COMPLETE')
      gaps.push('VERSION_MAPPING_COVERAGE_INCOMPLETE');
    if (set.approvedBodyCaptureCoverage !== 'COMPLETE')
      gaps.push('APPROVED_BODY_COVERAGE_INCOMPLETE');
    if (set.approvalReadiness !== 'ALL_APPROVED')
      gaps.push('APPROVAL_READINESS_NOT_ALL_APPROVED');
    if (set.currentness !== 'CURRENT')
      gaps.push('SOURCE_CURRENTNESS_UNCONFIRMED');
    if (set.sourceConsistency !== 'ATOMIC')
      gaps.push('SOURCE_OBSERVATION_NON_ATOMIC');
    const members: TdmsProcessingCohortContext['cohorts'][number]['members'] =
      [];
    const seenMembers = new Set<string>();
    for (const member of set.members) {
      const memberRef = identifier(member.memberRef);
      if (seenMembers.has(memberRef))
        throw tdmsError('TDMS_PROCESSING_MEMBER_DUPLICATE');
      seenMembers.add(memberRef);
      const projected: TdmsProcessingCohortContext['cohorts'][number]['members'][number] =
        {
          memberRef,
          assessmentObservationRef: member.assessmentObservationRef,
          membershipResolution: member.membershipResolution,
          opinionRefs: [],
          contributorRefs: [],
          responsibilityRefs: [],
          ataScopes: [],
          evidenceRefs: [],
          opinionContributions: [],
          status: 'UNKNOWN',
        };
      members.push(projected);
      const assessmentRef = member.assessmentObservationRef;
      if (
        !set.cohortRef ||
        !set.familyIdentityEvidenceRefs.length ||
        !set.cohortIdentityEvidenceRefs.length ||
        member.membershipResolution !== 'CONFIRMED' ||
        !member.cohortMembershipEvidenceRefs.length ||
        !assessmentRef
      ) {
        gaps.push('MEMBER_IDENTITY_UNCONFIRMED');
        continue;
      }
      const assessment = assessments.get(scoped(set.scope, assessmentRef));
      if (!assessment) {
        gaps.push('MEMBER_OBSERVATION_NOT_ACQUIRED');
        continue;
      }
      const mode = approvalMode(assessment);
      if (!mode) {
        projected.status =
          assessment.approval?.mode === 'METADATA_ONLY' &&
          assessment.approval.reason === 'STATE_NOT_ESTIMATED'
            ? 'METADATA_ONLY'
            : 'UNKNOWN';
        gaps.push(
          projected.status === 'METADATA_ONLY'
            ? 'ASSESSMENT_NOT_APPROVED'
            : 'APPROVAL_UNCONFIRMED',
        );
        continue;
      }
      const matching = input.mappings.filter(
        (mapping) =>
          scopeKey(mapping.scope) === scopeKey(set.scope) &&
          mapping.assessmentRevisionRef === assessmentRef &&
          exactMapping(mapping) &&
          mapping.path[0]?.to.kind === 'NATIVE_RECORD_REVISION' &&
          mapping.path[0].to.sourceRevisionRef ===
            set.processingObservationRef &&
          member.processingAssessmentAssertionRefs.includes(
            mapping.path[1]!.assertionRef,
          ) &&
          set.rootBindings.some((binding) => {
            const root = sourceVersions.get(
              scoped(set.scope, mapping.sourceRevisionRef),
            );
            return (
              binding.endpoint.kind === 'NATIVE_RECORD_REVISION' &&
              binding.endpoint.sourceRevisionRef ===
                mapping.sourceRevisionRef &&
              binding.applicabilityEvidenceRefs.length > 0 &&
              binding.fileProcessingAssertionRefs.includes(
                mapping.path[0]!.assertionRef,
              ) &&
              !!root &&
              exactVersion(root.sourceVersion)
            );
          }),
      );
      if (!matching.length) {
        gaps.push('MAPPING_UNCONFIRMED');
        continue;
      }
      if (mode === 'OBJECT_OBSERVATION')
        gaps.push('TECHNICAL_VERSION_UNEXPOSED');
      if (assessment.validity.status === 'REVOKED') {
        projected.status = 'REVOKED';
        gaps.push('APPROVAL_REVOKED');
      } else if (mode === 'OBJECT_OBSERVATION') {
        projected.status = 'QUALIFIED';
      } else if (
        assessment.validity.status !== 'ACTIVE' ||
        !assessment.validity.assertionRef
      ) {
        projected.status = 'QUALIFIED';
        gaps.push('APPROVAL_VALIDITY_UNKNOWN');
      } else projected.status = 'APPROVED';
      projected.evidenceRefs = unique([
        ...member.cohortMembershipEvidenceRefs,
        ...matching.flatMap((mapping) =>
          mapping.path.map((relation) => relation.assertionRef),
        ),
        ...(assessment.validity.assertionRef
          ? [assessment.validity.assertionRef]
          : []),
      ]);
      // opinionFields are touched only after the assessment's own gate passed.
      for (const field of assessment.opinionFields) {
        const opinionRef = tdmsApprovedOpinionRef({
          scope: set.scope,
          sourceRevisionRef: assessmentRef,
          opinionIndex: field.index,
        });
        const descriptor = available.get(opinionRef);
        if (!descriptor) throw tdmsError('TDMS_OPINION_LOCATOR_MISSING');
        const prior = used.get(opinionRef);
        if (prior && canonical(prior) !== canonical(descriptor))
          throw tdmsError('TDMS_OPINION_LOCATOR_CONFLICT');
        used.set(opinionRef, descriptor);
        projected.opinionRefs.push(opinionRef);
        const facts = input.contributions.filter(
          (fact) =>
            scopeKey(fact.scope) === scopeKey(set.scope) &&
            fact.assessmentObservationRef === assessmentRef &&
            fact.opinionIndex === field.index,
        );
        if (facts.length > 1)
          throw tdmsError('TDMS_OPINION_CONTRIBUTION_CONFLICT');
        const fact = facts[0];
        if (!fact) continue;
        if (!fact.assertionRefs.length)
          throw tdmsError('TDMS_OPINION_CONTRIBUTION_UNPROVEN');
        const contribution = {
          opinionRef,
          contributorRefs: unique([...fact.contributorRefs].map(identifier)),
          responsibilityRefs: unique(
            [...fact.responsibilityRefs].map(identifier),
          ),
          ataScopes: unique([...fact.ataScopes]),
          assertionRefs: unique([...fact.assertionRefs].map(identifier)),
        };
        projected.opinionContributions.push(contribution);
        projected.contributorRefs.push(...contribution.contributorRefs);
        projected.responsibilityRefs.push(...contribution.responsibilityRefs);
        projected.ataScopes.push(...contribution.ataScopes);
      }
      projected.opinionRefs = unique(projected.opinionRefs);
      projected.contributorRefs = unique(projected.contributorRefs);
      projected.responsibilityRefs = unique(projected.responsibilityRefs);
      projected.ataScopes = unique(projected.ataScopes);
      if (!projected.opinionRefs.length)
        gaps.push('OPINION_FIELDS_UNAVAILABLE');
    }
    cohorts.push({
      scope: scopeCopy(set.scope),
      setRevisionRef: set.setRevisionRef,
      processingFamilyRef: set.processingFamilyRef,
      cohortRef: set.cohortRef,
      processingObservationRef: set.processingObservationRef,
      rootBindings: set.rootBindings,
      selection,
      membershipCoverage: set.membershipCoverage,
      versionMappingCoverage: set.versionMappingCoverage,
      approvedBodyCaptureCoverage: set.approvedBodyCaptureCoverage,
      approvalReadiness: set.approvalReadiness,
      currentness: set.currentness,
      members,
      approvedOpinionRefs: unique(
        members
          .filter((member) => member.status === 'APPROVED')
          .flatMap((member) => member.opinionRefs),
      ),
      qualifiedOpinionRefs: unique(
        members
          .filter((member) => member.status === 'QUALIFIED')
          .flatMap((member) => member.opinionRefs),
      ),
      revokedOpinionRefs: unique(
        members
          .filter((member) => member.status === 'REVOKED')
          .flatMap((member) => member.opinionRefs),
      ),
      gaps: unique(gaps),
    });
  }
  const contradictions = registry.contradictions.filter(
    (fact) =>
      used.has(fact.opinionRef) &&
      (!available.has(fact.againstRef) || used.has(fact.againstRef)),
  );
  for (const cohort of cohorts) {
    if (
      cohort.members.some((member) =>
        member.opinionRefs.some((ref) =>
          contradictions.some(
            (fact) => fact.opinionRef === ref || fact.againstRef === ref,
          ),
        ),
      )
    ) {
      cohort.gaps = unique([...cohort.gaps, 'CONTRADICTION_UNRESOLVED']);
    }
  }
  return {
    contradictions,
    opinions: [...used.values()].sort((a, b) =>
      compare(a.evidenceRef, b.evidenceRef),
    ),
    selectedSetApprovedRefs: unique(
      cohorts
        .filter((cohort) => cohort.selection === 'HOST_SELECTED')
        .flatMap((cohort) => cohort.approvedOpinionRefs),
    ),
    historicalCohortApprovedRefs: unique(
      cohorts
        .filter((cohort) => cohort.selection === 'HISTORICAL')
        .flatMap((cohort) => cohort.approvedOpinionRefs),
    ),
    cohorts,
    readPerformed: false,
    interpretation: 'APPROVED_PROFESSIONAL_JUDGMENT_NOT_INFALLIBLE',
  };
}
