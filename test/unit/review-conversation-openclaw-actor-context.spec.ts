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
          serviceRoleMember: false,
          rowSecurityActive: true,
          expectedSchemaResolved: true,
          reviewSelectPolicyPresent: true,
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
          runtimeRoleClass: 'NEITHER',
          authenticatedRoleMember: false,
          serviceRoleMember: false,
          rowSecurityActive: true,
          expectedSchemaResolved: true,
          sameConnectionContextSupported: true,
          reviewSelectPolicyPresent: true,
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
          serviceRoleMember: false,
          rowSecurityActive: true,
          expectedSchemaResolved: true,
          reviewSelectPolicyPresent: false,
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
          runtimeRoleClass: 'NEITHER',
          authenticatedRoleMember: false,
          serviceRoleMember: false,
          rowSecurityActive: true,
          expectedSchemaResolved: true,
          sameConnectionContextSupported: true,
          reviewSelectPolicyPresent: false,
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
    expect(source).toContain('pg_catalog.pg_has_role(');
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
});
