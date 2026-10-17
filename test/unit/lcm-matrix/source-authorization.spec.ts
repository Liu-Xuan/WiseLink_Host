import type { LcmDatabaseScope } from '@shared/lcm-configuration-store.interface';
import type {
  LcmSnapshotBrowseRequest,
  LcmSnapshotCatalogueResponse,
} from '@shared/lcm-source-reading.interface';
import { LcmSourceReadingService } from '@server/modules/lcm-export-staging/lcm-source-reading.service';
import {
  lcmReadingError,
  type LcmSnapshotReadRepository,
  type LcmSourceReadAuthorization,
  type LcmSourceReadGrant,
} from '@server/modules/lcm-export-staging/lcm-source-reading.port';
import { actor } from '../tdms-source/tdms-fixtures';

/** Local decision/IO doubles exercise the actual consumer; they grant no production source access. */
function setup() {
  const subject = actor();
  let authorizationAvailable: boolean = true;
  let repositoryAvailable: boolean = true;
  let afterRead: () => void = (): void => undefined;
  let grant: LcmSourceReadGrant = {
    applicationScopeId: subject.applicationScopeId,
    scope: {
      tenantId: subject.tenantId,
      actorId: subject.canonicalSubject.id,
      authorizedSourceInstanceIds: ['test-lcm', 'test-lcm-other'],
    },
    permissionRevision: 'synthetic-r1',
    authorityRef: 'synthetic-current-decision',
    managementDomains: {
      'test-lcm': {
        managementDomainRef: 'synthetic-management-domain',
        evidenceRef: 'synthetic-domain-evidence',
      },
    },
  };
  const authorize = jest.fn(
    async (): Promise<LcmSourceReadGrant> => structuredClone(grant),
  );
  const catalogue = jest.fn<
    Promise<LcmSnapshotCatalogueResponse>,
    [LcmDatabaseScope, LcmSnapshotBrowseRequest]
  >(async () => {
    afterRead();
    return { snapshots: [], hasMore: false, nextAfter: null };
  });
  const authorization: LcmSourceReadAuthorization = {
    get available(): boolean {
      return authorizationAvailable;
    },
    authorize,
  };
  const repository: LcmSnapshotReadRepository = {
    get available(): boolean {
      return repositoryAvailable;
    },
    catalogue,
  };
  return {
    subject,
    authorize,
    catalogue,
    service: new LcmSourceReadingService(authorization, repository),
    currentGrant: (): LcmSourceReadGrant => structuredClone(grant),
    setGrant: (value: LcmSourceReadGrant): void => {
      grant = value;
    },
    afterRead: (callback: () => void): void => {
      afterRead = callback;
    },
    setAuthorizationAvailable: (value: boolean): void => {
      authorizationAvailable = value;
    },
    setRepositoryAvailable: (value: boolean): void => {
      repositoryAvailable = value;
    },
  };
}

