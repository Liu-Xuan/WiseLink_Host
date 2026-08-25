import { Test } from '@nestjs/testing';
import { UserContextMiddleware } from '@lark-apaas/fullstack-nestjs-core';
import type { NextFunction, Request, Response } from 'express';
import {
  CANONICAL_OBJECT_ACCESS,
  unavailableAilyActorContext,
  unavailableServiceActorContext,
  type CanonicalMiaodaFinalUserActorContext,
  type CanonicalObjectAccessPort,
} from '../../server/modules/work-item/canonical-object-access.port';
import { CanonicalObjectAccessRouter } from '../../server/modules/work-item/canonical-object-access.router';
import {
  MiaodaWorkItemRepository,
  type WorkItemAuthorizationBinding,
} from '../../server/modules/work-item/miaoda-work-item.repository';
import {
  UnavailableAilyObjectAccessAdapter,
  UnavailableServiceObjectAccessAdapter,
  UnavailableSessionObjectAccessAdapter,
} from '../../server/modules/work-item/unavailable-canonical-object-access.adapters';
import { MiaodaHostedCanonicalObjectAccessAdapter } from '../../server/modules/work-item/miaoda-hosted-canonical-object-access.adapter';
import { WorkItemRuntimeModule } from '../../server/modules/work-item/work-item-runtime.module';
import {
  SyntheticDevelopmentCanonicalObjectAccessAdapter,
  syntheticMiaodaActorFixture,
} from '../fixtures/synthetic-development-canonical-object-access.adapter';

const actors = {
  A: syntheticMiaodaActorFixture('user-a', 'tenant-1'),
  A_ROLE: syntheticMiaodaActorFixture('user-a', 'tenant-1', [
    'wiselink_development',
  ]),
  B: syntheticMiaodaActorFixture('user-b', 'tenant-1', [
    'wiselink_development',
  ]),
  C: syntheticMiaodaActorFixture('user-c', 'tenant-2'),
};

const bindings: WorkItemAuthorizationBinding[] = [
  binding('WI1', 11, 'tenant-1', 'user-a'),
  binding('WI2', 12, 'tenant-1', 'user-a'),
  binding('WI3', 13, 'tenant-2', 'user-c'),
];

