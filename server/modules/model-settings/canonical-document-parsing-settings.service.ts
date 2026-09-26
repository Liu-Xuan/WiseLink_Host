import { Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import type {
  DocumentParsingSettingsReadModel,
  DocumentParsingSettingsSnapshot,
  UpdateDocumentParsingSettingsRequest,
} from '@shared/document-parsing-settings.interface';
import type { CanonicalHostActor } from '../canonical-host/canonical-host.types';
import { canonicalModelError } from './canonical-model-catalog';
import { assertModelSettingsActor } from './canonical-model-settings.service';
import { CANONICAL_DEVELOPMENT_ROLE_ID } from '../canonical-host/canonical-host.constants';
import { CanonicalDocumentParsingSettingsRepository } from './canonical-document-parsing-settings.repository';

type StoredSettings = Awaited<
  ReturnType<CanonicalDocumentParsingSettingsRepository['read']>
>;
@Injectable()
export class CanonicalDocumentParsingSettingsService {
  constructor(
    private readonly repository: CanonicalDocumentParsingSettingsRepository,
  ) {}

  async read(
    actor: CanonicalHostActor,
  ): Promise<DocumentParsingSettingsReadModel> {
    assertModelSettingsActor(actor);
    return this.project(await this.repository.read(actor.tenantId), actor);
  }

  /** Internal callers must first authorize the exact tenant/source/actor. No identity bypass. */
  async readForTenant(
    tenantId: string,
    executor?: PostgresJsDatabase,
  ): Promise<DocumentParsingSettingsSnapshot> {
    if (!tenantId.trim())
      throw canonicalModelError(
        'DOCUMENT_PARSING_SETTINGS_TENANT_REQUIRED',
        400,
      );
    return snapshot(await this.repository.read(tenantId, executor));
  }

  /** The accepting parse run persists this value; later edits do not rewrite its decision. */
  capture(
    tenantId: string,
    executor?: PostgresJsDatabase,
  ): Promise<DocumentParsingSettingsSnapshot> {
    return this.readForTenant(tenantId, executor);
  }

  async update(
    input: UpdateDocumentParsingSettingsRequest,
    actor: CanonicalHostActor,
  ): Promise<DocumentParsingSettingsReadModel> {
    assertModelSettingsActor(actor);
    if (!configuredParsingManagerRole())
      throw canonicalModelError(
        'DOCUMENT_PARSING_SETTINGS_ROLE_NOT_CONFIGURED',
        503,
      );
    if (!canManageParsing(actor))
      throw canonicalModelError(
        'DOCUMENT_PARSING_SETTINGS_MANAGER_REQUIRED',
        403,
      );
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (key) =>
          ![
            'expectedRevision',
            'localMineruFallbackEnabled',
            'titleEnhancementEnabled',
          ].includes(key),
      ) ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0 ||
      input.expectedRevision >= 2147483647 ||
      typeof input.localMineruFallbackEnabled !== 'boolean' ||
      typeof input.titleEnhancementEnabled !== 'boolean'
    )
      throw canonicalModelError('DOCUMENT_PARSING_SETTINGS_INPUT_INVALID', 400);
    const saved = await this.repository.compareAndSet({
      ...input,
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
    });
    return this.project(saved, actor);
  }

  private project(
    saved: StoredSettings,
    actor: CanonicalHostActor,
  ): DocumentParsingSettingsReadModel {
    return {
      ...snapshot(saved),
      updatedAt: saved?.updatedAt.toISOString() ?? null,
      canManage: canManageParsing(actor),
      managementStatus: configuredParsingManagerRole()
        ? 'CONFIGURED'
        : 'ROLE_NOT_CONFIGURED',
      effectiveFor: 'NEW_LOCAL_DOCUMENT_PARSE_RUNS_ONLY',
    };
  }
}
function snapshot(saved: StoredSettings): DocumentParsingSettingsSnapshot {
  return {
    revision: saved?.revision ?? 0,
    localMineruFallbackEnabled: saved?.localMineruFallbackEnabled ?? true,
    titleEnhancementEnabled: saved?.titleEnhancementEnabled ?? false,
  };
}

export const DOCUMENT_PARSING_SETTINGS_MANAGER_ROLE_ENV =
  'WL_DOCUMENT_PARSING_SETTINGS_MANAGER_ROLE_ID';
function configuredParsingManagerRole(): string | null {
  const role = process.env[DOCUMENT_PARSING_SETTINGS_MANAGER_ROLE_ENV]?.trim();
  return role && role !== CANONICAL_DEVELOPMENT_ROLE_ID ? role : null;
}
function canManageParsing(actor: CanonicalHostActor): boolean {
  const role = configuredParsingManagerRole();
  return (
    !!role &&
    actor.roles.includes(role) &&
    actor.objectAccessActor?.platformRoles.includes(role) === true
  );
}
