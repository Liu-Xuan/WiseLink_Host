import { UnconfiguredTdmsRuntimeReader } from '@server/modules/tdms-source/tdms-runtime-reader.port';

test('unconfigured runtime exposes every capability and denies metadata discovery', async () => {
  const reader = new UnconfiguredTdmsRuntimeReader();
  const methods = reader as unknown as Record<
    string,
    (...args: unknown[]) => Promise<unknown>
  >;
  for (const method of [
    'discover',
    'assertAuthorized',
    'read',
    'verifyEvidence',
  ]) {
    expect(typeof methods[method]).toBe('function');
    await expect(methods[method]!()).rejects.toMatchObject({
      code: 'TDMS_RUNTIME_CALLER_AUTHORIZATION_NOT_CONNECTED',
    });
  }
});

import { HostTdmsRuntimeReader } from '@server/modules/tdms-source/tdms-runtime-reader.adapter';
import { assertTdmsRuntimeTaskContext } from '@server/modules/tdms-source/tdms-runtime-reader.port';
import { tdmsRuntimeFixture } from '../fixtures/tdms-runtime.fixture';

async function discovered() {
  const f = tdmsRuntimeFixture();
  const context = await f.adapter.discover(f.principal, f.binding);
  return { ...f, context };
}
async function read(
  f: Awaited<ReturnType<typeof discovered>>,
  evidenceRefs = f.context.projection.selectedSetApprovedRefs,
) {
  return f.adapter.read(f.principal, {
    context: f.context,
    evidenceRefs,
    purpose: 'JOB_AID_NATIVE_RECORD',
    taskContextRef: f.binding.taskContextRef,
  });
}

test('real processing-set service feeds metadata directory with all parallel siblings and multi-engineer ATA provenance, no body or receipt', async () => {
  const f = await discovered();
  expect(f.context.projection.selectedSetApprovedRefs).toHaveLength(2);
  expect(
    f.context.projection.cohorts[0]!.members.map((member) => member.memberRef),
  ).toEqual(['member-a', 'member-b']);
  expect(f.context.projection.cohorts[0]!.members[0]).toMatchObject({
    contributorRefs: ['engineer-1', 'engineer-2'],
    ataScopes: ['ATA 27', 'ATA 31'],
    responsibilityRefs: ['responsible-27', 'responsible-31'],
  });
  expect(f.control.bodyReads).toBe(0);
  expect(f.receipts).toEqual([]);
  expect(JSON.stringify(f.context)).not.toContain('Unique complete opinion');
  await f.adapter.assertAuthorized(f.principal, f.context);
  expect(f.control.bodyReads).toBe(0);
});

test('explicit READ returns each full approved opinion exactly once with distinct current task-bound persisted receipts', async () => {
  const f = await discovered();
  const result = await read(f, [
    ...f.context.projection.selectedSetApprovedRefs,
    ...f.context.projection.selectedSetApprovedRefs,
  ]);
  expect(result.evidence).toHaveLength(2);
  expect(result.receipts).toHaveLength(2);
  expect(f.receipts).toHaveLength(2);
  const first = JSON.parse(result.evidence[0]!.excerpt) as {
    text: string;
    conditions: string[];
    requiredActions: string[];
  };
  expect(first).toEqual(
    expect.objectContaining({
      text: 'Unique complete opinion a',
      conditions: ['Only if installed a'],
      requiredActions: ['Verify configuration a'],
    }),
  );
  expect(JSON.stringify(result)).toContain('JOB_AID_NATIVE_RECORD');
  expect(result.evidence[0]!.nativeScope?.processingSetBinding).toMatchObject({
    setRevisionRef: f.set.setRevisionRef,
    generation: 1,
    memberRef: 'member-a',
    assessmentObservationRef: 'a',
  });
  expect(result.receipts[0]!.permissionRevision.length).toBeGreaterThan(255);
  await f.adapter.verifyEvidence(f.principal, result.evidence);
  expect(f.receipts).toHaveLength(2); // verification is not a fresh semantic READ
  const second = await read(f, [
    f.context.projection.selectedSetApprovedRefs[0]!,
  ]);
  expect(second.evidence[0]!.excerpt).toBe(result.evidence[0]!.excerpt);
  expect(second.receipts[0]!.receiptRef).not.toBe(
    result.receipts[0]!.receiptRef,
  );
});

