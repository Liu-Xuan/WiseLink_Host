import {
  projectTdmsProcessingCohortContext as project,
  type TdmsOpinionAssessmentFact,
  type TdmsOpinionMappingFact,
  type TdmsOpinionSourceFact,
  type TdmsProcessingCohortContextInput,
} from '../../server/modules/canonical-host/tdms-approved-opinion-context';
import {
  TDMS_PROCESSING_SET_SCHEMA,
  type TdmsProcessingRevisionSet,
} from '../../shared/tdms-processing-set.interface';
import type { TdmsCoverage } from '../../shared/tdms-source.interface';

// Constructed development facts, not sampled TDMS fields or a released API.
const scope = {
  tenantId: 'tenant',
  sourceKey: 'TDMS',
  sourceInstanceId: 'instance',
  scopeId: 'scope',
};
const coverage = (): TdmsCoverage => ({
  status: 'COMPLETE',
  readback: 'CONSISTENT',
  gaps: [],
});
const version = () => ({
  rawRevision: 'A',
  rawIteration: '1',
  confirmation: 'SOURCE_DECLARED' as const,
});
const state = () => ({ rawCode: 'Estimated', rawName: 'Estimated' });
const endpoint = (id: string) => ({
  kind: 'NATIVE_RECORD_REVISION' as const,
  sourceRevisionRef: id,
});
function source(): TdmsOpinionSourceFact {
  return {
    scope,
    recordRef: 'file',
    versions: [
      {
        recordRef: 'file',
        sourceRevisionRef: 'oem-v1',
        sourceRecordId: 'file-id',
        sourceVersion: version(),
        businessVersion: version(),
      },
    ],
    latestness: [
      {
        assertionRef: 'latest-oem',
        basis: 'SOURCE_VERSION_DIRECTORY',
        recordRef: 'file',
        sourceRevisionRef: 'oem-v1',
        coverage: coverage(),
      },
    ],
    assessmentCoverage: [],
  };
}
function assessment(id: string): TdmsOpinionAssessmentFact {
  const observation = {
    sourceRecordId: `assessment-native-${id}`,
    sourceVersion: version(),
    recordKind: 'ENGINEER_ASSESSMENT' as const,
    objectBinding: 'EXACT_CURRENT_DETAIL' as const,
    state: state(),
    sourceModifiedAt: '2026-10-01T00:00:00Z',
    observedAt: '2026-10-06T09:00:00Z',
  };
  return {
    scope,
    recordRef: `record-${id}`,
    sourceRevisionRef: id,
    sourceRecordId: observation.sourceRecordId,
    sourceVersion: version(),
    businessVersion: null,
    recordKind: 'ENGINEER_ASSESSMENT',
    state: state(),
    captureRef: `capture-${id}`,
    observedAt: observation.observedAt,
    sourceModifiedAt: observation.sourceModifiedAt,
    coverage: coverage(),
    approval: {
      mode: 'ESTIMATED_OPINION',
      reason: 'APPROVED_CURRENT_EXACT_VERSION',
      approvalSubject: {
        sourceRecordId: observation.sourceRecordId,
        sourceVersion: version(),
      },
      before: { ...observation, observedAt: '2026-10-06T08:59:00Z' },
      after: observation,
    },
    validity: { status: 'ACTIVE', assertionRef: `valid-${id}` },
    lane: {
      seriesRef: 'same-lane',
      professionalScope: 'ATA 27',
      assertionRef: `lane-${id}`,
    },
    opinionFields: [
      {
        index: 0,
        sourceSelector: `#opinion-${id}`,
        author: {
          sourcePersonId: 'same-author',
          name: 'Engineer',
          role: 'ASSESSOR',
        },
      },
    ],
  };
}
function mapping(id: string, processing: string): TdmsOpinionMappingFact {
  const relation = (
    kind: 'FILE_PROCESSING' | 'PROCESSING_ASSESSMENT',
    assertionRef: string,
    from: string,
    to: string,
  ) => ({
    assertionRef,
    controlledKind: kind,
    from: endpoint(from),
    to: endpoint(to),
    authority: 'SOURCE_EXPLICIT' as const,
    coverage: coverage(),
    nativeScope: scope,
    scope: {
      kind: 'EXACT_SOURCE_VERSION_ASSESSMENT' as const,
      sourceRevisionRef: 'oem-v1',
      assessmentRevisionRef: id,
    },
  });
  return {
    scope,
    sourceRevisionRef: 'oem-v1',
    assessmentRevisionRef: id,
    path: [
      relation('FILE_PROCESSING', `fp-${processing}`, 'oem-v1', processing),
      relation('PROCESSING_ASSESSMENT', `pa-${id}`, processing, id),
    ],
  };
}
function set(
  cohort: string,
  processing: string,
  ids: string[],
): TdmsProcessingRevisionSet {
  return {
    schemaVersion: TDMS_PROCESSING_SET_SCHEMA,
    scope,
    setRevisionRef: `set-${cohort}`,
    processingFamilyRef: 'family',
    cohortRef: cohort,
    processingObservationRef: processing,
    familyIdentityEvidenceRefs: ['family-proof'],
    cohortIdentityEvidenceRefs: [`cohort-${cohort}-proof`],
    predecessorCohortRef: null,
    successionEvidenceRefs: [],
    supersedesSetRevisionRef: null,
    rootBindings: [
      {
        endpoint: endpoint('oem-v1'),
        fileProcessingAssertionRefs: [`fp-${processing}`],
        applicabilityEvidenceRefs: ['applicability'],
      },
    ],
    rosterEvidenceRefs: [`roster-${cohort}`],
    sourceRosterRevision: 'roster-1',
    captureRefs: ['capture'],
    observationWindow: {
      before: '2026-10-06T08:59:00Z',
      after: '2026-10-06T09:00:00Z',
    },
    membershipCoverage: 'COMPLETE',
    versionMappingCoverage: 'COMPLETE',
    approvedBodyCaptureCoverage: 'COMPLETE',
    approvalReadiness: 'ALL_APPROVED',
    sourceConsistency: 'ATOMIC',
    sourceTransactionRef: 'transaction',
    currentness: 'CURRENT',
    currentnessEvidenceRefs: ['current-proof'],
    members: ids.map((id) => ({
      memberRef: `member-${id}`,
      assessmentFamilyRef: `family-${id}`,
      assessmentBusinessRevisionKey: `business-${id}`,
      assessmentObservationRef: id,
      membershipResolution: 'CONFIRMED',
      processingAssessmentAssertionRefs: [`pa-${id}`],
      cohortMembershipEvidenceRefs: [`member-${id}-proof`],
      assessmentSuccessionEvidenceRefs: [],
      expectedSourceRecordId: null,
      gaps: [],
    })),
    gaps: [],
  };
}
function fixture(ids: string[]): TdmsProcessingCohortContextInput {
  return {
    sets: [set('c1', 'processing-c1', ids)],
    selectedSetRevisionRefs: ['set-c1'],
    sources: [source()],
    assessments: ids.map(assessment),
    mappings: ids.map((id) => mapping(id, 'processing-c1')),
    contributions: [],
  };
}