describe('synthetic development creator-only fixture', () => {
  it.each([
    ['A/WI1', 'A', 'WI1', true],
    ['A/WI2', 'A', 'WI2', true],
    ['B/WI1', 'B', 'WI1', false],
    ['C/WI3', 'C', 'WI3', true],
  ] as const)(
    '%s fresh-reads the exact tenant/owner relation',
    async (_label, actorKey, workItemId, expectedAllowed) => {
      const actor = actors[actorKey];
      const { adapter, repository } = syntheticTarget();
      const result = await adapter.freshRead({
        actor,
        action: 'READ_WORK_ITEM',
        accessRoot: { kind: 'WORK_ITEM', id: workItemId },
      });

      expect(result.allowed).toBe(expectedAllowed);
      if (expectedAllowed && result.allowed) {
        expect(result).toMatchObject({
          workItemId,
          tenantId: actor.tenantId,
          applicationScopeId: 'app_17bzc551rsg',
          workspaceId: null,
          workspaceProvenance: 'UNAVAILABLE',
          ownerFact: {
            isOwner: true,
            source: 'HOST_WORK_ITEM_REQUESTED_BY',
          },
          memberFact: { isMember: false, source: 'UNAVAILABLE' },
        });
      } else {
        expect(result).toMatchObject({
          code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
          statusCode: 404,
        });
      }
      expect(repository.loadAuthorizationBinding).toHaveBeenCalledWith({
        workItemId,
        tenantId: actor.tenantId,
        actorUserId: actor.canonicalSubject.id,
      });
    },
  );

  it('does not fill workspace provenance from application scope', () => {
    expect(actors.A).toMatchObject({
      applicationScopeId: 'app_17bzc551rsg',
      workspaceId: null,
      workspaceProvenance: 'UNAVAILABLE',
    });
    expect(actors.A.applicationScopeId).not.toBe(actors.A.workspaceId);
  });

  it('keeps object grants stable across unrelated platform roles', async () => {
    const { adapter } = syntheticTarget();
    const withoutRole = await adapter.freshRead({
      actor: actors.A,
      action: 'READ_WORK_ITEM',
      accessRoot: { kind: 'WORK_ITEM', id: 'WI1' },
    });
    const withRole = await adapter.freshRead({
      actor: actors.A_ROLE,
      action: 'READ_WORK_ITEM',
      accessRoot: { kind: 'WORK_ITEM', id: 'WI1' },
    });

    expect(withoutRole.allowed && withRole.allowed).toBe(true);
    if (withoutRole.allowed && withRole.allowed) {
      expect(withRole.actorFingerprint).toBe(withoutRole.actorFingerprint);
      expect(withRole.authorizationFingerprint).toBe(
        withoutRole.authorizationFingerprint,
      );
    }
  });

  it.each([
    [
      'review conversation',
      'READ_WORK_ITEM' as const,
      { kind: 'REVIEW_CONVERSATION' as const, id: 'RC-1' },
      'CANONICAL_REVIEW_CONVERSATION_SOURCE_UNAVAILABLE',
    ],
    [
      'research',
      'REQUEST_RESEARCH' as const,
      { kind: 'WORK_ITEM' as const, id: 'WI1' },
      'CANONICAL_SOURCE_VISIBILITY_UNAVAILABLE',
    ],
    [
      'source refs',
      'READ_SOURCE_REFS' as const,
      { kind: 'WORK_ITEM' as const, id: 'WI1' },
      'CANONICAL_SOURCE_VISIBILITY_UNAVAILABLE',
    ],
    [
      'attachment read',
      'READ_ATTACHMENT' as const,
      { kind: 'WORK_ITEM' as const, id: 'WI1' },
      'CANONICAL_ATTACHMENT_BINDING_UNAVAILABLE',
    ],
    [
      'attachment issue',
      'ISSUE_ATTACHMENT_INTAKE' as const,
      { kind: 'WORK_ITEM' as const, id: 'WI1' },
      'CANONICAL_SESSION_PROVENANCE_UNAVAILABLE',
    ],
    [
      'attachment commit',
      'COMMIT_ATTACHMENT_INTAKE' as const,
      { kind: 'WORK_ITEM' as const, id: 'WI1' },
      'CANONICAL_SESSION_PROVENANCE_UNAVAILABLE',
    ],
  ])(
    'keeps unavailable %s fail-closed before I/O',
    async (_label, action, accessRoot, code) => {
      const { adapter, repository } = syntheticTarget();
      const result = await adapter.freshRead({
        actor: actors.A,
        action,
        accessRoot,
      });

      expect(result).toMatchObject({ allowed: false, code, statusCode: 503 });
      expect(repository.loadAuthorizationBinding).not.toHaveBeenCalled();
    },
  );

  it('requires the exact revision for single-request attachment ingest', async () => {
    const { adapter, repository } = syntheticTarget();
    const granted = await adapter.freshRead({
      actor: actors.A,
      action: 'INGEST_ATTACHMENT_SINGLE_REQUEST',
      accessRoot: { kind: 'WORK_ITEM', id: 'WI1' },
      expectedWorkItemRevision: 11,
    });
    const stale = await adapter.freshRead({
      actor: actors.A,
      action: 'INGEST_ATTACHMENT_SINGLE_REQUEST',
      accessRoot: { kind: 'WORK_ITEM', id: 'WI1' },
      expectedWorkItemRevision: 10,
    });

    expect(granted).toMatchObject({ allowed: true, workItemRevision: 11 });
    expect(stale).toMatchObject({
      allowed: false,
      code: 'CANONICAL_WORK_ITEM_REVISION_MISMATCH',
      statusCode: 409,
    });
    expect(repository.loadAuthorizationBinding).toHaveBeenCalledTimes(2);
  });

  it('rejects a runtime mutation missing its revision before I/O', async () => {
    const { adapter, repository } = syntheticTarget();
    if (false) {
      // @ts-expect-error the mutation discriminant requires an exact revision
      void adapter.freshRead({
        actor: actors.A,
        action: 'INGEST_ATTACHMENT_SINGLE_REQUEST',
        accessRoot: { kind: 'WORK_ITEM', id: 'WI1' },
      });
    }
    const result = await Reflect.apply(adapter.freshRead, adapter, [
      {
        actor: actors.A,
        action: 'INGEST_ATTACHMENT_SINGLE_REQUEST',
        accessRoot: { kind: 'WORK_ITEM', id: 'WI1' },
      },
    ]);

    expect(result).toMatchObject({
      allowed: false,
      code: 'CANONICAL_WORK_ITEM_REVISION_REQUIRED',
      statusCode: 409,
    });
    expect(repository.loadAuthorizationBinding).not.toHaveBeenCalled();
  });
});