test('unconfigured optional authority denies all runtime operations without loading source or body', async () => {
  const f = await discovered();
  const reader = new HostTdmsRuntimeReader(
    f.sets,
    f.repository,
    f.authorization,
    f.documents,
  );
  for (const operation of [
    () => reader.discover(f.principal, f.binding),
    () => reader.assertAuthorized(f.principal, f.context),
    () =>
      reader.read(f.principal, {
        context: f.context,
        evidenceRefs: f.context.projection.selectedSetApprovedRefs,
        taskContextRef: f.binding.taskContextRef,
        purpose: 'JOB_AID_NATIVE_RECORD',
      }),
    () => reader.verifyEvidence(f.principal, []),
  ]) {
    await expect(operation()).rejects.toMatchObject({
      code: 'TDMS_RUNTIME_CALLER_AUTHORIZATION_NOT_CONNECTED',
    });
  }
  expect(f.control.bodyReads).toBe(0);
  expect(f.receipts).toEqual([]);
});

test.each([
  'applicationAllowed',
  'sourceAllowed',
  'objectAllowed',
  'documentAllowed',
] as const)(
  'current %s decision is mandatory for discovery and READ',
  async (key) => {
    const f = await discovered();
    f.control[key] = false;
    await expect(f.adapter.discover(f.principal, f.binding)).rejects.toThrow();
    await expect(read(f)).rejects.toThrow();
    expect(f.control.bodyReads).toBe(0);
    expect(f.receipts).toEqual([]);
  },
);

test('actual principal, delegated owner and independent lease authentication are required', async () => {
  const f = await discovered();
  await expect(
    f.adapter.discover(undefined as never, f.binding),
  ).rejects.toThrow('TDMS_RUNTIME_PRINCIPAL_BINDING_MISMATCH');
  await expect(
    f.adapter.discover(
      { ...f.principal, actorUserId: 'another-user' },
      f.binding,
    ),
  ).rejects.toThrow('TDMS_RUNTIME_PRINCIPAL_BINDING_MISMATCH');
  delete f.principal.scope.automaticWorkItemLease;
  await expect(read(f)).rejects.toThrow('FIXTURE_AUTHENTICATION_REQUIRED');
  expect(f.control.bodyReads).toBe(0);
});

function metadataOnly(
  f: ReturnType<typeof tdmsRuntimeFixture>,
  stateValue: { rawCode: string; rawName: string } | null,
) {
  f.set.approvalReadiness = 'PENDING';
  f.set.approvedBodyCaptureCoverage = 'PARTIAL';
  const assessment = f.facts.assessments[0]!;
  const raw = {
    schemaVersion: 'wiselink.tdms-opinion-collection.v1',
    mode: 'METADATA_ONLY',
    reason: stateValue ? 'STATE_NOT_ESTIMATED' : 'CURRENT_STATE_UNVERIFIED',
    approvalSubject: null,
    before: null,
    after: null,
  };
  f.revisions.get('a')!.record.state = stateValue;
  f.revisions.get('a')!.record.rawFields.opinionCollection = raw;
  assessment.state = stateValue;
  assessment.approval = {
    mode: 'METADATA_ONLY',
    reason: raw.reason,
    approvalSubject: null,
    before: null,
    after: null,
  };
  Object.defineProperty(assessment, 'opinionFields', {
    get() {
      throw new Error('UNAPPROVED_FIELDS_TOUCHED');
    },
  });
}
test.each([{ rawCode: 'Estimating', rawName: 'Estimating' }, null])(
  'unapproved own state %j never touches opinion fields or body despite Estimated parent',
  async (stateValue) => {
    const f = tdmsRuntimeFixture();
    metadataOnly(f, stateValue);
    const context = await f.adapter.discover(f.principal, f.binding);
    expect(context.projection.selectedSetApprovedRefs).toHaveLength(1);
    expect(context.projection.cohorts[0]!.members[0]!.opinionRefs).toEqual([]);
    expect(context.projection.cohorts[0]!.members[0]!.status).toBe(
      stateValue ? 'METADATA_ONLY' : 'UNKNOWN',
    );
    expect(f.control.bodyReads).toBe(0);
    const full = await discovered();
    await expect(
      f.adapter.read(f.principal, {
        context,
        evidenceRefs: [full.context.projection.selectedSetApprovedRefs[0]!],
        taskContextRef: f.binding.taskContextRef,
        purpose: 'JOB_AID_NATIVE_RECORD',
      }),
    ).rejects.toThrow('TDMS_RUNTIME_OPINION_NOT_APPROVED');
    expect(f.control.bodyReads).toBe(0);
  },
);

