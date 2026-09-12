import { CanonicalTranslationV2Service } from './canonical-translation-v2.service';
import { Injectable } from '@nestjs/common';
import type { UnifiedPackageArtifactDescriptor } from '@shared/api.interface';
import type { DocumentOriginalResult } from '@shared/document-original.interface';
import type { TranslationBlockCandidateV2, TranslationGenerationRequestV2, TranslationReadingElementV2, TranslationWorkspaceV2, TranslationSourceAnchorV2, TranslationSemanticBlockV2 } from '@shared/canonical-translation-v2.interface';
import { DocumentOfficialPluginService, DocumentPluginOutputError } from '../document-management/src/hosted/nest/document-official-plugin.service';
import { documentOriginalStructuredSource } from '../document-management/src/hosted/nest/document-original-adapter';
import { buildTranslationSourcePlan } from './canonical-translation-source-plan';
import { buildTranslationBatchV2, nextTranslationWorkV2, translationBatchDependenciesV2 } from './canonical-translation-v2-batch';
import { buildTranslationWorkspaceReadingV2, checkTranslationBlockV2 } from './canonical-translation-v2-quality';
import { CanonicalTranslationWorkspaceRepository, type TranslationActualPluginExecution, type TranslationWorkspaceFence } from './canonical-translation-workspace.repository';

