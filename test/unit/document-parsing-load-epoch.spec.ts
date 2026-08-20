jest.mock('@lark-apaas/client-toolkit/logger', () => ({
  logger: { error: jest.fn() },
}));

import type { CanonicalDocumentParsingPageResponse } from '@shared/api.interface';
import { runCanonicalDocumentParsingLoad } from '../../client/src/pages/DocumentParsingPage/document-parsing-load';
import {
  readRecentWorkItems,
  rememberRecentWorkItem,
} from '../../client/src/utils/recent-work-items';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(cause: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (cause: unknown) => void;
  return {
    promise: new Promise<T>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    }),
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

function page(marker: string): CanonicalDocumentParsingPageResponse {
  return {
    workItem: {
      workItemId: 'WI-SHARED',
      classification: { normalizedFamily: 'SB' },
      source: {
        documentId: marker,
        documentVersionId: `DV-${marker}`,
      },
    },
  } as CanonicalDocumentParsingPageResponse;
}

describe('DocumentParsingPage identity-bound load epoch', () => {
  const identityA = { userId: 'user-a', tenantId: 'tenant-a' };
  const identityB = { userId: 'user-b', tenantId: 'tenant-b' };
  const values: Map<string, string> = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string): string | null => values.get(key) ?? null,
          setItem: (key: string, value: string): void => {
            values.set(key, value);
          },
          removeItem: (key: string): void => {
            values.delete(key);
          },
        },
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
  });

  it('cannot render or cache an old actor response after the new actor is denied', async () => {
    const actorAReader = deferred<CanonicalDocumentParsingPageResponse>();
    let currentEpoch = 1;
    let domMarker: string | null = null;
    let readerCalls = 0;

    const actorALoad = runCanonicalDocumentParsingLoad({
      isCurrent: () => currentEpoch === 1,
      readIdentity: jest.fn().mockResolvedValue(identityA),
      readPage: () => {
        readerCalls += 1;
        return actorAReader.promise;
      },
      onFresh: (identity, fresh) => {
        domMarker = fresh.workItem.source.documentId;
        rememberRecentWorkItem(identity, {
          workItemId: fresh.workItem.workItemId,
          family: fresh.workItem.classification.normalizedFamily,
          documentLabel: fresh.workItem.source.documentId,
          documentVersionId: fresh.workItem.source.documentVersionId,
        });
      },
      onDenied: jest.fn(),
      onIdentityError: jest.fn(),
      onSettled: jest.fn(),
    });
    await Promise.resolve();

    currentEpoch = 2;
    const actorBReader = jest.fn().mockRejectedValue(
      Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
        code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
        statusCode: 404,
      }),
    );
    await runCanonicalDocumentParsingLoad({
      isCurrent: () => currentEpoch === 2,
      readIdentity: jest.fn().mockResolvedValue(identityB),
      readPage: () => {
        readerCalls += 1;
        return actorBReader();
      },
      onFresh: jest.fn(),
      onDenied: () => {
        domMarker = null;
      },
      onIdentityError: jest.fn(),
      onSettled: jest.fn(),
    });

    actorAReader.resolve(page('ACTOR_A_SECRET_MARKER'));
    await actorALoad;

    expect(readerCalls).toBe(2);
    expect(actorBReader).toHaveBeenCalledTimes(1);
    expect(domMarker).toBeNull();
    expect(readRecentWorkItems(identityA)).toEqual([]);
    expect([...values.values()].join('\n')).not.toContain(
      'ACTOR_A_SECRET_MARKER',
    );
  });
});