test.each(['before', 'after'] as const)(
  'own %s approval mismatch cannot be replaced by parent approval',
  async (side) => {
    const f = tdmsRuntimeFixture();
    const raw = f.revisions.get('a')!.record.rawFields.opinionCollection as {
      before: { state: unknown };
      after: { state: unknown };
    };
    raw[side].state = { rawCode: 'Estimating', rawName: 'Estimating' };
    f.facts.assessments[0]!.approval![side]!.state = {
      rawCode: 'Estimating',
      rawName: 'Estimating',
    };
    Object.defineProperty(f.facts.assessments[0]!, 'opinionFields', {
      get() {
        throw new Error('UNAPPROVED_FIELDS_TOUCHED');
      },
    });
    const context = await f.adapter.discover(f.principal, f.binding);
    expect(context.projection.selectedSetApprovedRefs).toHaveLength(1);
    expect(context.projection.cohorts[0]!.members[0]!.status).toBe('UNKNOWN');
    expect(f.control.bodyReads).toBe(0);
  },
);

test.each(['REVOKED', 'UNKNOWN'] as const)(
  'validity %s retains scoped metadata but forbids native body READ',
  async (status) => {
    const f = tdmsRuntimeFixture();
    f.facts.assessments[0]!.validity.status = status;
    const context = await f.adapter.discover(f.principal, f.binding);
    const ref = context.projection.cohorts[0]!.members[0]!.opinionRefs[0]!;
    expect(ref).toBeTruthy();
    expect(context.projection.selectedSetApprovedRefs).not.toContain(ref);
    await expect(read({ ...f, context }, [ref])).rejects.toThrow(
      'TDMS_RUNTIME_OPINION_NOT_APPROVED',
    );
    expect(f.control.bodyReads).toBe(0);
  },
);

test('new partial cohort keeps missing sibling gap and never fills from retained older cohort', async () => {
  const f = await discovered(),
    old = structuredClone(f.set),
    oldRef = f.context.projection.cohorts[0]!.members[1]!.opinionRefs[0]!;
  old.setRevisionRef = 'old-set';
  old.cohortRef = 'old-cohort';
  old.currentness = 'HISTORICAL';
  f.retainedSets.set(old.setRevisionRef, old);
  const missing = f.set.members[1]!;
  missing.assessmentObservationRef = null;
  missing.membershipResolution = 'UNRESOLVED';
  missing.processingAssessmentAssertionRefs = [];
  missing.gaps = ['NOT_ACQUIRED'];
  f.set.membershipCoverage = 'PARTIAL';
  f.set.versionMappingCoverage = 'PARTIAL';
  f.set.approvedBodyCaptureCoverage = 'PARTIAL';
  f.set.approvalReadiness = 'UNKNOWN';
  f.facts.assessments = f.facts.assessments.filter(
    (value) => value.sourceRevisionRef !== 'b',
  );
  f.facts.mappings = f.facts.mappings.filter(
    (value) => value.assessmentRevisionRef !== 'b',
  );
  const context = await f.adapter.discover(f.principal, f.binding);
  expect(context.projection.cohorts).toHaveLength(1);
  expect(context.projection.cohorts[0]!.members).toHaveLength(2);
  expect(context.projection.cohorts[0]!.members[1]).toMatchObject({
    assessmentObservationRef: null,
    opinionRefs: [],
    status: 'UNKNOWN',
  });
  expect(context.projection.selectedSetApprovedRefs).toHaveLength(1);
  await expect(read({ ...f, context }, [oldRef])).rejects.toThrow(
    'TDMS_RUNTIME_OPINION_NOT_APPROVED',
  );
  expect(f.control.bodyReads).toBe(0);
});