test('same cohort siblings with one ATA and author remain parallel', () => {
  const result = project(fixture(['a1', 'b1']));
  const cohort = result.cohorts[0]!;
  expect(cohort.members.map((member) => member.status)).toEqual([
    'APPROVED',
    'APPROVED',
  ]);
  expect(cohort.approvedOpinionRefs).toHaveLength(2);
  expect(cohort.gaps).not.toContain('ASSESSMENT_ORDER_UNCONFIRMED');
  expect(result.opinions).toHaveLength(2);
});

test('source-explicit sibling contradiction keeps both approved refs', () => {
  const input = fixture(['a1', 'b1']);
  input.contradictions = [
    {
      scope,
      assertionRef: 'explicit-conflict',
      opinion: { scope, sourceRevisionRef: 'a1', opinionIndex: 0 },
      against: {
        kind: 'OPINION',
        opinion: { scope, sourceRevisionRef: 'b1', opinionIndex: 0 },
      },
    },
  ];
  const result = project(input);
  expect(result.selectedSetApprovedRefs).toHaveLength(2);
  expect(result.contradictions).toHaveLength(1);
  expect(result.cohorts[0]!.gaps).toContain('CONTRADICTION_UNRESOLVED');
});

test('new partial cohort does not fill its missing member from old cohort', () => {
  const input = fixture(['a1', 'b1']);
  const old = set('c0', 'processing-c0', ['a0', 'b0']);
  old.currentness = 'HISTORICAL';
  input.sets = [old, input.sets[0]!];
  input.assessments = [
    ...input.assessments,
    assessment('a0'),
    assessment('b0'),
  ];
  input.mappings = [
    ...input.mappings,
    mapping('a0', 'processing-c0'),
    mapping('b0', 'processing-c0'),
  ];
  input.sets[1]!.members[1]!.assessmentObservationRef = null;
  input.sets[1]!.membershipCoverage = 'PARTIAL';
  const result = project(input);
  expect(result.cohorts[0]!.selection).toBe('HISTORICAL');
  expect(result.cohorts[1]!.approvedOpinionRefs).toHaveLength(1);
  expect(result.cohorts[1]!.members[1]!.opinionRefs).toEqual([]);
  expect(result.selectedSetApprovedRefs).toHaveLength(1);
  expect(result.historicalCohortApprovedRefs).toHaveLength(2);
  expect(result.selectedSetApprovedRefs).not.toContain(
    result.cohorts[0]!.members[1]!.opinionRefs[0],
  );
  expect(result.cohorts[1]!.gaps).toContain('MEMBER_IDENTITY_UNCONFIRMED');
});

