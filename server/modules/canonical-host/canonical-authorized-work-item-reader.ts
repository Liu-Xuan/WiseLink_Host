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
  if (
    !fresh.permissionSnapshotVersion.trim() ||
    fresh.permissionSnapshotVersion !== decision.permissionSnapshotVersion
  ) {
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

function canonicalWorkItemNotFound(): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
    code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
    statusCode: 404,
  });
}