test('stale selected generation, foreign tenant/context and tampered metadata are rejected before body access', async () => {
  const f = await discovered();
  f.head.generation++;
  await expect(read(f)).rejects.toThrow('TDMS_RUNTIME_CONTEXT_CHANGED');
  f.head.generation--;
  const foreign = structuredClone(f.context);
  foreign.binding.tenantId = 'foreign';
  expect(() => assertTdmsRuntimeTaskContext(foreign)).toThrow();
  const poisoned = structuredClone(f.context);
  (poisoned.projection.opinions[0] as unknown as Record<string, unknown>).body =
    'unapproved text';
  expect(() => assertTdmsRuntimeTaskContext(poisoned)).toThrow();
  const stolen = structuredClone(f.context);
  stolen.binding.actorUserId = 'foreign';
  await expect(f.adapter.assertAuthorized(f.principal, stolen)).rejects.toThrow(
    'TDMS_RUNTIME_PRINCIPAL_BINDING_MISMATCH',
  );
  expect(f.control.bodyReads).toBe(0);
});

test('source-to-task and exact assertion/member mapping substitution is denied', async () => {
  const f = tdmsRuntimeFixture();
  f.authority.resolveSelections = async () => [
    {
      scope: f.scope,
      processingFamilyRef: 'family',
      sourceRevisionRefs: ['foreign-source'],
    },
  ];
  await expect(f.adapter.discover(f.principal, f.binding)).rejects.toThrow(
    'TDMS_RUNTIME_SOURCE_BINDING_MISMATCH',
  );
  const other = tdmsRuntimeFixture();
  other.facts.mappings[0]!.path[1]!.scope = {
    kind: 'EXACT_SOURCE_VERSION_ASSESSMENT',
    sourceRevisionRef: 'source',
    assessmentRevisionRef: 'b',
  };
  await expect(
    other.adapter.discover(other.principal, other.binding),
  ).rejects.toThrow('TDMS_RUNTIME_MAPPING_MISMATCH');
  expect(f.control.bodyReads + other.control.bodyReads).toBe(0);
});

test('provider cannot replace retained own approval or selected record identity', async () => {
  const f = tdmsRuntimeFixture();
  f.facts.assessments[0]!.approval!.before!.sourceRecordId =
    'another-assessment';
  await expect(f.adapter.discover(f.principal, f.binding)).rejects.toThrow(
    'TDMS_RUNTIME_APPROVAL_SUBSTITUTED',
  );
  const other = tdmsRuntimeFixture();
  other.revisions.get('a')!.scope.scopeId = 'foreign';
  await expect(
    other.adapter.discover(other.principal, other.binding),
  ).rejects.toThrow('TDMS_SET_REFERENCE_INVALID');
  expect(f.control.bodyReads + other.control.bodyReads).toBe(0);
});

test('authorization revoked during an awaited roster lookup never reaches body', async () => {
  const f = await discovered();
  f.control.onRevision = async (ref) => {
    if (ref === 'a') f.control.sourceAllowed = false;
  };
  await expect(read(f)).rejects.toThrow();
  expect(f.control.bodyReads).toBe(0);
  expect(f.receipts).toEqual([]);
});

test.each(['revoked', 'revision-changed', 'set-advanced'] as const)(
  'late %s after receipt write denies return and rolls back receipt transaction',
  async (mutation) => {
    const f = await discovered();
    f.control.onReceipt = async () => {
      if (mutation === 'revoked') f.control.applicationAllowed = false;
      else if (mutation === 'revision-changed')
        f.control.permissionRevision = '2';
      else f.head.generation++;
    };
    await expect(read(f)).rejects.toThrow();
    expect(f.receipts).toEqual([]);
  },
);

test('stored opinion substitution during awaited receipt write cannot escape in response', async () => {
  const f = await discovered();
  f.control.onReceipt = async () => {
    f.bodies.get('a')!.opinions![0]!.text = 'substituted after read';
  };
  await expect(read(f)).rejects.toThrow('TDMS_RUNTIME_BODY_SUBSTITUTED');
});

test('saved evidence verification rejects substituted body, member, task and invented receipt without minting READs', async () => {
  const f = await discovered();
  const result = await read(f);
  const original = result.evidence[0]!;
  const bodies = [
    { ...original, excerpt: 'forged text' },
    {
      ...original,
      nativeReadReceipt: {
        ...original.nativeReadReceipt,
        taskContextRef: 'foreign-task',
      },
    },
    {
      ...original,
      nativeReadReceipt: {
        ...original.nativeReadReceipt,
        receiptRef: 'invented-receipt',
      },
    },
  ];
  const member = structuredClone(original);
  member.nativeScope!.processingSetBinding!.memberRef = 'member-b';
  bodies.push(member);
  for (const evidence of bodies)
    await expect(
      f.adapter.verifyEvidence(f.principal, [evidence]),
    ).rejects.toThrow();
  expect(f.receipts).toHaveLength(2);
  f.control.sourceAllowed = false;
  await expect(
    f.adapter.verifyEvidence(f.principal, result.evidence),
  ).rejects.toThrow();
  expect(f.receipts).toHaveLength(2);
});

