import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type {
  CanonicalAuthorizationDecision,
  CanonicalAuthorizationPort,
  CanonicalHostActor,
  CanonicalPermissionSnapshotPort,
} from './canonical-host.types';
import {
  MiaodaWorkItemRepository,
  type WorkItemAuthorizationBinding,
} from '../work-item/miaoda-work-item.repository';

@Injectable()
// Supplied through CanonicalHostModule.forRoot() in AppModule; the static lint
// rule cannot follow the DynamicModule provider option.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class OrdinaryCanonicalAuthorizationAdapter implements CanonicalAuthorizationPort {
  constructor(private readonly workItems: MiaodaWorkItemRepository) {}

  async authorize(input: {
    actor: CanonicalHostActor;
    action: CanonicalAuthorizationDecision['action'];
    workItemId: string;
    requestId?: string;
    documentVersionId?: string;
  }): Promise<CanonicalAuthorizationDecision> {
    assertActor(input.actor);
    const binding = await this.requiredOwnedBinding(input);
    const permissionSnapshotVersion = permissionSnapshot(input.actor, binding);
    const decisionSeed = JSON.stringify({
      action: input.action,
      actor: actorIdentity(input.actor),
      objectAuthorization: objectAuthorizationFacts(binding),
      permissionSnapshotVersion,
    });
    return {
      action: input.action,
      allowed: true,
      actorFingerprint: digest(JSON.stringify(actorIdentity(input.actor))),
      decisionId: `decision-${digest(decisionSeed).slice(7, 39)}`,
      decisionHash: digest(decisionSeed),
      permissionSnapshotVersion,
    };
  }

  private async requiredOwnedBinding(input: {
    actor: CanonicalHostActor;
    workItemId: string;
    requestId?: string;
    documentVersionId?: string;
  }): Promise<WorkItemAuthorizationBinding> {
    const binding = await this.workItems.loadAuthorizationBinding({
      workItemId: input.workItemId,
      tenantId: input.actor.tenantId,
      actorUserId: input.actor.userId,
    });
    assertOwnedBinding(binding, input);
    return binding;
  }
}

@Injectable()
// Supplied through CanonicalHostModule.forRoot() in AppModule; the static lint
// rule cannot follow the DynamicModule provider option.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class OrdinaryCanonicalPermissionSnapshotAdapter implements CanonicalPermissionSnapshotPort {
  constructor(private readonly workItems: MiaodaWorkItemRepository) {}

  async freshRead(input: {
    actor: CanonicalHostActor;
    decision: CanonicalAuthorizationDecision;
    workItemId: string;
    requestId?: string;
    documentVersionId?: string;
  }): Promise<{ permissionSnapshotVersion: string }> {
    assertActor(input.actor);
    const binding = await this.workItems.loadAuthorizationBinding({
      workItemId: input.workItemId,
      tenantId: input.actor.tenantId,
      actorUserId: input.actor.userId,
    });
    assertOwnedBinding(binding, input);
    const actorFingerprint = digest(JSON.stringify(actorIdentity(input.actor)));
    if (actorFingerprint !== input.decision.actorFingerprint) {
      throw authorizationNotFound();
    }
    return {
      permissionSnapshotVersion: permissionSnapshot(input.actor, binding),
    };
  }
}

function permissionSnapshot(
  actor: CanonicalHostActor,
  binding: WorkItemAuthorizationBinding,
): string {
  return `permission-snapshot:${digest(
    JSON.stringify({
      actor: actorIdentity(actor),
      objectAuthorization: objectAuthorizationFacts(binding),
    }),
  )}`;
}

function actorIdentity(actor: CanonicalHostActor): {
  userId: string;
  tenantId: string;
  appId: string;
  env: string;
  roles: string[];
} {
  return {
    userId: actor.userId,
    tenantId: actor.tenantId,
    appId: actor.appId,
    env: actor.env,
    roles: [...actor.roles].sort(),
  };
}

function objectAuthorizationFacts(binding: WorkItemAuthorizationBinding): {
  workItemId: string;
  tenantId: string;
  requestId: string;
  documentVersionId: string;
  requestedByUserId: string;
} {
  return {
    workItemId: binding.workItemId,
    tenantId: binding.tenantId,
    requestId: binding.requestId,
    documentVersionId: binding.documentVersionId,
    requestedByUserId: binding.requestedByUserId,
  };
}

function assertOwnedBinding(
  binding: WorkItemAuthorizationBinding | null,
  input: {
    actor: CanonicalHostActor;
    workItemId: string;
    requestId?: string;
    documentVersionId?: string;
  },
): asserts binding is WorkItemAuthorizationBinding {
  if (
    !binding ||
    binding.workItemId !== input.workItemId ||
    binding.tenantId !== input.actor.tenantId ||
    binding.requestedByUserId !== input.actor.userId ||
    (input.requestId !== undefined && binding.requestId !== input.requestId) ||
    (input.documentVersionId !== undefined &&
      binding.documentVersionId !== input.documentVersionId)
  ) {
    throw authorizationNotFound();
  }
}

function assertActor(actor: CanonicalHostActor): void {
  if (
    !actor.userId.trim() ||
    !actor.tenantId.trim() ||
    actor.appId !== 'app_17bzc551rsg' ||
    !actor.env.trim()
  ) {
    throw authorizationNotFound();
  }
}

function authorizationNotFound(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
    code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
    statusCode: 404,
  });
}

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
