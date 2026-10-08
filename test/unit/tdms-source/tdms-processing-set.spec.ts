import type {
  TdmsProcessingRevisionSet,
  TdmsProcessingSetHead,
  TdmsProcessingSetMember,
} from '@shared/tdms-processing-set.interface';
import type {
  TdmsExactEndpoint,
  TdmsRecordKind,
  TdmsRecordRevision,
  TdmsRelationAssertion,
  TdmsSourceVersion,
} from '@shared/tdms-source.interface';
import type {
  TdmsPublicActor,
  TdmsSourceScope,
  TdmsStoredAssertion,
  TdmsStoredRevision,
} from '@server/modules/tdms-source/tdms-source.types';
import { TdmsProcessingSetService } from '@server/modules/tdms-source/tdms-processing-set.service';
import type {
  TdmsProcessingSetAuthority,
  TdmsProcessingSetRepository,
  TdmsProcessingSetTransaction,
} from '@server/modules/tdms-source/tdms-processing-set.types';
import { UnconfiguredTdmsProcessingSetAuthority } from '@server/modules/tdms-source/tdms-processing-set.types';
import { processingSet } from '@server/modules/tdms-source/tdms-processing-set.validation';

const scope: TdmsSourceScope = {
  tenantId: 'tenant-a',
  sourceKey: 'TDMS',
  sourceInstanceId: 'fixture-instance',
  scopeId: 'fixture-scope',
};
const actor = {
  principalKind: 'FINAL_USER',
  transport: 'MIAODA_AUTHENTICATED_HTTP',
  canonicalSubject: { namespace: 'MIAODA_USER_ID', id: 'user-a' },
  tenantId: scope.tenantId,
  applicationScopeId: 'app_17bzc551rsg',
  subjectDecision: {
    source: 'MIAODA_GATEWAY_USER_CONTEXT',
    applicationScopeId: 'app_17bzc551rsg',
    tenantId: scope.tenantId,
    version: 'fixture-only',
    decidedAt: '2026-10-06T10:00:00.000Z',
  },
  identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
  applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT',
  workspaceId: null,
  workspaceProvenance: 'UNAVAILABLE',
  env: 'preview',
  platformRoles: [],
  feishuUserId: null,
  feishuOpenId: null,
  feishuIdentityProvenance: 'UNAVAILABLE',
  sessionId: null,
  sessionRevision: null,
  sessionProvenance: 'UNAVAILABLE',
} as unknown as TdmsPublicActor;

type MemberOptions = Partial<TdmsProcessingSetMember>;
function member(
  ref: string,
  options: MemberOptions = {},
): TdmsProcessingSetMember {
  return {
    memberRef: ref,
    assessmentFamilyRef: `assessment-family-${ref}`,
    assessmentBusinessRevisionKey: 'business-r00',
    assessmentObservationRef: `observation-${ref}`,
    membershipResolution: 'CONFIRMED',
    processingAssessmentAssertionRefs: [`relation-${ref}`],
    cohortMembershipEvidenceRefs: [`membership-proof-${ref}`],
    assessmentSuccessionEvidenceRefs: [],
    expectedSourceRecordId: `assessment-${ref}`,
    gaps: [],
    ...options,
  };
}

function set(
  ref: string,
  options: Partial<TdmsProcessingRevisionSet> = {},
): TdmsProcessingRevisionSet {
  return {
    schemaVersion: 'wiselink.tdms-processing-set.v1',
    scope: { ...scope },
    setRevisionRef: ref,
    processingFamilyRef: 'processing-family-1',
    cohortRef: 'cohort-0',
    processingObservationRef: 'processing-observation-0',
    familyIdentityEvidenceRefs: ['family-proof'],
    cohortIdentityEvidenceRefs: ['cohort-proof'],
    predecessorCohortRef: null,
    successionEvidenceRefs: [],
    supersedesSetRevisionRef: null,
    rootBindings: [],
    rosterEvidenceRefs: ['roster-proof'],
    sourceRosterRevision: 'roster-0',
    captureRefs: ['capture-observation-0'],
    observationWindow: {
      before: '2026-10-06T09:00:00.000Z',
      after: '2026-10-06T10:00:00.000Z',
    },
    membershipCoverage: 'COMPLETE',
    versionMappingCoverage: 'UNKNOWN',
    approvedBodyCaptureCoverage: 'UNKNOWN',
    approvalReadiness: 'ALL_APPROVED',
    sourceConsistency: 'NON_ATOMIC',
    sourceTransactionRef: null,
    currentness: 'CURRENT',
    currentnessEvidenceRefs: ['currentness-proof'],
    members: [member('a'), member('b')],
    gaps: [],
    ...options,
  };
}

function errorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : null;
}
function errorCodeOf(operation: () => unknown): string | null {
  try {
    operation();
    return null;
  } catch (error) {
    return errorCode(error);
  }
}
function codedError(
  code: string,
  statusCode = 404,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode });
}
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function scopeKey(s: TdmsSourceScope): string {
  return JSON.stringify([
    s.tenantId,
    s.sourceKey,
    s.sourceInstanceId,
    s.scopeId,
  ]);
}
function revisionKey(tenantId: string, ref: string): string {
  return `${tenantId}\u0000${ref}`;
}
function setKey(s: TdmsSourceScope, ref: string): string {
  return `${scopeKey(s)}\u0000${ref}`;
}
function headKey(s: TdmsSourceScope, family: string): string {
  return `${scopeKey(s)}\u0000${family}`;
}

class MemoryRepository implements TdmsProcessingSetRepository {
  readonly revisions = new Map<string, TdmsStoredRevision>();
  readonly assertions = new Map<string, TdmsStoredAssertion>();
  readonly sets = new Map<string, TdmsProcessingRevisionSet>();
  readonly heads = new Map<string, TdmsProcessingSetHead>();

