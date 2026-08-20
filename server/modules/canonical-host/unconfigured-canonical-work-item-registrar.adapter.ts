import type { CanonicalWorkItemProjection } from '@shared/api.interface';

import type { CanonicalWorkItemRegistrarPort } from './canonical-host.types';

export class UnconfiguredCanonicalWorkItemRegistrarAdapter implements CanonicalWorkItemRegistrarPort {
  async loadOrCreate(
    _seed: Omit<CanonicalWorkItemProjection, 'revision'>,
  ): Promise<CanonicalWorkItemProjection> {
    throw new Error('CANONICAL_WORK_ITEM_REGISTRAR_NOT_CONFIGURED');
  }

  async compareAndSet(_input: {
    workItemId: string;
    expectedRevision: number;
    next: Omit<CanonicalWorkItemProjection, 'revision'>;
  }): Promise<CanonicalWorkItemProjection> {
    throw new Error('CANONICAL_WORK_ITEM_REGISTRAR_NOT_CONFIGURED');
  }

  async getExact(_input: {
    workItemId: string;
    requestId: string;
    documentVersionId: string;
  }): Promise<CanonicalWorkItemProjection> {
    throw new Error('CANONICAL_WORK_ITEM_REGISTRAR_NOT_CONFIGURED');
  }

  async getTenantScopedByWorkItemId(_input: {
    workItemId: string;
    tenantId: string;
  }): Promise<CanonicalWorkItemProjection> {
    throw new Error('CANONICAL_WORK_ITEM_REGISTRAR_NOT_CONFIGURED');
  }
}
