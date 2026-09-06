import type { CanonicalHostActor } from '../../server/modules/canonical-host/canonical-host.types';
import { CanonicalModelSettingsService } from '../../server/modules/model-settings/canonical-model-settings.service';
import { CANONICAL_MODEL_MANAGER_ROLE_ENV } from '../../server/modules/model-settings/canonical-model-catalog';
import { parseExecutionModel } from '../../server/modules/model-settings/canonical-execution-model';
import { miaodaHostedFinalUserActor } from '../../server/modules/work-item/production-miaoda-browser-ingress';
import type { StoredCanonicalModelSetting } from '../../server/modules/model-settings/canonical-model-settings.repository';

const role = 'role_model_manager_fixture';
const originalEnv = { ...process.env };

function actor(roles = [role]): CanonicalHostActor {
  const identity = miaodaHostedFinalUserActor({
    userId: 'user-model-fixture',
    tenantId: 'tenant-model-fixture',
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

function setup(initial: StoredCanonicalModelSetting | null = null) {
  let stored = initial;
  const repository = {
    read: jest.fn(async () => stored),
    compareAndSet: jest.fn(async (input) => {
      if ((stored?.revision ?? 0) !== input.expectedRevision)
        throw Object.assign(new Error('Conflict'), {
          code: 'MODEL_SETTINGS_REVISION_CONFLICT',
          statusCode: 409,
        });
      stored = {
        tenantId: input.tenantId,
        modelRef: input.modelRef,
        revision: input.expectedRevision + 1,
        updatedAt: new Date(),
      };
      return stored;
    }),
  };
  return {
    service: new CanonicalModelSettingsService(repository as never),
    repository,
  };
}

describe('tenant global model selection', () => {
  beforeEach(() => {
    process.env.SANDBOX_ID = 'offline-unit-fixture';
    delete process.env.MIAODA_LOCAL_DEV;
    process.env[CANONICAL_MODEL_MANAGER_ROLE_ENV] = role;
  });
  afterEach(() => {
    for (const key of [
      'SANDBOX_ID',
      'MIAODA_LOCAL_DEV',
      CANONICAL_MODEL_MANAGER_ROLE_ENV,
    ]) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it('exposes the explicitly selected initial M3 and registered built-in / DLI options, with no credentials', async () => {
    const { service, repository } = setup();
    const result = await service.read(actor());
    expect(result).toMatchObject({
      selectedModelRef: 'miaoda/minimax-m3',
      revision: 0,
      canManage: true,
      effectiveFor: 'NEW_ANALYSIS_TASKS_ONLY',
    });
    expect(result.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          modelRef: 'dli/gpt-5.6-sol',
          providerKind: 'CUSTOM',
        }),
      ]),
    );
    expect(repository.read).toHaveBeenCalledWith('tenant-model-fixture');
    expect(JSON.stringify(result)).not.toMatch(
      /apiKey|https?:|credential|user-model-fixture/u,
    );
  });

  it('switches only future captures and rejects stale setting revisions', async () => {
    const { service, repository } = setup();
    const old = await service.captureForNewTask(
      'tenant-model-fixture',
      new Date('2026-09-06T01:00:00Z'),
    );
    await service.update(
      { expectedRevision: 0, modelRef: 'dli/gpt-5.6-sol' },
      actor(),
    );
    const next = await service.captureForNewTask(
      'tenant-model-fixture',
      new Date('2026-09-06T02:00:00Z'),
    );
    expect(old).toMatchObject({
      modelRef: 'miaoda/minimax-m3',
      settingsRevision: 0,
    });
    expect(next).toMatchObject({
      modelRef: 'dli/gpt-5.6-sol',
      providerKind: 'CUSTOM',
      settingsRevision: 1,
    });
    expect(repository.compareAndSet).toHaveBeenCalledWith({
      tenantId: 'tenant-model-fixture',
      actorUserId: 'user-model-fixture',
      expectedRevision: 0,
      modelRef: 'dli/gpt-5.6-sol',
    });
    await expect(
      service.update(
        { expectedRevision: 0, modelRef: 'miaoda/minimax-m3' },
        actor(),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect((await service.read(actor())).selectedModelRef).toBe(
      'dli/gpt-5.6-sol',
    );
  });

  it('requires matching verified identity and platform role before a global write', async () => {
    const { service, repository } = setup();
    await expect(
      service.update(
        { expectedRevision: 0, modelRef: 'dli/gpt-5.6-sol' },
        actor([]),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.read({ ...actor(), objectAccessActor: undefined }),
    ).rejects.toMatchObject({ code: 'MODEL_SETTINGS_IDENTITY_REQUIRED' });
    const mismatch = actor();
    mismatch.objectAccessActor!.tenantId = 'another-tenant';
    await expect(service.read(mismatch)).rejects.toMatchObject({
      statusCode: 403,
    });
    const forgedRole = actor([]);
    forgedRole.roles = [role];
    await expect(
      service.update(
        { expectedRevision: 0, modelRef: 'dli/gpt-5.6-sol' },
        forgedRole,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.compareAndSet).not.toHaveBeenCalled();
  });

  it('does not promote the development role or a missing role setting into permission', async () => {
    const { service, repository } = setup();
    for (const value of ['', 'wiselink_development']) {
      process.env[CANONICAL_MODEL_MANAGER_ROLE_ENV] = value;
      expect(await service.read(actor([value]))).toMatchObject({
        canManage: false,
        managementStatus: 'ROLE_NOT_CONFIGURED',
      });
      await expect(
        service.update(
          { expectedRevision: 0, modelRef: 'dli/gpt-5.6-sol' },
          actor([value]),
        ),
      ).rejects.toMatchObject({ statusCode: 503 });
    }
    expect(repository.compareAndSet).not.toHaveBeenCalled();
  });

  it('rejects arbitrary model refs, caller identity, URLs and secret fields', async () => {
    const { service, repository } = setup();
    for (const input of [
      { expectedRevision: 0, modelRef: 'other/model' },
      { expectedRevision: -1, modelRef: 'miaoda/minimax-m3' },
      { expectedRevision: 0, modelRef: 'miaoda/minimax-m3', tenantId: 'other' },
      {
        expectedRevision: 0,
        modelRef: 'miaoda/minimax-m3',
        apiKey: 'fixture-only',
      },
      {
        expectedRevision: 0,
        modelRef: 'miaoda/minimax-m3',
        endpoint: 'https://untrusted.invalid',
      },
    ])
      await expect(service.update(input, actor())).rejects.toMatchObject({
        statusCode: 400,
      });
    expect(repository.compareAndSet).not.toHaveBeenCalled();
  });

  it('does not silently replace a saved unavailable model with the initial default', async () => {
    const { service } = setup({
      tenantId: 'tenant-model-fixture',
      revision: 3,
      modelRef: 'retired/model',
      updatedAt: new Date(),
    });
    expect(await service.read(actor())).toMatchObject({
      status: 'UNAVAILABLE',
      selectedModelRef: 'retired/model',
      revision: 3,
    });
    await expect(
      service.captureForNewTask('tenant-model-fixture', new Date()),
    ).rejects.toMatchObject({ code: 'MODEL_SETTINGS_MODEL_UNAVAILABLE' });
  });

  it('validates routing metadata without accepting header injection or extra fields', () => {
    const selection = {
      modelRef: 'dli/gpt-5.6-sol',
      displayName: 'GPT 5.6 Sol',
      providerKind: 'CUSTOM',
      settingsRevision: 2,
      selectedAt: '2026-09-06T00:00:00Z',
    };
    expect(parseExecutionModel(selection)).toEqual(selection);
    expect(() =>
      parseExecutionModel({
        ...selection,
        modelRef: 'dli/gpt-5.6-sol\r\nx-header: injected',
      }),
    ).toThrow('TASK_EXECUTION_MODEL_INVALID');
    expect(() =>
      parseExecutionModel({ ...selection, apiKey: 'fixture-only' }),
    ).toThrow('TASK_EXECUTION_MODEL_INVALID');
  });
});