test('metadata-only assessment never accesses opinion fields', () => {
  const input = fixture(['a1', 'b1']);
  const pending = input.assessments[1]!;
  pending.state = { rawCode: 'Estimating', rawName: 'Estimating' };
  pending.approval = {
    mode: 'METADATA_ONLY',
    reason: 'STATE_NOT_ESTIMATED',
    approvalSubject: null,
    before: null,
    after: null,
  };
  Object.defineProperty(pending, 'opinionFields', {
    get() {
      throw new Error('metadata body getter touched');
    },
  });
  input.sets[0]!.approvalReadiness = 'PENDING';
  const result = project(input);
  expect(result.cohorts[0]!.members[1]!.status).toBe('METADATA_ONLY');
  expect(result.cohorts[0]!.approvedOpinionRefs).toHaveLength(1);
  expect(result.cohorts[0]!.gaps).toContain(
    'APPROVAL_READINESS_NOT_ALL_APPROVED',
  );
});

test('explicit contribution refs keep multiple people and ATA on one locator', () => {
  const input = fixture(['a1']);
  input.contributions = [
    {
      scope,
      assessmentObservationRef: 'a1',
      opinionIndex: 0,
      contributorRefs: ['person-1', 'person-2'],
      responsibilityRefs: ['role-27', 'role-29'],
      ataScopes: ['ATA 27', 'ATA 29'],
      assertionRefs: ['source-contribution'],
    },
  ];
  const result = project(input);
  const member = result.cohorts[0]!.members[0]!;
  expect(member.opinionRefs).toHaveLength(1);
  expect(member.contributorRefs).toEqual(['person-1', 'person-2']);
  expect(member.ataScopes).toEqual(['ATA 27', 'ATA 29']);
  expect(member.opinionContributions[0]!.opinionRef).toBe(
    member.opinionRefs[0],
  );
});

test('a plain relation without exact finite applicability leaves a gap', () => {
  const input = fixture(['a1']);
  input.mappings = [{ ...input.mappings[0]!, path: [] }];
  const result = project(input);
  expect(result.cohorts[0]!.approvedOpinionRefs).toEqual([]);
  expect(result.cohorts[0]!.gaps).toContain('MAPPING_UNCONFIRMED');
});

test('a revoked approval is preserved as a ref but not current approval', () => {
  const input = fixture(['a1']);
  input.assessments[0]!.validity = {
    status: 'REVOKED',
    assertionRef: 'revocation-proof',
  };
  const result = project(input);
  expect(result.selectedSetApprovedRefs).toEqual([]);
  expect(result.cohorts[0]!.revokedOpinionRefs).toHaveLength(1);
  expect(result.opinions).toHaveLength(1);
});

test('status regression without revocation proof leaves validity qualified', () => {
  const input = fixture(['a1']);
  input.assessments[0]!.validity = { status: 'UNKNOWN', assertionRef: null };
  const result = project(input);
  expect(result.selectedSetApprovedRefs).toEqual([]);
  expect(result.cohorts[0]!.qualifiedOpinionRefs).toHaveLength(1);
  expect(result.cohorts[0]!.gaps).toContain('APPROVAL_VALIDITY_UNKNOWN');
});

