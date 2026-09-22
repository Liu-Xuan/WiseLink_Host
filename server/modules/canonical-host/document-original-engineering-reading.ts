import { documentOriginalReadingCoverage } from '../document-management/src/hosted/nest/document-original-adapter';
import { semanticTranslationSource } from '../document-management/src/hosted/nest/document-semantic-map';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type { DocumentParsingHostedService } from '../document-management/src/hosted/nest/document-parsing-hosted.service';
import { buildTranslationSourcePlan } from './canonical-translation-source-plan';

type LoadedOriginal = Awaited<ReturnType<DocumentParsingHostedService['loadPublished']>>;
type SemanticMap = import('@shared/document-semantic-map.interface').DocumentSemanticMap;

/** A one-range reader for callers that do not own a larger execution scope. */
export function documentOriginalEngineeringReading(
  loaded: LoadedOriginal, offset: number, limit: number, semanticMap: SemanticMap | null = null,
) {
  assertRange(offset, limit);
  return prepareDocumentOriginalEngineeringReader(loaded, semanticMap)(offset, limit);
}

/** Owned by one preparation of an already verified immutable original. No shared cache
 * or authorization result: each subsequent request must load/authorize its own source.
 */
export function prepareDocumentOriginalEngineeringReader(loaded: LoadedOriginal, semanticMap: SemanticMap | null = null) {
  const { original, run } = loaded;
  const structuredSource = semanticMap ? semanticTranslationSource(original, semanticMap) : loaded.structuredSource;
  const artifact = run.manifestArtifact;
  if (!artifact || artifact.readback !== 'VERIFIED' || artifact.relativePath !== 'original/manifest.json' ||
      run.parseRunId !== original.binding.parseRunId || run.documentVersionId !== original.binding.documentVersionId)
    throw new Error('DOCUMENT_ORIGINAL_ENGINEERING_BINDING_INVALID');
  const plan = buildTranslationSourcePlan({ documentVersionId: run.documentVersionId, packageId: run.parseRunId,
    parsedArtifact: { storeRole: 'UnifiedArtifactStoreCandidate', ref: `document-original://${run.documentVersionId}/${run.parseRunId}`,
      sha256: artifact.sha256, byteLength: artifact.byteLength, mediaType: 'application/json' }, title: '', source: structuredSource });
  const coverage = documentOriginalReadingCoverage(original);
  const refsByUnit = new Map<string, Set<string>>();
  const findingsByUnit = new Map<string, Set<string>>();
  const texts = new Map<string, string[]>();
  for (const anchor of plan.anchors) {
    const refs = refsByUnit.get(anchor.sourceUnitId) ?? new Set<string>();
    for (const ref of anchor.sourceRefIds) {
      refs.add(ref);
      const parts = texts.get(ref) ?? [];
      parts.push(anchor.sourceText); texts.set(ref, parts);
    }
    refsByUnit.set(anchor.sourceUnitId, refs);
  }
  // A locator's complete quote includes all its anchors, regardless of page slice.
  const excerpts = new Map<string, string>();
  const locations = new Map(structuredSource.sourceLocators.map(location => [location.sourceRefId, location]));
  for (const block of plan.blocks) {
    const ids = block.sourceIssues.map(issue => issue.sourceFindingId).filter(Boolean);
    for (const unitId of block.sourceUnitIds) {
      const findings = findingsByUnit.get(unitId) ?? new Set<string>();
      for (const id of ids) findings.add(id);
      findingsByUnit.set(unitId, findings);
    }
  }
  return (offset: number, limit: number) => {
    assertRange(offset, limit);
    const units = structuredSource.units.slice(offset, offset + limit);
    const selectedFindingIds = new Set(units.flatMap(unit => [...(findingsByUnit.get(unit.unitId) ?? [])]));
    const selectedRefs = new Set(units.flatMap(unit => [...(refsByUnit.get(unit.unitId) ?? [])]));
    const evidence: Extract<AssessmentEvidence, { kind: 'DOCUMENT_PASSAGE' }>[] = [...texts].filter(([ref]) => selectedRefs.has(ref)).map(([ref, parts]) => {
      let text = excerpts.get(ref);
      if (text === undefined) { text = parts.join('\n'); excerpts.set(ref, text); }
      const location = locations.get(ref);
      if (!location) throw new Error('DOCUMENT_ORIGINAL_SOURCE_LOCATOR_MISSING');
      const evidenceRef = `DOCUMENT_ORIGINAL:${run.documentVersionId}:${run.parseRunId}:${ref}`;
      if (evidenceRef.length > 512) throw new Error('DOCUMENT_ORIGINAL_SOURCE_REF_TOO_LONG');
      return { evidenceRef, kind: 'DOCUMENT_PASSAGE', workItemId: null, documentVersionId: run.documentVersionId,
        sourceRefId: ref, title: `原文 · 解析修订 ${run.parseRevision}`, versionLabel: run.parseRunId,
        excerpt: text, locator: JSON.stringify({ parseRunId: run.parseRunId, sourceRefId: ref,
          pageStart: location.pageStart, normalizedPath: location.normalizedPath, xpath: location.xpath }) };
    });
    return { documentVersionId: run.documentVersionId, binding: original.binding, artifactSha256: artifact.sha256,
      semanticMap: semanticMap ? { ...semanticMap, unresolvedRanges: structuredClone(coverage.unresolvedRanges) } : null,
      offset, units, evidence, sourceRefs: evidence.map(item => item.evidenceRef),
      sourceLocators: structuredSource.sourceLocators.filter(item => selectedRefs.has(item.sourceRefId)),
      coverage: structuredClone(coverage),
      findings: structuredSource.findings.filter(finding => selectedFindingIds.has(String(finding.findingId))), producer: original.producer,
      nextOffset: offset + units.length < structuredSource.units.length ? offset + units.length : null };
  };
}

function assertRange(offset: number, limit: number) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 20)
    throw new Error('DOCUMENT_ORIGINAL_RANGE_INVALID');
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
