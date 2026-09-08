import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod/v4';
import { authorizeAndLoadCanonicalWorkItem } from './canonical-authorized-work-item-reader';
import {
  CANONICAL_AUTHORIZATION,
  CANONICAL_PERMISSION_SNAPSHOT,
  CANONICAL_WORK_ITEM_REGISTRAR,
} from './canonical-host.constants';
import type {
  CanonicalAuthorizationPort,
  CanonicalHostActor,
  CanonicalPermissionSnapshotPort,
  CanonicalWorkItemRegistrarPort,
} from './canonical-host.types';
import { CanonicalTranslationWorkspaceRepository } from './canonical-translation-workspace.repository';
import { translationCandidateSchemaV2 } from './canonical-translation-v2.contract';
import { buildTranslationWorkspaceReadingV2 } from './canonical-translation-v2-quality';

const command = z.strictObject({
  requestId: z.string().uuid(),
  workspaceId: z.string().min(1).max(96),
  expectedWorkItemRevision: z.number().int().positive(),
  baseBlockRevisionId: z.string().min(1).max(96),
  expectedRowVersion: z.number().int().positive(),
  candidate: translationCandidateSchemaV2,
  confirmedSourceReview: z.literal(true),
});

@Injectable()
export class CanonicalTranslationRevisionService {
  constructor(
    @Inject(CANONICAL_AUTHORIZATION)
    private readonly authorization: CanonicalAuthorizationPort,
    @Inject(CANONICAL_PERMISSION_SNAPSHOT)
    private readonly permissionSnapshots: CanonicalPermissionSnapshotPort,
    @Inject(CANONICAL_WORK_ITEM_REGISTRAR)
    private readonly registrar: CanonicalWorkItemRegistrarPort,
    private readonly workspaces: CanonicalTranslationWorkspaceRepository,
  ) {}
  private async authorized(
    workItemId: string,
    actor: CanonicalHostActor,
    action: 'READ_DOCUMENT_PARSING' | 'RECORD_ENGINEER_REVIEW',
  ) {
    return authorizeAndLoadCanonicalWorkItem({
      authorization: this.authorization,
      permissionSnapshots: this.permissionSnapshots,
      registrar: this.registrar,
      actor,
      action,
      workItemId,
    });
  }
  async read(
    workItemId: string,
    workspaceId: string,
    actor: CanonicalHostActor,
  ) {
    const { workItem } = await this.authorized(
      workItemId,
      actor,
      'READ_DOCUMENT_PARSING',
    );
    const state = await this.workspaces.readSnapshot({
      tenantId: actor.tenantId,
      workItemId,
      workspaceId,
    });
    if (
      workItem.source.documentVersionId !==
        state.workspace.plan.source.documentVersionId ||
      workItem.package?.artifact.sha256 !==
        state.workspace.plan.source.parsedArtifact.sha256 ||
      workItem.package?.artifact.ref !==
        state.workspace.plan.source.parsedArtifact.ref
    )
      throw new Error('TRANSLATION_WORKSPACE_SOURCE_CHANGED');
    return {
      reading: buildTranslationWorkspaceReadingV2(
        state.workspace,
        state.revisions,
      ),
      revisions: state.revisions,
    };
  }
  async save(workItemId: string, raw: unknown, actor: CanonicalHostActor) {
    const input = command.parse(raw);
    await this.authorized(workItemId, actor, 'RECORD_ENGINEER_REVIEW');
    const revision = await this.workspaces.saveEngineerRevision({
      ...input,
      tenantId: actor.tenantId,
      workItemId,
      actorUserId: actor.userId,
    });
    return {
      revision,
      ...(await this.read(workItemId, input.workspaceId, actor)),
      candidateOnly: true as const,
    };
  }
}
