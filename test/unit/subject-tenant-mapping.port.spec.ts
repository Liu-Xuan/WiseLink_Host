import {
  DatabaseSubjectTenantMappingAdapter,
  type SubjectTenantMapping,
} from '../../server/modules/identity/subject-tenant-mapping.port';
import type { IdentityRepository } from '../../server/modules/identity/identity.repository';
import type { OAuthConfigPort } from '../../server/modules/identity/oauth-config.port';

const OFFICIAL_INPUT = {
  feishuOpenId: 'official-open-id',
  feishuTenantKey: 'official-tenant-key',
  feishuUserId: 'official-user-id',
  expectedClientId: 'cli_aadde8b579f95bc9',
};

const PERSISTED_MAPPING = {
  id: '11111111-1111-4111-8111-111111111111',
  feishuOpenId: OFFICIAL_INPUT.feishuOpenId,
  feishuTenantKey: OFFICIAL_INPUT.feishuTenantKey,
  feishuUserId: OFFICIAL_INPUT.feishuUserId,
  miaodaUserId: 'hosted-actor',
  miaodaTenantId: 'controlled-dev-tenant',
  expectedClientId: OFFICIAL_INPUT.expectedClientId,
  revision: 1,
};

describe('DatabaseSubjectTenantMappingAdapter one-time bootstrap', () => {
  it('uses an existing Host mapping and never attempts bootstrap', async () => {
    const repository = mockRepository(PERSISTED_MAPPING);
    const adapter = new DatabaseSubjectTenantMappingAdapter(
      repository as unknown as IdentityRepository,
      config({ kind: 'DISABLED' }),
    );

    const result = await adapter.resolveMapping(OFFICIAL_INPUT);

    expect(result).toEqual(expectedMapping());
    expect(repository.bootstrapSubjectMapping).not.toHaveBeenCalled();
  });

  it('remains fail-closed when bootstrap is disabled', async () => {
    const repository = mockRepository(null);
    const adapter = new DatabaseSubjectTenantMappingAdapter(
      repository as unknown as IdentityRepository,
      config({ kind: 'DISABLED' }),
    );

    await expect(adapter.resolveMapping(OFFICIAL_INPUT)).resolves.toBeNull();
    expect(repository.bootstrapSubjectMapping).not.toHaveBeenCalled();
  });

  it('bootstraps only from official user_info fields for the exact client', async () => {
    const repository = mockRepository(null, PERSISTED_MAPPING);
    const adapter = new DatabaseSubjectTenantMappingAdapter(
      repository as unknown as IdentityRepository,
      config({
        kind: 'ENABLED',
        mode: 'OFFICIAL_ONE_TIME_ISOLATED_DEV',
        miaodaTenantId: 'controlled-dev-tenant',
      }),
    );

    await expect(adapter.resolveMapping(OFFICIAL_INPUT)).resolves.toEqual(
      expectedMapping(),
    );
    expect(repository.bootstrapSubjectMapping).toHaveBeenCalledTimes(1);
    expect(repository.bootstrapSubjectMapping).toHaveBeenCalledWith({
      ...OFFICIAL_INPUT,
      miaodaTenantId: 'controlled-dev-tenant',
    });
  });

  it('does not bootstrap when callback client differs from server config', async () => {
    const repository = mockRepository(null, PERSISTED_MAPPING);
    const adapter = new DatabaseSubjectTenantMappingAdapter(
      repository as unknown as IdentityRepository,
      { ...config({ kind: 'DISABLED' }), clientId: 'cli_other' },
    );

    await expect(adapter.resolveMapping(OFFICIAL_INPUT)).resolves.toBeNull();
    expect(repository.bootstrapSubjectMapping).not.toHaveBeenCalled();
  });

  function config(
    mappingBootstrap: OAuthConfigPort['mappingBootstrap'],
  ): OAuthConfigPort {
    return {
      configured: true,
      clientId: OFFICIAL_INPUT.expectedClientId,
      redirectUri: 'https://host/client/oauth/callback',
      tokenApiVersion: 'v2',
      mappingBootstrap,
      applicationScopeId: 'app_17bzc551rsg',
      sessionEnvironment: 'preview',
    };
  }

  function mockRepository(
    resolved: typeof PERSISTED_MAPPING | null,
    bootstrapped: typeof PERSISTED_MAPPING | null = null,
  ) {
    return {
      resolveSubjectMapping: jest.fn().mockResolvedValue(resolved),
      bootstrapSubjectMapping: jest.fn().mockResolvedValue(bootstrapped),
    };
  }

  function expectedMapping(): SubjectTenantMapping {
    return {
      mappingId: PERSISTED_MAPPING.id,
      miaodaUserId: PERSISTED_MAPPING.miaodaUserId,
      miaodaTenantId: PERSISTED_MAPPING.miaodaTenantId,
      feishuTenantKey: PERSISTED_MAPPING.feishuTenantKey,
      expectedClientId: PERSISTED_MAPPING.expectedClientId,
    };
  }
});
