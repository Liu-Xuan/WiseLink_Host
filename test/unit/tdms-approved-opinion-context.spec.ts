import {
  projectTdmsApprovedOpinionContext as project,
  tdmsApprovedOpinionRef as ref,
  type TdmsApprovedOpinionContextInput as Input,
  type TdmsOpinionAssessmentFact as Assessment,
  type TdmsOpinionMappingFact as Mapping,
  type TdmsOpinionSourceFact as Source,
} from '../../server/modules/canonical-host/tdms-approved-opinion-context';
import type { TdmsCoverage } from '../../shared/tdms-source.interface';

// Constructed DEVELOPMENT facts; not actual source provenance or a frozen holdout.
const scope = {
  tenantId: 'tenant',
  sourceKey: 'TDMS',
  sourceInstanceId: 'instance',
  scopeId: 'scope',
};
const complete = (): TdmsCoverage => ({
  status: 'COMPLETE',
  readback: 'CONSISTENT',
  gaps: [],
});
const version = (rev = 'A') => ({
  rawRevision: rev,
  rawIteration: '1',
  confirmation: 'SOURCE_DECLARED' as const,
});
const estimated = () => ({ rawCode: 'Estimated', rawName: 'Estimated' });
function source(): Source {
  return {
    scope: { ...scope },
    recordRef: 'file',
    versions: ['v1', 'v2'].map((id) => ({
      recordRef: 'file',
      sourceRevisionRef: id,
      sourceRecordId: 'file-native-id',
      sourceVersion: version(id),
      businessVersion: version(id),
    })),
    latestness: [
      {
        assertionRef: 'latest-v2',
        basis: 'SOURCE_VERSION_DIRECTORY',
        recordRef: 'file',
        sourceRevisionRef: 'v2',
        coverage: complete(),
      },
    ],
    assessmentCoverage: ['v1', 'v2'].map((id) => ({
      sourceRevisionRef: id,
      assertionRef: `roster-${id}`,
      assessmentRevisionRefs: [],
      coverage: complete(),
    })),
  };
}
function assessment(id = 'a1', series = 'series-structures'): Assessment {
  const observation = {
    sourceRecordId: `OR:wt.change2.WTChangeOrder2:${Array.from(id)
      .map((c) => c.codePointAt(0))
      .join('')}`,
    sourceVersion: version(),
    recordKind: 'ENGINEER_ASSESSMENT' as const,
    objectBinding: 'EXACT_CURRENT_DETAIL' as const,
    state: estimated(),
    sourceModifiedAt: '2026-10-01T00:00:00Z',
    observedAt: '2026-10-06T09:00:00Z',
  };
  return {
    scope: { ...scope },
    recordRef: `assessment-${id}`,
    sourceRevisionRef: id,
    sourceRecordId: observation.sourceRecordId,
    sourceVersion: version(),
    businessVersion: null,
    recordKind: 'ENGINEER_ASSESSMENT',
    state: estimated(),
    captureRef: `capture-${id}`,
    observedAt: observation.observedAt,
    sourceModifiedAt: observation.sourceModifiedAt,
    coverage: complete(),
    approval: {
      mode: 'ESTIMATED_OPINION',
      reason: 'APPROVED_CURRENT_EXACT_VERSION',
      approvalSubject: {
        sourceRecordId: observation.sourceRecordId,
        sourceVersion: version(),
      },
      before: { ...observation, observedAt: '2026-10-06T08:59:00Z' },
      after: { ...observation },
    },
    validity: { status: 'ACTIVE', assertionRef: `validity-${id}` },
    lane: {
      seriesRef: series,
      professionalScope: 'structures',
      assertionRef: `lane-${id}`,
    },
    opinionFields: [
      {
        index: 0,
        sourceSelector:
          '.attributePanel[oid] .attributePanel-label[评估意见] => .attributePanel-value',
        author: null,
      },
    ],
  };
}
const endpoint = (id: string) => ({
  kind: 'NATIVE_RECORD_REVISION' as const,
  sourceRevisionRef: id,
});
function mapping(a = 'a1', v = 'v2'): Mapping {
  return {
    scope: { ...scope },
    sourceRevisionRef: v,
    assessmentRevisionRef: a,
    path: [
      {
        assertionRef: `fp-${v}-${a}`,
        controlledKind: 'FILE_PROCESSING',
        nativeScope: { ...scope },
        scope: {
          kind: 'EXACT_SOURCE_VERSION_ASSESSMENT',
          sourceRevisionRef: v,
          assessmentRevisionRef: a,
        },
        from: endpoint(v),
        to: endpoint(`p-${a}`),
        authority: 'SOURCE_EXPLICIT',
        coverage: complete(),
      },
      {
        assertionRef: `pa-${v}-${a}`,
        controlledKind: 'PROCESSING_ASSESSMENT',
        nativeScope: { ...scope },
        scope: {
          kind: 'EXACT_SOURCE_VERSION_ASSESSMENT',
          sourceRevisionRef: v,
          assessmentRevisionRef: a,
        },
        from: endpoint(`p-${a}`),
        to: endpoint(a),
        authority: 'SOURCE_EXPLICIT',
        coverage: complete(),
      },
    ],
  };
}
function fixture(): Input {
  const s = source();
  s.assessmentCoverage[1]!.assessmentRevisionRefs = ['a1'];
  return {
    sources: [s],
    assessments: [assessment()],
    mappings: [mapping()],
    successors: [],
    contradictions: [],
  };
}
function add(input: Input, a: Assessment, v = 'v2'): void {
  input.assessments = [...input.assessments, a];
  input.mappings = [...input.mappings, mapping(a.sourceRevisionRef, v)];
  const c = input.sources[0]!.assessmentCoverage.find(
    (r) => r.sourceRevisionRef === v,
  )!;
  c.assessmentRevisionRefs = [...c.assessmentRevisionRefs, a.sourceRevisionRef];
}
function successor(input: Input, older: string, newer: string): void {
  input.successors = [
    ...input.successors,
    {
      scope: { ...scope },
      olderAssessmentRevisionRef: older,
      newerAssessmentRevisionRef: newer,
      assertionRef: `${older}-to-${newer}`,
      authority: 'SOURCE_EXPLICIT',
      coverage: complete(),
    },
  ];
}
function codes(input: Input) {
  return project(input).sources[0]!.gaps.map((g) => g.code);
}
function current(input: Input) {
  return project(input).sources[0]!.currentVersionApprovedRefs;
}
function opinionRef(a = 'a1', index = 0) {
  return ref({ scope, sourceRevisionRef: a, opinionIndex: index });
}
function noLocatorAccess(a: Assessment): jest.Mock {
  const touched = jest.fn(() => {
    throw new Error('OPINION LOCATOR TOUCHED BEFORE APPROVAL');
  });
  Object.defineProperty(a, 'opinionFields', { get: touched });
  return touched;
}
function unapprove(a: Assessment) {
  a.state = { rawCode: 'Estimating', rawName: 'Estimating' };
  a.approval = {
    mode: 'METADATA_ONLY',
    reason: 'STATE_NOT_ESTIMATED',
    approvalSubject: null,
    before: null,
    after: null,
  };
}
function objectObservation(a: Assessment) {
  a.sourceVersion = {
    rawRevision: null,
    rawIteration: null,
    confirmation: 'VERSION_UNCONFIRMED',
  };
  a.businessVersion = {
    rawRevision: 'R00',
    rawIteration: null,
    confirmation: 'SOURCE_DECLARED',
  };
  a.sourceModifiedAt = null;
  a.sourceModifiedRaw = '2026-10-01 00:00 CST';
  a.coverage = {
    status: 'PARTIAL',
    readback: 'NON_ATOMIC',
    gaps: ['TECHNICAL_VERSION_UNEXPOSED'],
  };
  a.opinionFields = a.opinionFields.map((field) => ({
    ...field,
    sourceSelector:
      'fieldset td.attributePanel-label[评估意见] + td.attributePanel-value',
  }));
  const p = a.approval!;
  p.reason = 'APPROVED_CURRENT_OBJECT_OBSERVATION';
  for (const value of [p.approvalSubject!, p.before!, p.after!]) {
    value.sourceVersion = { ...a.sourceVersion };
    value.businessVersion = { ...a.businessVersion };
  }
  for (const value of [p.before!, p.after!]) {
    value.sourceModifiedAt = null;
    value.sourceModifiedRaw = a.sourceModifiedRaw;
  }
}