test('source revocation while selected document authorization awaits is checked before releasing directory or body', async () => {
  const f = await discovered();
  f.control.onDocumentRead = async () => {
    f.control.sourceAllowed = false;
  };
  await expect(read(f)).rejects.toThrow();
  expect(f.control.bodyReads).toBe(0);
});

test('approval validity revoked after saved READ audit does not release body', async () => {
  const f = await discovered();
  f.control.onReceipt = async () => {
    f.facts.assessments[0]!.validity.status = 'REVOKED';
  };
  await expect(read(f)).rejects.toThrow('TDMS_RUNTIME_CONTEXT_CHANGED');
});

test('unexpected opinion payload fields cannot be promoted to approved opinion evidence', async () => {
  const f = await discovered();
  (
    f.bodies.get('a')!.opinions![0] as unknown as Record<string, unknown>
  ).unrelatedBody = 'foreign fields';
  await expect(read(f)).rejects.toThrow('TDMS_INPUT_UNKNOWN_FIELD');
  expect(f.receipts).toEqual([]);
});

test('approval revoked during the final verification snapshot recheck blocks release', async () => {
  const f = await discovered();
  f.control.onRevision = async (ref) => {
    if (f.control.projectionReads >= 3 && ref === 'a')
      f.facts.assessments[0]!.validity.status = 'REVOKED';
  };
  await expect(read(f)).rejects.toThrow();
});

test('generation advanced during final source permission wait is fenced at release', async () => {
  const f = await discovered();
  let selectedReads = 0;
  const selected = f.sets.readSelected.bind(f.sets);
  f.sets.readSelected = async (...args) => {
    selectedReads++;
    return selected(...args);
  };
  const authorize = f.authorization.authorize.bind(f.authorization);
  f.authorization.authorize = async (...args) => {
    const result = await authorize(...args);
    if (selectedReads === 8) f.head.generation++;
    return result;
  };
  await expect(
    read(f, [f.context.projection.selectedSetApprovedRefs[0]!]),
  ).rejects.toThrow();
});

test('body changed during final document authorization wait is fenced at release', async () => {
  const f = await discovered();
  f.control.onDocumentRead = async () => {
    if (f.control.bodyReads >= 2)
      f.bodies.get('a')!.opinions![0]!.text = 'changed during final recheck';
  };
  await expect(
    read(f, [f.context.projection.selectedSetApprovedRefs[0]!]),
  ).rejects.toThrow();
});

test('missing coordinated final release authority fails closed without body access', async () => {
  const f = tdmsRuntimeFixture();
  delete (f.authority as unknown as Record<string, unknown>)
    .assertCurrentSnapshot;
  await expect(f.adapter.discover(f.principal, f.binding)).rejects.toThrow(
    'TDMS_RUNTIME_RELEASE_AUTHORITY_NOT_CONNECTED',
  );
  expect(f.control.bodyReads).toBe(0);
});

test('malformed own raw approval selectors are rejected before reading opinion body', async () => {
  const f = tdmsRuntimeFixture();
  const proof = f.revisions.get('a')!.record.rawFields.opinionCollection as {
    before: { identitySelector: string };
  };
  proof.before.identitySelector = 'wrong-object-selector';
  const context = await f.adapter.discover(f.principal, f.binding);
  await expect(
    read({ ...f, context }, [context.projection.selectedSetApprovedRefs[0]!]),
  ).rejects.toThrow('ASSESSMENT_TDMS_NATIVE_EVIDENCE_INVALID');
  expect(f.control.bodyReads).toBe(0);
  expect(f.receipts).toEqual([]);
});

test.each(['source', 'a'])(
  'foreign related document on %s denies directory and body before any read',
  async (ref) => {
    const f = tdmsRuntimeFixture();
    f.revisions.get(ref)!.record.relatedDocumentVersionIds = ['foreign-dv'];
    await expect(f.adapter.discover(f.principal, f.binding)).rejects.toThrow(
      'FIXTURE_DOCUMENT_REVOKED',
    );
    expect(f.control.bodyReads).toBe(0);
    expect(f.receipts).toEqual([]);
  },
);