  addRevision(value: TdmsStoredRevision): void {
    this.revisions.set(
      revisionKey(value.scope.tenantId, value.record.sourceRevisionRef),
      value,
    );
  }
  addAssertion(value: TdmsStoredAssertion): void {
    this.assertions.set(
      setKey(value.scope, value.assertion.assertionRef),
      value,
    );
  }
  async transaction<T>(
    operation: (tx: TdmsProcessingSetTransaction) => Promise<T>,
  ): Promise<T> {
    const priorSets = copy([...this.sets.entries()]);
    const priorHeads = copy([...this.heads.entries()]);
    const tx = {
      capture: async () => null,
      recordHead: async () => null,
      revision: async (tenantId: string, ref: string) =>
        this.revisions.get(revisionKey(tenantId, ref)) ?? null,
      catalogue: async () => [],
      history: async () => [],
      relationHead: async () => null,
      relations: async () => [],
      saveRevision: async () => {
        throw new Error('NOT_USED');
      },
      saveAssertion: async () => {
        throw new Error('NOT_USED');
      },
      saveCapture: async () => {
        throw new Error('NOT_USED');
      },
      saveReceipt: async () => {
        throw new Error('NOT_USED');
      },
      processingSet: async (s: TdmsSourceScope, ref: string) =>
        this.sets.get(setKey(s, ref)) ?? null,
      processingSetHead: async (s: TdmsSourceScope, family: string) =>
        this.heads.get(headKey(s, family)) ?? null,
      processingSetHistory: async (
        s: TdmsSourceScope,
        family: string,
        after: string | null,
      ) =>
        [...this.sets.values()]
          .filter(
            (v) =>
              scopeKey(v.scope) === scopeKey(s) &&
              v.processingFamilyRef === family &&
              (after === null || v.setRevisionRef > after),
          )
          .sort((a, b) => a.setRevisionRef.localeCompare(b.setRevisionRef))
          .slice(0, 51),
      processingAssertion: async (s: TdmsSourceScope, ref: string) =>
        this.assertions.get(setKey(s, ref)) ?? null,
      insertProcessingSet: async (v: TdmsProcessingRevisionSet) => {
        const key = setKey(v.scope, v.setRevisionRef);
        if (this.sets.has(key))
          throw codedError(
            'duplicate key value violates unique constraint',
            409,
          );
        this.sets.set(key, copy(v));
      },
      selectProcessingSet: async (
        h: TdmsProcessingSetHead,
        expected: number | null,
      ) => {
        const key = headKey(h.scope, h.processingFamilyRef);
        const current = this.heads.get(key) ?? null;
        if ((current?.generation ?? null) !== expected)
          throw codedError('TDMS_PROCESSING_SET_CAS_CONFLICT', 409);
        this.heads.set(key, copy(h));
      },
    } as unknown as TdmsProcessingSetTransaction;
    try {
      return await operation(tx);
    } catch (error) {
      this.sets.clear();
      this.heads.clear();
      for (const [key, value] of priorSets) this.sets.set(key, value);
      for (const [key, value] of priorHeads) this.heads.set(key, value);
      throw error;
    }
  }
}

type CompareResult = Awaited<ReturnType<TdmsProcessingSetAuthority['compare']>>;
class FixtureAuthority implements TdmsProcessingSetAuthority {
  readonly available = true;
  readonly scopeChecks: Array<{
    actorId: string;
    action: 'RETAIN' | 'READ';
    scope: TdmsSourceScope;
  }> = [];
  readonly accessChecks: Array<{
    actorId: string;
    action: 'RETAIN' | 'READ';
    setRef: string;
  }> = [];
  compareResult: CompareResult = {
    cohort: 'SAME',
    roster: 'SAME',
    evidenceRefs: ['fixture-order-proof'],
  };
  compareHandler?: (
    input: Parameters<TdmsProcessingSetAuthority['compare']>[0],
  ) => CompareResult;
  accessHandler?: (
    input: Parameters<TdmsProcessingSetAuthority['assertAccess']>[0],
  ) => void | Promise<void>;
  scopeHandler?: (
    input: Parameters<TdmsProcessingSetAuthority['assertScopeAccess']>[0],
  ) => void | Promise<void>;

  async assertScopeAccess(
    input: Parameters<TdmsProcessingSetAuthority['assertScopeAccess']>[0],
  ): Promise<void> {
    this.scopeChecks.push({
      actorId: input.actor.canonicalSubject.id,
      action: input.action,
      scope: input.scope,
    });
    if (this.scopeHandler) await this.scopeHandler(input);
    else if (input.actor.tenantId !== input.scope.tenantId)
      throw codedError('TDMS_SOURCE_NOT_FOUND');
  }
  async assertAccess(
    input: Parameters<TdmsProcessingSetAuthority['assertAccess']>[0],
  ): Promise<void> {
    this.accessChecks.push({
      actorId: input.actor.canonicalSubject.id,
      action: input.action,
      setRef: input.set.setRevisionRef,
    });
    if (this.accessHandler) await this.accessHandler(input);
  }
  async compare(
    input: Parameters<TdmsProcessingSetAuthority['compare']>[0],
  ): Promise<CompareResult> {
    return this.compareHandler
      ? this.compareHandler(input)
      : this.compareResult;
  }
}