/** M owns authorization, dispatch and lease lifecycle; this executes one saved V2 scope. */
@Injectable()
// Registered by M in the canonical Host module during integration.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class CanonicalTranslationV2PluginService {
  constructor(private readonly workspaces: CanonicalTranslationWorkspaceRepository,
    private readonly plugins: DocumentOfficialPluginService, private readonly v2: CanonicalTranslationV2Service) {}

  async prepareOriginal(input: { tenantId: string; workItemId?: string | null; original: DocumentOriginalResult;
    artifact: UnifiedPackageArtifactDescriptor; assertAuthorized: () => Promise<void> }) {
    await input.assertAuthorized();
    const source = documentOriginalStructuredSource(input.original, input.original.binding);
    const plan = buildTranslationSourcePlan({ documentVersionId: input.original.binding.documentVersionId,
      packageId: input.original.binding.parseRunId, parsedArtifact: input.artifact, source,
      title: String(source.units.find(unit => unit.kind === 'heading')?.payload.text ?? '') });
    plan.source.originalBinding = structuredClone(input.original.binding);
    const workspace = await this.workspaces.prepare({ tenantId: input.tenantId, workItemId: input.workItemId ?? null,
      documentVersionId: input.original.binding.documentVersionId, plan });
    await input.assertAuthorized();
    return workspace;
  }

  taskInput(workspace: TranslationWorkspaceV2) {
    return { schemaVersion: 'wiselink.3_1.translation_task.v2', workspaceId: workspace.workspaceId,
      planRevision: workspace.plan.planRevision, contextRevision: workspace.plan.documentContext.revision,
      methodVersion: workspace.methodVersion, source: structuredClone(workspace.plan.source),
      documentProducer: 'OFFICIAL_PLUGIN' as const };
  }

  async executeStep(input: { fence: TranslationWorkspaceFence; requestId: string; assertAuthorized: () => Promise<void> }) {
    const { fence } = input;
    await input.assertAuthorized();
    await this.workspaces.attachAttempt(fence);
    const assertActive = async () => {
      await input.assertAuthorized();
      await this.workspaces.assertOfficialExecution(fence);
    };
    await assertActive();
    const reused = await this.workspaces.reusePreviousOriginal(fence);
    if (reused.length) return { status: 'PROGRESSED' as const, blockIds: reused, reused: true };
    let state = await this.workspaces.readSnapshot(fence);
    const reading = buildTranslationWorkspaceReadingV2(state.workspace, state.revisions);
    const next = nextTranslationWorkV2(state.workspace, state.revisions, reading);
    if (next.kind === 'LOCAL_CHECK') {
      await this.workspaces.checkAndSelect({ ...fence, blockRevisionId: next.revision.blockRevisionId,
        expectedRowVersion: next.revision.rowVersion,
        check: checkTranslationBlockV2({ plan: state.workspace.plan, candidate: next.revision.candidate }) });
      return { status: 'PROGRESSED' as const, blockIds: [next.revision.blockId] };
    }
    if (next.kind === 'DONE') {
      const result = reading.blocks.some(block => block.selected)
        ? await this.v2.assembleOfficial(fence, input.assertAuthorized) : null;
      return { status: reading.blocks.every(block => block.readingStatus === 'READABLE') ? 'DONE' as const : 'REMAINING_LIMITATIONS' as const, reading, result };
    }
    let request: TranslationGenerationRequestV2;
    if (next.kind === 'UNRESOLVED_GENERATION') {
      request = next.request;
      if (request.error) return { status: 'NEEDS_RECOVERY' as const, request };
    } else {
      request = await this.workspaces.registerGeneration({ ...fence, clientRequestId: input.requestId,
        blockIds: next.blockIds, purpose: next.kind, targetBlockRevisionId: next.targetBlockRevisionId,
        ...(next.kind === 'CHECK_BATCH' ? { checkTargets: next.checkTargets } : {}),
        dependencies: translationBatchDependenciesV2(state.workspace, next.blockIds) });
    }
    state = await this.workspaces.readSnapshot(fence);
    const batch = buildTranslationBatchV2(state.workspace, request, state.revisions);
    let attemptedBlockId: string | null = null;
    try {
      const unchecked = state.revisions.find(revision => revision.provenance.generationRequestRef === request.generationRequestRef && !revision.check);
      if (unchecked && ['GENERATE', 'CORRECT'].includes(request.purpose)) {
        await this.workspaces.checkAndSelect({ ...fence, blockRevisionId: unchecked.blockRevisionId, expectedRowVersion: unchecked.rowVersion,
          check: checkTranslationBlockV2({ plan: state.workspace.plan, candidate: unchecked.candidate }) });
        return { status: 'PROGRESSED' as const, blockIds: [unchecked.blockId] };
      }
      if (request.purpose === 'CHECK' || request.purpose === 'CHECK_BATCH') {
        // The normal step scheduler uses one check at a time; a recovered explicit
        // CHECK_BATCH keeps its original immutable targets and validates the whole batch.
        const targets = request.checkTargets ?? [{ blockId: request.blockIds[0],
          blockRevisionId: request.targetBlockRevisionId!, rowVersion: -1 }];
        const checks = [];
        for (const target of targets) {
          const revision = state.revisions.find(item => item.blockRevisionId === target.blockRevisionId);
          if (!revision || (target.rowVersion !== -1 && revision.rowVersion !== target.rowVersion))
            throw new Error('TRANSLATION_CHECK_TARGET_CHANGED');
          const block = state.workspace.plan.blocks.find(item => item.blockId === revision.blockId)!;
          const result = await this.plugins.checkTranslation({ blockId: block.blockId,
            anchors: batch.anchors.filter(anchor => block.anchorIds.includes(anchor.anchorId)),
            candidate: revision.candidate, context: batch.documentContext }, assertActive);
          const provenance = await this.workspaces.officialPluginProvenance({ ...fence,
            generationRequestRef: request.generationRequestRef, actualExecution: execution(result.producer) });
          checks.push({ blockRevisionId: revision.blockRevisionId, expectedRowVersion: revision.rowVersion,
            check: checkTranslationBlockV2({ plan: state.workspace.plan, candidate: revision.candidate,
              semanticReview: { result: result.review, provenance } }) });
        }
        await assertActive();
        if (request.purpose === 'CHECK_BATCH') await this.workspaces.checkAndSelectBatch({ ...fence, generationRequestRef: request.generationRequestRef, checks });
        else await this.workspaces.checkAndSelect({ ...fence, ...checks[0] });
        return { status: 'PROGRESSED' as const, blockIds: targets.map(target => target.blockId) };
      }
      const block = batch.blocks.find(item => !state.revisions.some(revision =>
        revision.blockId === item.blockId && revision.provenance.generationRequestRef === request.generationRequestRef));
      if (!block) throw new Error('TRANSLATION_REQUEST_SAVE_STATE_INVALID');
      attemptedBlockId = block.blockId;
      const anchors = batch.anchors.filter(anchor => block.anchorIds.includes(anchor.anchorId));
      let candidate: TranslationBlockCandidateV2;
      let actual: TranslationActualPluginExecution;
      if (['prose', 'heading', 'advisory', 'step', 'preserved_source'].includes(block.kind)) {
        const result = await this.plugins.translateProse(anchors.map(anchor => anchor.sourceText).join('\n'), assertActive, { documentContext: batch.documentContext, terminology: batch.terminology, correctionIssues: batch.correctionIssues, previousCandidate: batch.previousCandidate });
        candidate = { blockId: block.blockId, elements: [{ elementId: `${request.generationRequestRef}:${block.blockId}:e1`,
          kind: block.kind === 'heading' ? 'heading' : block.kind === 'advisory' ? 'advisory' : 'paragraph',
          translatedText: result.translation, anchorIds: anchors.map(anchor => anchor.anchorId) }] };
        actual = execution(result.producer);
      } else {
        const groups = structuredTranslationItems(block, anchors);
        const result = await this.plugins.translateStructure(groups.map(({ id, text }) => ({ id, text })), assertActive,
          { documentContext: batch.documentContext, terminology: batch.terminology, correctionIssues: batch.correctionIssues, previousCandidate: batch.previousCandidate });
        candidate = { blockId: block.blockId, elements: result.items.map((item, index) => ({
          elementId: `${request.generationRequestRef}:${block.blockId}:e${index + 1}`,
          kind: groups[index].kind, translatedText: item.translation, anchorIds: groups[index].anchorIds,
        })) };
        actual = execution(result.producer);
      }
      await assertActive();
      const [saved] = await this.workspaces.saveCandidates({ ...fence, generationRequestRef: request.generationRequestRef,
        candidates: [candidate], actualExecution: actual });
      await this.workspaces.checkAndSelect({ ...fence, blockRevisionId: saved.blockRevisionId, expectedRowVersion: saved.rowVersion,
        check: checkTranslationBlockV2({ plan: state.workspace.plan, candidate: saved.candidate }) });
      return { status: 'PROGRESSED' as const, blockIds: [block.blockId] };
    } catch (error) {
      // Query the durable snapshot before describing a response loss as failed work.
      // If SAVE committed, its request stays SAVED and the next step resumes checking.
      await assertActive();
      const current = await this.workspaces.readSnapshot(fence);
      const registered = current.workspace.generationRequests.find(item => item.generationRequestRef === request.generationRequestRef);
      const savedActualBlock = attemptedBlockId !== null && current.revisions.some(revision =>
        revision.blockId === attemptedBlockId && revision.provenance.generationRequestRef === request.generationRequestRef);
      if (registered?.status !== 'SAVED' && !savedActualBlock) await this.workspaces.recordGenerationFailure({ ...fence,
        generationRequestRef: request.generationRequestRef,
        error: error instanceof DocumentPluginOutputError
          ? { origin: 'OUTPUT_CONTRACT', code: safeCode(error), outcome: 'KNOWN_FAILURE', retryable: true }
          : { origin: 'UPSTREAM', code: safeCode(error), outcome: 'GENERATION_UNKNOWN', retryable: true } });
      throw error;
    }
  }
}
function execution(producer: TranslationActualPluginExecution['producer']): TranslationActualPluginExecution {
  return { producer, promptVersion: 'wiselink-document-translation@1', providerRequestId: null,
    usage: { inputTokens: null, outputTokens: null }, generatedAt: null };
}
function safeCode(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  return /^[A-Z][A-Z0-9_]{1,159}$/.test(code) ? code : 'DOCUMENT_TRANSLATION_PLUGIN_FAILED';
}

