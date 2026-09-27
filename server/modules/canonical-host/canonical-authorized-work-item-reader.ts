import type { CanonicalWorkItemProjection } from '@shared/api.interface';

import type {
  CanonicalAuthorizationDecision,
  CanonicalAuthorizationPort,
  CanonicalHostActor,
  CanonicalPermissionSnapshotPort,
  CanonicalWorkItemRegistrarPort,
} from './canonical-host.types';

export async function authorizeAndLoadCanonicalWorkItem(input: {
  authorization: CanonicalAuthorizationPort;
  permissionSnapshots: CanonicalPermissionSnapshotPort;
  registrar: CanonicalWorkItemRegistrarPort;
  actor: CanonicalHostActor;
  action: CanonicalAuthorizationDecision['action'];
  workItemId: string;
}): Promise<{
  workItem: CanonicalWorkItemProjection;
  permissionSnapshotVersion: string;
}> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const decision = await input.authorization.authorize({
      actor: input.actor,
      action: input.action,
      workItemId: input.workItemId,
    });
    if (!decision.allowed || decision.action !== input.action) {
      throw canonicalWorkItemNotFound();
    }
    const fresh = await input.permissionSnapshots.freshRead({
      actor: input.actor,
      decision,
      workItemId: input.workItemId,
    });
    if (!fresh.permissionSnapshotVersion.trim()) {
      throw canonicalWorkItemNotFound();
    }
    if (fresh.permissionSnapshotVersion !== decision.permissionSnapshotVersion) {
      // A concurrent WorkItem revision can change the owner grant between the
      // two fresh reads. Repeat the whole authorization chain once; never use
      // either mismatched grant to load content.
      if (attempt === 0) continue;
      throw canonicalWorkItemNotFound();
    }
    const workItem = await input.registrar.getTenantScopedByWorkItemId({
      workItemId: input.workItemId,
      tenantId: input.actor.tenantId,
    });
    return {
      workItem,
      permissionSnapshotVersion: fresh.permissionSnapshotVersion,
    };
  }
  throw canonicalWorkItemNotFound();
}

function canonicalWorkItemNotFound(): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
    code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
    statusCode: 404,
  });
}
