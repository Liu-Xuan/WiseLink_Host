import { Injectable } from '@nestjs/common';

import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import type { CanonicalWorkItemRegistrarPort } from '../canonical-host/canonical-host.types';
import { MiaodaWorkItemRepository } from './miaoda-work-item.repository';

@Injectable()
export class MiaodaCanonicalWorkItemRegistrarAdapter
  implements CanonicalWorkItemRegistrarPort
{
  constructor(private readonly repository: MiaodaWorkItemRepository) {}

  async loadOrCreate(
    seed: Omit<CanonicalWorkItemProjection, 'revision'>,
  ): Promise<CanonicalWorkItemProjection> {
    const existing = await this.repository.loadProjection(seed.workItemId);
    return existing ?? this.repository.initializeProjection(seed.workItemId, seed);
  }

  compareAndSet(input: {
    workItemId: string;
    expectedRevision: number;
    next: Omit<CanonicalWorkItemProjection, 'revision'>;
  }): Promise<CanonicalWorkItemProjection> {
    return this.repository.compareAndSet(input);
  }

  async getExact(input: {
    workItemId: string;
    requestId: string;
    documentVersionId: string;
  }): Promise<CanonicalWorkItemProjection> {
    const projection = await this.required(input.workItemId);
    if (
      projection.requestId !== input.requestId ||
      projection.source.documentVersionId !== input.documentVersionId
    ) {
      throw new Error('WORK_ITEM_EXACT_IDENTITY_MISMATCH');
    }
    return projection;
  }

  getByWorkItemId(workItemId: string): Promise<CanonicalWorkItemProjection> {
    return this.required(workItemId);
  }

  private async required(workItemId: string): Promise<CanonicalWorkItemProjection> {
    const projection = await this.repository.loadProjection(workItemId);
    if (!projection) throw new Error('WORK_ITEM_NOT_INITIALIZED');
    return projection;
  }
}