describe('hosted native browser creator-only access', () => {
  it('fresh-reads and grants only the exact Host creator binding', async () => {
    const repository = productionRepository();
    const result = await productionRouter(repository).freshRead({
      actor: hostedMiaodaActor(),
      action: 'READ_WORK_ITEM',
      accessRoot: { kind: 'WORK_ITEM', id: 'WI1' },
    });

    expect(result).toMatchObject({
      allowed: true,
      workItemId: 'WI1',
      tenantId: 'tenant-1',
      actorUserId: 'user-a',
      ownerFact: { isOwner: true },
      auditProvenance: {
        identity: 'MIAODA_GATEWAY_USER_CONTEXT',
        objectAuthorization: 'HOST_WORK_ITEM_REQUESTED_BY',
      },
    });
    expect(repository.loadAuthorizationBinding).toHaveBeenCalledWith({
      workItemId: 'WI1',
      tenantId: 'tenant-1',
      actorUserId: 'user-a',
    });
  });

  it('does not promote an SDK-parsed header into the required hosted actor decision', async () => {
    const request = {
      headers: gatewayIdentityHeader('user-a', 'tenant-1'),
    } as unknown as Request;
    const next: NextFunction = jest.fn();
    new UserContextMiddleware().use(request, {} as Response, next);
    expect(request.userContext).toMatchObject({
      userId: 'user-a',
      tenantId: 'tenant-1',
      appId: 'app_17bzc551rsg',
    });

    const repository = productionRepository();
    const result = await productionRouter(repository).freshRead({
      actor: callerConstructedMiaodaActor(),
      action: 'READ_WORK_ITEM',
      accessRoot: { kind: 'WORK_ITEM', id: 'WI1' },
    });

    expect(result).toMatchObject({
      allowed: false,
      denialSource: 'MIAODA_OBJECT_ACCESS',
      statusCode: 503,
    });
    expect(repository.loadAuthorizationBinding).not.toHaveBeenCalled();
  });
});