test('revoked exact related-document permission denies saved native verification without new receipt', async () => {
  const f = tdmsRuntimeFixture();
  f.revisions.get('a')!.record.relatedDocumentVersionIds = ['related-dv'];
  f.control.allowedDocumentIds.add('related-dv');
  const context = await f.adapter.discover(f.principal, f.binding);
  const result = await read({ ...f, context });
  f.control.allowedDocumentIds.delete('related-dv');
  await expect(
    f.adapter.verifyEvidence(f.principal, result.evidence),
  ).rejects.toThrow('FIXTURE_DOCUMENT_REVOKED');
  expect(f.receipts).toHaveLength(2);
});

test('saved older generation is denied rather than rebound to a newer selected set', async () => {
  const f = await discovered();
  const result = await read(f);
  f.head.generation++;
  await expect(
    f.adapter.verifyEvidence(f.principal, result.evidence),
  ).rejects.toThrow('TDMS_RUNTIME_BODY_SUBSTITUTED');
  expect(
    result.evidence[0]!.nativeScope!.processingSetBinding!.generation,
  ).toBe(1);
  expect(f.receipts).toHaveLength(2);
});

test('permission revoked inside awaited native-body lookup cannot touch the body', async () => {
  const f = await discovered();
  let injected = false;
  const original = f.repository.transaction.bind(f.repository);
  f.repository.transaction = async (operation) =>
    original(async (tx) => {
      // Target the explicit body-read transaction, not the ref-only roster reads.
      // The assertion below makes a renamed callback fail rather than silently skipping injection.
      if (!operation.toString().includes('output.push(native)'))
        return operation(tx);
      return operation({
        ...tx,
        revision: async (tenant: string, ref: string) => {
          const value = await tx.revision(tenant, ref);
          injected = true;
          f.control.sourceAllowed = false;
          return value;
        },
      });
    });
  await expect(
    read(f, [f.context.projection.selectedSetApprovedRefs[0]!]),
  ).rejects.toThrow();
  expect(injected).toBe(true);
  expect(f.control.bodyReads).toBe(0);
  expect(f.receipts).toEqual([]);
});

test('saved native evidence preserves exact multi-engineer responsibility and ATA contribution proof', async () => {
  const f = await discovered();
  const result = await read(f);
  expect(result.evidence[0]!.nativeScope).toEqual(
    expect.objectContaining({
      opinionContribution:
        f.context.projection.cohorts[0]!.members[0]!.opinionContributions[0],
    }),
  );
  expect(result.evidence[1]!.nativeScope).not.toHaveProperty(
    'opinionContribution',
  );
  const forged = structuredClone(result.evidence[0]!);
  (
    forged.nativeScope as unknown as {
      opinionContribution: { ataScopes: string[] };
    }
  ).opinionContribution.ataScopes = ['ATA 99'];
  await expect(f.adapter.verifyEvidence(f.principal, [forged])).rejects.toThrow(
    'TDMS_RUNTIME_BODY_SUBSTITUTED',
  );
});

test('sealed metadata context does not alias later retained roster mutations', async () => {
  const f = await discovered();
  const sealed = JSON.stringify(f.context);
  f.set.rootBindings[0]!.applicabilityEvidenceRefs.push('later-proof');
  expect(JSON.stringify(f.context)).toBe(sealed);
  await expect(
    f.adapter.assertAuthorized(f.principal, f.context),
  ).rejects.toThrow('TDMS_RUNTIME_CONTEXT_CHANGED');
  expect(f.control.bodyReads).toBe(0);
});

function compositeIdentityFixture(component: string, assessmentRef: string) {
  const f = tdmsRuntimeFixture({ tenantId: component });
  f.scope.sourceInstanceId = component;
  f.scope.scopeId = component;
  for (const stored of f.revisions.values()) {
    stored.scope.sourceInstanceId = component;
    stored.scope.scopeId = component;
    stored.record.sourceInstanceId = component;
  }
  const a = f.revisions.get('a')!;
  a.record.sourceRevisionRef = assessmentRef;
  f.revisions.delete('a');
  f.revisions.set(assessmentRef, a);
  f.bodies.set(assessmentRef, f.bodies.get('a')!);
  f.set.members[0]!.assessmentObservationRef = assessmentRef;
  f.facts.assessments[0]!.sourceRevisionRef = assessmentRef;
  const mapping = f.facts.mappings[0]!;
  mapping.assessmentRevisionRef = assessmentRef;
  for (const edge of mapping.path)
    edge.scope.assessmentRevisionRef = assessmentRef;
  mapping.path[1]!.to = {
    kind: 'NATIVE_RECORD_REVISION',
    sourceRevisionRef: assessmentRef,
  };
  f.assertions.get('pa-a')!.assertion.to = {
    kind: 'NATIVE_RECORD_REVISION',
    sourceRevisionRef: assessmentRef,
  };
  f.facts.contributions[0]!.assessmentObservationRef = assessmentRef;
  return f;
}

