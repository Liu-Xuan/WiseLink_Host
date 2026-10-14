import type {
  LcmSnapshotBrowseRequest, LcmSnapshotCatalogueResponse, LcmSnapshotRowsResponse,
} from '@shared/lcm-source-reading.interface';
import type { LcmDatabaseScope } from '@shared/lcm-configuration-store.interface';
import type { CanonicalMiaodaFinalUserActorContext } from '../work-item/canonical-object-access.port';

export const LCM_SOURCE_READ_AUTHORIZATION = Symbol('LCM_SOURCE_READ_AUTHORIZATION');
export const LCM_SNAPSHOT_READ_REPOSITORY = Symbol('LCM_SNAPSHOT_READ_REPOSITORY');

export interface LcmSourceReadGrant {
  applicationScopeId: string;
  scope: LcmDatabaseScope;
  permissionRevision: string;
  authorityRef: string;
}

/** Current source audience decisions come from Host, never browser filters. */
export interface LcmSourceReadAuthorization {
  readonly available: boolean;
  authorize(actor: CanonicalMiaodaFinalUserActorContext): Promise<LcmSourceReadGrant>;
}

export interface LcmSnapshotReadRepository {
  readonly available: boolean;
  catalogue(scope: LcmDatabaseScope, query: LcmSnapshotBrowseRequest): Promise<LcmSnapshotCatalogueResponse>;
  snapshot(scope: LcmDatabaseScope, snapshotId: string,
    query: LcmSnapshotBrowseRequest): Promise<LcmSnapshotRowsResponse>;
}

export function lcmReadingError(code: string, statusCode: number): Error {
  return Object.assign(new Error(code), { code, statusCode });
}

/** These defaults cannot read files, infer grants or substitute a production URL. */
export class UnconfiguredLcmSourceReadAuthorization implements LcmSourceReadAuthorization {
  readonly available: boolean = false;
  async authorize(): Promise<LcmSourceReadGrant> {
    throw lcmReadingError('LCM_SOURCE_READING_UNCONFIGURED', 503);
  }
}

export class UnconfiguredLcmSnapshotReadRepository implements LcmSnapshotReadRepository {
  readonly available: boolean = false;
  async catalogue(): Promise<LcmSnapshotCatalogueResponse> {
    throw lcmReadingError('LCM_SOURCE_READING_UNCONFIGURED', 503);
  }
  async snapshot(): Promise<LcmSnapshotRowsResponse> {
    throw lcmReadingError('LCM_SOURCE_READING_UNCONFIGURED', 503);
  }
}
