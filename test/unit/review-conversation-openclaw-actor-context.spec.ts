import { Logger } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ReviewConversationRepository } from '../../server/modules/review-persistence/review-conversation.repository';

describe('ReviewConversationRepository OpenClaw actor context', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sets the Host-owned actor and reads the Review binding in one statement', async () => {
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const db = {
      execute: jest.fn(async () => [
        {
          actorContext: 'actor-1',
          authenticatedRoleMember: false,
          serviceRoleMember: true,
          rowSecurityActive: true,
          expectedSchemaResolved: true,
          reviewSelectPolicyPresent: true,
          reviewCandidateUpdatePolicyPresent: true,
          reviewRlsEnabled: true,
        },
      ]),
      transaction: jest.fn(),
      select: jest.fn(),
    };
    const repository = new ReviewConversationRepository(db as never);

    await expect(
      repository.loadOpenClawTurnBinding({
        reviewConversationId: 'RC-1',
        requestId: 'request-1',
        tenantId: 'tenant-1',
        actorId: 'actor-1',
        workItemId: 'WI-1',
      }),
    ).resolves.toBeNull();

    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'OPENCLAW_REVIEW_BINDING_NOT_FOUND',
        reason: 'CONVERSATION_NOT_VISIBLE',
        diagnostic: {
          actorContextApplied: true,
          runtimeRoleClass: 'SERVICE_ROLE_MEMBER',
          authenticatedRoleMember: false,
          serviceRoleMember: true,
          rowSecurityActive: true,
          expectedSchemaResolved: true,
          sameConnectionContextSupported: true,
          reviewSelectPolicyPresent: true,
          reviewCandidateUpdatePolicyPresent: true,
          reviewRlsEnabled: true,
          rlsPolicyApplicable: true,
          exactActiveConversationVisible: false,
        },
      }),
    );
    expect(warning.mock.calls.flat().join(' ')).not.toMatch(
      /actor-1|tenant-1|WI-1|RC-1|request-1/u,
    );
  });

  it('normalizes raw SQL timestamp strings at the Review persistence boundary', async () => {
    const db = {
      execute: jest.fn(async () => [
        {
          actorContext: 'actor-1',
          authenticatedRoleMember: true,
          serviceRoleMember: false,
          rowSecurityActive: true,
          expectedSchemaResolved: true,
          reviewSelectPolicyPresent: true,
          reviewCandidateUpdatePolicyPresent: true,
          reviewRlsEnabled: true,
          reviewConversationId: 'RC-1',
          conversationTenantId: 'tenant-1',
          conversationActorId: 'actor-1',
          conversationWorkItemId: 'WI-1',
          openClawAgentId: 'wiselink-engineering',
          openClawSessionKey: 'review:server-owned-secret',
          startedAtRevision: 7,
          lastSyncedRevision: 7,
          conversationStatus: 'ACTIVE',
          conversationCreatedAt: '2026-08-26T10:00:00.000Z',
          lastActiveAt: '2026-08-26T10:01:00.000Z',
          closedAt: null,
          officialMappingId: 'ISM-1',
          reviewTurnId: 'RT-1',
          turnReviewConversationId: 'RC-1',
          engineerSuppliedInputId: 'ESI-1',
          turnNo: 1,
          requestId: 'request-1',
          inputRevision: 7,
          userMessage: 'Please review rule 1.',
          inputType: 'ENGINEER_TEXT',
          adoptionStatus: 'CANDIDATE_UNADOPTED',
          candidateText: 'Please review rule 1.',
          responseType: null,
          assistantResponse: null,
          sourceRefsJson: null,
          missingInputsJson: null,
          candidateEvidenceRefsJson: null,
          reviewActionDraftJson: null,
          affectedItemIdsJson: null,
          warningsJson: null,
          resultProvenanceJson: null,
          resultContentHash: null,
          actionAttemptId: null,
          assistantCompletedAt: null,
          turnCreatedAt: '2026-08-26T10:02:00.000Z',
        },
      ]),
    };
    const repository = new ReviewConversationRepository(db as never);

    const binding = await repository.loadOpenClawTurnBinding({
      reviewConversationId: 'RC-1',
      requestId: 'request-1',
      tenantId: 'tenant-1',
      actorId: 'actor-1',
      workItemId: 'WI-1',
    });

    expect(binding?.conversation.createdAt).toEqual(
      new Date('2026-08-26T10:00:00.000Z'),
    );
    expect(binding?.conversation.lastActiveAt).toEqual(
      new Date('2026-08-26T10:01:00.000Z'),
    );
    expect(binding?.turn.createdAt).toEqual(
      new Date('2026-08-26T10:02:00.000Z'),
    );
    expect(binding?.conversation.createdAt).toBeInstanceOf(Date);
    expect(binding?.turn.createdAt).toBeInstanceOf(Date);
  });

  it('fails closed when the one-statement actor context is not established', async () => {
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const db = {
      execute: jest.fn(async () => [
        {
          actorContext: 'actor-other',
          authenticatedRoleMember: true,
          serviceRoleMember: false,
          rowSecurityActive: true,
          expectedSchemaResolved: true,
          reviewSelectPolicyPresent: true,
          reviewCandidateUpdatePolicyPresent: true,
          reviewRlsEnabled: true,
        },
      ]),
      transaction: jest.fn(),
      select: jest.fn(),
    };
    const repository = new ReviewConversationRepository(db as never);

    await expect(
      repository.loadOpenClawTurnBinding({
        reviewConversationId: 'RC-1',
        requestId: 'request-1',
        tenantId: 'tenant-1',
        actorId: 'actor-1',
        workItemId: 'WI-1',
      }),
    ).rejects.toThrow('REVIEW_OPENCLAW_ACTOR_CONTEXT_UNAVAILABLE');
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'OPENCLAW_REVIEW_BINDING_NOT_FOUND',
        reason: 'ACTOR_CONTEXT_NOT_RETAINED',
        diagnostic: {
          actorContextApplied: false,
          runtimeRoleClass: 'AUTHENTICATED_MEMBER',
          authenticatedRoleMember: true,
          serviceRoleMember: false,
          rowSecurityActive: true,
          expectedSchemaResolved: true,
          sameConnectionContextSupported: false,
          reviewSelectPolicyPresent: true,
          reviewCandidateUpdatePolicyPresent: true,
          reviewRlsEnabled: true,
          rlsPolicyApplicable: true,
          exactActiveConversationVisible: false,
        },
      }),
    );
    expect(warning.mock.calls.flat().join(' ')).not.toMatch(
      /actor-1|actor-other|tenant-1|WI-1|RC-1|request-1/u,
    );
  });

  it('reports schema not ready when the hosted policy closure is not applicable', async () => {
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const db = {
      execute: jest.fn(async () => [
        {
          actorContext: 'actor-1',
          authenticatedRoleMember: false,
          serviceRoleMember: true,
          rowSecurityActive: true,
          expectedSchemaResolved: true,
          reviewSelectPolicyPresent: false,
          reviewCandidateUpdatePolicyPresent: true,
          reviewRlsEnabled: true,
        },
      ]),
    };
    const repository = new ReviewConversationRepository(db as never);

    await expect(
      repository.loadOpenClawTurnBinding({
        reviewConversationId: 'RC-1',
        requestId: 'request-1',
        tenantId: 'tenant-1',
        actorId: 'actor-1',
        workItemId: 'WI-1',
      }),
    ).rejects.toMatchObject({
      code: 'REVIEW_SCHEMA_NOT_READY',
      statusCode: 503,
      retryable: false,
      operatorAction: 'APPLY_REQUIRED_SCHEMA_MIGRATIONS',
    });
    expect(warning).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'OPENCLAW_REVIEW_BINDING_NOT_FOUND',
        reason: 'REVIEW_SCHEMA_NOT_READY',
        diagnostic: {
          actorContextApplied: true,
          runtimeRoleClass: 'SERVICE_ROLE_MEMBER',
          authenticatedRoleMember: false,
          serviceRoleMember: true,
          rowSecurityActive: true,
          expectedSchemaResolved: true,
          sameConnectionContextSupported: true,
          reviewSelectPolicyPresent: false,
          reviewCandidateUpdatePolicyPresent: true,
          reviewRlsEnabled: true,
          rlsPolicyApplicable: false,
          exactActiveConversationVisible: false,
        },
      }),
    );
  });

  it('never executes a Review statement for the public or service actor', async () => {
    const db = { execute: jest.fn(), transaction: jest.fn() };
    const repository = new ReviewConversationRepository(db as never);

    for (const actorId of ['-1', 'service:openclaw', '']) {
      await expect(
        repository.loadOpenClawTurnBinding({
          reviewConversationId: 'RC-1',
          requestId: 'request-1',
          tenantId: 'tenant-1',
          actorId,
          workItemId: 'WI-1',
        }),
      ).rejects.toThrow('REVIEW_OPENCLAW_ACTOR_CONTEXT_UNAVAILABLE');
    }
    expect(db.execute).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('uses the managed application search path instead of public schema qualification', async () => {
    const source = await readFile(
      resolve(
        process.cwd(),
        'server/modules/review-persistence/review-conversation.repository.ts',
      ),
      'utf8',
    );

    expect(source).not.toMatch(
      /public\.(?:review_conversation|review_turn|engineer_supplied_input|identity_subject_mapping)/u,
    );
    expect(source).toContain("to_regclass('review_conversation')");
    expect(source).toContain(
      "'identity_subject_mapping_hosted_runtime_actor_select'",
    );
    expect(source).toContain("'work_item_hosted_runtime_actor_select'");
    expect(source).toContain(
      "'review_turn_hosted_runtime_actor_candidate_update'",
    );
    expect(source).toContain('pg_catalog.pg_has_role(');
    expect(source).toContain("current_user LIKE 'service_role#_%'");
    expect(source).toContain(
      'FROM review_conversation AS candidate_conversation',
    );
  });

  it('maps PostgreSQL undefined_table to an operator-actionable 503', async () => {
    const postgresError = Object.assign(new Error('undefined table'), {
      code: '42P01',
    });
    const db = {
      execute: jest.fn().mockRejectedValue(
        Object.assign(new Error('database query failed'), {
          cause: postgresError,
        }),
      ),
    };
    const repository = new ReviewConversationRepository(db as never);

    await expect(
      repository.loadOpenClawTurnBinding({
        reviewConversationId: 'RC-1',
        requestId: 'request-1',
        tenantId: 'tenant-1',
        actorId: 'actor-1',
        workItemId: 'WI-1',
      }),
    ).rejects.toMatchObject({
      code: 'REVIEW_SCHEMA_NOT_READY',
      statusCode: 503,
      retryable: false,
      operatorAction: 'APPLY_REQUIRED_SCHEMA_MIGRATIONS',
      details: {
        retryable: false,
        operatorAction: 'APPLY_REQUIRED_SCHEMA_MIGRATIONS',
      },
    });
  });

  it('persists and reads a hosted candidate with actor context in one statement', async () => {
    const resultContentHash = 'a'.repeat(64);
    const completedAt = new Date('2026-09-02T12:00:00.000Z');
    const db = {
      execute: jest.fn(async () => [
        {
          actorContext: 'actor-1',
          candidateInserted: true,
          reviewTurnId: 'RT-1',
          reviewConversationId: 'RC-1',
          engineerSuppliedInputId: 'ESI-1',
          turnNo: 1,
          requestId: 'request-1',
          inputRevision: 7,
          userMessage: 'Please review rule 1.',
          inputType: 'ENGINEER_TEXT',
          adoptionStatus: 'CANDIDATE_UNADOPTED',
          candidateText: 'Please review rule 1.',
          responseType: 'INPUT_REQUEST',
          assistantResponse: 'Controlled AD evidence is required.',
          sourceRefsJson: '[]',
          missingInputsJson: '["controlled-ad-mapping"]',
          candidateEvidenceRefsJson: '[]',
          reviewActionDraftJson: 'null',
          affectedItemIdsJson: '[]',
          warningsJson: '["candidate_only"]',
          resultProvenanceJson: JSON.stringify({
            runtimeAppId: 'app_17c3zn24kv2',
            profileRef: 'wiselink-engineering',
            modelVersion: 'GLM-5.3',
            promptVersion: 'wiselink-review-turn-prompt@r09.c5',
        skillVersion: 'wiselink-research-and-synthesize@r09.c9',
            toolVersions: {
              'wiselink-openclaw-engineering-assessment': '1.2.0',
            },
            resultContentHash,
            actionAttemptRef: 'AQ-1',
          }),
          resultContentHash,
          actionAttemptId: 'ATT-1',
          assistantCompletedAt: completedAt.toISOString(),
          createdAt: '2026-09-02T11:59:00.000Z',
        },
      ]),
      transaction: jest.fn(),
      update: jest.fn(),
      select: jest.fn(),
    };
    const repository = new ReviewConversationRepository(db as never);

    const persisted = await repository.persistOpenClawAssistantCandidate({
      conversation: {
        reviewConversationId: 'RC-1',
        tenantId: 'tenant-1',
        actorId: 'actor-1',
        workItemId: 'WI-1',
        openClawAgentId: 'wiselink-engineering',
        openClawSessionKey: 'review:server-owned',
        startedAtRevision: 7,
        lastSyncedRevision: 7,
        status: 'ACTIVE',
        createdAt: new Date('2026-09-02T11:58:00.000Z'),
        lastActiveAt: new Date('2026-09-02T11:59:00.000Z'),
        closedAt: null,
      },
      turn: {
        reviewTurnId: 'RT-1',
        reviewConversationId: 'RC-1',
        engineerSuppliedInputId: 'ESI-1',
        turnNo: 1,
        requestId: 'request-1',
        inputRevision: 7,
        userMessage: 'Please review rule 1.',
        inputType: 'ENGINEER_TEXT',
        adoptionStatus: 'CANDIDATE_UNADOPTED',
        candidateText: 'Please review rule 1.',
        attachmentBindings: [],
        assistantCandidate: null,
        createdAt: new Date('2026-09-02T11:59:00.000Z'),
      },
      actionAttemptId: 'ATT-1',
      candidate: {
        responseType: 'INPUT_REQUEST',
        answer: 'Controlled AD evidence is required.',
        sourceRefs: [],
        missingInputs: ['controlled-ad-mapping'],
        candidateEvidenceRefs: [],
        reviewActionDraft: null,
        affectedItemIds: [],
        warnings: ['candidate_only'],
        actionAttemptRef: 'AQ-1',
        provenance: {
          runtimeAppId: 'app_17c3zn24kv2',
          profileRef: 'wiselink-engineering',
          modelVersion: 'GLM-5.3',
          promptVersion: 'wiselink-review-turn-prompt@r09.c5',
          skillVersion: 'wiselink-research-and-synthesize@r09.c9',
          toolVersions: {
            'wiselink-openclaw-engineering-assessment': '1.2.0',
          },
          resultContentHash,
        },
      },
      completedAt,
    });

    expect(persisted.replayed).toBe(false);
    expect(persisted.turn.assistantCandidate?.actionAttemptRef).toBe('AQ-1');
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
  });
});
