import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import { CanonicalHostEngineerReviewService } from '../../server/modules/canonical-host/canonical-host-engineer-review.service';
import { CANONICAL_ACTIVE_JOB_AID_CRITERION_SET_ID } from '../../server/modules/canonical-host/canonical-job-aid-browser-rules';
import {
  encodeReviewAttachmentParsedArtifact,
  reviewAttachmentEvidenceStatement,
} from '../../server/modules/review-persistence/review-attachment-artifact';

describe('CanonicalHostEngineerReviewService', () => {
  it('projects the active JobAid rule text for browser review without internal rule metadata', async () => {
    const harness = target();
    harness.state.workItem.integratedAssessment!.baseRules!.criterionSetId =
      CANONICAL_ACTIVE_JOB_AID_CRITERION_SET_ID;
    harness.artifacts.set('artifact://dynamic', dynamicBytes('GOV-001'));

    const context = await harness.service.pageContext(harness.state.workItem);

    expect(context?.items).toEqual([
      expect.objectContaining({
        criterionId: 'GOV-001',
        criterionName: '程序手册优先级与冲突检查',
        evaluationQuestion:
          '本次评估所采用的 JA 规则是否与现行有效程序手册冲突？',
        appliesWhen: '所有使用本规则包的评估。',
        decisionRule: expect.stringContaining('现行有效程序手册为准'),
      }),
    ]);
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain('criterionHash');
    expect(serialized).not.toContain('criterionVersion');
    expect(serialized).not.toContain('ruleArtifact');
    expect(serialized).not.toContain('blockerLevel');
    expect(serialized).not.toContain('automationMode');
    expect(serialized).not.toContain('stageCode');
    expect(serialized).not.toContain('stageName');
  });

  it('derives one browser-safe current gap for a shared missing input', async () => {
    const harness = target();
    harness.state.workItem.integratedAssessment!.baseRules!.criterionSetId =
      CANONICAL_ACTIVE_JOB_AID_CRITERION_SET_ID;
    harness.state.workItem.integratedAssessment!.baseRules!.criterionCount = 2;
    harness.state.workItem.integratedAssessment!.baseRules!.evaluationItemCount = 2;
    harness.state.workItem.integratedAssessment!.baseRules!.unresolvedCount = 2;
    harness.artifacts.set('artifact://dynamic', dynamicGapBytes());

    const context = await harness.service.pageContext(harness.state.workItem);

    expect(context?.gapLedger).toMatchObject({
      inputRevision: 5,
      baseRuleRevision: 1,
      currentness: 'CURRENT',
      candidateOnly: true,
      summary: {
        total: 1,
        open: 1,
        partiallyResolved: 0,
        resolved: 0,
        decisionCritical: 1,
        reviewQueryable: 1,
      },
      gaps: [
        expect.objectContaining({
          gapRef: 'GAP-001',
          missingInputId: 'aircraft.currentPartNumber',
          materiality: 'P0_DECISION_CRITICAL',
          queryability: 'REVIEW_QUERYABLE',
          affectedCriterionIds: ['GOV-001', 'GOV-002'],
          sourceRefs: ['SRC-001', 'SRC-002'],
        }),
      ],
    });
  });

  it('fresh-reads and resolves only the exact Host gap-to-criterion mapping', async () => {
    const harness = target();
    harness.state.workItem.integratedAssessment!.baseRules!.criterionSetId =
      CANONICAL_ACTIVE_JOB_AID_CRITERION_SET_ID;
    harness.state.workItem.integratedAssessment!.baseRules!.criterionCount = 2;
    harness.state.workItem.integratedAssessment!.baseRules!.evaluationItemCount = 2;
    harness.state.workItem.integratedAssessment!.baseRules!.unresolvedCount = 2;
    harness.artifacts.set('artifact://dynamic', dynamicGapBytes());

    const resolved = await harness.service.resolveReviewActionGaps(
      {
        workItemId: 'WI-REVIEW',
        expectedRevision: 5,
        gapRefs: ['GAP-001'],
        affectedCriterionIds: ['GOV-002', 'GOV-001'],
      },
      engineerActor(),
    );

    expect(resolved).toEqual({
      gapRefs: ['GAP-001'],
      resolvedMissingInputs: ['aircraft.currentPartNumber'],
      affectedCriterionIds: ['GOV-001', 'GOV-002'],
    });
    expect(harness.state.attempts).toBe(0);
    expect(harness.state.persisted).toHaveLength(0);
  });

  it('rejects invented gaps and incomplete affected-only mappings before mutation', async () => {
    const harness = target();
    harness.state.workItem.integratedAssessment!.baseRules!.criterionSetId =
      CANONICAL_ACTIVE_JOB_AID_CRITERION_SET_ID;
    harness.state.workItem.integratedAssessment!.baseRules!.criterionCount = 2;
    harness.state.workItem.integratedAssessment!.baseRules!.evaluationItemCount = 2;
    harness.state.workItem.integratedAssessment!.baseRules!.unresolvedCount = 2;
    harness.artifacts.set('artifact://dynamic', dynamicGapBytes());

    await expect(
      harness.service.resolveReviewActionGaps(
        {
          workItemId: 'WI-REVIEW',
          expectedRevision: 5,
          gapRefs: ['GAP-404'],
          affectedCriterionIds: ['GOV-001', 'GOV-002'],
        },
        engineerActor(),
      ),
    ).rejects.toThrow('ENGINEER_REVIEW_GAP_UNKNOWN:GAP-404');
    await expect(
      harness.service.resolveReviewActionGaps(
        {
          workItemId: 'WI-REVIEW',
          expectedRevision: 5,
          gapRefs: ['GAP-001'],
          affectedCriterionIds: ['GOV-001'],
        },
        engineerActor(),
      ),
    ).rejects.toThrow('ENGINEER_REVIEW_GAP_AFFECTED_CRITERIA_MISMATCH');
    expect(harness.state.attempts).toBe(0);
    expect(harness.state.persisted).toHaveLength(0);
  });

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

  it('records server-private non-attachment evidence and exposes no actor authority to OpenClaw', async () => {
    const harness = target();
    const updated = await harness.service.recordReviewAction(
      {
        workItemId: 'WI-REVIEW',
        expectedRevision: 5,
        criterionId: 'RULE-001',
        actionType: 'SUPPLEMENT_EVIDENCE',
        comment: '补充 Host 内部解析的受控飞机构型事实，只重算本项。',
        evidence: [
          {
            kind: 'AIRCRAFT_FACT',
            statement: '该机当前构型已安装目标件号。',
            locator: 'FleetMasterData/AC-001@2026-08-26',
          },
        ],
        resolvedMissingInputs: [],
      },
      {
        userId: 'engineer-1',
        tenantId: 'tenant-1',
        appId: 'app_17bzc551rsg',
        env: 'development',
        roles: [],
      },
    );

    expect(updated.revision).toBe(6);
    const context = await harness.service.modelContext(updated);
    expect(context.effective).toEqual([
      expect.objectContaining({
        criterionId: 'RULE-001',
        actionType: 'SUPPLEMENT_EVIDENCE',
        evidence: [
          expect.objectContaining({
            kind: 'AIRCRAFT_FACT',
            sourceRefId: expect.stringMatching(/^review-evidence:\/\//),
          }),
        ],
      }),
    ]);
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain('engineer-1');
    expect(serialized).not.toContain('ATT-1');
  });

  it('fails explicitly when a Review attachment descriptor does not resolve to actual bytes', async () => {
    const harness = target();
    await expect(
      harness.service.recordReviewAction(
        {
          workItemId: 'WI-REVIEW',
          expectedRevision: 5,
          criterionId: 'RULE-001',
          actionType: 'SUPPLEMENT_EVIDENCE',
          comment: '不得信任 caller 提供的跨对象 artifact descriptor。',
          evidence: [
            {
              kind: 'ATTACHMENT',
              statement: 'caller 声称的附件事实。',
              locator: 'caller-provided locator',
              artifact: attachmentArtifact(),
            },
          ],
          resolvedMissingInputs: [],
        },
        {
          userId: 'engineer-1',
          tenantId: 'tenant-1',
          appId: 'app_17bzc551rsg',
          env: 'development',
          roles: [],
        },
      ),
    ).rejects.toThrow('ARTIFACT_NOT_FOUND');
    expect(harness.state.readRefs).toContain('artifact://attachment');
    expect(harness.state.attempts).toBe(0);
    expect(harness.state.persisted).toHaveLength(0);
  });

  it('records an attachment only after resolving and checking its parsed actual bytes', async () => {
    const harness = target();
    const parsed = {
      schemaVersion: 'wiselink.3_1.review_attachment_parse.v1.c7' as const,
      attachmentRef: 'ATTACHMENT-1',
      workItemId: 'WI-REVIEW',
      reviewConversationId: 'RC-1',
      documentVersionId: 'DV-ATTACHMENT-1',
      fileName: 'engineering-note.pdf',
      mediaType: 'application/pdf' as const,
      byteLength: 321,
      pageCount: 1,
      pages: [{ page: 1, text: 'Verified attachment engineering fact.' }],
    };
    harness.artifacts.set(
      'artifact://attachment',
      encodeReviewAttachmentParsedArtifact(parsed),
    );
    const updated = await harness.service.recordReviewAction(
      {
        workItemId: 'WI-REVIEW',
        expectedRevision: 5,
        criterionId: 'RULE-001',
        affectedCriterionIds: ['RULE-001'],
        actionType: 'SUPPLEMENT_EVIDENCE',
        comment: 'Adopt the Host-resolved attachment evidence.',
        evidence: [
          {
            kind: 'ATTACHMENT',
            statement: reviewAttachmentEvidenceStatement(parsed),
            locator: 'ATTACHMENT-1',
            artifact: attachmentArtifact(),
          },
        ],
        resolvedMissingInputs: [],
      },
      {
        userId: 'engineer-1',
        tenantId: 'tenant-1',
        appId: 'app_17bzc551rsg',
        env: 'development',
        roles: [],
      },
    );

    expect(updated.revision).toBe(6);
    expect(updated.integratedAssessment?.overallSynthesis).toMatchObject({
      status: 'STALE',
      staleReason: 'ENGINEER_REVIEW_CHANGED',
    });
    const context = await harness.service.modelContext(updated);
    expect(context.effective[0]).toMatchObject({
      affectedCriterionIds: ['RULE-001'],
      evidence: [
        expect.objectContaining({
          kind: 'ATTACHMENT',
          locator: 'ATTACHMENT-1',
        }),
      ],
    });
  });

  it('fails stale expectedRevision before reserving an ActionAttempt', async () => {
    const harness = target();
    await expect(
      harness.service.recordReviewAction(
        {
          workItemId: 'WI-REVIEW',
          expectedRevision: 4,
          criterionId: 'RULE-001',
          actionType: 'CORRECT_ANALYSIS_DIRECTION',
          comment: '应按现行构型重新判断。',
          correctedAnalysisDirection: '以现行飞机构型和生效日期为准。',
        },
        {
          userId: 'engineer-1',
          tenantId: 'tenant-1',
          appId: 'app_17bzc551rsg',
          env: 'development',
          roles: [],
        },
      ),
    ).rejects.toThrow('WORK_ITEM_CAS_CONFLICT');
    expect(harness.state.attempts).toBe(0);
    expect(harness.state.persisted).toHaveLength(0);
  });
});

function target() {
  const state = {
    workItem: workItem(),
    persisted: [] as Uint8Array[],
    completed: [] as string[],
    readRefs: [] as string[],
    events: [] as string[],
    attempts: 0,
  };
  const artifacts = new Map<string, Uint8Array>([
    ['artifact://dynamic', dynamicBytes()],
  ]);
  const artifactStore = {
    readActualBytes: async (artifact: { ref: string }) => {
      state.readRefs.push(artifact.ref);
      state.events.push(`read:${artifact.ref}`);
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
        state.events.push('reserve');
        state.attempts += 1;
        return { attemptId: `ATT-${state.attempts}`, created: true };
      },
      completeAssessmentAction: async (attemptId: string) => {
        state.completed.push(attemptId);
      },
      failAssessmentAction: async () => undefined,
    } as never,
  );
  return { service, state, artifacts };
}

function attachmentArtifact() {
  return {
    storeRole: 'UnifiedArtifactStoreCandidate' as const,
    ref: 'artifact://attachment',
    sha256: 'e'.repeat(64),
    byteLength: 15,
    mediaType: 'application/json' as const,
  };
}

function engineerActor() {
  return {
    userId: 'engineer-1',
    tenantId: 'tenant-1',
    appId: 'app_17bzc551rsg',
    env: 'development',
    roles: [],
  };
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

function dynamicBytes(criterionId = 'RULE-001') {
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
            criterionId,
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

function dynamicGapBytes() {
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
            'GOV-001',
            'UNKNOWN',
            ['fact-1'],
            'rule application 1',
            'analysis 1',
            'waiting for controlled fact',
            ['SRC-001'],
            ['aircraft.currentPartNumber'],
            true,
          ],
          [
            'GOV-002',
            'UNKNOWN',
            ['fact-2'],
            'rule application 2',
            'analysis 2',
            'waiting for controlled fact',
            ['SRC-002'],
            ['aircraft.currentPartNumber'],
            true,
          ],
        ],
      },
    }),
  );
}
