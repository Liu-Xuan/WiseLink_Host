import { Inject, Injectable } from '@nestjs/common';
import type {
  LcmSnapshotBrowseRequest, LcmSnapshotCatalogueResponse, LcmSnapshotRowsResponse, LcmSnapshotSummary,
} from '@shared/lcm-source-reading.interface';
import type { CanonicalMiaodaFinalUserActorContext } from '../work-item/canonical-object-access.port';
import { assertPublicActor } from '../tdms-source/tdms-source.authorization';
import { canonicalJson } from './lcm-export.helpers';
import {
  LCM_SNAPSHOT_READ_REPOSITORY, LCM_SOURCE_READ_AUTHORIZATION, lcmReadingError,
  type LcmSnapshotReadRepository, type LcmSourceReadAuthorization, type LcmSourceReadGrant,
} from './lcm-source-reading.port';

export function lcmBrowserQuery(value: unknown): LcmSnapshotBrowseRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw lcmReadingError('LCM_BROWSER_QUERY_INVALID', 400);
  const input: Record<string, unknown> = value as Record<string, unknown>;
  const keys: string[] = ['aircraftModel', 'tailNumber', 'partNumber', 'system', 'ata', 'softwareName',
    'position', 'after', 'limit'];
  if (Object.keys(input).some((key: string) => !keys.includes(key)))
    throw lcmReadingError('LCM_BROWSER_QUERY_INVALID', 400);
  const query: LcmSnapshotBrowseRequest = {};
  for (const key of ['aircraftModel', 'tailNumber', 'partNumber', 'system', 'ata', 'softwareName',
    'position', 'after'] as const) {
    const item: unknown = input[key];
    if (item === undefined) continue;
    if (typeof item !== 'string' || !item.trim() || item.length > (key === 'after' ? 1024 : 128) ||
        /[\u0000-\u001f\u007f]/u.test(item)) throw lcmReadingError('LCM_BROWSER_QUERY_INVALID', 400);
    query[key] = item.trim();
  }
  const limit: unknown = input.limit ?? 50;
  if ((typeof limit !== 'string' && typeof limit !== 'number') ||
      (typeof limit === 'string' && !/^[1-9]\d*$/u.test(limit)) ||
      !Number.isSafeInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 50)
    throw lcmReadingError('LCM_BROWSER_QUERY_INVALID', 400);
  query.limit = Number(limit);
  return query;
}

@Injectable()
export class LcmSourceReadingService {
  constructor(
    @Inject(LCM_SOURCE_READ_AUTHORIZATION) private readonly authorization: LcmSourceReadAuthorization,
    @Inject(LCM_SNAPSHOT_READ_REPOSITORY) private readonly repository: LcmSnapshotReadRepository,
  ) {}

  async catalogue(actor: CanonicalMiaodaFinalUserActorContext,
    value: unknown): Promise<LcmSnapshotCatalogueResponse> {
    const query: LcmSnapshotBrowseRequest = lcmBrowserQuery(value);
    const grant: LcmSourceReadGrant = await this.authorize(actor);
    const result: LcmSnapshotCatalogueResponse = await this.repository.catalogue(grant.scope, query);
    result.snapshots.forEach((snapshot: LcmSnapshotSummary) => assertSnapshotGrant(snapshot, grant));
    await this.reauthorize(actor, grant);
    return result;
  }

  async snapshot(actor: CanonicalMiaodaFinalUserActorContext, snapshotId: string,
    value: unknown): Promise<LcmSnapshotRowsResponse> {
    if (!/^[a-f0-9]{64}$/u.test(snapshotId)) throw lcmReadingError('LCM_SNAPSHOT_ID_INVALID', 400);
    const query: LcmSnapshotBrowseRequest = lcmBrowserQuery(value);
    const grant: LcmSourceReadGrant = await this.authorize(actor);
    const result: LcmSnapshotRowsResponse = await this.repository.snapshot(grant.scope, snapshotId, query);
    if (result.snapshot.snapshotId !== snapshotId) throw lcmReadingError('LCM_SNAPSHOT_BINDING_INVALID', 409);
    assertSnapshotGrant(result.snapshot, grant);
    await this.reauthorize(actor, grant);
    return result;
  }

  private async authorize(actor: CanonicalMiaodaFinalUserActorContext): Promise<LcmSourceReadGrant> {
    assertPublicActor(actor);
    if (!this.authorization.available || !this.repository.available)
      throw lcmReadingError('LCM_SOURCE_READING_UNCONFIGURED', 503);
    const grant: LcmSourceReadGrant = await this.authorization.authorize(actor);
    if (!grant || grant.applicationScopeId !== actor.applicationScopeId || !grant.scope ||
        grant.scope.tenantId !== actor.tenantId ||
        grant.scope.actorId !== actor.canonicalSubject.id ||
        typeof grant.authorityRef !== 'string' || !grant.authorityRef.trim() ||
        typeof grant.permissionRevision !== 'string' || !grant.permissionRevision.trim() ||
        !Array.isArray(grant.scope.authorizedSourceInstanceIds) ||
        !grant.scope.authorizedSourceInstanceIds.length || grant.scope.authorizedSourceInstanceIds.length > 200 ||
        grant.scope.authorizedSourceInstanceIds.some((id: string) => typeof id !== 'string' || !id.trim()) ||
        new Set(grant.scope.authorizedSourceInstanceIds).size !== grant.scope.authorizedSourceInstanceIds.length)
      throw lcmReadingError('LCM_SOURCE_ACCESS_DENIED', 403);
    return structuredClone(grant);
  }

  private async reauthorize(actor: CanonicalMiaodaFinalUserActorContext, before: LcmSourceReadGrant): Promise<void> {
    const after: LcmSourceReadGrant = await this.authorize(actor);
    if (canonicalJson(before) !== canonicalJson(after)) throw lcmReadingError('LCM_SOURCE_PERMISSION_CHANGED', 409);
  }
}

function assertSnapshotGrant(snapshot: LcmSnapshotSummary, grant: LcmSourceReadGrant): void {
  if (!grant.scope.authorizedSourceInstanceIds.includes(snapshot.sourceInstanceId) ||
      snapshot.sourceAuthority !== 'unverified/local' || snapshot.candidateOnly !== true ||
      snapshot.liveExternalVerified !== false || snapshot.sourceEffectiveAt !== null)
    throw lcmReadingError('LCM_SNAPSHOT_BINDING_INVALID', 409);
}
