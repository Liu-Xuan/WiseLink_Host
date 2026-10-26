import { parseExecutionModel, readStoredExecutionModel } from '../../server/modules/model-settings/canonical-execution-model';
import { taskModelSelection, CANONICAL_MODEL_MANAGER_ROLE_ENV } from '../../server/modules/model-settings/canonical-model-catalog';
import { CanonicalModelSettingsService } from '../../server/modules/model-settings/canonical-model-settings.service';
import type { StoredCanonicalModelSetting } from '../../server/modules/model-settings/canonical-model-settings.repository';
import {
  CANONICAL_EXECUTION_MODEL_V2_ENV,
  CANONICAL_EXECUTION_MODEL_V2_SCHEMA,
  CANONICAL_INITIAL_GLM_OUTPUT_TOKENS,
  readModelOutputBudgets,
} from '../../server/modules/model-settings/canonical-model-output-budget';
import { parsePendingModelConfigurationRequest } from '../../server/modules/canonical-host/pending-model-configuration.request';
import { miaodaHostedFinalUserActor } from '../../server/modules/work-item/production-miaoda-browser-ingress';
import type { CanonicalHostActor } from '../../server/modules/canonical-host/canonical-host.types';

const modelRef = 'miaoda/glm-5.3';
const manager = 'role_budget_fixture';
const selectedAt = new Date('2026-10-26T00:00:00Z');
const originalEnv = { ...process.env };

function actor(roles: string[] = [manager]): CanonicalHostActor {
  const identity = miaodaHostedFinalUserActor({ userId: 'budget-user', tenantId: 'budget-tenant',
    appId: 'app_17bzc551rsg', env: 'runtime', roles });
  return { userId: identity.canonicalSubject.id, tenantId: identity.tenantId,
    appId: identity.applicationScopeId, roles, env: 'runtime', objectAccessActor: identity };
}

function settings(initialBudgets: Record<string, number> = {}, revision = 4) {
  let stored: StoredCanonicalModelSetting = { tenantId: 'budget-tenant',
    modelRef: 'miaoda/minimax-m3', revision, updatedAt: selectedAt,
    outputBudgetsJson: { ...initialBudgets } };
  const repository = {
    read: jest.fn(async (_tenantId: string) => stored),
    compareAndSet: jest.fn(async (input: { tenantId: string; modelRef: string;
      expectedRevision: number; maxOutputTokens?: number }) => {
      if (stored.revision !== input.expectedRevision)
        throw Object.assign(new Error('MODEL_SETTINGS_REVISION_CONFLICT'), { statusCode: 409 });
      const budgets = readModelOutputBudgets(stored.outputBudgetsJson);
      if (input.maxOutputTokens !== undefined) budgets[input.modelRef] = input.maxOutputTokens;
      stored = { ...stored, modelRef: input.modelRef, revision: stored.revision + 1,
        outputBudgetsJson: budgets };
      return stored;
    }),
  };
  return { repository, service: new CanonicalModelSettingsService(repository as never) };
}

