import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type { DocumentParsingHostedService } from '../document-management/src/hosted/nest/document-parsing-hosted.service';
import { buildTranslationSourcePlan } from './canonical-translation-source-plan';

/** Uses only persisted original fields; the planner extracts structure, not translations. */
export function documentOriginalEngineeringReading(
  loaded: Awaited<ReturnType<DocumentParsingHostedService['loadPublished']>>, offset: number, limit: number,
  semanticMap: import('@shared/document-semantic-map.interface').DocumentSemanticMap | null = null,
) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 20)
    throw new Error('DOCUMENT_ORIGINAL_RANGE_INVALID');
  const { original, structuredSource, run } = loaded;
  const artifact = run.manifestArtifact;
  if (!artifact || artifact.readback !== 'VERIFIED' || artifact.relativePath !== 'original/manifest.json' ||
      run.parseRunId !== original.binding.parseRunId || run.documentVersionId !== original.binding.documentVersionId)
    throw new Error('DOCUMENT_ORIGINAL_ENGINEERING_BINDING_INVALID');
  const plan = buildTranslationSourcePlan({ documentVersionId: run.documentVersionId, packageId: run.parseRunId,
    parsedArtifact: { storeRole: 'UnifiedArtifactStoreCandidate', ref: `document-original://${run.documentVersionId}/${run.parseRunId}`,
      sha256: artifact.sha256, byteLength: artifact.byteLength, mediaType: 'application/json' }, title: '', source: structuredSource });
  const units = structuredSource.units.slice(offset, offset + limit);
  const ids = new Set(units.map(unit => unit.unitId));
  const selectedRefs = new Set(plan.anchors.filter(anchor => ids.has(anchor.sourceUnitId)).flatMap(anchor => anchor.sourceRefIds));
  const texts = new Map<string, string[]>();
  // A locator may cover several units. Its evidence stays identical across pagination.
  for (const anchor of plan.anchors)
    for (const ref of anchor.sourceRefIds.filter(ref => selectedRefs.has(ref)))
      texts.set(ref, [...(texts.get(ref) ?? []), anchor.sourceText]);
  const evidence: Extract<AssessmentEvidence, { kind: 'DOCUMENT_PASSAGE' }>[] = [...texts].map(([ref, text]) => {
    const location = structuredSource.sourceLocators.find(item => item.sourceRefId === ref);
    if (!location) throw new Error('DOCUMENT_ORIGINAL_SOURCE_LOCATOR_MISSING');
    const evidenceRef = `DOCUMENT_ORIGINAL:${run.documentVersionId}:${run.parseRunId}:${ref}`;
    if (evidenceRef.length > 512) throw new Error('DOCUMENT_ORIGINAL_SOURCE_REF_TOO_LONG');
    return { evidenceRef, kind: 'DOCUMENT_PASSAGE', workItemId: null, documentVersionId: run.documentVersionId,
      sourceRefId: ref, title: `原文 · 解析修订 ${run.parseRevision}`, versionLabel: run.parseRunId,
      excerpt: text.join('\n'), locator: JSON.stringify({ parseRunId: run.parseRunId, sourceRefId: ref,
        pageStart: location.pageStart, normalizedPath: location.normalizedPath, xpath: location.xpath }) };
  });
  return { documentVersionId: run.documentVersionId, binding: original.binding, artifactSha256: artifact.sha256,
    semanticMap,
    offset, units, evidence, sourceRefs: evidence.map(item => item.evidenceRef),
    sourceLocators: structuredSource.sourceLocators.filter(item => texts.has(item.sourceRefId)),
    coverage: original.coverage, findings: structuredSource.findings, producer: original.producer,
    nextOffset: offset + units.length < structuredSource.units.length ? offset + units.length : null };
}
export type DocumentOriginalEngineeringReading = ReturnType<typeof documentOriginalEngineeringReading>;

export function findDocumentOriginalEvidence(loaded: Parameters<typeof documentOriginalEngineeringReading>[0], sourceRefId: string) {
  const includesRef = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(includesRef);
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, child]) => key === 'sourceRefIds' && Array.isArray(child)
      ? child.includes(sourceRefId) : includesRef(child));
  };
  const offset = loaded.structuredSource.units.findIndex(includesRef);
  if (offset < 0) throw new Error('DOCUMENT_ORIGINAL_SOURCE_LOCATOR_MISSING');
  const evidence = documentOriginalEngineeringReading(loaded, offset, 1).evidence.find(item => item.sourceRefId === sourceRefId);
  if (!evidence) throw new Error('DOCUMENT_ORIGINAL_SOURCE_TEXT_MISSING');
  return evidence;
}