describe('inactive deterministic approved TDMS opinion selector', () => {
  it('different ambiguous professional lanes remain separate competing sets', () => {
    const input = fixture();
    add(input, assessment('a2'));
    add(input, assessment('b1', 'other'));
    add(input, assessment('b2', 'other'));
    const groups = project(input).sources[0]!.competingApprovalSets;
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.opinionRefs.length)).toEqual([2, 2]);
    expect(new Set(groups.map((g) => g.seriesRef)).size).toBe(2);
  });

  it('one scoped immutable source revision cannot belong to two different files', () => {
    const input = fixture(),
      other = structuredClone(input.sources[0]!);
    other.recordRef = 'other-file';
    other.versions = other.versions.map((v) => ({
      ...v,
      recordRef: other.recordRef,
    }));
    input.sources = [...input.sources, other];
    expect(() => project(input)).toThrow(
      'TDMS_OPINION_SOURCE_VERSION_CONFLICT',
    );
  });

  it.each(['missing', 'contradictory', 'arbitrary', 'cross-scope'])(
    'mapping scope %s is a gap, never inferred applicability',
    (kind) => {
      const input = fixture(),
        r = input.mappings[0]!.path[0]!;
      if (kind === 'missing') r.scope = {};
      if (kind === 'contradictory') r.scope.sourceRevisionRef = 'v1';
      if (kind === 'arbitrary') r.scope.extra = 'not a finite verified scope';
      if (kind === 'cross-scope')
        r.nativeScope = { ...scope, sourceInstanceId: 'other' };
      expect(current(input)).toEqual([]);
      expect(codes(input)).toContain('MAPPING_UNCONFIRMED');
    },
  );
  it('a cycle in one independent professional series cannot block another series succession', () => {
    const input = fixture();
    add(input, assessment('a2'));
    add(input, assessment('b1', 'other'));
    add(input, assessment('b2', 'other'));
    successor(input, 'a1', 'a2');
    successor(input, 'b1', 'b2');
    successor(input, 'b2', 'b1');
    const s = project(input).sources[0]!;
    expect(s.currentVersionApprovedRefs).toEqual([
      opinionRef('a2'),
      opinionRef('b1'),
      opinionRef('b2'),
    ]);
    expect(s.supersededAssessmentRefs).toEqual([opinionRef('a1')]);
    expect(s.competingApprovalSets[0]!.opinionRefs).toEqual([
      opinionRef('b1'),
      opinionRef('b2'),
    ]);
  });
  it('canonically equivalent Unicode identifiers still have ordinal stable order', () => {
    const input = fixture();
    add(input, assessment('é', 'series-1'));
    add(input, assessment('e\u0301', 'series-2'));
    const before = JSON.stringify(project(input));
    input.mappings = [...input.mappings].reverse();
    input.assessments = [...input.assessments].reverse();
    expect(JSON.stringify(project(input))).toBe(before);
  });

  it('EXACT_VERSION_PAIR: retains the exact source/assessment/path and own approval metadata', () => {
    const result = project(fixture()),
      s = result.sources[0]!,
      o = result.opinions[0]!;
    expect(s.currentVersionApprovedRefs).toEqual([opinionRef()]);
    expect(s.mappings).toMatchObject([
      {
        sourceRevisionRef: 'v2',
        assessmentRevisionRef: 'a1',
        assertionRefs: ['fp-v2-a1', 'pa-v2-a1'],
      },
    ]);
    expect(s.latestnessAssertionRefs).toEqual(['latest-v2']);
    expect(s.validityNotices).toEqual([
      {
        assessmentRevisionRef: 'a1',
        status: 'ACTIVE',
        assertionRef: 'validity-a1',
      },
    ]);
    expect(o.approval).toEqual({
      captureRef: 'capture-a1',
      evidencePath: 'rawFields.opinionCollection',
      mode: 'EXACT_VERSION',
    });
    expect(o.assessment.sourceVersion).toEqual(version());
    expect(s.gaps).toEqual([]);
  });
  it('APPROVAL_BEFORE_BODY: metadata-only own assessment never touches even opinion locators', () => {
    const input = fixture(),
      a = input.assessments[0]!;
    unapprove(a);
    const touched = noLocatorAccess(a);
    const result = project(input);
    expect(touched).not.toHaveBeenCalled();
    expect(result.opinions).toEqual([]);
    expect(result.sources[0]!.unresolvedRefs).toEqual(['a1']);
    expect(codes(input)).toContain('ASSESSMENT_NOT_APPROVED');
  });
  it.each([
    [
      'own state',
      (a: Assessment) => {
        a.state = { rawCode: 'Estimating', rawName: 'Estimating' };
      },
    ],
    [
      'before state',
      (a: Assessment) => {
        a.approval!.before!.state = { rawCode: null, rawName: 'Estimating' };
      },
    ],
    [
      'after version',
      (a: Assessment) => {
        a.approval!.after!.sourceVersion = version('B');
      },
    ],
    [
      'after modification',
      (a: Assessment) => {
        a.approval!.after!.sourceModifiedAt = '2026-10-02T00:00:00Z';
      },
    ],
    [
      'reversed observation time',
      (a: Assessment) => {
        a.approval!.before!.observedAt = '2026-10-07T00:00:00Z';
      },
    ],
    [
      'invalid observation time',
      (a: Assessment) => {
        a.approval!.after!.observedAt = 'not-a-date';
      },
    ],
    [
      'wrong approval subject',
      (a: Assessment) => {
        a.approval!.approvalSubject!.sourceRecordId = 'file-native-id';
      },
    ],
    [
      'wrong detail binding',
      (a: Assessment) => {
        (a.approval!.before! as any).objectBinding = 'CATALOGUE';
      },
    ],
    [
      'no approval capture',
      (a: Assessment) => {
        a.approval = null;
      },
    ],
    [
      'technical version unknown',
      (a: Assessment) => {
        a.sourceVersion.confirmation = 'VERSION_UNCONFIRMED';
      },
    ],
  ])(
    'APPROVAL_RACE / NO_BORROWED_APPROVAL: %s fails closed before locators',
    (_name, mutate) => {
      const input = fixture(),
        a = input.assessments[0]!;
      mutate(a);
      const touched = noLocatorAccess(a);
      const result = project(input);
      expect(touched).not.toHaveBeenCalled();
      expect(result.opinions).toEqual([]);
      expect(codes(input)).toContain('APPROVAL_UNCONFIRMED');
      expect(codes(input)).not.toContain(
        'NO_APPROVED_OPINION_FOR_LATEST_SOURCE_VERSION',
      );
    },
  );
  it('OBJECT_OBSERVATION: is qualified, never exact-current or absence proof', () => {
    const input = fixture();
    objectObservation(input.assessments[0]!);
    const result = project(input),
      s = result.sources[0]!;
    expect(s.qualifiedObservationRefs).toEqual([opinionRef()]);
    expect(s.currentVersionApprovedRefs).toEqual([]);
    expect(result.opinions[0]!.approval.mode).toBe('OBJECT_OBSERVATION');
    expect(codes(input)).toContain('TECHNICAL_VERSION_UNEXPOSED');
    expect(codes(input)).not.toContain(
      'NO_APPROVED_OPINION_FOR_LATEST_SOURCE_VERSION',
    );
  });
  it('object observation without mandatory limits is not promoted or read', () => {
    const input = fixture(),
      a = input.assessments[0]!;
    objectObservation(a);
    a.coverage = complete();
    const touched = noLocatorAccess(a);
    expect(project(input).opinions).toEqual([]);
    expect(touched).not.toHaveBeenCalled();
  });
  it.each([
    [
      'REFERENCES only',
      (m: Mapping) => {
        m.path = [{ ...m.path[0]!, controlledKind: 'REFERENCES' }];
      },
    ],
    [
      'candidate-only',
      (m: Mapping) => {
        m.path[0]!.authority = 'CANDIDATE_ONLY';
      },
    ],
    [
      'wrong first source',
      (m: Mapping) => {
        m.path[0]!.from = endpoint('v1');
      },
    ],
    [
      'disconnected processing',
      (m: Mapping) => {
        m.path[1]!.from = endpoint('different-processing');
      },
    ],
    [
      'wrong assessment',
      (m: Mapping) => {
        m.path[1]!.to = endpoint('a2');
      },
    ],
    [
      'unresolved endpoint',
      (m: Mapping) => {
        m.path[0]!.from = {
          kind: 'UNRESOLVED',
          rawIdentity: 'similar title',
          versionGap: 'unversioned',
        };
      },
    ],
    [
      'partial path',
      (m: Mapping) => {
        m.path[1]!.coverage.status = 'PARTIAL';
      },
    ],
    [
      'non-atomic path',
      (m: Mapping) => {
        m.path[1]!.coverage.readback = 'NON_ATOMIC';
      },
    ],
  ])(
    'UNRESOLVED_MAPPING: %s cannot establish current applicability',
    (_name, mutate) => {
      const input = fixture();
      mutate(input.mappings[0]!);
      expect(current(input)).toEqual([]);
      expect(codes(input)).toContain('MAPPING_UNCONFIRMED');
      expect(codes(input)).not.toContain(
        'NO_APPROVED_OPINION_FOR_LATEST_SOURCE_VERSION',
      );
    },
  );
  it('missing exact mapping for an authorized roster member remains an explicit gap', () => {
    const input = fixture();
    input.mappings = [];
    const s = project(input).sources[0]!;
    expect(s.unresolvedRefs).toEqual(['a1']);
    expect(codes(input)).toContain('MAPPING_UNCONFIRMED');
    expect(codes(input)).not.toContain(
      'NO_APPROVED_OPINION_FOR_LATEST_SOURCE_VERSION',
    );
  });
  it('missing or unauthorized roster member emits no protected identity or count', () => {
    const input = fixture();
    input.assessments = [];
    input.mappings = [];
    const output = JSON.stringify(project(input));
    expect(output).not.toContain('a1');
    expect(output).not.toContain('file-native-id');
    expect(codes(input)).toContain('COVERAGE_INCOMPLETE');
    expect(codes(input)).not.toContain(
      'NO_APPROVED_OPINION_FOR_LATEST_SOURCE_VERSION',
    );
  });
  it('LATEST_DOCUMENT_GAP: older approved opinion cannot cover latest source version', () => {
    const input = fixture();
    input.mappings = [mapping('a1', 'v1')];
    input.sources[0]!.assessmentCoverage[0]!.assessmentRevisionRefs = ['a1'];
    input.sources[0]!.assessmentCoverage[1]!.assessmentRevisionRefs = [];
    const s = project(input).sources[0]!;
    expect(s.historicalSourceApprovedRefs).toEqual([opinionRef()]);
    expect(s.currentVersionApprovedRefs).toEqual([]);
    expect(codes(input)).toContain(
      'NO_APPROVED_OPINION_FOR_LATEST_SOURCE_VERSION',
    );
  });
  it.each(['PARTIAL', 'UNKNOWN'] as const)(
    'PARTIAL_DISCOVERY: %s roster does not prove no approved opinions',
    (status) => {
      const input = fixture();
      input.assessments = [];
      input.mappings = [];
      input.sources[0]!.assessmentCoverage[1]!.assessmentRevisionRefs = [];
      input.sources[0]!.assessmentCoverage[1]!.coverage.status = status;
      expect(
        project(input).sources[0]!.coverage.find(
          (c) => c.sourceRevisionRef === 'v2',
        )!.status,
      ).toBe(status);
      expect(codes(input)).toContain('COVERAGE_INCOMPLETE');
      expect(codes(input)).not.toContain(
        'NO_APPROVED_OPINION_FOR_LATEST_SOURCE_VERSION',
      );
    },
  );
  it('HEAD_NOT_LATEST: selectedHead and capture/read timestamps cannot supply latestness', () => {
    const input = fixture();
    input.sources[0]!.latestness = [];
    Object.assign(input.sources[0]!.versions[1]!, {
      selectedHead: true,
      capturedAt: '2099-01-01',
      readAt: '2099-01-01',
    });
    expect(current(input)).toEqual([]);
    expect(codes(input)).toContain('SOURCE_CURRENTNESS_UNKNOWN');
    expect(project(input).sources[0]!.unresolvedRefs).toEqual(['a1']);
  });
  it('conflicting official latest facts retain conflict and suppress current selection', () => {
    const input = fixture(),
      s = input.sources[0]!;
    s.latestness = [
      ...s.latestness,
      {
        ...s.latestness[0]!,
        assertionRef: 'latest-v1',
        sourceRevisionRef: 'v1',
      },
    ];
    expect(current(input)).toEqual([]);
    expect(codes(input)).toContain('SOURCE_CURRENTNESS_CONFLICT');
  });
  it('an incomplete or unavailable latest version fact is not silently discarded', () => {
    const input = fixture(),
      s = input.sources[0]!;
    s.latestness = [
      ...s.latestness,
      {
        ...s.latestness[0]!,
        assertionRef: 'missing-v3',
        sourceRevisionRef: 'v3',
      },
    ];
    expect(current(input)).toEqual([]);
    expect(codes(input)).toContain('SOURCE_CURRENTNESS_UNKNOWN');
  });
  it('unconfirmed technical source version cannot become an exact pair', () => {
    const input = fixture();
    input.sources[0]!.versions[1]!.sourceVersion.confirmation =
      'VERSION_UNCONFIRMED';
    expect(current(input)).toEqual([]);
    expect(codes(input)).toContain('SOURCE_VERSION_UNCONFIRMED');
  });
  it('PROFESSIONAL_MULTIPLICITY: retains independent professional approvals', () => {
    const input = fixture(),
      a = assessment('a2', 'series-avionics');
    a.lane!.professionalScope = 'avionics';
    add(input, a);
    expect(current(input)).toEqual([opinionRef('a1'), opinionRef('a2')]);
    expect(codes(input)).not.toContain('ASSESSMENT_ORDER_UNCONFIRMED');
  });
  it('AMBIGUOUS_LANES: unknown or competing lanes retain all opinions with explicit ordering gaps', () => {
    const input = fixture();
    input.assessments[0]!.lane = null;
    const a = assessment('a2');
    a.lane = null;
    add(input, a);
    expect(current(input)).toEqual([opinionRef('a1'), opinionRef('a2')]);
    expect(codes(input)).toContain('ASSESSMENT_ORDER_UNCONFIRMED');
    expect(
      project(input).sources[0]!.competingApprovalSets[0]!.opinionRefs,
    ).toHaveLength(2);
  });
  it('same-series timestamps do not elect a winner without explicit succession', () => {
    const input = fixture();
    add(input, assessment('a2'));
    Object.assign(input.assessments[1]!, { capturedAt: '2099-01-01' });
    expect(current(input)).toHaveLength(2);
    expect(codes(input)).toContain('ASSESSMENT_ORDER_UNCONFIRMED');
  });
  it('ASSESSMENT_SUCCESSOR: explicit same-series newer approval keeps older exact ref as superseded', () => {
    const input = fixture();
    add(input, assessment('a2'));
    successor(input, 'a1', 'a2');
    const s = project(input).sources[0]!;
    expect(s.currentVersionApprovedRefs).toEqual([opinionRef('a2')]);
    expect(s.supersededAssessmentRefs).toEqual([opinionRef('a1')]);
    expect(s.successionAssertionRefs).toEqual(['a1-to-a2']);
    expect(project(input).opinions).toHaveLength(2);
  });
  it('NEW_UNAPPROVED_REVISION: older approved retained, pending metadata notice, no new locators', () => {
    const input = fixture(),
      a = assessment('a2');
    unapprove(a);
    add(input, a);
    successor(input, 'a1', 'a2');
    const touched = noLocatorAccess(a);
    expect(current(input)).toEqual([opinionRef('a1')]);
    expect(codes(input)).toContain('NEWER_ASSESSMENT_NOT_APPROVED');
    expect(touched).not.toHaveBeenCalled();
  });
  it('transitive explicit revision ordering can pass through an unapproved revision', () => {
    const input = fixture(),
      a = assessment('a2');
    unapprove(a);
    add(input, a);
    add(input, assessment('a3'));
    successor(input, 'a1', 'a2');
    successor(input, 'a2', 'a3');
    expect(current(input)).toEqual([opinionRef('a3')]);
  });
  it('cross-professional succession cannot remove another professional approval', () => {
    const input = fixture();
    add(input, assessment('a2', 'different-series'));
    successor(input, 'a1', 'a2');
    expect(current(input)).toHaveLength(2);
    expect(codes(input)).toContain('ASSESSMENT_ORDER_UNCONFIRMED');
  });
  it('succession cycles preserve candidates and report conflict instead of erasing all', () => {
    const input = fixture();
    add(input, assessment('a2'));
    successor(input, 'a1', 'a2');
    successor(input, 'a2', 'a1');
    expect(current(input)).toHaveLength(2);
    expect(codes(input)).toContain('ASSESSMENT_SUCCESSION_CONFLICT');
  });
  it('cross-source-version revision ordering does not erase historical version-specific opinions', () => {
    const input = fixture();
    add(input, assessment('a2'), 'v1');
    successor(input, 'a2', 'a1');
    const s = project(input).sources[0]!;
    expect(s.currentVersionApprovedRefs).toEqual([opinionRef('a1')]);
    expect(s.historicalSourceApprovedRefs).toEqual([opinionRef('a2')]);
  });
  it('APPROVAL_REVOKED: retain historical approval fact, never current active reference', () => {
    const input = fixture();
    input.assessments[0]!.validity = {
      status: 'REVOKED',
      assertionRef: 'withdrawal',
    };
    const s = project(input).sources[0]!;
    expect(s.currentVersionApprovedRefs).toEqual([]);
    expect(s.revokedOpinionRefs).toEqual([opinionRef()]);
    expect(codes(input)).toContain('APPROVAL_REVOKED');
    expect(s.validityNotices[0]!.assertionRef).toBe('withdrawal');
  });
  it('unknown approval validity remains unresolved even with Estimated capture', () => {
    const input = fixture();
    input.assessments[0]!.validity = { status: 'UNKNOWN', assertionRef: null };
    expect(current(input)).toEqual([]);
    expect(codes(input)).toContain('APPROVAL_VALIDITY_UNKNOWN');
    expect(codes(input)).not.toContain(
      'NO_APPROVED_OPINION_FOR_LATEST_SOURCE_VERSION',
    );
  });
  it('SCOPE_COLLISION: same native revision IDs in two instances remain distinct', () => {
    const a = fixture(),
      b = fixture();
    for (const entry of [...b.sources, ...b.assessments, ...b.mappings])
      entry.scope = { ...scope, sourceInstanceId: 'instance-2' };
    for (const m of b.mappings)
      for (const r of m.path)
        r.nativeScope = { ...scope, sourceInstanceId: 'instance-2' };
    const output = project({
      ...a,
      sources: [...a.sources, ...b.sources],
      assessments: [...a.assessments, ...b.assessments],
      mappings: [...a.mappings, ...b.mappings],
    });
    expect(output.sources).toHaveLength(2);
    expect(output.opinions).toHaveLength(2);
    expect(new Set(output.opinions.map((o) => o.evidenceRef)).size).toBe(2);
  });
  it('STABLE_BODY_REF / FRESH_RECEIPT_SEPARATION: ref excludes actors, task and time', () => {
    const input = fixture();
    const before = project(input);
    Object.assign(input.assessments[0]!, {
      actor: 'reader-B',
      taskContextRef: 'new-task',
      readAt: '2099-01-01',
      receiptRef: 'new-read',
    });
    expect(project(input)).toEqual(before);
    expect(ref({ scope, sourceRevisionRef: 'a1', opinionIndex: 0 })).toBe(
      opinionRef(),
    );
  });
  it('reference escaping avoids delimiter collisions and preserves Unicode identity', () => {
    expect(
      ref({
        scope: { ...scope, scopeId: 'x:y' },
        sourceRevisionRef: 'z',
        opinionIndex: 0,
      }),
    ).not.toBe(
      ref({
        scope: { ...scope, scopeId: 'x' },
        sourceRevisionRef: 'y:z',
        opinionIndex: 0,
      }),
    );
    expect(
      ref({ scope, sourceRevisionRef: '评估:版本/%', opinionIndex: 0 }),
    ).toContain(encodeURIComponent('评估:版本/%'));
  });
  it('BODY_MISMATCH boundary: same immutable opinion index with altered locator fails closed', () => {
    const input = fixture();
    input.assessments[0]!.opinionFields = [
      { index: 0, sourceSelector: 'first', author: null },
      { index: 0, sourceSelector: 'altered', author: null },
    ];
    expect(() => project(input)).toThrow('TDMS_OPINION_LOCATOR_CONFLICT');
  });
  it('duplicate exact opinion locators deduplicate while distinct field indices coexist', () => {
    const input = fixture(),
      field = input.assessments[0]!.opinionFields[0]!;
    input.assessments[0]!.opinionFields = [
      field,
      { ...field },
      { ...field, index: 1 },
    ];
    expect(project(input).opinions).toHaveLength(2);
    expect(current(input)).toHaveLength(2);
  });
  it('DIRECTORY_IS_NOT_BODY / NO_EXECUTION_INFERENCE: projection never delivers or adopts evidence', () => {
    const input = fixture();
    Object.defineProperty(input.assessments[0]!, 'content', {
      get() {
        throw new Error('body access');
      },
    });
    Object.assign(input.assessments[0]!.opinionFields[0]!, {
      text: 'SECRET_BODY',
      conditions: ['SECRET_CONDITION'],
      requiredActions: ['SECRET_ACTION'],
    });
    const output = project(input);
    expect(output.readPerformed).toBe(false);
    expect(output.opinions[0]).toMatchObject({
      readPerformed: false,
      engineeringAdoption: 'NOT_CREATED',
      executionVerified: false,
    });
    expect(JSON.stringify(output)).not.toMatch(
      /SECRET_BODY|SECRET_CONDITION|SECRET_ACTION|readAt|receiptRef/,
    );
  });
  it('APPROVED_BUT_CONTRADICTED: explicit contrary source preserved without electing truth', () => {
    const input = fixture();
    input.contradictions = [
      {
        scope,
        assertionRef: 'conflict-1',
        opinion: { scope, sourceRevisionRef: 'a1', opinionIndex: 0 },
        against: {
          kind: 'SOURCE_EVIDENCE',
          evidenceRef: 'EXACT_SOURCE:v2:section-4',
        },
      },
    ];
    const output = project(input);
    expect(current(input)).toEqual([opinionRef()]);
    expect(output.contradictions).toEqual([
      {
        assertionRef: 'conflict-1',
        opinionRef: opinionRef(),
        againstRef: 'EXACT_SOURCE:v2:section-4',
      },
    ]);
    expect(output.interpretation).toBe(
      'APPROVED_PROFESSIONAL_JUDGMENT_NOT_INFALLIBLE',
    );
    expect(codes(input)).toContain('CONTRADICTION_UNRESOLVED');
  });
  it('conflicting professional opinions coexist with an explicit conflict ref', () => {
    const input = fixture();
    add(input, assessment('a2', 'another-series'));
    input.contradictions = [
      {
        scope,
        assertionRef: 'conflict-opinions',
        opinion: { scope, sourceRevisionRef: 'a1', opinionIndex: 0 },
        against: {
          kind: 'OPINION',
          opinion: { scope, sourceRevisionRef: 'a2', opinionIndex: 0 },
        },
      },
    ];
    expect(current(input)).toHaveLength(2);
    expect(project(input).contradictions[0]!.againstRef).toBe(opinionRef('a2'));
  });
  it('contradiction refs cannot expose absent or cross-scope opinions', () => {
    const input = fixture();
    input.contradictions = [
      {
        scope,
        assertionRef: 'hidden-conflict',
        opinion: { scope, sourceRevisionRef: 'a1', opinionIndex: 0 },
        against: {
          kind: 'OPINION',
          opinion: {
            scope: { ...scope, tenantId: 'hidden' },
            sourceRevisionRef: 'hidden-assessment',
            opinionIndex: 0,
          },
        },
      },
    ];
    expect(project(input).contradictions).toEqual([]);
    expect(JSON.stringify(project(input))).not.toContain('hidden');
  });
  it('empty approved opinion field directory is a gap, not negative coverage proof', () => {
    const input = fixture();
    input.assessments[0]!.opinionFields = [];
    expect(codes(input)).toContain('OPINION_FIELDS_UNAVAILABLE');
    expect(codes(input)).not.toContain(
      'NO_APPROVED_OPINION_FOR_LATEST_SOURCE_VERSION',
    );
  });
  it('conflicting roster facts cannot prove absence', () => {
    const input = fixture();
    input.sources[0]!.assessmentCoverage = [
      ...input.sources[0]!.assessmentCoverage,
      {
        sourceRevisionRef: 'v2',
        assertionRef: 'conflicting-roster',
        assessmentRevisionRefs: [],
        coverage: complete(),
      },
    ];
    expect(codes(input)).toContain('COVERAGE_INCOMPLETE');
  });
  it('invalid source identity and duplicate assessment fail closed instead of last-write wins', () => {
    const input = fixture();
    input.sources[0]!.versions[0]!.recordRef = 'different-file';
    expect(() => project(input)).toThrow(
      'TDMS_OPINION_SOURCE_IDENTITY_MISMATCH',
    );
    const duplicate = fixture();
    duplicate.assessments = [...duplicate.assessments, assessment()];
    expect(() => project(duplicate)).toThrow(
      'TDMS_OPINION_DUPLICATE_ASSESSMENT',
    );
  });
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    'invalid opinion index %s is rejected',
    (opinionIndex) => {
      expect(() =>
        ref({ scope, sourceRevisionRef: 'a1', opinionIndex }),
      ).toThrow('TDMS_OPINION_LOCATOR_INVALID');
    },
  );
  it('NO_READ_TIME_MODELS: pure inputs, deterministic repeated result, immutable output copies', () => {
    const input = fixture();
    const before = JSON.stringify(input);
    const freeze = (value: any) => {
      if (value && typeof value === 'object') {
        Object.freeze(value);
        Object.values(value).forEach(freeze);
      }
    };
    freeze(input);
    const output = project(input);
    expect(project(input)).toEqual(output);
    expect(JSON.stringify(input)).toBe(before);
    output.opinions[0]!.assessment.sourceVersion.rawRevision = 'changed';
    expect(input.assessments[0]!.sourceVersion.rawRevision).toBe('A');
  });
  it('adversarial permutation of every unordered input collection is byte-stable', () => {
    const input = fixture();
    add(input, assessment('a2'));
    add(input, assessment('a3', 'series-other'));
    add(input, assessment('a4'), 'v1');
    successor(input, 'a1', 'a2');
    input.assessments[1]!.opinionFields = [
      { index: 1, sourceSelector: '.second', author: null },
      { index: 0, sourceSelector: '.first', author: null },
    ];
    const expected = JSON.stringify(project(input));
    for (let seed = 1; seed <= 32; seed++) {
      let n = seed;
      const shuffle = <T>(arr: readonly T[]) =>
        [...arr].sort(() => {
          n = (n * 1664525 + 1013904223) >>> 0;
          return (n % 3) - 1;
        });
      const x = structuredClone(input);
      x.assessments = shuffle(x.assessments);
      x.mappings = shuffle(x.mappings);
      x.successors = shuffle(x.successors);
      x.sources = shuffle(x.sources);
      for (const s of x.sources) {
        s.versions = shuffle(s.versions);
        s.latestness = shuffle(s.latestness);
        s.assessmentCoverage = shuffle(s.assessmentCoverage);
        for (const c of s.assessmentCoverage)
          c.assessmentRevisionRefs = shuffle(c.assessmentRevisionRefs);
      }
      for (const a of x.assessments) a.opinionFields = shuffle(a.opinionFields);
      expect(JSON.stringify(project(x))).toBe(expected);
    }
  });
});
