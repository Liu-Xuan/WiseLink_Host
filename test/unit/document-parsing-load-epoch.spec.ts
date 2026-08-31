import type { CanonicalDocumentParsingPageResponse } from '@shared/api.interface';
import {
  createCanonicalDocumentParsingRouteHandoff,
  createCanonicalDocumentParsingProjectionReader,
  resolveCanonicalDocumentParsingRouteHandoff,
  runCanonicalDocumentParsingLoad,
} from '../../client/src/pages/DocumentParsingPage/document-parsing-load';

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
    status: 'FRESH_READ',
    workItem: {
      workItemId: 'WI-SHARED',
      classification: { normalizedFamily: 'SB' },
      source: {
        documentId: marker,
        documentVersionId: `DV-${marker}`,
      },
    },
    readerProjection: {
      query: '',
    },
  } as CanonicalDocumentParsingPageResponse;
}

describe('DocumentParsingPage identity-bound load epoch', () => {
  const identityA = { userId: 'user-a', tenantId: 'tenant-a' };
  const identityB = { userId: 'user-b', tenantId: 'tenant-b' };

  it('cannot render or cache an old actor response after the new actor is denied', async () => {
    const actorAReader = deferred<CanonicalDocumentParsingPageResponse>();
    let currentEpoch = 1;
    let domMarker: string | null = null;
    const cacheMarkers: string[] = [];
    let readerCalls = 0;

    const actorALoad = runCanonicalDocumentParsingLoad({
      isCurrent: () => currentEpoch === 1,
      readIdentity: jest.fn().mockResolvedValue(identityA),
      readPage: () => {
        readerCalls += 1;
        return actorAReader.promise;
      },
      onFresh: (_identity, fresh) => {
        domMarker = fresh.workItem.source.documentId;
        cacheMarkers.push(fresh.workItem.source.documentId);
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
    expect(cacheMarkers).toEqual([]);
  });

  it('shares one large projection request across overlapping epochs with the same stable identity key', async () => {
    const projectionReader = createCanonicalDocumentParsingProjectionReader();
    const projection = deferred<CanonicalDocumentParsingPageResponse>();
    const freshMarkers: string[] = [];
    let currentEpoch = 1;
    let projectionCalls = 0;

    const startLoad = (epoch: number): Promise<void> =>
      runCanonicalDocumentParsingLoad({
        isCurrent: () => currentEpoch === epoch,
        readIdentity: jest.fn().mockResolvedValue(identityA),
        readPage: (identity) =>
          projectionReader.read(
            {
              identity,
              sessionGeneration: 1,
              workItemId: 'WI-SHARED',
              query: epoch === 1 ? '  hydraulic  ' : 'hydraulic',
            },
            () => {
              projectionCalls += 1;
              return projection.promise;
            },
          ),
        onFresh: (_identity, fresh) => {
          freshMarkers.push(fresh.workItem.source.documentId);
        },
        onDenied: jest.fn(),
        onIdentityError: jest.fn(),
        onSettled: jest.fn(),
      });

    const firstLoad = startLoad(1);
    await Promise.resolve();
    currentEpoch = 2;
    const secondLoad = startLoad(2);
    await Promise.resolve();

    expect(projectionCalls).toBe(1);
    projection.resolve(page('SHARED_FRESH_PROJECTION'));
    await Promise.all([firstLoad, secondLoad]);

    expect(freshMarkers).toEqual(['SHARED_FRESH_PROJECTION']);
  });

  it('does not retain completed projections or share across identity and query keys', async () => {
    const projectionReader = createCanonicalDocumentParsingProjectionReader();
    let projectionCalls = 0;
    const readProjection =
      async (): Promise<CanonicalDocumentParsingPageResponse> => {
        projectionCalls += 1;
        return page(`PROJECTION_${projectionCalls}`);
      };

    await projectionReader.read(
      {
        identity: identityA,
        sessionGeneration: 1,
        workItemId: 'WI-SHARED',
        query: 'hydraulic',
      },
      readProjection,
    );
    await projectionReader.read(
      {
        identity: identityA,
        sessionGeneration: 1,
        workItemId: 'WI-SHARED',
        query: 'hydraulic',
      },
      readProjection,
    );
    await Promise.all([
      projectionReader.read(
        {
          identity: identityA,
          sessionGeneration: 1,
          workItemId: 'WI-SHARED',
          query: 'electrical',
        },
        readProjection,
      ),
      projectionReader.read(
        {
          identity: identityB,
          sessionGeneration: 1,
          workItemId: 'WI-SHARED',
          query: 'hydraulic',
        },
        readProjection,
      ),
    ]);

    expect(projectionCalls).toBe(4);
  });

  it('reads identity once for a successful load and once for a denied load', async () => {
    const successfulIdentity = jest.fn().mockResolvedValue(identityA);
    const deniedIdentity = jest.fn().mockResolvedValue(identityA);

    await runCanonicalDocumentParsingLoad({
      isCurrent: () => true,
      readIdentity: successfulIdentity,
      readPage: jest.fn().mockResolvedValue(page('SUCCESS')),
      onFresh: jest.fn(),
      onDenied: jest.fn(),
      onIdentityError: jest.fn(),
      onSettled: jest.fn(),
    });
    await runCanonicalDocumentParsingLoad({
      isCurrent: () => true,
      readIdentity: deniedIdentity,
      readPage: jest.fn().mockRejectedValue(new Error('DENIED')),
      onFresh: jest.fn(),
      onDenied: jest.fn(),
      onIdentityError: jest.fn(),
      onSettled: jest.fn(),
    });

    expect(successfulIdentity).toHaveBeenCalledTimes(1);
    expect(deniedIdentity).toHaveBeenCalledTimes(1);
  });

  it('does not share an in-flight projection across session generations', async () => {
    const projectionReader = createCanonicalDocumentParsingProjectionReader();
    const firstProjection = deferred<CanonicalDocumentParsingPageResponse>();
    let projectionCalls = 0;
    const startRead = (sessionGeneration: number) =>
      projectionReader.read(
        {
          identity: identityA,
          sessionGeneration,
          workItemId: 'WI-SHARED',
          query: 'hydraulic',
        },
        () => {
          projectionCalls += 1;
          return sessionGeneration === 1
            ? firstProjection.promise
            : Promise.resolve(page('GENERATION_2'));
        },
      );

    const generationOneRead = startRead(1);
    await expect(startRead(2)).resolves.toEqual(page('GENERATION_2'));
    firstProjection.resolve(page('GENERATION_1'));
    await expect(generationOneRead).resolves.toEqual(page('GENERATION_1'));

    expect(projectionCalls).toBe(2);
  });

  it('hands a just-read projection to the same session route without a duplicate request', () => {
    const fresh = page('ROUTE_HANDOFF');
    const handoff = createCanonicalDocumentParsingRouteHandoff(
      fresh,
      7,
      '',
      1_000,
    );

    expect(
      resolveCanonicalDocumentParsingRouteHandoff(handoff, {
        sessionGeneration: 7,
        workItemId: 'WI-SHARED',
        query: '',
        nowMs: 5_999,
      }),
    ).toBe(fresh);
  });

  it('rejects stale, cross-session, cross-work-item, and cross-query route handoffs', () => {
    const fresh = page('ROUTE_HANDOFF');
    const handoff = createCanonicalDocumentParsingRouteHandoff(
      fresh,
      7,
      '',
      1_000,
    );
    const expected = {
      sessionGeneration: 7,
      workItemId: 'WI-SHARED',
      query: '',
      nowMs: 6_001,
    };

    expect(
      resolveCanonicalDocumentParsingRouteHandoff(handoff, expected),
    ).toBeNull();
    expect(
      resolveCanonicalDocumentParsingRouteHandoff(handoff, {
        ...expected,
        nowMs: 1_001,
        sessionGeneration: 8,
      }),
    ).toBeNull();
    expect(
      resolveCanonicalDocumentParsingRouteHandoff(handoff, {
        ...expected,
        nowMs: 1_001,
        workItemId: 'WI-OTHER',
      }),
    ).toBeNull();
    expect(
      resolveCanonicalDocumentParsingRouteHandoff(handoff, {
        ...expected,
        nowMs: 1_001,
        query: 'applicability',
      }),
    ).toBeNull();
  });
});
