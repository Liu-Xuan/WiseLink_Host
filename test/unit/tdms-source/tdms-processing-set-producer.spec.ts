import { TdmsProcessingSetProducerService } from '@server/modules/tdms-source/tdms-processing-set-producer.service';
import { TdmsProcessingSetSourceAuthority } from '@server/modules/tdms-source/tdms-processing-set-source-authority';
import { TDMS_EXPECTED_RECEIVER_HEADER } from '@server/modules/tdms-source/tdms-receiver-expectation';
import { canonical } from '@server/modules/tdms-source/tdms-source.validation';
import { copyComplete } from './tdms-complete-owned.fixture';
import { createProcessingProducerFixture } from './tdms-processing-set-producer.fixture';
import { source092RecordProof } from './tdms-source092-dto.fixture';

describe('actual retained processing producer and independently authorized reads', () => {
  let f: Awaited<ReturnType<typeof createProcessingProducerFixture>>;
  beforeEach(async () => {
    f = await createProcessingProducerFixture();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await f?.module.close();
  });

  it.each(['SB', 'SL'] as const)(
    '%s uses the same processing/assessment production DI, save and independent read',
    async (rootScope) => {
      if (rootScope === 'SB') {
        await f.module.close();
        f = await createProcessingProducerFixture('SB');
      }
      const input = await f.seed();
      expect(Reflect.get(f.controller, 'producer')).toBe(
        f.module.get(TdmsProcessingSetProducerService),
      );
      expect(Reflect.get(f.producer, 'authority')).toBeInstanceOf(
        TdmsProcessingSetSourceAuthority,
      );
      expect(
        f.storage.state.revisions
          .slice(0, 3)
          .map((row) => source092RecordProof(row.record).scopeId),
      ).toEqual([rootScope, 'SB_PROCESSING_FORM', 'SB_ASSESSMENT_FORM']);
      const before = canonical(f.storage.state);
      const saved = await f.controller.fromRetained(f.request, input);
      expect(saved.status).toBe('RETAINED_UNRESOLVED');
      expect(saved.receipt).toMatchObject({
        setRevisionRef: input.operationRef,
        disposition: 'UNRESOLVED',
        selectedSetRevisionRef: null,
        generation: null,
      });
      const frozen = await f.controller.frozen(
        f.request,
        input.operationRef,
        f.query,
      );
      expect(frozen.set.processingObservationRef).toBe(
        input.processingObservationRef,
      );
      expect(frozen.set.processingFamilyRef).toBe(
        f.storage.state.revisions[1].record.recordRef,
      );
      expect(frozen.set.familyIdentityEvidenceRefs).toEqual([]);
      expect(frozen.set.cohortRef).toBeNull();
      expect(frozen.set.currentness).toBe('UNKNOWN');
      expect(frozen.set.members[0].membershipResolution).toBe('OBSERVED_ONLY');
      expect(frozen.set.rootBindings[0].fileProcessingAssertionRefs).toEqual(
        [],
      );
      expect(frozen.set.members[0].processingAssessmentAssertionRefs).toEqual(
        [],
      );
      expect(JSON.stringify(frozen)).not.toContain('TBD / feedback');
      expect(
        await f.controller.selected(
          f.request,
          frozen.set.processingFamilyRef,
          f.query,
        ),
      ).toEqual({ selection: null });
      expect(canonical(f.storage.state)).toBe(before);
      expect(f.committed.heads.size).toBe(0);
      const write = f.state.queries.find((query) =>
        query.sql.includes('INSERT INTO tdms_processing_revision_set'),
      )!;
      expect(
        f.state.queries.filter(
          (query) =>
            query.sql.includes('FROM tdms_capture c') &&
            query.transactionId === write.transactionId,
        ).length,
      ).toBeGreaterThan(0);
      expect(
        f.state.queries.some((query) =>
          /(?:INSERT INTO|UPDATE) tdms_relation/u.test(query.sql),
        ),
      ).toBe(false);
    },
  );
  it('retains requested but unobserved members as UNRESOLVED, never as Source membership', async () => {
    const input = await f.seed();
    input.captures.push({
      packageId: f.storage.state.captures[3].packageId,
      captureRef: f.storage.state.captures[3].receipt.captureRef,
    });
    input.assessmentObservationRefs.push(
      f.storage.state.revisions[3].record.sourceRevisionRef,
    );
    await f.controller.fromRetained(f.request, input);
    const { set } = await f.controller.frozen(
      f.request,
      input.operationRef,
      f.query,
    );
    expect(set.members.map((member) => member.membershipResolution)).toEqual([
      'OBSERVED_ONLY',
      'UNRESOLVED',
    ]);
    expect(set.members[1].gaps).toContain(
      'MEMBER_REQUEST_WITHOUT_SOURCE_RELATION',
    );
  });
  it('does not save a manufacturer observation as a processing own observation', async () => {
    const input = await f.seed();
    input.captures = input.captures.slice(0, 1);
    input.processingObservationRef =
      f.storage.state.revisions[0].record.sourceRevisionRef;
    input.rootObservationRefs = [];
    input.assessmentObservationRefs = [];
    await expect(
      f.controller.fromRetained(f.request, input),
    ).resolves.toMatchObject({
      status: 'NOT_RETAINED',
      receipt: null,
      diagnostic: { code: 'PROCESSING_OBSERVATION_NOT_ACQUIRED' },
    });
    expect(f.committed.sets.size).toBe(0);
    expect(f.state.proofReads).toBe(0);
  });
  it('keeps IMPORT and frozen READ independent, including native SSO without OAuth on read', async () => {
    const input = await f.seed();
    f.actions.READ_HISTORY.allowed = false;
    f.actions.READ_RECORD.allowed = false;
    await expect(
      f.controller.fromRetained(f.request, input),
    ).resolves.toMatchObject({ status: 'RETAINED_UNRESOLVED' });
    await expect(
      f.controller.frozen(f.request, input.operationRef, f.query),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
    f.actions.IMPORT.allowed = false;
    f.actions.READ_HISTORY.allowed = true;
    f.request.headers.cookie = '';
    await expect(
      f.controller.frozen(f.request, input.operationRef, f.query),
    ).resolves.toHaveProperty('set');
    await expect(
      f.controller.fromRetained(f.request, {
        ...input,
        operationRef: 'synthetic-no-oauth',
      }),
    ).rejects.toMatchObject({ code: 'OFFICIAL_OAUTH_SESSION_REQUIRED' });
  });
  it('checks IMPORT exact members before any proof projection and checks READ_RELATIONS independently', async () => {
    const input = await f.seed();
    const original = copyComplete(f.actions.IMPORT.permittedMembers);
    f.actions.IMPORT.permittedMembers.records = [];
    await expect(
      f.controller.fromRetained(f.request, input),
    ).rejects.toMatchObject({ code: 'TDMS_RECEIVER_EXACT_MEMBER_DENIED' });
    expect(f.state.proofReads).toBe(0);
    f.actions.IMPORT.permittedMembers = original;
    await f.controller.fromRetained(f.request, input);
    f.actions.READ_RELATIONS.allowed = false;
    await expect(
      f.controller.frozen(f.request, input.operationRef, f.query),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
  });
  it.each(['record', 'relation'] as const)(
    'checks the exact current READ %s members before proof projection',
    async (kind) => {
      const input = await f.seed();
      await f.controller.fromRetained(f.request, input);
      const reads = f.state.proofReads;
      if (kind === 'record')
        f.actions.READ_HISTORY.permittedMembers.records = [];
      else f.actions.READ_RELATIONS.permittedMembers.relationIds = [];
      await expect(
        f.controller.frozen(f.request, input.operationRef, f.query),
      ).rejects.toMatchObject({ code: 'TDMS_RECEIVER_EXACT_MEMBER_DENIED' });
      expect(f.state.proofReads).toBe(reads);
    },
  );
  it('refuses an in-flight READ member revocation without returning frozen metadata', async () => {
    const input = await f.seed();
    await f.controller.fromRetained(f.request, input);
    f.state.afterQuery = (sql) => {
      if (sql.includes('FROM tdms_capture c'))
        f.actions.READ_HISTORY.permittedMembers.records = [];
    };
    await expect(
      f.controller.frozen(f.request, input.operationRef, f.query),
    ).rejects.toMatchObject({ code: 'TDMS_RECEIVER_EXACT_MEMBER_DENIED' });
  });
  it('withholds frozen metadata when the authorized read transaction returns after expiry', async () => {
    const input = await f.seed();
    await f.controller.fromRetained(f.request, input);
    const now = Date.now();
    f.actions.READ_HISTORY.validUntil = new Date(now + 1000).toISOString();
    f.state.afterCommit = () => {
      jest.spyOn(Date, 'now').mockReturnValue(now + 2000);
    };
    await expect(
      f.controller.frozen(f.request, input.operationRef, f.query),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_PERMISSION_CHANGED' });
  });
  it.each(['scope', 'capture', 'version', 'candidate'] as const)(
    'rejects a mismatched %s without a retained set',
    async (kind) => {
      const input = await f.seed();
      if (kind === 'scope') input.scope.scopeId = 'foreign-scope';
      if (kind === 'capture')
        f.storage.state.captures[0].dailyMetadata!.nativeRetention!.records[0].sourceRevisionRef =
          input.processingObservationRef!;
      if (kind === 'version')
        f.storage.state.revisions[1].record.sourceVersion.rawRevision =
          'FOREIGN';
      if (kind === 'candidate')
        f.storage.state.assertions[0].assertion.authority = 'SOURCE_EXPLICIT';
      await expect(
        f.controller.fromRetained(f.request, input),
      ).rejects.toBeDefined();
      expect(f.committed.sets.size).toBe(0);
    },
  );
  it('rejects another actor and stale receiver expectation instead of adopting the submitted identity', async () => {
    const input = await f.seed();
    f.request.userContext!.userId = 'synthetic-other-actor';
    await expect(
      f.controller.fromRetained(f.request, input),
    ).rejects.toBeDefined();
    f.request.userContext!.userId = '123';
    const binding = await f.receiver.binding(f.request);
    f.request.headers[TDMS_EXPECTED_RECEIVER_HEADER] = Buffer.from(
      JSON.stringify(binding),
    ).toString('base64url');
    f.row.grantRevision++;
    await expect(
      f.controller.fromRetained(f.request, input),
    ).rejects.toMatchObject({ code: 'TDMS_RECEIVER_IDENTITY_CHANGED' });
    expect(f.committed.sets.size).toBe(0);
  });
  it('replays the exact operation and applies existing generation CAS without selecting a head', async () => {
    const input = await f.seed();
    await f.controller.fromRetained(f.request, input);
    await expect(
      f.controller.fromRetained(f.request, input),
    ).resolves.toMatchObject({ receipt: { disposition: 'REPLAY' } });
    expect(f.committed.sets.size).toBe(1);
    const processing = f.storage.state.revisions[1].record;
    f.committed.heads.set(processing.recordRef, {
      scope: f.scope,
      processingFamilyRef: processing.recordRef,
      selectedSetRevisionRef: 'synthetic-preexisting-head',
      generation: 4,
    });
    await expect(
      f.controller.fromRetained(f.request, {
        ...input,
        operationRef: 'synthetic-cas-failure',
        expectedGeneration: 3,
      }),
    ).rejects.toMatchObject({ code: 'TDMS_PROCESSING_SET_CAS_CONFLICT' });
    expect(f.committed.sets.size).toBe(1);
    expect(f.committed.heads.get(processing.recordRef)?.generation).toBe(4);
  });
  it('rolls back set insertion when current IMPORT is revoked before the transaction finishes', async () => {
    const input = await f.seed();
    f.state.afterQuery = (sql) => {
      if (sql.includes('INSERT INTO tdms_processing_revision_set'))
        f.actions.IMPORT.allowed = false;
    };
    await expect(
      f.controller.fromRetained(f.request, input),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
    expect(f.committed.sets.size).toBe(0);
  });
  it.each(['source', 'oauth'] as const)(
    'withholds a late commit response after its admitted %s deadline',
    async (kind) => {
      const input = await f.seed();
      const now = Date.now();
      if (kind === 'source')
        f.actions.IMPORT.validUntil = new Date(now + 1000).toISOString();
      else f.session.expiresAt = new Date(now + 1000);
      f.state.afterCommit = () => {
        jest.spyOn(Date, 'now').mockReturnValue(now + 2000);
      };
      await expect(
        f.controller.fromRetained(f.request, input),
      ).rejects.toMatchObject({
        code:
          kind === 'source'
            ? 'TDMS_SOURCE_PERMISSION_CHANGED'
            : 'TDMS_PROCESSING_REQUEST_IDENTITY_CHANGED',
      });
      // The transaction outcome is known committed; no automatic retry or rollback claim.
      expect(f.committed.sets.size).toBe(1);
    },
  );
  it.each([
    'CURRENT',
    'CONFIRMED',
    'cohort',
    'family',
    'roster',
    'succession',
  ] as const)(
    'refuses unsupported %s declarations on a retained set',
    async (kind) => {
      const input = await f.seed();
      await f.controller.fromRetained(f.request, input);
      const set = f.committed.sets.get(input.operationRef)!;
      if (kind === 'CURRENT') {
        set.currentness = 'CURRENT';
        set.currentnessEvidenceRefs = ['synthetic-unsupported'];
      }
      if (kind === 'CONFIRMED') {
        set.members[0].membershipResolution = 'CONFIRMED';
        set.members[0].cohortMembershipEvidenceRefs = [
          'synthetic-unverified-membership',
        ];
        set.cohortRef = 'synthetic-unverified-cohort';
      }
      if (kind === 'cohort') set.cohortRef = 'synthetic-unverified-cohort';
      if (kind === 'family')
        set.familyIdentityEvidenceRefs = ['synthetic-unverified-family'];
      if (kind === 'roster')
        set.rosterEvidenceRefs = ['synthetic-unverified-roster'];
      if (kind === 'succession')
        set.successionEvidenceRefs = ['synthetic-unverified-succession'];
      await expect(
        f.controller.frozen(f.request, input.operationRef, f.query),
      ).rejects.toMatchObject({ code: 'TDMS_PROCESSING_FACTS_UNSUPPORTED' });
    },
  );
});
