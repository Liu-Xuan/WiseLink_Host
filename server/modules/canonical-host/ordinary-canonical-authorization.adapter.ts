import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';

import {
  CANONICAL_OBJECT_ACCESS,
  type CanonicalObjectAccessGrant,
  type CanonicalObjectAccessPort,
  type CanonicalObjectAccessResult,
  unavailableServiceActorContext,
} from '../work-item/canonical-object-access.port';
import type {
  CanonicalAuthorizationDecision,
  CanonicalAuthorizationPort,
  CanonicalHostActor,
  CanonicalPermissionSnapshotPort,
} from './canonical-host.types';

@Injectable()
// Supplied through CanonicalHostModule.forRoot() in AppModule; the static lint
// rule cannot follow the DynamicModule provider option.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class OrdinaryCanonicalAuthorizationAdapter implements CanonicalAuthorizationPort {
  constructor(
    @Inject(CANONICAL_OBJECT_ACCESS)
    private readonly objectAccess: CanonicalObjectAccessPort,
  ) {}

  async authorize(input: {
    actor: CanonicalHostActor;
    action: CanonicalAuthorizationDecision['action'];
    workItemId: string;
    requestId?: string;
    documentVersionId?: string;
  }, database?: PostgresJsDatabase): Promise<CanonicalAuthorizationDecision> {
    const accessInput = {
      actor: input.actor.objectAccessActor ?? unavailableServiceActorContext(),
      action: input.action,
      accessRoot: { kind: 'WORK_ITEM' as const, id: input.workItemId },
    };
    const grant = requiredLegacyGrant(
      await (database ? this.objectAccess.freshRead(accessInput, database) : this.objectAccess.freshRead(accessInput)),
      input,
    );
    return canonicalAuthorizationDecisionFromGrant(input.action, grant);
  }
}

@Injectable()
// Supplied through CanonicalHostModule.forRoot() in AppModule; the static lint
// rule cannot follow the DynamicModule provider option.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class OrdinaryCanonicalPermissionSnapshotAdapter implements CanonicalPermissionSnapshotPort {
  constructor(
    @Inject(CANONICAL_OBJECT_ACCESS)
    private readonly objectAccess: CanonicalObjectAccessPort,
  ) {}

  async freshRead(input: {
    actor: CanonicalHostActor;
    decision: CanonicalAuthorizationDecision;
    workItemId: string;
    requestId?: string;
    documentVersionId?: string;
  }, database?: PostgresJsDatabase): Promise<{ permissionSnapshotVersion: string }> {
    const accessInput = {
      actor: input.actor.objectAccessActor ?? unavailableServiceActorContext(),
      action: input.decision.action,
      accessRoot: { kind: 'WORK_ITEM' as const, id: input.workItemId },
    };
    const grant = requiredLegacyGrant(
      await (database ? this.objectAccess.freshRead(accessInput, database) : this.objectAccess.freshRead(accessInput)),
      input,
    );
    if (
      input.decision.allowed !== true ||
      grant.actorFingerprint !== input.decision.actorFingerprint
    ) {
      throw authorizationNotFound();
    }
    return { permissionSnapshotVersion: grant.authorizationFingerprint };
  }
}

/** The existing decision hash rule is also used to prove a frozen seed; hashing
 * those facts alone never grants permission to execute the seed authorization. */
export function canonicalAuthorizationDecisionFromGrant(
  action: CanonicalAuthorizationDecision['action'],
  grant: Pick<CanonicalObjectAccessGrant, 'actorFingerprint' | 'authorizationFingerprint' | 'accessRevision'>,
): CanonicalAuthorizationDecision {
  const decisionSeed = JSON.stringify({ action, actorFingerprint: grant.actorFingerprint,
    authorizationFingerprint: grant.authorizationFingerprint, accessRevision: grant.accessRevision });
  return { action, allowed: true, actorFingerprint: grant.actorFingerprint,
    decisionId: `decision-${digest(decisionSeed).slice(7, 39)}`, decisionHash: digest(decisionSeed),
    permissionSnapshotVersion: grant.authorizationFingerprint };
}

function requiredLegacyGrant(
  result: CanonicalObjectAccessResult,
  input: {
    workItemId: string;
    requestId?: string;
    documentVersionId?: string;
  },
): CanonicalObjectAccessGrant {
  if ('code' in result) {
    throw Object.assign(new Error(result.code), {
      code: result.code,
      statusCode: result.statusCode,
    });
  }
  if (
    result.workItemId !== input.workItemId ||
    (input.requestId !== undefined && result.requestId !== input.requestId) ||
    (input.documentVersionId !== undefined &&
      result.documentVersionId !== input.documentVersionId)
  ) {
    throw authorizationNotFound();
  }
  return result;
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