beforeEach(() => {
  process.env.SANDBOX_ID = 'offline-budget-fixture';
  delete process.env.MIAODA_LOCAL_DEV;
  process.env[CANONICAL_MODEL_MANAGER_ROLE_ENV] = manager;
  delete process.env[CANONICAL_EXECUTION_MODEL_V2_ENV];
});
afterEach(() => {
  for (const key of ['SANDBOX_ID', 'MIAODA_LOCAL_DEV', CANONICAL_MODEL_MANAGER_ROLE_ENV,
    CANONICAL_EXECUTION_MODEL_V2_ENV]) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe('strict legacy and candidate budgeted execution model', () => {
  const legacy = taskModelSelection(modelRef, selectedAt);
  const budgeted = { ...legacy, schemaVersion: CANONICAL_EXECUTION_MODEL_V2_SCHEMA,
    settingsRevision: 5, maxOutputTokens: 131072 };

  it('reads old five-field bytes without filling a budget or version', () => {
    const raw = JSON.stringify(legacy);
    expect(JSON.stringify(readStoredExecutionModel(raw))).toBe(raw);
    expect(Object.keys(parseExecutionModel(legacy))).toHaveLength(5);
    expect(parseExecutionModel(budgeted)).toEqual(budgeted);
  });

  it.each([0, -1, 1.5, true, '131072', Number.MAX_SAFE_INTEGER + 1, null])(
    'rejects an invalid V2 budget %p before accepting a selection', (value) => {
      expect(() => parseExecutionModel({ ...budgeted, maxOutputTokens: value }))
        .toThrow('TASK_EXECUTION_MODEL_INVALID');
    },
  );

  it('rejects mixed versions, missing budget and unknown control fields', () => {
    for (const value of [
      { ...legacy, maxOutputTokens: 131072 },
      { ...legacy, schemaVersion: CANONICAL_EXECUTION_MODEL_V2_SCHEMA },
      { ...budgeted, schemaVersion: 'unknown-version' },
      { ...budgeted, endpoint: 'https://untrusted.invalid' },
    ]) expect(() => parseExecutionModel(value)).toThrow('TASK_EXECUTION_MODEL_INVALID');
  });

  it('preserves V2 fields in the exact pending-configuration expectation', () => {
    const request = { configurationRequestId: '11111111-1111-4111-8111-111111111111',
      workItemId: 'WI-budget', requestId: 'REQ-budget', documentVersionId: 'DV-budget',
      sourceArtifactId: 'SRC-budget', sourceFileSha256: 'a'.repeat(64), sourceByteLength: 1,
      expectedWorkItemRevision: 3, expectedExecutionModel: budgeted, expectedSettingsRevision: 5 };
    expect(parsePendingModelConfigurationRequest(request)).toEqual(request);
    expect(() => parsePendingModelConfigurationRequest({ ...request,
      expectedExecutionModel: { ...budgeted, maxOutputTokens: 0 } }))
      .toThrow('PENDING_MODEL_CONFIGURATION_INPUT_INVALID');
  });
});

describe('manager-owned per-model output budgets', () => {
  it('persists GLM initial 131072 through the existing tenant revision CAS', async () => {
    const { service, repository } = settings({ 'dli/gpt-5.6-sol': 12000 });
    const result = await service.update({ expectedRevision: 4, modelRef,
      maxOutputTokens: CANONICAL_INITIAL_GLM_OUTPUT_TOKENS }, actor());
    expect(repository.compareAndSet).toHaveBeenCalledWith({ tenantId: 'budget-tenant',
      actorUserId: 'budget-user', expectedRevision: 4, modelRef, maxOutputTokens: 131072 });
    expect(result).toMatchObject({ revision: 5, outputBudgets: {
      [modelRef]: 131072, 'dli/gpt-5.6-sol': 12000 } });
    await expect(service.update({ expectedRevision: 4, modelRef, maxOutputTokens: 64000 }, actor()))
      .rejects.toMatchObject({ statusCode: 409 });
    expect((await service.read(actor())).outputBudgets?.[modelRef]).toBe(131072);
  });

  it('allows an explicitly managed lower positive budget and a model-only save', async () => {
    const { service } = settings({ [modelRef]: 131072 });
    await service.update({ expectedRevision: 4, modelRef, maxOutputTokens: 64000 }, actor());
    const result = await service.update({ expectedRevision: 5, modelRef: 'dli/gpt-5.6-sol' }, actor());
    expect(result).toMatchObject({ revision: 6, selectedModelRef: 'dli/gpt-5.6-sol',
      outputBudgets: { [modelRef]: 64000 } });
  });

  it('preserves a retired profile without granting it new model admission or breaking model-only saves', async () => {
    const { service } = settings({ 'retired/model': 12000 });
    expect((await service.read(actor())).outputBudgets).toEqual({ 'retired/model': 12000 });
    const result = await service.update({ expectedRevision: 4, modelRef }, actor());
    expect(result.outputBudgets).toEqual({ 'retired/model': 12000 });
    await expect(service.captureForExplicitProgram('budget-tenant', 'retired/model', selectedAt))
      .rejects.toThrow('TASK_MODEL_UNAVAILABLE');
  });

  it('rejects forged tenant or manager and never gives the budget write a separate authority', async () => {
    const { service, repository } = settings();
    const input = { expectedRevision: 4, modelRef, maxOutputTokens: 131072 };
    await expect(service.update(input, actor([]))).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.update(input, { ...actor(), tenantId: 'forged' }))
      .rejects.toMatchObject({ statusCode: 403 });
    const forged = actor([]); forged.roles = [manager];
    await expect(service.update(input, forged)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.compareAndSet).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, true, '131072', Number.MAX_SAFE_INTEGER + 1, null, undefined])(
    'does not write an invalid supplied budget %p', async (value) => {
      const { service, repository } = settings();
      await expect(service.update({ expectedRevision: 4, modelRef,
        maxOutputTokens: value } as never, actor())).rejects.toMatchObject({ statusCode: 400 });
      expect(repository.compareAndSet).not.toHaveBeenCalled();
    },
  );

  it('rejects new-strategy admission while disabled and keeps legacy requests unchanged', async () => {
    const { service, repository } = settings({ [modelRef]: 131072 });
    for (const value of [undefined, 'false', '1']) {
      if (value === undefined) delete process.env[CANONICAL_EXECUTION_MODEL_V2_ENV];
      else process.env[CANONICAL_EXECUTION_MODEL_V2_ENV] = value;
      const selection = await service.captureForExplicitProgram('budget-tenant', modelRef, selectedAt);
      expect(selection).toEqual(taskModelSelection(modelRef, selectedAt));
      expect(Object.keys(selection)).toHaveLength(5);
      await expect(service.captureForExplicitProgram('budget-tenant', modelRef, selectedAt, 'PROGRAM_AGENT_V1'))
        .rejects.toThrow('PROGRAM_AGENT_NOT_ENABLED');
    }
    expect(repository.read).not.toHaveBeenCalled();
  });

  it('captures the exact selected model budget with the real saved settings revision', async () => {
    process.env[CANONICAL_EXECUTION_MODEL_V2_ENV] = 'true';
    const { service } = settings({ [modelRef]: 131072, 'dli/gpt-5.6-sol': 12000 }, 8);
    expect(await service.captureForExplicitProgram('budget-tenant', modelRef, selectedAt, 'PROGRAM_AGENT_V1'))
      .toMatchObject({ schemaVersion: CANONICAL_EXECUTION_MODEL_V2_SCHEMA,
        modelRef, settingsRevision: 8, maxOutputTokens: 131072 });
    // Enabling a new strategy never changes legacy request bytes or opts other
    // consumers into a seven-field snapshot.
    for (const mode of [undefined, 'PROGRAM_CONTROLLED_V1'] as const)
      expect(await service.captureForExplicitProgram('budget-tenant', modelRef, selectedAt, mode))
        .toEqual(taskModelSelection(modelRef, selectedAt));
    expect(Object.keys(await service.captureForNewTask('budget-tenant', selectedAt))).toHaveLength(5);
    expect(Object.keys(await service.captureForExplicitProgram(
      'budget-tenant', 'miaoda/miaoda-model-flash', selectedAt))).toHaveLength(5);
    await expect(service.captureForExplicitProgram('budget-tenant', 'dli/gpt-5.6-sol', selectedAt, 'PROGRAM_AGENT_V1'))
      .rejects.toThrow('PROGRAM_AGENT_MODEL_UNSUPPORTED');
  });

  it('never borrows a default-model budget for GLM or accepts malformed stored budgets', async () => {
    process.env[CANONICAL_EXECUTION_MODEL_V2_ENV] = 'true';
    await expect(settings({ 'miaoda/minimax-m3': 64000 }).service
      .captureForExplicitProgram('budget-tenant', modelRef, selectedAt, 'PROGRAM_AGENT_V1'))
      .rejects.toThrow('MODEL_OUTPUT_BUDGET_NOT_CONFIGURED');
    for (const value of ['{broken', [], { [modelRef]: 0 }, { 'invalid model key': 131072 }])
      expect(() => readModelOutputBudgets(value)).toThrow('MODEL_OUTPUT_BUDGET_STORED_INVALID');
  });

  it('rejects unknown runtime modes before reading settings instead of silently using legacy mode', async () => {
    const { service, repository } = settings({ [modelRef]: 131072 });
    await expect(service.captureForExplicitProgram('budget-tenant', modelRef, selectedAt, 'UNKNOWN_MODE' as never))
      .rejects.toThrow('PROGRAM_EXECUTION_MODE_INVALID');
    expect(repository.read).not.toHaveBeenCalled();
  });

  it('rejects invalid saved revision and captures a later configured budget only for a new selection', async () => {
    process.env[CANONICAL_EXECUTION_MODEL_V2_ENV] = 'true';
    await expect(settings({ [modelRef]: 131072 }, 0).service
      .captureForExplicitProgram('budget-tenant', modelRef, selectedAt, 'PROGRAM_AGENT_V1'))
      .rejects.toThrow('MODEL_OUTPUT_BUDGET_REVISION_INVALID');
    const { service } = settings({ [modelRef]: 131072 }, 8);
    const original = await service.captureForExplicitProgram('budget-tenant', modelRef, selectedAt, 'PROGRAM_AGENT_V1');
    await service.update({ expectedRevision: 8, modelRef, maxOutputTokens: 262144 }, actor());
    const successor = await service.captureForExplicitProgram('budget-tenant', modelRef, selectedAt, 'PROGRAM_AGENT_V1');
    expect(original).toMatchObject({ settingsRevision: 8, maxOutputTokens: 131072 });
    expect(successor).toMatchObject({ settingsRevision: 9, maxOutputTokens: 262144 });
  });
});
