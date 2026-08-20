import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import { CanonicalHostEngineerReviewService } from '../../server/modules/canonical-host/canonical-host-engineer-review.service';

describe('CanonicalHostEngineerReviewService', () => {
  it('appends repeated criterion reviews, stales overall, clears AEO, and exposes only sanitized model context', async () => {
    const harness = target();
    const actor = {
      userId: 'engineer-1',
      tenantId: 'tenant-1',
      appId: 'app_17bzc551rsg',
      env: 'development',
      roles: [],
    };

    const first = await harness.service.recordReview(
      {
        workItemId: 'WI-REVIEW',
        expectedRevision: 5,
        criterionId: 'RULE-001',
        decision: 'deferred',
        comment: '需要补充受控构型输入。',
      },
      actor,
    );
    expect(first.integratedAssessment).toMatchObject({
      status: 'OVERALL_CANDIDATE_STALE',
      engineerReviews: { revision: 1, reviewCount: 1 },
      overallSynthesis: {
        status: 'STALE',
        staleReason: 'ENGINEER_REVIEW_CHANGED',
      },
      overallForAeoConfirmation: null,
    });
    expect(first.aeo).toBeNull();

    const second = await harness.service.recordReview(
      {
        workItemId: 'WI-REVIEW',
        expectedRevision: 6,
        criterionId: 'RULE-001',
        decision: 'confirmed_pass',
        comment: '补充输入已核对，保留候选层级。',
      },
      actor,
    );
    expect(second.integratedAssessment?.engineerReviews).toMatchObject({
      revision: 2,
      reviewCount: 2,
    });

    const context = await harness.service.modelContext(second);
    expect(context).toMatchObject({ revision: 2, reviewCount: 2 });
    expect(context.history).toHaveLength(2);
    expect(context.effective).toEqual([
      expect.objectContaining({
        criterionId: 'RULE-001',
        decision: 'confirmed_pass',
      }),
    ]);
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain('engineer-1');
    expect(serialized).not.toContain('ATT-');
    expect(harness.state.persisted).toHaveLength(2);
    expect(harness.state.completed).toEqual(['ATT-1', 'ATT-2']);
  });

  it('rejects an unknown criterion before ActionAttempt or artifact I/O', async () => {
    const harness = target();
    await expect(
      harness.service.recordReview(
        {
          workItemId: 'WI-REVIEW',
          expectedRevision: 5,
          criterionId: 'RULE-UNKNOWN',
          decision: 'deferred',
          comment: '不应保存。',
        },
        {
          userId: 'engineer-1',
          tenantId: 'tenant-1',
          appId: 'app_17bzc551rsg',
          env: 'development',
          roles: [],
        },
      ),
    ).rejects.toThrow('ENGINEER_REVIEW_CRITERION_UNKNOWN:RULE-UNKNOWN');
    expect(harness.state.persisted).toHaveLength(0);
  });
});

function target() {
  const state = {
    workItem: workItem(),
    persisted: [] as Uint8Array[],
    completed: [] as string[],
    attempts: 0,
  };
  const artifacts = new Map<string, Uint8Array>([
    ['artifact://dynamic', dynamicBytes()],
  ]);
  const artifactStore = {
    readActualBytes: async (artifact: { ref: string }) => {
      const bytes = artifacts.get(artifact.ref);
      if (!bytes) throw new Error('ARTIFACT_NOT_FOUND');
      return bytes;
    },
    persistAndReadback: async (bytes: Uint8Array) => {
      const ref = `artifact://review-${state.persisted.length + 1}`;
      const copy = Uint8Array.from(bytes);
      artifacts.set(ref, copy);
      state.persisted.push(copy);
      return {
        artifact: {
          storeRole: 'UnifiedArtifactStoreCandidate' as const,
          ref,
          sha256: String(state.persisted.length).repeat(64),
          byteLength: copy.byteLength,
          mediaType: 'application/json' as const,
        },
        bytes: copy,
        reused: false,
      };
    },
  };
  const service = new CanonicalHostEngineerReviewService(
    {
      getByWorkItemId: async () => state.workItem,
      getTenantScopedByWorkItemId: async () => state.workItem,
      compareAndSet: async (input: {
        expectedRevision: number;
        next: Omit<CanonicalWorkItemProjection, 'revision'>;
      }) => {
        if (state.workItem.revision !== input.expectedRevision) {
          throw new Error('WORK_ITEM_CAS_CONFLICT');
        }
        state.workItem = {
          ...input.next,
          revision: input.expectedRevision + 1,
        };
        return state.workItem;
      },
    } as never,
    {
      authorize: async (input: { action: string }) => ({
        action: input.action,
        allowed: true,
        permissionSnapshotVersion: 'permission-1',
      }),
    } as never,
    {
      freshRead: async () => ({ permissionSnapshotVersion: 'permission-1' }),
    } as never,
    { nowIso: () => `2026-08-17T00:00:0${state.attempts}.000Z` },
    artifactStore as never,
    {
      reserveAssessmentAction: async () => {
        state.attempts += 1;
        return { attemptId: `ATT-${state.attempts}`, created: true };
      },
      completeAssessmentAction: async (attemptId: string) => {
        state.completed.push(attemptId);
      },
      failAssessmentAction: async () => undefined,
    } as never,
  );
  return { service, state };
}