/** A cell/list item may contain several extraction fragments; translate its complete text once. */
export function structuredTranslationItems(block: Pick<TranslationSemanticBlockV2, 'kind'>,
  anchors: Array<Pick<TranslationSourceAnchorV2, 'anchorId' | 'sourceUnitId' | 'payloadPath' | 'sourceText'>>) {
  const groups = new Map<string, { id: string; text: string; anchorIds: string[]; kind: TranslationReadingElementV2['kind'] }>();
  for (const anchor of anchors) {
    const cell = /^(\/payload\/rowGroups\/\d+\/rows\/\d+\/cells\/\d+)\/inlineContent\//.exec(anchor.payloadPath);
    const key = block.kind === 'table' && cell ? `${anchor.sourceUnitId}:${cell[1]}` :
      block.kind === 'list' ? anchor.sourceUnitId : `${anchor.sourceUnitId}:${anchor.payloadPath}`;
    const existing = groups.get(key);
    if (existing) { existing.text += `\n${anchor.sourceText}`; existing.anchorIds.push(anchor.anchorId); }
    else groups.set(key, { id: `slot-${groups.size + 1}`, text: anchor.sourceText, anchorIds: [anchor.anchorId],
      kind: block.kind === 'table' && cell ? 'table_cell' : block.kind === 'list' ? 'list_item' :
        block.kind === 'figure' ? 'caption' : 'label' });
  }
  return [...groups.values()];
}
