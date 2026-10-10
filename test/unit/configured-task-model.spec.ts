import { CanonicalModelSettingsService } from '../../server/modules/model-settings/canonical-model-settings.service';
import { taskModelSelection } from '../../server/modules/model-settings/canonical-model-catalog';
import { miaodaHostedFinalUserActor } from '../../server/modules/work-item/production-miaoda-browser-ingress';
function actor() {
  const identity = miaodaHostedFinalUserActor({
    userId: 'user-config',
    tenantId: 'tenant-config',
    appId: 'app_17bzc551rsg',
    env: 'runtime',
    roles: [],
  });
  return {
    userId: 'user-config',
    tenantId: 'tenant-config',
    appId: 'app_17bzc551rsg',
    env: 'runtime' as const,
    roles: [],
    objectAccessActor: identity,
  };
}
function setup(modelRef = 'miaoda/glm-5.3') {
  const repository = {
    read: jest
      .fn()
      .mockResolvedValue({
        tenantId: 'tenant-config',
        modelRef,
        revision: 7,
        updatedAt: new Date('2026-10-10T00:00:00Z'),
      }),
    readWorkItemModel: jest.fn().mockResolvedValue(null),
    pinWorkItemModel: jest.fn(
      async (_tenant: string, _wi: string, model: unknown) => model,
    ),
  };
  return {
    repository,
    service: new CanonicalModelSettingsService(repository as never),
  };
}
describe('configuration-page model inherited by new unfrozen tasks', () => {
  const sandbox = process.env.SANDBOX_ID;
  beforeEach(() => {
    process.env.SANDBOX_ID = 'offline-config-test';
  });
  afterEach(() => {
    if (sandbox === undefined) delete process.env.SANDBOX_ID;
    else process.env.SANDBOX_ID = sandbox;
  });
  it('offers the saved configuration as the task default without needing a management role', async () => {
    const { service, repository } = setup();
    expect((await service.taskOptions(actor())).defaultModelRef).toBe(
      'miaoda/glm-5.3',
    );
    expect(repository.read).toHaveBeenCalledWith('tenant-config', undefined);
  });
  it('freezes the configured model and its settings revision on first initial execution', async () => {
    const { service, repository } = setup();
    const selectedAt = new Date('2026-10-10T14:00:00Z');
    const model = await service.captureForWorkItem(
      'tenant-config',
      'WI-config',
      selectedAt,
    );
    expect(model).toEqual({
      modelRef: 'miaoda/glm-5.3',
      displayName: 'GLM 5.3',
      providerKind: 'BUILT_IN',
      settingsRevision: 7,
      selectedAt: selectedAt.toISOString(),
    });
    expect(repository.pinWorkItemModel).toHaveBeenCalledWith(
      'tenant-config',
      'WI-config',
      model,
    );
  });
  it('preserves an explicit or historical snapshot without consulting new defaults', async () => {
    const { service, repository } = setup();
    const old = taskModelSelection('dli/gpt-5.6-sol');
    repository.readWorkItemModel.mockResolvedValue(old);
    expect(
      await service.captureForWorkItem(
        'tenant-config',
        'WI-config',
        new Date(),
      ),
    ).toEqual(old);
    expect(repository.read).not.toHaveBeenCalled();
  });
  it('does not silently use a fallback if configured selection is unavailable', async () => {
    const { service, repository } = setup('retired/model');
    await expect(
      service.captureForWorkItem('tenant-config', 'WI-config', new Date()),
    ).rejects.toMatchObject({ code: 'MODEL_SETTINGS_MODEL_UNAVAILABLE' });
    expect(repository.pinWorkItemModel).not.toHaveBeenCalled();
  });
  it('preserves database failure and does not pin a fallback', async () => {
    const { service, repository } = setup();
    repository.read.mockRejectedValue(new Error('settings read failed'));
    await expect(
      service.captureForWorkItem('tenant-config', 'WI-config', new Date()),
    ).rejects.toThrow('settings read failed');
    expect(repository.pinWorkItemModel).not.toHaveBeenCalled();
  });
});