function workItem(): CanonicalWorkItemProjection {
  const artifact = (ref: string, sha256: string) => ({
    storeRole: 'UnifiedArtifactStoreCandidate' as const,
    ref,
    sha256,
    byteLength: 100,
    mediaType: 'application/json' as const,
  });
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: 'WI-REVIEW',
    requestId: 'REQ-REVIEW',
    revision: 5,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    permissionSnapshotVersion: 'permission-1',
    parseAuthorization: {} as never,
    source: {
      documentId: 'DOC-737',
      documentVersionId: 'DV-737',
      sourceArtifactId: 'SOURCE-737',
      artifactSha256: 'a'.repeat(64),
      byteLength: 100,
    } as never,
    classification: {
      status: 'CONFIRMED',
      normalizedFamily: 'SB',
      parserProfileId: 'issuer.boeing.sb',
    } as never,
    package: {
      packageId: 'PKG-737',
      artifact: artifact('artifact://package', 'b'.repeat(64)),
    } as never,
    assessment: null,
    integratedAssessment: {
      status: 'OVERALL_CANDIDATE_READY',
      baseRules: {
        status: 'CANDIDATE_ONLY',
        revision: 1,
        sourceResultId: 'openclaw-dynamic://DYN-1',
        criterionSetId: 'JACS-ONE',
        criterionCount: 1,
        evaluationItemCount: 1,
        unresolvedCount: 0,
        sourceBoundCandidateCount: 1,
        artifact: artifact('artifact://dynamic', 'c'.repeat(64)),
        actionAttemptId: 'ATT-DYNAMIC',
      },
      engineerReviews: null,
      overallSynthesis: {
        status: 'CANDIDATE_ONLY',
        revision: 1,
        sourceResultId: 'openclaw-overall://OVR-1',
        basedOnBaseRuleRevision: 1,
        basedOnBaseRuleArtifactSha256: 'c'.repeat(64),
        basedOnEngineerReviewRevision: null,
        basedOnEngineerReviewArtifactSha256: null,
        discoveryStatus: 'NO_DISCOVERY',
        gap: null,
        candidateRefCount: 0,
        findingCount: 1,
        unresolvedCount: 0,
        authorityLevel: 'candidate_only',
        externalDiscoveryIsEvidence: false,
        artifact: artifact('artifact://overall', 'd'.repeat(64)),
        actionAttemptId: 'ATT-OVERALL',
        staleReason: null,
      },
      overallForAeoConfirmation: {
        status: 'HUMAN_CONFIRMED',
      } as never,
    },
    aeo: { status: 'CANDIDATE_WORD_EXPORTED' } as never,
    failure: null,
    recordingFailure: null,
  };
}

function dynamicBytes() {
  return new TextEncoder().encode(
    JSON.stringify({
      ruleResults: {
        columns: [
          'ruleId',
          'result',
          'factsConsidered',
          'ruleApplication',
          'analysisSummary',
          'conclusion',
          'sourceRefs',
          'missingInputs',
          'humanReviewRequired',
        ],
        rows: [
          [
            'RULE-001',
            'PASS',
            ['fact'],
            'rule application',
            'analysis',
            'candidate conclusion',
            ['SRC-001'],
            [],
            true,
          ],
        ],
      },
    }),
  );
}
