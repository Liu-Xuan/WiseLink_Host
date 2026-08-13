import type {
  CanonicalAuthorizationDecision,
  CanonicalHostActor,
  CanonicalPermissionSnapshotPort,
} from './canonical-host.types';

export class UnconfiguredCanonicalPermissionSnapshotAdapter implements CanonicalPermissionSnapshotPort {
  async freshRead(_input: {
    actor: CanonicalHostActor;
    decision: CanonicalAuthorizationDecision;
    workItemId: string;
    requestId: string;
    documentVersionId: string;
  }): Promise<{ permissionSnapshotVersion: string }> {
    throw new Error('CANONICAL_PERMISSION_SNAPSHOT_NOT_CONFIGURED');
  }
}
