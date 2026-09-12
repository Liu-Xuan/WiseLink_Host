import { buildTranslationSourcePlan } from '../../../server/modules/canonical-host/canonical-translation-source-plan';
import { translationBatchDependenciesV2 } from '../../../server/modules/canonical-host/canonical-translation-v2-batch';
import { planOriginalTranslationReuse } from '../../../server/modules/canonical-host/canonical-translation-v2-reuse';
import type { TranslationBlockRevisionV2, TranslationWorkspaceV2 } from '../../../shared/canonical-translation-v2.interface';

const texts = Array.from({ length: 6 }, (_, i) => `Region ${i}: ${'The component remains available. '.repeat(210)}`);
function workspace(revision: number, content = texts): TranslationWorkspaceV2 {
  const run = `parse-${revision}`;
  const plan = buildTranslationSourcePlan({ documentVersionId: 'DV', packageId: run, title: 'Same document',
    parsedArtifact: { storeRole: 'UnifiedArtifactStoreCandidate', ref: `document-original://DV/${run}`,
      sha256: `${revision}`.repeat(64), byteLength: 100, mediaType: 'application/json' },
    source: { modules: [{ moduleId: 'm', order: 0 }], findings: [], references: [],
      sourceLocators: content.map((_text, i) => ({ sourceRefId: `${run}:sr${i}`, kind: 'pdf_page', artifactId: 'PDF',
        pageStart: i + revision, pageEnd: i + revision, charStart: null, charEnd: null, charOffsetUnit: null,
        normalizedPath: null, xpath: null, elementId: null, quote: null, bbox: null })),
      units: content.map((text, i) => ({ unitId: `${run}:u${i}`, moduleId: 'm', kind: 'paragraph', parentUnitId: null,
        order: i, depth: 0, continuityKey: `${run}:u${i}`, sourceRefIds: [`${run}:sr${i}`], sourceSegmentIds: [],
        mapping: { status: 'mapped_exactly' }, payload: { text, role: 'body' } })) } });
  plan.source.originalBinding = { documentVersionId: 'DV', parseRunId: run, parseRevision: revision,
    sourceArtifactId: 'PDF', sourceSha256: 'a'.repeat(64), sourceByteLength: 40000 };
  return { workspaceId: `TW-${revision}`, tenantId: 'tenant', workItemId: null, subjectKind: 'DOCUMENT_VERSION',
    rowVersion: 1, activeAttemptId: null, methodVersion: 'method-test', plan, generationRequests: [], resultArtifact: null, resultManifest: null };
}
function revisions(old: TranslationWorkspaceV2): TranslationBlockRevisionV2[] {
  return old.plan.blocks.map(block => ({ blockRevisionId: `TB-${block.blockId}`, workspaceId: old.workspaceId,
    blockId: block.blockId, planRevision: old.plan.planRevision, contentRevision: 1, rowVersion: 1,
    candidate: { blockId: block.blockId, elements: [{ elementId: 'element', kind: 'paragraph', translatedText: `已保存译文 ${block.order}`, anchorIds: block.anchorIds }] },
    dependencies: translationBatchDependenciesV2(old, [block.blockId]),
    provenance: { authorKind: 'MODEL', authorUserId: 'actor', executionModel: null, modelVersion: null, skillVersion: null,
      promptVersion: null, generationRequestRef: `G-${block.blockId}`, originAttemptId: 'ATT-1', providerRequestId: null,
      usage: { inputTokens: null, outputTokens: null } },
    generatedAt: null, savedAt: '2026-09-13T00:00:00Z', checkedAt: '2026-09-13T00:00:00Z', selectedForReading: true,
    check: { schemaVersion: 'wiselink.3_1.translation_block_check.v2', checkVersion: 'semantic-block-check@2.0', issues: [], semanticCheck: 'NOT_REQUIRED', semanticReview: null } }));
}
test('locator-only parse changes reuse saved text and remap anchors to the new original', () => {
  const old = workspace(1), next = workspace(2); expect(old.plan.blocks).toHaveLength(6);
  const reused = planOriginalTranslationReuse(old, next, revisions(old)); expect(reused).toHaveLength(6);
  expect(reused[0].candidate.elements[0].translatedText).toBe('已保存译文 0');
  expect(reused[0].candidate.elements[0].anchorIds).toEqual(next.plan.blocks[0].anchorIds);
  expect(next.plan.anchors[0].sourceUnitId).not.toBe(old.plan.anchors[0].sourceUnitId);
  expect(next.plan.anchors[0].sourceLocators[0].pageStart).toBe(2);
});
test('a changed region invalidates itself and delivered neighbors, retaining distant saved blocks', () => {
  const old = workspace(1), changed = [...texts]; changed[3] += ' Changed value 42.';
  const next = workspace(2, changed), reused = planOriginalTranslationReuse(old, next, revisions(old));
  expect(reused.map(entry => next.plan.blocks.find(block => block.blockId === entry.candidate.blockId)!.order)).toEqual([0, 1, 5]);
});
test('new scoped conditions prevent copying translations made without that context', () => {
  const old = workspace(1), next = workspace(2); next.plan.documentContext.conditionAnchorIds = [next.plan.anchors[0].anchorId];
  expect(planOriginalTranslationReuse(old, next, revisions(old))).toEqual([]);
});
test('ambiguous repeated regions are not matched by text alone', () => {
  const old = workspace(1, [texts[0], texts[0]]), next = workspace(2, [texts[0], texts[0]]);
  expect(planOriginalTranslationReuse(old, next, revisions(old))).toEqual([]);
});
test('changed source bytes or generation method reject reuse', () => {
  const old = workspace(1), next = workspace(2); next.plan.source.originalBinding!.sourceByteLength++;
  expect(planOriginalTranslationReuse(old, next, revisions(old))).toEqual([]);
  next.plan.source.originalBinding!.sourceByteLength--; next.methodVersion += '-new';
  expect(planOriginalTranslationReuse(old, next, revisions(old))).toEqual([]);
});

test('a superseded quality checker does not authorize copying its check result', () => {
  const old = workspace(1), next = workspace(2), saved = revisions(old);
  saved.forEach(revision => { revision.check!.checkVersion = 'old-check-version'; });
  expect(planOriginalTranslationReuse(old, next, saved)).toEqual([]);
});

test('the same number set with different object assignments invalidates dependent translations', () => {
  const before = [...texts], after = [...texts];
  before[3] += ' Valve A: 10; valve B: 20.'; after[3] += ' Valve A: 20; valve B: 10.';
  const old = workspace(1, before), next = workspace(2, after);
  const reused = planOriginalTranslationReuse(old, next, revisions(old));
  expect(reused.map(entry => next.plan.blocks.find(block => block.blockId === entry.candidate.blockId)!.order)).toEqual([0, 1, 5]);
});

test('reordering source regions is not treated as a positioning-only improvement', () => {
  const old = workspace(1), reordered = [...texts]; [reordered[2], reordered[3]] = [reordered[3], reordered[2]];
  const next = workspace(2, reordered), reused = planOriginalTranslationReuse(old, next, revisions(old));
  expect(reused.map(entry => next.plan.blocks.find(block => block.blockId === entry.candidate.blockId)!.order)).toEqual([0, 5]);
});