test.each([
  ['ascii-composite', 'a'.repeat(64), 'assessment-'.padEnd(45, 'r')],
  ['escaped-components', '工:程/%'.repeat(51), '评'.repeat(255)],
])(
  'valid %s atomic identities survive input, discovery and explicit native READ',
  async (_name, component, assessmentRef) => {
    const f = compositeIdentityFixture(component!, assessmentRef!);
    const context = await f.adapter.discover(f.principal, f.binding);
    const reference = context.projection.opinions.find(
      (opinion) => opinion.assessment.sourceRevisionRef === assessmentRef,
    )!.evidenceRef;
    expect(reference.length).toBeGreaterThan(255);
    expect(f.control.bodyReads).toBe(0);
    const result = await read({ ...f, context }, [reference]);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]!.evidenceRef).toBe(reference);
    expect(result.evidence[0]!.nativeSource.sourceRevisionRef).toBe(
      assessmentRef,
    );
    expect(result.evidence[0]!.nativeReadReceipt.sourceRevisionRef).toBe(
      assessmentRef,
    );
    await f.adapter.verifyEvidence(f.principal, result.evidence);
    expect(f.receipts).toHaveLength(1);
  },
);

import {
  isTdmsApprovedOpinionReference,
  TDMS_APPROVED_OPINION_REFERENCE_MAX_LENGTH,
} from '@shared/tdms-approved-opinion-reference';
import { tdmsApprovedOpinionRef } from '@server/modules/canonical-host/tdms-approved-opinion-context';
import { parseAssessmentTdmsEvidence } from '@shared/assessment-tdms-evidence';

test('long canonical opinion refs preserve contradictory siblings and exact contribution references', async () => {
  const f = compositeIdentityFixture('工:程/%'.repeat(51), '评'.repeat(255));
  f.facts.contradictions = [
    {
      scope: f.scope,
      assertionRef: 'exact-contradiction',
      opinion: {
        scope: f.scope,
        sourceRevisionRef: '评'.repeat(255),
        opinionIndex: 0,
      },
      against: {
        kind: 'OPINION',
        opinion: { scope: f.scope, sourceRevisionRef: 'b', opinionIndex: 0 },
      },
    },
  ];
  const context = await f.adapter.discover(f.principal, f.binding);
  expect(context.projection.contradictions).toHaveLength(1);
  for (const ref of context.projection.selectedSetApprovedRefs)
    expect(isTdmsApprovedOpinionReference(ref)).toBe(true);
  expect(
    context.projection.selectedSetApprovedRefs.every((ref) => ref.length > 255),
  ).toBe(true);
  const result = await read({ ...f, context });
  expect(result.evidence).toHaveLength(2);
  expect(
    result.evidence.find(
      (value) => value.nativeSource.sourceRevisionRef === '评'.repeat(255),
    )!.nativeScope.opinionContribution!.opinionRef,
  ).toBe(context.projection.contradictions[0]!.opinionRef);
});

test('full tuple limit accepts maximum encoded atomic identifiers and safe integer index without truncation', () => {
  const atomic = '评'.repeat(255);
  const ref = tdmsApprovedOpinionRef({
    scope: {
      tenantId: atomic,
      sourceKey: atomic,
      sourceInstanceId: atomic,
      scopeId: atomic,
    },
    sourceRevisionRef: atomic,
    opinionIndex: Number.MAX_SAFE_INTEGER,
  });
  expect(ref.length).toBe(TDMS_APPROVED_OPINION_REFERENCE_MAX_LENGTH);
  expect(isTdmsApprovedOpinionReference(ref)).toBe(true);
  expect(isTdmsApprovedOpinionReference(`${ref}0`)).toBe(false);
});