function sourceVersion(
  options: Partial<TdmsSourceVersion> = {},
): TdmsSourceVersion {
  return {
    rawRevision: 'R00',
    rawIteration: '1',
    confirmation: 'SOURCE_DECLARED',
    ...options,
  };
}
function record(
  s: TdmsSourceScope,
  ref: string,
  kind: TdmsRecordKind,
  sourceRecordId: string,
  options: {
    version?: TdmsSourceVersion;
    state?: string | null;
    opinionText?: string;
  } = {},
): TdmsStoredRevision {
  const now = '2026-10-06T10:00:00.000Z';
  const state =
    options.state === null
      ? null
      : {
          rawCode: options.state ?? 'Estimated',
          rawName: options.state ?? 'Estimated',
        };
  const body = options.opinionText
    ? [
        {
          text: options.opinionText,
          author: {
            sourcePersonId: `person-${sourceRecordId}`,
            name: 'Fixture author',
            role: 'ATA reviewer',
          },
          state,
          conditions: ['fixture condition'],
          requiredActions: ['fixture action'],
          sourceSelector: 'fixture.opinion',
        },
      ]
    : undefined;
  const value: TdmsRecordRevision = {
    recordRef: `record-${sourceRecordId}`,
    sourceRevisionRef: ref,
    recordKind: kind,
    sourceRecordId,
    sourceKey: s.sourceKey,
    sourceInstanceId: s.sourceInstanceId,
    title: `Fixture ${sourceRecordId}`,
    fileType: null,
    sourceVersion: options.version ?? sourceVersion(),
    businessVersion: null,
    state,
    authors: [],
    observedAt: now,
    capturedAt: now,
    coverage: { status: 'COMPLETE', gaps: [], readback: 'CONSISTENT' },
    relatedDocumentVersionIds: [],
    fieldSelectors: [],
    sourceVerification: 'DECLARED_ONLY',
    currentness: 'SELECTED_HOST_OBSERVATION',
    captureRef: 'capture-fixture',
    sourceModifiedAt: null,
    rawFields: {},
    content: body ? { opinions: body } : {},
    fieldProvenance: [],
    artifacts: [],
    unreadAttachments: [],
    selectedHead: true,
  };
  return { scope: { ...s }, record: value };
}
function assertion(
  s: TdmsSourceScope,
  ref: string,
  kind: TdmsRelationAssertion['controlledKind'],
  from: TdmsExactEndpoint,
  to: TdmsExactEndpoint,
): TdmsStoredAssertion {
  const value: TdmsRelationAssertion = {
    sourceRelationId: `source-${ref}`,
    rawKind: kind ?? 'OTHER',
    controlledKind: kind,
    authority: 'SOURCE_EXPLICIT',
    selector: 'fixture.source-relation',
    observedAt: '2026-10-06T10:00:00.000Z',
    coverage: { status: 'COMPLETE', gaps: [], readback: 'CONSISTENT' },
    scope: {},
    completionEffect: 'UNSPECIFIED',
    changeClass: 'UNSPECIFIED',
    rawFields: {},
    relationRef: `relation-${ref}`,
    assertionRef: ref,
    selectedHead: true,
    captureRef: 'capture-fixture',
    from,
    to,
    sourceVerification: 'DECLARED_ONLY',
  };
  return { scope: { ...s }, assertion: value };
}

function provisionFacts(
  repo: MemoryRepository,
  value: TdmsProcessingRevisionSet,
  overrides: Map<
    string,
    { version?: TdmsSourceVersion; state?: string | null; opinionText?: string }
  > = new Map(),
): void {
  const parentRef = value.processingObservationRef;
  const parentEndpoint: TdmsExactEndpoint = {
    kind: 'NATIVE_RECORD_REVISION',
    sourceRevisionRef: parentRef,
  };
  if (!repo.revisions.has(revisionKey(value.scope.tenantId, parentRef))) {
    repo.addRevision(
      record(
        value.scope,
        parentRef,
        'PROCESSING_SHEET',
        `processing-${parentRef}`,
      ),
    );
  }
  for (const m of value.members) {
    if (m.assessmentObservationRef) {
      if (
        !repo.revisions.has(
          revisionKey(value.scope.tenantId, m.assessmentObservationRef),
        )
      ) {
        const facts = overrides.get(m.assessmentObservationRef) ?? {};
        repo.addRevision(
          record(
            value.scope,
            m.assessmentObservationRef,
            'ENGINEER_ASSESSMENT',
            m.expectedSourceRecordId ?? `assessment-${m.memberRef}`,
            facts,
          ),
        );
      }
      for (const ref of m.processingAssessmentAssertionRefs) {
        repo.addAssertion(
          assertion(value.scope, ref, 'PROCESSING_ASSESSMENT', parentEndpoint, {
            kind: 'NATIVE_RECORD_REVISION',
            sourceRevisionRef: m.assessmentObservationRef,
          }),
        );
      }
    }
  }
  for (const root of value.rootBindings) {
    if (
      root.endpoint.kind === 'NATIVE_RECORD_REVISION' &&
      !repo.revisions.has(
        revisionKey(value.scope.tenantId, root.endpoint.sourceRevisionRef),
      )
    ) {
      repo.addRevision(
        record(
          value.scope,
          root.endpoint.sourceRevisionRef,
          'MANUFACTURER_FILE',
          `root-${root.endpoint.sourceRevisionRef}`,
        ),
      );
    }
    for (const ref of root.fileProcessingAssertionRefs) {
      repo.addAssertion(
        assertion(
          value.scope,
          ref,
          'FILE_PROCESSING',
          root.endpoint,
          parentEndpoint,
        ),
      );
    }
  }
  for (const binding of value.objectContextBindings ?? []) {
    if (
      !repo.revisions.has(
        revisionKey(value.scope.tenantId, binding.ownerObservationRef),
      )
    ) {
      repo.addRevision(
        record(
          value.scope,
          binding.ownerObservationRef,
          'ENGINEERING_FILE',
          `owner-${binding.ownerObservationRef}`,
        ),
      );
    }
    for (const ref of binding.attachmentRelationAssertionRefs) {
      const from: TdmsExactEndpoint = {
        kind: 'NATIVE_RECORD_REVISION',
        sourceRevisionRef: binding.ownerObservationRef,
      };
      repo.addAssertion(
        assertion(value.scope, ref, 'OTHER', from, parentEndpoint),
      );
    }
  }
}

function service(repo: MemoryRepository, authority = new FixtureAuthority()) {
  return { service: new TdmsProcessingSetService(repo, authority), authority };
}

