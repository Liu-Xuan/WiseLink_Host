import {
  CanonicalDocumentParsingSettingsService,
  DOCUMENT_PARSING_SETTINGS_MANAGER_ROLE_ENV,
} from '../../server/modules/model-settings/canonical-document-parsing-settings.service';
import { CanonicalDocumentParsingSettingsRepository } from '../../server/modules/model-settings/canonical-document-parsing-settings.repository';
import { miaodaHostedFinalUserActor } from '../../server/modules/work-item/production-miaoda-browser-ingress';
import { CANONICAL_DEVELOPMENT_ROLE_ID } from '../../server/modules/canonical-host/canonical-host.constants';
import { CANONICAL_MODEL_MANAGER_ROLE_ENV } from '../../server/modules/model-settings/canonical-model-catalog';
const role = 'parsing-manager-test';
const originalEnv = { ...process.env };
function actor(roles = [role]) {
  const identity = miaodaHostedFinalUserActor({
    userId: 'fixture-user',
    tenantId: 'fixture-tenant',
    appId: 'app_17bzc551rsg',
    env: 'runtime',
    roles,
  });
  return {
    userId: identity.canonicalSubject.id,
    tenantId: identity.tenantId,
    appId: identity.applicationScopeId,
    roles,
    env: 'runtime',
    objectAccessActor: identity,
  };
}
const input = {
  expectedRevision: 2,
  localMineruFallbackEnabled: true,
  titleEnhancementEnabled: true,
};
function setup() {
  const repository = {
    read: jest.fn().mockResolvedValue(null),
    compareAndSet: jest
      .fn()
      .mockResolvedValue({ ...input, revision: 3, updatedAt: new Date() }),
  };
  return {
    repository,
    service: new CanonicalDocumentParsingSettingsService(repository as never),
  };
}
beforeEach(() => {
  process.env.SANDBOX_ID = 'offline-unit-fixture';
  delete process.env.MIAODA_LOCAL_DEV;
  process.env[DOCUMENT_PARSING_SETTINGS_MANAGER_ROLE_ENV] = role;
});
afterEach(() => {
  process.env = { ...originalEnv };
});
it('defaults off and reports missing manager configuration without enabling writes', async () => {
  delete process.env[DOCUMENT_PARSING_SETTINGS_MANAGER_ROLE_ENV];
  const { service, repository } = setup();
  expect(await service.read(actor())).toMatchObject({
    revision: 0,
    localMineruFallbackEnabled: false,
    titleEnhancementEnabled: false,
    canManage: false,
    managementStatus: 'ROLE_NOT_CONFIGURED',
  });
  await expect(service.update(input, actor())).rejects.toThrow(
    'DOCUMENT_PARSING_SETTINGS_ROLE_NOT_CONFIGURED',
  );
  expect(repository.compareAndSet).not.toHaveBeenCalled();
});
it('does not reuse model manager privilege or development role', async () => {
  const { service, repository } = setup();
  process.env[CANONICAL_MODEL_MANAGER_ROLE_ENV] = 'model-only';
  await expect(service.update(input, actor(['model-only']))).rejects.toThrow(
    'DOCUMENT_PARSING_SETTINGS_MANAGER_REQUIRED',
  );
  process.env[DOCUMENT_PARSING_SETTINGS_MANAGER_ROLE_ENV] =
    CANONICAL_DEVELOPMENT_ROLE_ID;
  await expect(
    service.update(input, actor([CANONICAL_DEVELOPMENT_ROLE_ID])),
  ).rejects.toThrow('DOCUMENT_PARSING_SETTINGS_ROLE_NOT_CONFIGURED');
  expect(repository.compareAndSet).not.toHaveBeenCalled();
});
it('requires matching platform role and tenant identity', async () => {
  const { service } = setup();
  const forged = actor([]);
  forged.roles = [role];
  await expect(service.update(input, forged)).rejects.toThrow(
    'DOCUMENT_PARSING_SETTINGS_MANAGER_REQUIRED',
  );
  await expect(
    service.read({ ...actor(), tenantId: 'another' }),
  ).rejects.toThrow('MODEL_SETTINGS_IDENTITY_REQUIRED');
});
it('saves only validated flags and captured revision with the authenticated tenant and actor', async () => {
  const { service, repository } = setup();
  expect(await service.update(input, actor())).toMatchObject({
    revision: 3,
    canManage: true,
    localMineruFallbackEnabled: true,
    titleEnhancementEnabled: true,
  });
  expect(repository.compareAndSet).toHaveBeenCalledWith({
    ...input,
    tenantId: actor().tenantId,
    actorUserId: actor().userId,
  });
  repository.read.mockResolvedValue({
    ...input,
    revision: 3,
    updatedAt: new Date(),
  });
  expect(await service.capture(actor().tenantId)).toEqual({
    revision: 3,
    localMineruFallbackEnabled: true,
    titleEnhancementEnabled: true,
  });
});
it.each([
  { ...input, modelRef: 'unauthorized' },
  { ...input, titleEnhancementEnabled: 'true' },
  { ...input, expectedRevision: -1 },
])('rejects extra model writes and invalid values', async (value) => {
  const { service, repository } = setup();
  await expect(service.update(value as never, actor())).rejects.toThrow(
    'DOCUMENT_PARSING_SETTINGS_INPUT_INVALID',
  );
  expect(repository.compareAndSet).not.toHaveBeenCalled();
});
it('does not silently default settings on storage failure', async () => {
  const { service, repository } = setup();
  repository.read.mockRejectedValue(new Error('storage unavailable'));
  await expect(service.capture('tenant')).rejects.toThrow(
    'storage unavailable',
  );
});
it('repository update excludes modelRef and uses tenant plus revision CAS', async () => {
  const returning = jest.fn().mockResolvedValue([{ revision: 3 }]);
  const where = jest.fn().mockReturnValue({ returning });
  const set = jest.fn().mockReturnValue({ where });
  const db = { update: jest.fn().mockReturnValue({ set }) };
  const repository = new CanonicalDocumentParsingSettingsRepository(
    db as never,
  );
  await repository.compareAndSet({
    ...input,
    tenantId: 'fixture-tenant',
    actorUserId: 'fixture-user',
  });
  expect(Object.keys(set.mock.calls[0][0]).sort()).toEqual(
    [
      'changedByUserId',
      'localMineruFallbackEnabled',
      'revision',
      'titleEnhancementEnabled',
      'updatedAt',
      'updatedBy',
    ].sort(),
  );
  expect(set.mock.calls[0][0]).toMatchObject({
    revision: 3,
    localMineruFallbackEnabled: true,
    titleEnhancementEnabled: true,
  });
  const { PgDialect } = await import('drizzle-orm/pg-core');
  const query = new PgDialect().sqlToQuery(where.mock.calls[0][0]);
  expect(query.sql).toContain('"tenant_id"');
  expect(query.sql).toContain('"revision"');
  expect(query.params).toEqual(['fixture-tenant', 2]);
  returning.mockResolvedValue([]);
  await expect(
    repository.compareAndSet({
      ...input,
      tenantId: 'fixture-tenant',
      actorUserId: 'fixture-user',
    }),
  ).rejects.toThrow('DOCUMENT_PARSING_SETTINGS_REVISION_CONFLICT');
});
