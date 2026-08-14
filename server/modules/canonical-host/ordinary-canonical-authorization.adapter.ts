import { createHash } from 'node:crypto';

import type {
  CanonicalAuthorizationDecision,
  CanonicalAuthorizationPort,
  CanonicalHostActor,
  CanonicalPermissionSnapshotPort,
} from './canonical-host.types';

export class OrdinaryCanonicalAuthorizationAdapter
  implements CanonicalAuthorizationPort
{
  async authorize(input: {
    actor: CanonicalHostActor;
    action: CanonicalAuthorizationDecision['action'];
    workItemId: string;
    requestId: string;
    documentVersionId: string;
  }): Promise<CanonicalAuthorizationDecision> {
    assertActor(input.actor);
    const permissionSnapshotVersion = permissionSnapshot(input.actor);
    const decisionSeed = JSON.stringify({
      action: input.action,
      actor: actorIdentity(input.actor),
      workItemId: input.workItemId,
      requestId: input.requestId,
      documentVersionId: input.documentVersionId,
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
}

export class OrdinaryCanonicalPermissionSnapshotAdapter
  implements CanonicalPermissionSnapshotPort
{
  async freshRead(input: {
    actor: CanonicalHostActor;
    decision: CanonicalAuthorizationDecision;
  }): Promise<{ permissionSnapshotVersion: string }> {
    assertActor(input.actor);
    return { permissionSnapshotVersion: permissionSnapshot(input.actor) };
  }
}

function permissionSnapshot(actor: CanonicalHostActor): string {
  return `permission-snapshot:${digest(JSON.stringify(actorIdentity(actor)))}`;
}

function actorIdentity(actor: CanonicalHostActor) {
  return {
    userId: actor.userId,
    tenantId: actor.tenantId,
    appId: actor.appId,
    env: actor.env,
    roles: [...actor.roles].sort(),
  };
}

function assertActor(actor: CanonicalHostActor): void {
  if (
    !actor.userId.trim() ||
    !actor.tenantId.trim() ||
    actor.appId !== 'app_17bzc551rsg' ||
    !actor.env.trim()
  ) {
    throw new Error('CANONICAL_ACTION_NOT_AUTHORIZED');
  }
}

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