describe('WorkItemRuntimeModule object access routing', () => {
  it('selects hosted Miaoda ACL plus fail-closed Aily/service/session adapters through DI', async () => {
    const repository = productionRepository();
    const moduleRef = await Test.createTestingModule({
      imports: [WorkItemRuntimeModule],
    })
      .overrideProvider(MiaodaWorkItemRepository)
      .useValue(repository)
      .compile();
    const port = moduleRef.get<CanonicalObjectAccessPort>(
      CANONICAL_OBJECT_ACCESS,
    );

    await expect(
      port.freshRead({
        actor: hostedMiaodaActor(),
        action: 'READ_WORK_ITEM',
        accessRoot: { kind: 'WORK_ITEM', id: 'WI1' },
      }),
    ).resolves.toMatchObject({
      allowed: true,
      workItemId: 'WI1',
    });
    await expect(
      port.freshRead({
        actor: unavailableAilyActorContext(),
        action: 'READ_WORK_ITEM',
        accessRoot: { kind: 'WORK_ITEM', id: 'WI1' },
      }),
    ).resolves.toMatchObject({
      denialSource: 'AILY_UNAVAILABLE_ADAPTER',
      statusCode: 503,
    });
    await expect(
      port.freshRead({
        actor: unavailableServiceActorContext(),
        action: 'READ_WORK_ITEM',
        accessRoot: { kind: 'WORK_ITEM', id: 'WI1' },
      }),
    ).resolves.toMatchObject({
      denialSource: 'SERVICE_UNAVAILABLE_ADAPTER',
      statusCode: 503,
    });
    await expect(
      port.freshRead({
        actor: hostedMiaodaActor(),
        action: 'ISSUE_ATTACHMENT_INTAKE',
        accessRoot: { kind: 'WORK_ITEM', id: 'WI1' },
      }),
    ).resolves.toMatchObject({
      denialSource: 'SESSION_UNAVAILABLE_ADAPTER',
      statusCode: 503,
    });
    expect(repository.loadAuthorizationBinding).toHaveBeenCalledTimes(1);
    await moduleRef.close();
  });
});

function syntheticTarget() {
  const repository = {
    loadAuthorizationBinding: jest.fn(
      async (input: {
        workItemId: string;
        tenantId: string;
        actorUserId: string;
      }) =>
        bindings.find(
          (value) =>
            value.workItemId === input.workItemId &&
            value.tenantId === input.tenantId &&
            value.requestedByUserId === input.actorUserId,
        ) ?? null,
    ),
  };
  return {
    repository,
    adapter: new SyntheticDevelopmentCanonicalObjectAccessAdapter(
      repository as never,
    ),
  };
}

function productionRouter(
  repository = productionRepository(),
): CanonicalObjectAccessRouter {
  return new CanonicalObjectAccessRouter(
    new MiaodaHostedCanonicalObjectAccessAdapter(repository as never),
    new UnavailableAilyObjectAccessAdapter(),
    new UnavailableServiceObjectAccessAdapter(),
    new UnavailableSessionObjectAccessAdapter(),
  );
}

function productionRepository() {
  return {
    loadAuthorizationBinding: jest.fn(
      async (input: {
        workItemId: string;
        tenantId: string;
        actorUserId: string;
      }) =>
        bindings.find(
          (value) =>
            value.workItemId === input.workItemId &&
            value.tenantId === input.tenantId &&
            value.requestedByUserId === input.actorUserId,
        ) ?? null,
    ),
  };
}

function callerConstructedMiaodaActor(): CanonicalMiaodaFinalUserActorContext {
  return {
    ...syntheticMiaodaActorFixture('user-a', 'tenant-1'),
    env: 'runtime',
  };
}

function hostedMiaodaActor(): CanonicalMiaodaFinalUserActorContext {
  const actor = callerConstructedMiaodaActor();
  return {
    ...actor,
    subjectDecision: {
      ...actor.subjectDecision,
      version: 'miaoda-hosted-native-sso.v1',
    },
  };
}

function gatewayIdentityHeader(
  userId: string,
  tenantId: string,
): Record<string, string> {
  return {
    'x-larkgw-suda-webuser': encodeURIComponent(
      JSON.stringify({
        user_id: userId,
        tenant_id: tenantId,
        app_id: 'app_17bzc551rsg',
        env: 'runtime',
      }),
    ),
  };
}

function binding(
  workItemId: string,
  revision: number,
  tenantId: string,
  requestedByUserId: string,
): WorkItemAuthorizationBinding {
  return {
    workItemId,
    revision,
    tenantId,
    requestId: `REQ-${workItemId}`,
    documentId: `DOC-${workItemId}`,
    documentVersionId: `DV-${workItemId}`,
    requestedByUserId,
    runKey: `RUN-${workItemId}`,
  };
}
