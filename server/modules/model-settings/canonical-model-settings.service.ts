import { Injectable } from '@nestjs/common';
import type {
  CanonicalExecutionModelSelection,
  CanonicalModelSettingsReadModel,
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
} from './canonical-model-catalog';
import {
  CanonicalModelSettingsRepository,
  type StoredCanonicalModelSetting,
} from './canonical-model-settings.repository';

@Injectable()
export class CanonicalModelSettingsService {
  constructor(private readonly repository: CanonicalModelSettingsRepository) {}

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
        (key) => !['modelRef', 'expectedRevision'].includes(key),
      ) ||
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
    });
    return this.project(saved, actor);
  }

  /** Called only after the existing task's tenant/WorkItem authorization. */
  async captureForNewTask(
    tenantId: string,
    selectedAt: Date,
  ): Promise<CanonicalExecutionModelSelection> {
    if (!tenantId.trim())
      throw canonicalModelError('MODEL_SETTINGS_TENANT_REQUIRED', 400);
    const saved = await this.repository.read(tenantId);
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
    };
  }
}

function assertModelSettingsActor(actor: CanonicalHostActor): void {
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