describe('TDMS processing revision set validation and storage seam', () => {
  it.each(['REPLAY', 'HISTORY_ONLY', 'UNRESOLVED'] as const)(
    'preserves %s retention while withholding a head whose selected set is unreadable',
    async (disposition) => {
      const repo = new MemoryRepository();
      const authority = new FixtureAuthority();
      const { service: sut } = service(repo, authority);
      const selected = set('hidden-selected-set-B');
      provisionFacts(repo, selected);
      await sut.save(actor, selected, null);
      const historical = set('retained-old-set-A', {
        currentness: disposition === 'UNRESOLVED' ? 'UNKNOWN' : 'HISTORICAL',
        currentnessEvidenceRefs:
          disposition === 'UNRESOLVED' ? [] : ['historical-proof'],
      });
      provisionFacts(repo, historical);
      if (disposition === 'REPLAY') await sut.save(actor, historical, 1);
      authority.accessChecks.length = 0;
      authority.scopeChecks.length = 0;
      authority.compareHandler = () => {
        throw new Error('comparison must not run');
      };
      authority.accessHandler = ({ action, set: value }) => {
        if (
          action === 'READ' &&
          value.setRevisionRef === selected.setRevisionRef
        )
          throw codedError(
            'hidden-selected-set-B generation=1 must remain private',
          );
      };
      const receipt = await sut.save(actor, historical, 1);
      expect(receipt).toEqual({
        setRevisionRef: historical.setRevisionRef,
        disposition,
        selectedSetRevisionRef: null,
        generation: null,
      });
      expect(JSON.stringify(receipt)).not.toContain('hidden-selected-set-B');
      expect(authority.accessChecks).toContainEqual({
        actorId: 'user-a',
        action: 'READ',
        setRef: selected.setRevisionRef,
      });
      expect(authority.scopeChecks.some((v) => v.action === 'READ')).toBe(true);
      expect(repo.sets.has(setKey(scope, historical.setRevisionRef))).toBe(
        true,
      );
      expect(
        repo.heads.get(headKey(scope, selected.processingFamilyRef)),
      ).toMatchObject({
        selectedSetRevisionRef: selected.setRevisionRef,
        generation: 1,
      });
      authority.accessHandler = undefined;
      expect(await sut.save(actor, historical, 1)).toMatchObject({
        disposition: 'REPLAY',
        selectedSetRevisionRef: selected.setRevisionRef,
        generation: 1,
      });
    },
  );

  it('keeps a selected save committed when RETAIN scope is allowed but READ scope is denied', async () => {
    const repo = new MemoryRepository();
    const authority = new FixtureAuthority();
    const { service: sut } = service(repo, authority);
    const value = set('selected-retain-only');
    provisionFacts(repo, value);
    authority.scopeHandler = ({ action }) => {
      if (action === 'READ')
        throw codedError('selected-retain-only generation=1 hidden');
    };
    expect(await sut.save(actor, value, null)).toEqual({
      setRevisionRef: value.setRevisionRef,
      disposition: 'SELECTED',
      selectedSetRevisionRef: null,
      generation: null,
    });
    expect(repo.sets.has(setKey(scope, value.setRevisionRef))).toBe(true);
    expect(
      repo.heads.get(headKey(scope, value.processingFamilyRef))?.generation,
    ).toBe(1);
    expect(authority.scopeChecks.some((v) => v.action === 'READ')).toBe(true);
  });

  it('withholds save head fields when READ is revoked after its authorization transaction', async () => {
    const repo = new MemoryRepository();
    const authority = new FixtureAuthority();
    const { service: sut } = service(repo, authority);
    const value = set('selected-late-read-denial');
    provisionFacts(repo, value);
    let reads = 0;
    authority.accessHandler = ({ action }) => {
      if (action === 'READ' && ++reads === 3)
        throw codedError('selected-late-read-denial generation=1 hidden');
    };
    expect(await sut.save(actor, value, null)).toMatchObject({
      disposition: 'SELECTED',
      selectedSetRevisionRef: null,
      generation: null,
    });
    expect(reads).toBe(3);
    expect(repo.sets.has(setKey(scope, value.setRevisionRef))).toBe(true);
    expect(
      repo.heads.get(headKey(scope, value.processingFamilyRef))?.generation,
    ).toBe(1);
  });

  it('rejects selected reads revoked while the final head query waits without returning protected diagnostics', async () => {
    const repo = new MemoryRepository();
    const authority = new FixtureAuthority();
    const { service: sut } = service(repo, authority);
    const selected = set('hidden-after-lock-set');
    provisionFacts(repo, selected);
    await sut.save(actor, selected, null);
    const originalTransaction = repo.transaction.bind(repo);
    let headQueries = 0;
    let releaseHead!: () => void;
    let announceWait!: () => void;
    const waiting = new Promise<void>((resolve) => {
      announceWait = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseHead = resolve;
    });
    repo.transaction = (operation) =>
      originalTransaction((tx) =>
        operation({
          ...tx,
          processingSetHead: async (s, family) => {
            const head = await tx.processingSetHead(s, family);
            if (++headQueries === 2) {
              announceWait();
              await release;
            }
            return head;
          },
        }),
      );
    const result = sut
      .readSelected(actor, scope, selected.processingFamilyRef)
      .then(
        (value) => ({ value, error: null }),
        (error: unknown) => ({ value: null, error }),
      );
    await waiting;
    authority.accessHandler = ({ action }) => {
      if (action === 'READ')
        throw codedError('hidden-after-lock-set generation=1 denied');
    };
    releaseHead();
    const outcome = await result;
    expect(outcome.value).toBeNull();
    expect(outcome.error).toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
    expect(
      JSON.stringify(
        outcome.error,
        Object.getOwnPropertyNames(outcome.error as object),
      ),
    ).not.toContain('hidden-after-lock-set');
    expect(
      JSON.stringify(
        outcome.error,
        Object.getOwnPropertyNames(outcome.error as object),
      ),
    ).not.toContain('generation=1');
  });

  it('keeps complete capture and exact membership separate from pending approval and unknown currentness', async () => {
    const repo = new MemoryRepository();
    const value = set('set-complete-capture-pending', {
      rootBindings: [
        {
          endpoint: {
            kind: 'NATIVE_RECORD_REVISION',
            sourceRevisionRef: 'root-exact',
          },
          fileProcessingAssertionRefs: ['root-processing-exact'],
          applicabilityEvidenceRefs: ['root-applicability-exact'],
        },
      ],
      versionMappingCoverage: 'COMPLETE',
      approvedBodyCaptureCoverage: 'COMPLETE',
      approvalReadiness: 'PENDING',
      currentness: 'UNKNOWN',
      currentnessEvidenceRefs: [],
    });
    provisionFacts(
      repo,
      value,
      new Map([['observation-b', { state: 'Estimating' }]]),
    );
    Object.defineProperty(
      repo.revisions.get(revisionKey(scope.tenantId, 'observation-b'))!.record,
      'content',
      {
        get() {
          throw new Error('pending opinion body touched');
        },
      },
    );
    const { service: sut } = service(repo);
    expect((await sut.save(actor, value, null)).disposition).toBe('UNRESOLVED');
    expect(
      await sut.readSelected(actor, scope, value.processingFamilyRef),
    ).toBeNull();
    const frozen = await sut.readFrozen(actor, scope, value.setRevisionRef);
    expect(frozen).toMatchObject({
      membershipCoverage: 'COMPLETE',
      versionMappingCoverage: 'COMPLETE',
      approvedBodyCaptureCoverage: 'COMPLETE',
      approvalReadiness: 'PENDING',
      currentness: 'UNKNOWN',
    });
    await expect(
      sut.save(
        actor,
        {
          ...value,
          setRevisionRef: 'false-all-approved',
          approvalReadiness: 'ALL_APPROVED',
        },
        null,
      ),
    ).rejects.toMatchObject({ code: 'TDMS_SET_ALL_APPROVED_UNCONFIRMED' });
    expect(repo.sets.size).toBe(1);
  });

  it('keeps sibling assessment refs distinct and stores only owner/classification metadata, never attachment bytes', () => {
    const original = set('set-ref-only', {
      members: [
        member('ata-27', {
          assessmentFamilyRef: 'assessment-family-27',
          processingAssessmentAssertionRefs: ['relation-27'],
        }),
        member('ata-29', {
          assessmentFamilyRef: 'assessment-family-29',
          processingAssessmentAssertionRefs: ['relation-29'],
        }),
      ],
      objectContextBindings: [
        {
          ownerObservationRef: 'owner-engineering-file-v1',
          attachmentRelationAssertionRefs: ['attachment-owner-1'],
          sourceContainerEvidenceRefs: ['storage-SB-WTDocument'],
          businessClassificationEvidenceRefs: [],
          productEligibility: 'UNKNOWN',
          gaps: ['business classification unproved'],
        },
        {
          ownerObservationRef: 'owner-assessment-v1',
          attachmentRelationAssertionRefs: ['attachment-owner-2'],
          sourceContainerEvidenceRefs: ['storage-SB-WTDocument'],
          businessClassificationEvidenceRefs: [
            'business-classification-unknown',
          ],
          productEligibility: 'UNKNOWN',
          gaps: ['classification source is unresolved'],
        },
      ],
    });
    const validated = processingSet(original);
    expect(validated.members.map((m) => m.memberRef)).toEqual([
      'ata-27',
      'ata-29',
    ]);
    expect(
      validated.objectContextBindings?.map((b) => b.ownerObservationRef),
    ).toEqual(['owner-engineering-file-v1', 'owner-assessment-v1']);
    expect(
      validated.objectContextBindings?.[0]?.attachmentRelationAssertionRefs,
    ).toEqual(['attachment-owner-1']);
    expect(
      validated.objectContextBindings?.[1]?.attachmentRelationAssertionRefs,
    ).toEqual(['attachment-owner-2']);
    expect(JSON.stringify(validated)).not.toMatch(
      /bytesBase64|artifactMemberIds|unreadAttachments|sha256|fileName/,
    );

    expect(
      errorCodeOf(() =>
        processingSet({
          ...original,
          objectContextBindings: original.objectContextBindings?.map((b) => ({
            ...b,
            productEligibility: 'ELIGIBLE',
          })),
        }),
      ),
    ).toBe('TDMS_SET_ELIGIBILITY_UNCONFIGURED');
    expect(
      errorCodeOf(() => processingSet({ ...original, artifacts: [] })),
    ).toBe('TDMS_INPUT_UNKNOWN_FIELD');
  });

  it('retains unresolved/OTHER container facts without treating them as a business type or selector', async () => {
    const repo = new MemoryRepository();
    const value = set('set-other-classification', {
      objectContextBindings: [
        {
          ownerObservationRef: 'owner-other-record',
          attachmentRelationAssertionRefs: ['attachment-other'],
          sourceContainerEvidenceRefs: ['CAMP-OTHER-connector-fixture'],
          businessClassificationEvidenceRefs: [],
          productEligibility: 'UNKNOWN',
          gaps: ['connector fixture is not a business classification'],
        },
      ],
    });
    provisionFacts(repo, value);
    const { service: sut } = service(repo);
    const saved = await sut.save(actor, value, null);
    expect(saved.disposition).toBe('SELECTED');
    const read = await sut.readFrozen(actor, scope, value.setRevisionRef);
    expect(
      read.objectContextBindings?.[0]?.sourceContainerEvidenceRefs,
    ).toEqual(['CAMP-OTHER-connector-fixture']);
    expect(
      read.objectContextBindings?.[0]?.businessClassificationEvidenceRefs,
    ).toEqual([]);
    expect(read.objectContextBindings?.[0]?.productEligibility).toBe('UNKNOWN');
  });

  it('selects a successor cohort first, keeps an incomplete child metadata-only, later supplements it, and never lets late predecessor facts rewind the head', async () => {
    const repo = new MemoryRepository();
    const authority = new FixtureAuthority();
    const { service: sut } = service(repo, authority);
    const c0 = set('set-c0', {
      cohortRef: 'cohort-c0',
      members: [member('a0'), member('b0')],
    });
    provisionFacts(repo, c0);
    expect((await sut.save(actor, c0, null)).disposition).toBe('SELECTED');

    const expectedB1 = member('b1', {
      assessmentFamilyRef: 'assessment-family-b',
      assessmentBusinessRevisionKey: 'business-b1',
      assessmentObservationRef: null,
      membershipResolution: 'UNRESOLVED',
      processingAssessmentAssertionRefs: [],
      cohortMembershipEvidenceRefs: [],
      expectedSourceRecordId: 'assessment-b1',
      gaps: ['observation has not arrived'],
    });
    const c1Partial = set('set-c1-partial', {
      cohortRef: 'cohort-c1',
      predecessorCohortRef: 'cohort-c0',
      successionEvidenceRefs: ['cohort-successor-proof'],
      processingObservationRef: 'processing-observation-c1',
      membershipCoverage: 'PARTIAL',
      approvalReadiness: 'PENDING',
      approvedBodyCaptureCoverage: 'PARTIAL',
      members: [
        member('a1', {
          assessmentFamilyRef: 'assessment-family-a',
          assessmentBusinessRevisionKey: 'business-a1',
        }),
        expectedB1,
      ],
    });
    provisionFacts(repo, c1Partial);
    authority.compareHandler = ({ candidate }) =>
      candidate.cohortRef === 'cohort-c1'
        ? {
            cohort: 'SUCCESSOR',
            roster: 'UNKNOWN',
            evidenceRefs: ['cohort-c0-before-c1'],
          }
        : {
            cohort: 'PREDECESSOR',
            roster: 'PREDECESSOR',
            evidenceRefs: ['cohort-c0-before-c1'],
          };
    expect((await sut.save(actor, c1Partial, 1)).disposition).toBe('SELECTED');

    const c1Complete = set('set-c1-complete', {
      cohortRef: 'cohort-c1',
      predecessorCohortRef: 'cohort-c0',
      successionEvidenceRefs: ['cohort-successor-proof'],
      processingObservationRef: 'processing-observation-c1',
      supersedesSetRevisionRef: 'set-c1-partial',
      membershipCoverage: 'COMPLETE',
      approvedBodyCaptureCoverage: 'COMPLETE',
      approvalReadiness: 'ALL_APPROVED',
      members: [
        member('a1', {
          assessmentFamilyRef: 'assessment-family-a',
          assessmentBusinessRevisionKey: 'business-a1',
        }),
        member('b1', {
          assessmentFamilyRef: 'assessment-family-b',
          assessmentBusinessRevisionKey: 'business-b1',
        }),
      ],
    });
    provisionFacts(repo, c1Complete);
    authority.compareHandler = () => ({
      cohort: 'SAME',
      roster: 'SAME',
      evidenceRefs: ['same-roster-proof'],
    });
    expect((await sut.save(actor, c1Complete, 2)).disposition).toBe('SELECTED');

    const delayedC0 = { ...copy(c0), setRevisionRef: 'set-c0-delayed' };
    provisionFacts(repo, delayedC0);
    authority.compareHandler = () => ({
      cohort: 'PREDECESSOR',
      roster: 'PREDECESSOR',
      evidenceRefs: ['c0-is-predecessor'],
    });
    expect((await sut.save(actor, delayedC0, 3)).disposition).toBe(
      'HISTORY_ONLY',
    );
    const selected = await sut.readSelected(
      actor,
      scope,
      'processing-family-1',
    );
    expect(selected?.head).toMatchObject({
      selectedSetRevisionRef: 'set-c1-complete',
      generation: 3,
    });
    expect(
      selected?.set.members.map((m) => m.assessmentObservationRef),
    ).toEqual(['observation-a1', 'observation-b1']);
    const frozenPartial = await sut.readFrozen(actor, scope, 'set-c1-partial');
    expect(frozenPartial.members[1]?.assessmentObservationRef).toBeNull();
    expect(
      repo.sets.get(setKey(scope, 'set-c1-partial'))?.members[1]
        ?.assessmentObservationRef,
    ).toBeNull();
  });

  it('supplements a same-cohort technical observation while retaining the business revision key; unknown iteration cannot be promoted to exact mapping', async () => {
    const repo = new MemoryRepository();
    const authority = new FixtureAuthority();
    const { service: sut } = service(repo, authority);
    const first = set('set-iteration-1', {
      members: [
        member('a', {
          assessmentFamilyRef: 'family-assessment-a',
          assessmentBusinessRevisionKey: 'business-v4',
        }),
      ],
    });
    provisionFacts(
      repo,
      first,
      new Map([
        [
          'observation-a',
          { version: sourceVersion({ rawRevision: 'R00', rawIteration: '1' }) },
        ],
      ]),
    );
    expect((await sut.save(actor, first, null)).disposition).toBe('SELECTED');
    const second = set('set-iteration-2', {
      setRevisionRef: 'set-iteration-2',
      supersedesSetRevisionRef: 'set-iteration-1',
      members: [
        member('a', {
          assessmentFamilyRef: 'family-assessment-a',
          assessmentBusinessRevisionKey: 'business-v4',
          assessmentObservationRef: 'observation-a-iter2',
          assessmentSuccessionEvidenceRefs: [
            'assessment-observation-succession',
          ],
        }),
      ],
    });
    provisionFacts(
      repo,
      second,
      new Map([
        [
          'observation-a-iter2',
          { version: sourceVersion({ rawRevision: 'R00', rawIteration: '2' }) },
        ],
      ]),
    );
    authority.compareResult = {
      cohort: 'SAME',
      roster: 'SAME',
      evidenceRefs: ['same-business-cohort'],
      memberObservationSuccessions: [
        {
          memberRef: 'a',
          olderObservationRef: 'observation-a',
          newerObservationRef: 'observation-a-iter2',
          evidenceRefs: ['assessment-observation-succession'],
        },
      ],
    };
    expect((await sut.save(actor, second, 1)).disposition).toBe('SELECTED');
    expect(
      (await sut.readSelected(actor, scope, 'processing-family-1'))?.set
        .members[0]?.assessmentBusinessRevisionKey,
    ).toBe('business-v4');

    const rootRef = 'root-oem-exact';
    const unbound = set('set-r00-unmapped', {
      processingFamilyRef: 'processing-family-unmapped',
      processingObservationRef: 'processing-observation-unmapped',
      rootBindings: [
        {
          endpoint: {
            kind: 'NATIVE_RECORD_REVISION',
            sourceRevisionRef: rootRef,
          },
          fileProcessingAssertionRefs: ['file-processing-unmapped'],
          applicabilityEvidenceRefs: ['applicability-proof'],
        },
      ],
      versionMappingCoverage: 'COMPLETE',
      members: [
        member('unknown-iteration', {
          assessmentFamilyRef: 'family-unknown',
          assessmentBusinessRevisionKey: null,
          assessmentObservationRef: 'assessment-unknown-iteration',
          processingAssessmentAssertionRefs: ['relation-unknown-iteration'],
        }),
      ],
    });
    provisionFacts(
      repo,
      unbound,
      new Map([
        [
          'assessment-unknown-iteration',
          {
            version: sourceVersion({
              rawRevision: 'R00',
              rawIteration: null,
              confirmation: 'VERSION_UNCONFIRMED',
            }),
          },
        ],
      ]),
    );
    await expect(sut.save(actor, unbound, null)).rejects.toMatchObject({
      code: 'TDMS_SET_EXACT_MAPPING_UNCONFIRMED',
    });
    expect(repo.sets.has(setKey(scope, 'set-r00-unmapped'))).toBe(false);
  });

  it('requires source succession evidence for changed assessment and processing observations within one cohort', async () => {
    const repo = new MemoryRepository();
    const authority = new FixtureAuthority();
    const { service: sut } = service(repo, authority);
    const initial = set('set-observation-initial', {
      members: [
        member('a', {
          assessmentFamilyRef: 'assessment-family-a',
          assessmentBusinessRevisionKey: 'business-v1',
        }),
      ],
    });
    provisionFacts(repo, initial);
    await sut.save(actor, initial, null);

    const noMemberProof = set('set-observation-without-proof', {
      supersedesSetRevisionRef: initial.setRevisionRef,
      members: [
        member('a', {
          assessmentFamilyRef: 'assessment-family-a',
          assessmentBusinessRevisionKey: 'business-v1',
          assessmentObservationRef: 'observation-a-v2',
        }),
      ],
    });
    provisionFacts(repo, noMemberProof);
    authority.compareResult = {
      cohort: 'SAME',
      roster: 'SAME',
      evidenceRefs: ['same-cohort'],
    };
    expect((await sut.save(actor, noMemberProof, 1)).disposition).toBe(
      'UNRESOLVED',
    );
    expect(
      repo.heads.get(headKey(scope, initial.processingFamilyRef))
        ?.selectedSetRevisionRef,
    ).toBe(initial.setRevisionRef);

    const noParentProof = set('set-parent-without-proof', {
      processingObservationRef: 'processing-observation-v2',
      supersedesSetRevisionRef: initial.setRevisionRef,
      members: [
        member('a', {
          assessmentFamilyRef: 'assessment-family-a',
          assessmentBusinessRevisionKey: 'business-v1',
        }),
      ],
    });
    provisionFacts(repo, noParentProof);
    expect((await sut.save(actor, noParentProof, 1)).disposition).toBe(
      'UNRESOLVED',
    );

    const withParentProof = set('set-parent-with-proof', {
      processingObservationRef: 'processing-observation-v2',
      supersedesSetRevisionRef: initial.setRevisionRef,
      successionEvidenceRefs: ['processing-observation-succession'],
      members: [
        member('a', {
          assessmentFamilyRef: 'assessment-family-a',
          assessmentBusinessRevisionKey: 'business-v1',
        }),
      ],
    });
    provisionFacts(repo, withParentProof);
    authority.compareResult = {
      cohort: 'SAME',
      roster: 'SAME',
      evidenceRefs: ['same-cohort'],
      processingObservationSuccession: {
        olderObservationRef: initial.processingObservationRef,
        newerObservationRef: withParentProof.processingObservationRef,
        evidenceRefs: ['processing-observation-succession'],
      },
    };
    expect((await sut.save(actor, withParentProof, 1)).disposition).toBe(
      'SELECTED',
    );
    expect(
      (await sut.readSelected(actor, scope, initial.processingFamilyRef))?.set
        .processingObservationRef,
    ).toBe(withParentProof.processingObservationRef);
  });

  it('rejects dangling/cross-scope/wrong-kind exact pins and rolls back before head selection', async () => {
    const repo = new MemoryRepository();
    const { service: sut } = service(repo);
    const dangling = set('set-dangling', {
      members: [
        member('missing', {
          assessmentObservationRef: 'missing-assessment',
          processingAssessmentAssertionRefs: ['missing-relation'],
        }),
      ],
    });
    provisionFacts(repo, dangling);
    repo.revisions.delete(revisionKey(scope.tenantId, 'missing-assessment'));
    await expect(sut.save(actor, dangling, null)).rejects.toMatchObject({
      code: 'TDMS_SET_REFERENCE_INVALID',
    });
    expect(repo.sets.size).toBe(0);
    expect(repo.heads.size).toBe(0);

    const foreign = set('set-cross-scope', {
      processingFamilyRef: 'processing-family-foreign',
      members: [],
    });
    provisionFacts(repo, foreign);
    const parent = repo.revisions.get(
      revisionKey(scope.tenantId, foreign.processingObservationRef),
    )!;
    repo.addRevision({
      ...parent,
      scope: { ...parent.scope, scopeId: 'another-scope' },
    });
    await expect(sut.save(actor, foreign, null)).rejects.toMatchObject({
      code: 'TDMS_SET_REFERENCE_INVALID',
    });

    const wrongKind = set('set-wrong-kind', {
      processingFamilyRef: 'processing-family-wrong-kind',
      members: [
        member('wrong-kind', {
          assessmentObservationRef: 'observation-comment',
        }),
      ],
    });
    provisionFacts(repo, wrongKind);
    repo.addRevision(
      record(scope, 'observation-comment', 'COMMENT', 'comment-1'),
    );
    await expect(sut.save(actor, wrongKind, null)).rejects.toMatchObject({
      code: 'TDMS_SET_REFERENCE_INVALID',
    });
    expect(repo.heads.size).toBe(0);
  });

  it('replays identical saves, freezes historical refs and rechecks shared-reader ACL at each read boundary', async () => {
    const repo = new MemoryRepository();
    const authority = new FixtureAuthority();
    const { service: sut } = service(repo, authority);
    const value = set('set-shared');
    provisionFacts(repo, value);
    expect((await sut.save(actor, value, null)).disposition).toBe('SELECTED');
    expect((await sut.save(actor, value, 1)).disposition).toBe('REPLAY');
    expect(repo.sets.size).toBe(1);
    expect(
      repo.heads.get(headKey(scope, value.processingFamilyRef))?.generation,
    ).toBe(1);

    const sharedActor = {
      ...actor,
      canonicalSubject: { namespace: 'MIAODA_USER_ID', id: 'shared-user' },
    } as TdmsPublicActor;
    expect(
      (await sut.readFrozen(sharedActor, scope, value.setRevisionRef))
        .setRevisionRef,
    ).toBe('set-shared');
    expect(
      authority.accessChecks.some(
        (check) => check.actorId === 'shared-user' && check.action === 'READ',
      ),
    ).toBe(true);

    let checks = 0;
    authority.accessHandler = ({ action }) => {
      if (action === 'READ' && ++checks === 2)
        throw codedError('TDMS_SOURCE_NOT_FOUND');
    };
    await expect(
      sut.readFrozen(sharedActor, scope, value.setRevisionRef),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
  });

  it('uses all-or-deny history and requires scope admission even when the set/head query is empty', async () => {
    const repo = new MemoryRepository();
    const authority = new FixtureAuthority();
    const { service: sut } = service(repo, authority);
    const value = set('set-history-one');
    provisionFacts(repo, value);
    await sut.save(actor, value, null);
    const deniedActor = {
      ...actor,
      canonicalSubject: { namespace: 'MIAODA_USER_ID', id: 'denied-user' },
    } as TdmsPublicActor;
    authority.scopeHandler = ({ actor: observed }) => {
      if (observed.canonicalSubject.id === 'denied-user')
        throw codedError('TDMS_SOURCE_NOT_FOUND');
    };
    await expect(
      sut.readSelected(deniedActor, scope, 'unknown-family'),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
    expect(
      authority.scopeChecks.some(
        (c) => c.actorId === 'denied-user' && c.action === 'READ',
      ),
    ).toBe(true);

    authority.scopeHandler = undefined;
    authority.accessHandler = ({ actor: observed }) => {
      if (observed.canonicalSubject.id === 'denied-user')
        throw codedError('TDMS_SOURCE_NOT_FOUND');
    };
    await expect(
      sut.history(deniedActor, scope, value.processingFamilyRef),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
  });

  it('keeps conflict/unordered cohorts unresolved and does not merge independent processing families', async () => {
    const repo = new MemoryRepository();
    const authority = new FixtureAuthority();
    const { service: sut } = service(repo, authority);
    const sharedRoot = {
      kind: 'NATIVE_RECORD_REVISION' as const,
      sourceRevisionRef: 'shared-oem-observation',
    };
    const familyA = set('set-family-a', {
      processingFamilyRef: 'processing-family-a',
      cohortRef: 'cohort-shared-a',
      processingObservationRef: 'processing-observation-a',
      rootBindings: [
        {
          endpoint: sharedRoot,
          fileProcessingAssertionRefs: ['file-processing-family-a'],
          applicabilityEvidenceRefs: ['applies-a'],
        },
      ],
      members: [member('family-a-assessment')],
    });
    const familyB = set('set-family-b', {
      processingFamilyRef: 'processing-family-b',
      cohortRef: 'cohort-shared-b',
      processingObservationRef: 'processing-observation-b',
      rootBindings: [
        {
          endpoint: sharedRoot,
          fileProcessingAssertionRefs: ['file-processing-family-b'],
          applicabilityEvidenceRefs: ['applies-b'],
        },
      ],
      members: [member('family-b-assessment')],
    });
    provisionFacts(repo, familyA);
    provisionFacts(repo, familyB);
    expect((await sut.save(actor, familyA, null)).disposition).toBe('SELECTED');
    expect((await sut.save(actor, familyB, null)).disposition).toBe('SELECTED');
    expect(repo.heads.size).toBe(2);

    const conflicting = set('set-family-a-conflict', {
      processingFamilyRef: 'processing-family-a',
      cohortRef: 'cohort-next',
    });
    provisionFacts(repo, conflicting);
    authority.compareResult = {
      cohort: 'CONFLICT',
      roster: 'CONFLICT',
      evidenceRefs: ['conflicting-proof'],
    };
    expect((await sut.save(actor, conflicting, 1)).disposition).toBe(
      'UNRESOLVED',
    );
    expect(
      repo.heads.get(headKey(scope, 'processing-family-a'))
        ?.selectedSetRevisionRef,
    ).toBe('set-family-a');
    expect(
      repo.heads.get(headKey(scope, 'processing-family-b'))
        ?.selectedSetRevisionRef,
    ).toBe('set-family-b');
  });

  it('never restores a member removed by a verified newer roster when stale roster facts arrive later', async () => {
    const repo = new MemoryRepository();
    const authority = new FixtureAuthority();
    const { service: sut } = service(repo, authority);
    const oldRoster = set('set-roster-ab', {
      members: [member('a'), member('b')],
    });
    provisionFacts(repo, oldRoster);
    await sut.save(actor, oldRoster, null);
    const newRoster = set('set-roster-a', {
      setRevisionRef: 'set-roster-a',
      supersedesSetRevisionRef: 'set-roster-ab',
      sourceRosterRevision: 'roster-1',
      members: [member('a')],
    });
    provisionFacts(repo, newRoster);
    authority.compareResult = {
      cohort: 'SAME',
      roster: 'SUCCESSOR',
      evidenceRefs: ['member-b-removed'],
    };
    expect((await sut.save(actor, newRoster, 1)).disposition).toBe('SELECTED');
    authority.compareResult = {
      cohort: 'SAME',
      roster: 'PREDECESSOR',
      evidenceRefs: ['stale-roster-proof'],
    };
    const delayedOld = {
      ...copy(oldRoster),
      setRevisionRef: 'set-roster-ab-late',
    };
    provisionFacts(repo, delayedOld);
    expect((await sut.save(actor, delayedOld, 2)).disposition).toBe(
      'HISTORY_ONLY',
    );
    expect(
      (
        await sut.readSelected(actor, scope, oldRoster.processingFamilyRef)
      )?.set.members.map((m) => m.memberRef),
    ).toEqual(['a']);
  });

  it('uses the unconfigured provider as default deny and never begins database work', async () => {
    const repo = new MemoryRepository();
    const unavailable = new TdmsProcessingSetService(
      repo,
      new UnconfiguredTdmsProcessingSetAuthority(),
    );
    const value = set('set-deny-default');
    provisionFacts(repo, value);
    await expect(unavailable.save(actor, value, null)).rejects.toMatchObject({
      code: 'TDMS_PROCESSING_SET_AUTHORITY_UNCONFIGURED',
    });
    await expect(
      unavailable.readSelected(actor, scope, value.processingFamilyRef),
    ).rejects.toMatchObject({
      code: 'TDMS_PROCESSING_SET_AUTHORITY_UNCONFIGURED',
    });
    expect(repo.sets.size).toBe(0);
    expect(repo.heads.size).toBe(0);
  });
});