test.each([
  'TDMS_APPROVED_OPINION:t:TDMS:i:s:r:-1',
  'TDMS_APPROVED_OPINION:t:TDMS:i:s:r:00',
  'TDMS_APPROVED_OPINION:t:TDMS:i:s:r:9007199254740992',
  'TDMS_APPROVED_OPINION:t:TDMS:i:s:r:0:extra',
  'TDMS_APPROVED_OPINION:%74:TDMS:i:s:r:0',
  'TDMS_APPROVED_OPINION:t:TDMS:i:s:%3a:0',
  'TDMS_APPROVED_OPINION:t:TDMS:i:s:%00:0',
  'TDMS_APPROVED_OPINION:t:TDMS:i:s:%E0%A4:0',
  `TDMS_APPROVED_OPINION:${'a'.repeat(256)}:TDMS:i:s:r:0`,
  `TDMS_APPROVED_OPINION:${'a'.repeat(TDMS_APPROVED_OPINION_REFERENCE_MAX_LENGTH)}`,
])(
  'noncanonical or oversized composite ref rejects before body (case %#)',
  async (ref) => {
    expect(isTdmsApprovedOpinionReference(ref)).toBe(false);
    const f = await discovered();
    await expect(read(f, [ref])).rejects.toThrow('TDMS_RUNTIME_READ_INVALID');
    expect(f.control.bodyReads).toBe(0);
    expect(f.receipts).toEqual([]);
  },
);

test('long reference grammar does not relax atomic identity or exact locator-to-scope binding', async () => {
  const invalid = compositeIdentityFixture('x'.repeat(256), 'valid-assessment');
  await expect(
    invalid.adapter.discover(invalid.principal, invalid.binding),
  ).rejects.toThrow('TDMS_IDENTIFIER_INVALID');
  expect(invalid.control.bodyReads).toBe(0);
  const f = compositeIdentityFixture(
    'a'.repeat(64),
    'assessment-'.padEnd(45, 'r'),
  );
  const context = await f.adapter.discover(f.principal, f.binding);
  const original = context.projection.opinions[0]!;
  const wrongRef = tdmsApprovedOpinionRef({
    scope: { ...original.scope, scopeId: 'other-scope' },
    sourceRevisionRef: original.assessment.sourceRevisionRef,
    opinionIndex: 0,
  });
  expect(isTdmsApprovedOpinionReference(wrongRef)).toBe(true);
  const changed = structuredClone(context);
  changed.projection.opinions[0]!.evidenceRef = wrongRef;
  expect(() => assertTdmsRuntimeTaskContext(changed)).toThrow(
    'TDMS_RUNTIME_CONTEXT_INVALID',
  );
  await expect(read({ ...f, context }, [wrongRef])).rejects.toThrow(
    'TDMS_RUNTIME_OPINION_NOT_APPROVED',
  );
  expect(f.control.bodyReads).toBe(0);
});

test('native parser accepts canonical long tuple but keeps legacy aliases and atomic metadata bounded', async () => {
  const f = compositeIdentityFixture(
    'a'.repeat(64),
    'assessment-'.padEnd(45, 'r'),
  );
  const context = await f.adapter.discover(f.principal, f.binding);
  const result = await read({ ...f, context }, [
    context.projection.opinions.find(
      (value) =>
        value.assessment.sourceRevisionRef === 'assessment-'.padEnd(45, 'r'),
    )!.evidenceRef,
  ]);
  const native = result.evidence[0]!;
  expect(parseAssessmentTdmsEvidence(native)).toEqual(native);
  const legacy = structuredClone(native);
  legacy.evidenceRef = 'TDMS_NATIVE:legacy';
  delete legacy.nativeScope.opinionContribution;
  expect(parseAssessmentTdmsEvidence(legacy)).toEqual(legacy);
  const oversized = structuredClone(legacy);
  oversized.evidenceRef = 'legacy'.padEnd(256, 'x');
  expect(() => parseAssessmentTdmsEvidence(oversized)).toThrow(
    'ASSESSMENT_TDMS_NATIVE_EVIDENCE_INVALID',
  );
  const atomic = structuredClone(native);
  atomic.nativeSource.sourceRevisionRef = 'x'.repeat(256);
  expect(() => parseAssessmentTdmsEvidence(atomic)).toThrow(
    'ASSESSMENT_TDMS_NATIVE_EVIDENCE_INVALID',
  );
});