test('business R00 with technical iteration hidden remains qualified', () => {
  const input = fixture(['a1']);
  const item = input.assessments[0]!;
  item.sourceVersion = {
    rawRevision: null,
    rawIteration: null,
    confirmation: 'VERSION_UNCONFIRMED',
  };
  item.businessVersion = {
    rawRevision: 'R00',
    rawIteration: null,
    confirmation: 'SOURCE_DECLARED',
  };
  item.sourceModifiedAt = null;
  item.sourceModifiedRaw = '2026-10-01 00:00 CST';
  item.coverage = {
    status: 'PARTIAL',
    readback: 'NON_ATOMIC',
    gaps: ['TECHNICAL_VERSION_UNEXPOSED'],
  };
  item.approval!.reason = 'APPROVED_CURRENT_OBJECT_OBSERVATION';
  for (const value of [
    item.approval!.approvalSubject!,
    item.approval!.before!,
    item.approval!.after!,
  ]) {
    value.sourceVersion = { ...item.sourceVersion };
    value.businessVersion = { ...item.businessVersion };
  }
  for (const value of [item.approval!.before!, item.approval!.after!]) {
    value.sourceModifiedAt = null;
    value.sourceModifiedRaw = item.sourceModifiedRaw;
  }
  const result = project(input);
  expect(result.selectedSetApprovedRefs).toEqual([]);
  expect(result.cohorts[0]!.qualifiedOpinionRefs).toHaveLength(1);
  expect(result.cohorts[0]!.gaps).toContain('TECHNICAL_VERSION_UNEXPOSED');
});

test('revoked object observation is revoked, never a qualified current ref', () => {
  const input = fixture(['a1']);
  const item = input.assessments[0]!;
  item.sourceVersion = {
    rawRevision: null,
    rawIteration: null,
    confirmation: 'VERSION_UNCONFIRMED',
  };
  item.businessVersion = {
    rawRevision: 'R00',
    rawIteration: null,
    confirmation: 'SOURCE_DECLARED',
  };
  item.sourceModifiedAt = null;
  item.sourceModifiedRaw = '2026-10-01 00:00 CST';
  item.coverage = {
    status: 'PARTIAL',
    readback: 'NON_ATOMIC',
    gaps: ['TECHNICAL_VERSION_UNEXPOSED'],
  };
  item.approval!.reason = 'APPROVED_CURRENT_OBJECT_OBSERVATION';
  for (const value of [
    item.approval!.approvalSubject!,
    item.approval!.before!,
    item.approval!.after!,
  ]) {
    value.sourceVersion = { ...item.sourceVersion };
    value.businessVersion = { ...item.businessVersion };
  }
  for (const value of [item.approval!.before!, item.approval!.after!]) {
    value.sourceModifiedAt = null;
    value.sourceModifiedRaw = item.sourceModifiedRaw;
  }
  item.validity = { status: 'REVOKED', assertionRef: 'revoked-object-proof' };
  const result = project(input);
  expect(result.selectedSetApprovedRefs).toEqual([]);
  expect(result.cohorts[0]!.qualifiedOpinionRefs).toEqual([]);
  expect(result.cohorts[0]!.revokedOpinionRefs).toHaveLength(1);
  expect(result.cohorts[0]!.members[0]!.status).toBe('REVOKED');
  expect(result.cohorts[0]!.gaps).toContain('APPROVAL_REVOKED');
});

test('a set cannot duplicate one business member as separate observations', () => {
  const input = fixture(['a1']);
  input.sets[0]!.members.push({ ...input.sets[0]!.members[0]! });
  expect(() => project(input)).toThrow('TDMS_PROCESSING_MEMBER_DUPLICATE');
});

test('a link to another processing observation cannot enter the selected set', () => {
  const input = fixture(['a1']);
  input.mappings = [mapping('a1', 'processing-c0')];
  const result = project(input);
  expect(result.selectedSetApprovedRefs).toEqual([]);
  expect(result.cohorts[0]!.gaps).toContain('MAPPING_UNCONFIRMED');
});

test('two processing families can share one OEM revision without merging rosters', () => {
  const input = fixture(['a1']);
  const second = set('second-c1', 'processing-second', ['b1']);
  second.processingFamilyRef = 'second-family';
  input.sets = [...input.sets, second];
  input.selectedSetRevisionRefs = ['set-c1', second.setRevisionRef];
  input.assessments = [...input.assessments, assessment('b1')];
  input.mappings = [...input.mappings, mapping('b1', 'processing-second')];
  const result = project(input);
  expect(result.cohorts).toHaveLength(2);
  expect(
    result.cohorts.map((cohort) => cohort.approvedOpinionRefs.length),
  ).toEqual([1, 1]);
  expect(result.selectedSetApprovedRefs).toHaveLength(2);
});
