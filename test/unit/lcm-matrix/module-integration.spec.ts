import { Test, type TestingModule } from '@nestjs/testing';
import { LcmSourceReadingModule } from '@server/modules/lcm-export-staging/lcm-source-reading.module';
import { LcmSourceReadingController } from '@server/modules/lcm-export-staging/lcm-source-reading.controller';
import { LcmNativeMatrixReadingService } from '@server/modules/lcm-export-staging/lcm-native-matrix-reading.service';
import { LcmSourceReadingService } from '@server/modules/lcm-export-staging/lcm-source-reading.service';
import {
  LCM_SOURCE_READ_AUTHORIZATION,
  LCM_SNAPSHOT_READ_REPOSITORY,
  lcmReadingError,
  type LcmSourceReadAuthorization,
  type LcmSourceReadGrant,
  type LcmSnapshotReadRepository,
} from '@server/modules/lcm-export-staging/lcm-source-reading.port';
import type { LcmSnapshotCatalogueResponse } from '@shared/lcm-source-reading.interface';
import { actor } from '../tdms-source/tdms-fixtures';

/** Explicit local doubles prove DI composition, never a real source or received store. */
function configuredProviders() {
  const subject = actor();
  let authorizationAvailable: boolean = true;
  let repositoryAvailable: boolean = true;
  const grant: LcmSourceReadGrant = {
    applicationScopeId: subject.applicationScopeId,
    scope: {
      tenantId: subject.tenantId,
      actorId: subject.canonicalSubject.id,
      authorizedSourceInstanceIds: ['synthetic-configured-source'],
    },
    authorityRef: 'synthetic-configured-authority',
    permissionRevision: 'synthetic-r1',
  };
  const authorize = jest.fn(
    async (): Promise<LcmSourceReadGrant> => structuredClone(grant),
  );
  const catalogue = jest.fn(
    async (): Promise<LcmSnapshotCatalogueResponse> => ({
      snapshots: [],
      hasMore: false,
      nextAfter: null,
    }),
  );
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
    authorization,
    repository,
    authorize,
    catalogue,
    registration: LcmSourceReadingModule.register({
      authorizationProvider: {
        provide: LCM_SOURCE_READ_AUTHORIZATION,
        useValue: authorization,
      },
      repositoryProvider: {
        provide: LCM_SNAPSHOT_READ_REPOSITORY,
        useValue: repository,
      },
    }),
    setAuthorizationAvailable: (value: boolean): void => {
      authorizationAvailable = value;
    },
    setRepositoryAvailable: (value: boolean): void => {
      repositoryAvailable = value;
    },
  };
}

describe('R2 matrix wiring in the existing unconfigured Host reading module', () => {
  it('resolves the real controller and matrix service while both reads stay unavailable without providers', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [LcmSourceReadingModule],
    }).compile();
    try {
      expect(module.get(LcmSourceReadingController)).toBeDefined();
      const service: LcmNativeMatrixReadingService = module.get(
        LcmNativeMatrixReadingService,
      );
      const query = { snapshotIds: ['a'.repeat(64)] };
      await expect(service.read(actor(), query)).rejects.toMatchObject({
        code: 'LCM_SOURCE_READING_UNCONFIGURED',
        statusCode: 503,
      });
      await expect(
        service.details(actor(), {
          query,
          aircraftRef: 'synthetic-plane',
          binding: {
            readSetRef: 'synthetic-read',
            projectionRevision: 'r2',
            scopeRef: 'synthetic-scope',
            permissionRevision: 'p1',
            filterHash: 'synthetic-filter',
            orderRef: 'synthetic-order',
          },
        }),
      ).rejects.toMatchObject({
        code: 'LCM_SOURCE_READING_UNCONFIGURED',
        statusCode: 503,
      });
    } finally {
      await module.close();
    }
  });

  it('resolves the exact registered providers rather than the unavailable defaults', async () => {
    const test = configuredProviders();
    const module: TestingModule = await Test.createTestingModule({
      imports: [test.registration],
    }).compile();
    try {
      expect(module.get(LCM_SOURCE_READ_AUTHORIZATION)).toBe(
        test.authorization,
      );
      expect(module.get(LCM_SNAPSHOT_READ_REPOSITORY)).toBe(test.repository);
      const service: LcmSourceReadingService = module.get(
        LcmSourceReadingService,
      );
      await expect(
        service.catalogue(test.subject, { limit: 50 }),
      ).resolves.toEqual({
        snapshots: [],
        hasMore: false,
        nextAfter: null,
      });
      expect(test.catalogue).toHaveBeenCalledTimes(1);
      expect(test.authorize).toHaveBeenCalledTimes(2);
    } finally {
      await module.close();
    }
  });

  it.each(['authorization', 'repository'] as const)(
    'keeps a registered but unavailable %s closed before reading',
    async (missing: string) => {
      const test = configuredProviders();
      if (missing === 'authorization') test.setAuthorizationAvailable(false);
      else test.setRepositoryAvailable(false);
      const module: TestingModule = await Test.createTestingModule({
        imports: [test.registration],
      }).compile();
      try {
        const service: LcmSourceReadingService = module.get(
          LcmSourceReadingService,
        );
        await expect(service.catalogue(test.subject, {})).rejects.toMatchObject(
          {
            code: 'LCM_SOURCE_READING_UNCONFIGURED',
            statusCode: 503,
          },
        );
        expect(test.authorize).not.toHaveBeenCalled();
        expect(test.catalogue).not.toHaveBeenCalled();
      } finally {
        await module.close();
      }
    },
  );

  it('preserves registered authority and store failures before a genuine empty result', async () => {
    const test = configuredProviders();
    const denied: Error = lcmReadingError('LCM_SOURCE_ACCESS_DENIED', 403);
    const failed: Error = Object.assign(
      new Error('synthetic received-store read failed'),
      { code: 'ECONNRESET' },
    );
    const module: TestingModule = await Test.createTestingModule({
      imports: [test.registration],
    }).compile();
    try {
      const service: LcmSourceReadingService = module.get(
        LcmSourceReadingService,
      );
      test.authorize.mockRejectedValueOnce(denied);
      await expect(service.catalogue(test.subject, {})).rejects.toBe(denied);
      expect(test.catalogue).not.toHaveBeenCalled();
      test.catalogue.mockRejectedValueOnce(failed);
      await expect(service.catalogue(test.subject, {})).rejects.toBe(failed);
      await expect(service.catalogue(test.subject, {})).resolves.toEqual({
        snapshots: [],
        hasMore: false,
        nextAfter: null,
      });
      expect(test.authorize).toHaveBeenCalledTimes(4);
      expect(test.catalogue).toHaveBeenCalledTimes(2);
    } finally {
      await module.close();
    }
  });
});