describe('LCM source decisions and received-store failures at the existing consumer', () => {
  it.each(['authorization', 'repository'] as const)(
    'rejects unavailable %s before either provider can be read',
    async (missing: string) => {
      const test = setup();
      if (missing === 'authorization') test.setAuthorizationAvailable(false);
      else test.setRepositoryAvailable(false);
      await expect(
        test.service.catalogue(test.subject, {}),
      ).rejects.toMatchObject({
        code: 'LCM_SOURCE_READING_UNCONFIGURED',
        statusCode: 503,
      });
      expect(test.authorize).not.toHaveBeenCalled();
      expect(test.catalogue).not.toHaveBeenCalled();
    },
  );

  it('keeps an explicit current source denial instead of inferring access from a valid identity', async () => {
    const test = setup();
    const denied: Error = lcmReadingError('LCM_SOURCE_ACCESS_DENIED', 403);
    test.authorize.mockRejectedValue(denied);
    await expect(test.service.catalogue(test.subject, {})).rejects.toBe(denied);
    expect(test.catalogue).not.toHaveBeenCalled();
  });

  it('propagates a failed authority read instead of returning an empty catalogue', async () => {
    const test = setup();
    const failed: Error = Object.assign(
      new Error('synthetic authority read timed out'),
      { code: 'ETIMEDOUT' },
    );
    test.authorize.mockRejectedValue(failed);
    await expect(test.service.catalogue(test.subject, {})).rejects.toBe(failed);
    expect(test.catalogue).not.toHaveBeenCalled();
  });

  it('propagates a catalogue store failure without an empty successful read', async () => {
    const test = setup();
    const failed: Error = Object.assign(new Error('synthetic store failure'), {
      code: 'ECONNRESET',
    });
    test.catalogue.mockRejectedValue(failed);
    await expect(test.service.catalogue(test.subject, {})).rejects.toBe(failed);
    expect(test.authorize).toHaveBeenCalledTimes(1);
  });

  it('returns a genuine empty catalogue after a store read and unchanged current decision', async () => {
    const test = setup();
    await expect(
      test.service.catalogue(test.subject, { limit: 50 }),
    ).resolves.toEqual({
      snapshots: [],
      hasMore: false,
      nextAfter: null,
    });
    expect(test.authorize).toHaveBeenCalledTimes(2);
    expect(test.catalogue).toHaveBeenCalledWith(test.currentGrant().scope, {
      limit: 50,
    });
  });

  it('rejects an empty store result when the current source decision is revoked before return', async () => {
    const test = setup();
    const denied: Error = lcmReadingError('LCM_SOURCE_ACCESS_DENIED', 403);
    test.afterRead((): void => {
      test.authorize.mockRejectedValueOnce(denied);
    });
    await expect(test.service.catalogue(test.subject, {})).rejects.toBe(denied);
    expect(test.catalogue).toHaveBeenCalledTimes(1);
    expect(test.authorize).toHaveBeenCalledTimes(2);
  });

  it('detects an authority change even when its permission revision string is unchanged', async () => {
    const test = setup();
    test.afterRead((): void => {
      test.setGrant({
        ...test.currentGrant(),
        authorityRef: 'synthetic-other-authority',
      });
    });
    await expect(
      test.service.catalogue(test.subject, {}),
    ).rejects.toMatchObject({
      code: 'LCM_SOURCE_PERMISSION_CHANGED',
      statusCode: 409,
    });
    expect(test.authorize).toHaveBeenCalledTimes(2);
  });

  it('rejects removal of a source from the owner read range despite an unchanged permission revision', async () => {
    const test = setup();
    test.afterRead((): void => {
      const grant: LcmSourceReadGrant = test.currentGrant();
      test.setGrant({
        ...grant,
        scope: {
          ...grant.scope,
          authorizedSourceInstanceIds: ['test-lcm-other'],
        },
      });
    });
    await expect(
      test.service.catalogue(test.subject, {}),
    ).rejects.toMatchObject({
      code: 'LCM_SOURCE_PERMISSION_CHANGED',
      statusCode: 409,
    });
    expect(test.catalogue).toHaveBeenCalledTimes(1);
  });

  it('rejects changed management-domain evidence before returning the catalogue', async () => {
    const test = setup();
    test.afterRead((): void => {
      test.setGrant({
        ...test.currentGrant(),
        managementDomains: {
          'test-lcm': {
            managementDomainRef: 'synthetic-management-domain',
            evidenceRef: 'synthetic-replacement-evidence',
          },
        },
      });
    });
    await expect(
      test.service.catalogue(test.subject, {}),
    ).rejects.toMatchObject({
      code: 'LCM_SOURCE_PERMISSION_CHANGED',
      statusCode: 409,
    });
  });

  it.each(['authorization', 'repository'] as const)(
    'rejects loss of %s availability during the store read',
    async (missing: string) => {
      const test = setup();
      test.afterRead((): void => {
        if (missing === 'authorization') test.setAuthorizationAvailable(false);
        else test.setRepositoryAvailable(false);
      });
      await expect(
        test.service.catalogue(test.subject, {}),
      ).rejects.toMatchObject({
        code: 'LCM_SOURCE_READING_UNCONFIGURED',
        statusCode: 503,
      });
      expect(test.catalogue).toHaveBeenCalledTimes(1);
      expect(test.authorize).toHaveBeenCalledTimes(1);
    },
  );

  it('does not treat an absent current source range as an empty authorized catalogue', async () => {
    const test = setup();
    const grant: LcmSourceReadGrant = test.currentGrant();
    test.setGrant({
      ...grant,
      scope: { ...grant.scope, authorizedSourceInstanceIds: [] },
    });
    await expect(
      test.service.catalogue(test.subject, {}),
    ).rejects.toMatchObject({
      code: 'LCM_SOURCE_ACCESS_DENIED',
      statusCode: 403,
    });
    expect(test.catalogue).not.toHaveBeenCalled();
  });

  it('does not replace the requester with another owner from the same tenant', async () => {
    const test = setup();
    const grant: LcmSourceReadGrant = test.currentGrant();
    test.setGrant({
      ...grant,
      scope: { ...grant.scope, actorId: 'synthetic-other-owner' },
    });
    await expect(
      test.service.catalogue(test.subject, {}),
    ).rejects.toMatchObject({
      code: 'LCM_SOURCE_ACCESS_DENIED',
      statusCode: 403,
    });
    expect(test.catalogue).not.toHaveBeenCalled();
  });
});
