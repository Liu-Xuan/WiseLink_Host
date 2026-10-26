import { Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import type {
  CanonicalAssessmentExecutionMode,
  CanonicalExecutionModelSelection,
  CanonicalBudgetedExecutionModelSelection,
  CanonicalModelSettingsReadModel,
  CanonicalTaskModelOptions,
  UpdateCanonicalModelSettingsRequest,
} from '@shared/api.interface';
import type { CanonicalHostActor } from '../canonical-host/canonical-host.types';
import {
  CANONICAL_DEVELOPMENT_ROLE_ID,
  CANONICAL_MIAODA_APP_ID,
} from '../canonical-host/canonical-host.constants';
import {
  CANONICAL_INITIAL_MODEL_REF,
  CANONICAL_MODEL_MANAGER_ROLE_ENV,
  CANONICAL_REGISTERED_MODELS,
  canonicalModelError,
  taskModelSelection,
} from './canonical-model-catalog';
import {
  CANONICAL_EXECUTION_MODEL_V2_ENV,
  CANONICAL_EXECUTION_MODEL_V2_SCHEMA,
  readModelOutputBudgets,
  validOutputTokens,
} from './canonical-model-output-budget';
import {
  CanonicalModelSettingsRepository,
  type StoredCanonicalModelSetting,
} from './canonical-model-settings.repository';

@Injectable()
export class CanonicalModelSettingsService {
  constructor(private readonly repository: CanonicalModelSettingsRepository) {}

  async taskOptions(
    actor: CanonicalHostActor,
  ): Promise<CanonicalTaskModelOptions> {
    assertModelSettingsActor(actor);
    const configured = await this.captureForNewTask(actor.tenantId, new Date());
    return {
      options: CANONICAL_REGISTERED_MODELS.map((option) => ({ ...option })),
      defaultModelRef: configured.modelRef,
    };
  }

  /** Only use after the task's existing authorization has succeeded. */
  readWorkItemModel(tenantId: string, workItemId: string) {
    return this.repository.readWorkItemModel(tenantId, workItemId);
  }

  async captureForWorkItem(
    tenantId: string,
    workItemId: string,
    selectedAt: Date,
  ): Promise<CanonicalExecutionModelSelection> {
    const model = await this.repository.readWorkItemModel(tenantId, workItemId);
    return this.repository.pinWorkItemModel(
      tenantId,
      workItemId,
      model ?? (await this.captureForNewTask(tenantId, selectedAt)),
    );
  }

  async read(
    actor: CanonicalHostActor,
  ): Promise<CanonicalModelSettingsReadModel> {
    assertModelSettingsActor(actor);
    return this.project(await this.repository.read(actor.tenantId), actor);
  }

  async update(
    input: UpdateCanonicalModelSettingsRequest,
    actor: CanonicalHostActor,
  ): Promise<CanonicalModelSettingsReadModel> {
    assertModelSettingsActor(actor);
    if (!configuredManagerRole())
      throw canonicalModelError('MODEL_SETTINGS_ROLE_NOT_CONFIGURED', 503);
    if (!canManageModels(actor))
      throw canonicalModelError('MODEL_SETTINGS_MANAGER_REQUIRED', 403);
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (key) => !['modelRef', 'expectedRevision', 'maxOutputTokens'].includes(key),
      ) ||
      (Object.hasOwn(input, 'maxOutputTokens') && !validOutputTokens(input.maxOutputTokens)) ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0 ||
      input.expectedRevision >= 2147483647
    ) {
      throw canonicalModelError('MODEL_SETTINGS_INPUT_INVALID', 400);
    }
    const option = CANONICAL_REGISTERED_MODELS.find(
      (model) => model.modelRef === input.modelRef && model.available,
    );
    if (!option)
      throw canonicalModelError('MODEL_SETTINGS_MODEL_UNAVAILABLE', 400);
    const saved = await this.repository.compareAndSet({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      expectedRevision: input.expectedRevision,
      modelRef: option.modelRef,
      ...(input.maxOutputTokens === undefined ? {} : { maxOutputTokens: input.maxOutputTokens }),
    });
    return this.project(saved, actor);
  }

  /** New requests only, after existing task authorization and idempotent replay. */
  async captureForExplicitProgram(
    tenantId: string,
    modelRef: string,
    selectedAt: Date,
    executionMode?: CanonicalAssessmentExecutionMode,
  ): Promise<CanonicalExecutionModelSelection> {
    const legacy = taskModelSelection(modelRef, selectedAt);
    // Existing program requests retain their original five-field snapshot,
    // including after the new strategy is enabled for fresh requests.
    if (executionMode === undefined || executionMode === 'PROGRAM_CONTROLLED_V1') return legacy;
    if (executionMode !== 'PROGRAM_AGENT_V1')
      throw canonicalModelError('PROGRAM_EXECUTION_MODE_INVALID', 400);
    if (process.env[CANONICAL_EXECUTION_MODEL_V2_ENV] !== 'true')
      throw canonicalModelError('PROGRAM_AGENT_NOT_ENABLED', 503);
    // The first real Native agent consumer supports this exact Hosted profile.
    if (modelRef !== 'miaoda/glm-5.3')
      throw canonicalModelError('PROGRAM_AGENT_MODEL_UNSUPPORTED', 400);
    if (!tenantId.trim()) throw canonicalModelError('MODEL_SETTINGS_TENANT_REQUIRED', 400);
    const saved = await this.repository.read(tenantId);
    const maxOutputTokens = readModelOutputBudgets(saved?.outputBudgetsJson)[modelRef];
    // New strategy admission requires its exact manager-saved budget. Never
    // downgrade the snapshot or borrow another profile's/default directory cap.
    if (maxOutputTokens === undefined)
      throw canonicalModelError('MODEL_OUTPUT_BUDGET_NOT_CONFIGURED', 503);
    if (!saved || !Number.isSafeInteger(saved.revision) || saved.revision < 1)
      throw canonicalModelError('MODEL_OUTPUT_BUDGET_REVISION_INVALID', 500);
    const result: CanonicalBudgetedExecutionModelSelection = {
      ...legacy,
      schemaVersion: CANONICAL_EXECUTION_MODEL_V2_SCHEMA,
      settingsRevision: saved.revision,
      maxOutputTokens,
    };
    return result;
  }

  /** Called only after the existing task's tenant/WorkItem authorization. */
  async captureForNewTask(
    tenantId: string,
    selectedAt: Date,
    executor?: PostgresJsDatabase,
  ): Promise<CanonicalExecutionModelSelection> {
    if (!tenantId.trim())
      throw canonicalModelError('MODEL_SETTINGS_TENANT_REQUIRED', 400);
    const saved = await this.repository.read(tenantId, executor);
    const modelRef = saved?.modelRef ?? CANONICAL_INITIAL_MODEL_REF;
    const option = CANONICAL_REGISTERED_MODELS.find(
      (model) => model.modelRef === modelRef && model.available,
    );
    if (!option)
      throw canonicalModelError('MODEL_SETTINGS_MODEL_UNAVAILABLE', 503);
    return {
      modelRef: option.modelRef,
      displayName: option.displayName,
      providerKind: option.providerKind,
      settingsRevision: saved?.revision ?? 0,
      selectedAt: selectedAt.toISOString(),
    };
  }

  private project(
    saved: StoredCanonicalModelSetting | null,
    actor: CanonicalHostActor,
  ): CanonicalModelSettingsReadModel {
    const selectedModelRef = saved?.modelRef ?? CANONICAL_INITIAL_MODEL_REF;
    return {
      status: CANONICAL_REGISTERED_MODELS.some(
        (option) => option.modelRef === selectedModelRef && option.available,
      )
        ? 'CONFIGURED'
        : 'UNAVAILABLE',
      revision: saved?.revision ?? 0,
      selectedModelRef,
      options: CANONICAL_REGISTERED_MODELS.map((option) => ({ ...option })),
      updatedAt: saved?.updatedAt.toISOString() ?? null,
      canManage: canManageModels(actor),
      managementStatus: configuredManagerRole()
        ? 'CONFIGURED'
        : 'ROLE_NOT_CONFIGURED',
      effectiveFor: 'NEW_ANALYSIS_TASKS_ONLY',
      outputBudgets: readModelOutputBudgets(saved?.outputBudgetsJson),
    };
  }
}

export function assertModelSettingsActor(actor: CanonicalHostActor): void {
  const identity = actor.objectAccessActor;
  if (
    !identity ||
    identity.principalKind !== 'FINAL_USER' ||
    identity.transport !== 'MIAODA_AUTHENTICATED_HTTP' ||
    identity.canonicalSubject.id !== actor.userId ||
    identity.tenantId !== actor.tenantId ||
    identity.applicationScopeId !== actor.appId ||
    actor.appId !== CANONICAL_MIAODA_APP_ID
  ) {
    throw canonicalModelError('MODEL_SETTINGS_IDENTITY_REQUIRED', 403);
  }
}

function configuredManagerRole(): string | null {
  const role = process.env[CANONICAL_MODEL_MANAGER_ROLE_ENV]?.trim();
  // Do not silently turn the existing development role into a settings admin.
  return role && role !== CANONICAL_DEVELOPMENT_ROLE_ID ? role : null;
}

function canManageModels(actor: CanonicalHostActor): boolean {
  const role = configuredManagerRole();
  return (
    !!role &&
    actor.roles.includes(role) &&
    actor.objectAccessActor?.platformRoles.includes(role) === true
  );
}
