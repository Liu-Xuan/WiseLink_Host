import type { TdmsTransaction } from '../../../server/modules/tdms-source/tdms-source.types';
import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import { HostDecisionTdmsSourceAuthorization } from '../../../server/modules/tdms-source/tdms-source.authorization';
import { tdmsError } from '../../../server/modules/tdms-source/tdms-source.types';
import { adaptTdmsDailySource } from '../../../server/modules/tdms-source/tdms-daily-source-adapter';
import { hash } from '../../../server/modules/tdms-source/tdms-source.validation';
import { MemoryTdmsRepository, nativeScope } from './tdms-memory-double';
import {
  withSbStructureEvidence,
  sbProof,
  sealSb,
} from './tdms-reviewed-sb-0-2-73.fixture';

// Reorders only synthetic JSON object property insertion. Array indexes,
// cardinality, types and every value stay untouched. No Source store runs.
export function reorderObjectKeys<T>(value: T, descending = false): T {
  if (Array.isArray(value))
    return value.map((entry) => reorderObjectKeys(entry, descending)) as T;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    if (descending) keys.reverse();
    return Object.fromEntries(
      keys.map((key) => [
        key,
        reorderObjectKeys(Reflect.get(value, key), descending),
      ]),
    ) as T;
  }
  return value;
}
export function keyOrderEnvelope(scope: 'SB' | 'SL' = 'SB') {
  const env = withSbStructureEvidence();
  if (scope === 'SL') {
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      for (const [key, entry] of Object.entries(value)) {
        if (
          ['scopeId', 'businessType', 'businessSubtype'].includes(key) &&
          entry === 'SB'
        )
          Reflect.set(value, key, 'SL');
        else visit(entry);
      }
    };
    visit(env);
    sealSb(env);
  }
  return env;
}
export type KeyOrderEnvelope = ReturnType<typeof keyOrderEnvelope>;
export type KeyOrderLayoutFrame = {
  grids: {
    gridId: string;
    columns: { actualLabel: string; nativeColumnToken: string }[];
  }[];
};
export type KeyOrderLayoutPanel = {
  before: KeyOrderLayoutFrame;
  after: KeyOrderLayoutFrame;
};
export function minimalLayoutKeyOrder(env: KeyOrderEnvelope) {
  for (const read of sbProof(env).reads) {
    const panel = read.sbNativeLayoutEvidence.panels.find(
      (value: KeyOrderLayoutPanel) => value.before.grids.length > 0,
    );
    for (const side of ['before', 'after'])
      panel[side].grids[0] = reorderObjectKeys(panel[side].grids[0]);
  }
  return env;
}
// Invalid-wire probes retain the prior snapshot and proof so actual prepare is
// the first validation boundary; only the outer request digest is reconciled.
export function sealKeyOrderRaw(env: KeyOrderEnvelope) {
  env.requestId = 'TDMSIMPORT-' + hash(env.package);
  return env;
}

/** Explicit synthetic Host persistence port, not physical PG or Source DailyStore.
 * The existing Memory repository still owns rollback; only committed JSON object
 * ordering changes before the production service's next read/replay transaction. */
class ObjectKeyOrderMemoryRepository extends MemoryTdmsRepository {
  override async transaction<T>(
    operation: (tx: TdmsTransaction) => Promise<T>,
  ): Promise<T> {
    const result = await super.transaction(operation);
    this.state = reorderObjectKeys(this.state);
    return result;
  }
}
export function keyOrderService(env: KeyOrderEnvelope) {
  const repository = new ObjectKeyOrderMemoryRepository();
  const claims = adaptTdmsDailySource(env).memberClaims;
  const permissions = { import: true, read: true };
  const authorization = new HostDecisionTdmsSourceAuthorization(
    async () => [
      { scope: nativeScope, permissionRevision: 'synthetic-key-order-85' },
    ],
    async ({ grant }) => {
      if (!permissions.import)
        throw tdmsError('SYNTHETIC_SOURCE_IMPORT_REVOKED', 403);
      return {
        ...grant,
        authorityRef: 'synthetic-import',
        captureRetentionAllowed: true,
        nativeProjectionAllowed: true,
        permittedMembers: claims,
      };
    },
    async ({ grant }) => {
      if (!permissions.read)
        throw tdmsError('SYNTHETIC_SOURCE_READ_REVOKED', 403);
      return {
        ...grant,
        authorityRef: 'synthetic-read',
        retainedCaptureReadAllowed: true,
        permittedMembers: claims,
      };
    },
  );
  const artifacts = { acquire: jest.fn() },
    documents = { assertRead: jest.fn() };
  return {
    repository,
    permissions,
    artifacts,
    documents,
    service: new TdmsSourceService(
      repository,
      authorization,
      artifacts,
      documents,
    ),
  };
}
