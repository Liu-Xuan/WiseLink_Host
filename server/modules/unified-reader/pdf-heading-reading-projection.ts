import { PDF_HEADING_LEVEL_UNKNOWN_FINDING } from '@shared/pdf-heading-semantics';
import type { TranslationStructuredSourceUnit } from '@shared/canonical-translation-v2.interface';
import { canonicalJson, sha256Text } from './unified-reader.utils';

const LEGACY_PIPELINE = 'professional-input-pure.v1.candidate.1';
const SEGMENTATION_PROFILE = 'professional-input-pure-pdf-lines-v1';
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.map(record) : [];
const entityId = (kind: string, value: unknown) =>
  `urn:techpub:${kind}:v1:${sha256Text(canonicalJson(value))}`;
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);

/**
 * Recognize only the old pure-PDF serializer's complete heading sequence.
 * Rank magnitude and heading text never establish this diagnosis. All profile,
 * source-anchor and identity checks must agree, or the original rank is kept.
 */
export function legacyPdfHeadingIds(pkg: Record<string, unknown>): Set<string> {
  const source = record(pkg.source);
  const profile = record(pkg.profile);
  const mapping = record(profile.mappingProfile);
  const producer = record(record(pkg.lineage).producer);
  const basis = record(record(pkg.coverage).basis);
  if (source.kind !== 'pdf' ||
      profile.canonicalModel !== 'technical-publication-core.v1' ||
      profile.sourceProfile !== 'wiselink.v3_1.host_native.pdf.v1' ||
      mapping.id !== 'professional-input-pure-pdf-v1' || mapping.version !== 'frozen.2' ||
      mapping.hash !== sha256Text(`${LEGACY_PIPELINE}@frozen.2`) ||
      producer.name !== 'WiseLinkCanonicalHostProfessionalInput' || producer.version !== LEGACY_PIPELINE ||
      producer.runtime !== 'typescript' || producer.buildHash !== sha256Text(LEGACY_PIPELINE) ||
      basis.segmentationProfileId !== SEGMENTATION_PROFILE ||
      basis.segmentationProfileHash !== sha256Text(`${SEGMENTATION_PROFILE}@frozen.2`)) return new Set();
  const sourcePackageId = source.sourcePackageId;
  if (typeof sourcePackageId !== 'string') return new Set();
  const moduleId = entityId('module', {
    namespace: 'techpub-module-id-v1', sourcePackageId,
    continuityKey: 'logical-document', moduleKind: 'logical_document',
  });
  const modules = records(pkg.modules);
  if (modules.length !== 1 || modules[0].moduleId !== moduleId ||
      modules[0].continuityKey !== 'logical-document' ||
      modules[0].moduleKind !== 'logical_document') return new Set();
  const segments = new Map(records(pkg.sourceSegments).map(segment => [segment.sourceSegmentId, segment]));
  const refs = new Map(records(pkg.sourceRefs).map(ref => [ref.sourceRefId, ref]));
  const headings = records(pkg.contentUnits).filter(unit => unit.kind === 'heading')
    .sort((left, right) => Number(left.order) - Number(right.order));
  const ids = new Set<string>();
  for (const [index, unit] of headings.entries()) {
    const continuityKey = `heading-${index + 1}`;
    const payload = record(unit.payload);
    const unitMapping = record(unit.mapping);
    const segmentIds = unit.sourceSegmentIds;
    const refIds = unit.sourceRefIds;
    if (unit.continuityKey !== continuityKey || payload.level !== index + 1 ||
        typeof payload.text !== 'string' || unit.moduleId !== moduleId ||
        unit.parentUnitId !== undefined || unit.depth !== 0 ||
        unitMapping.status !== 'mapped_exactly' || unitMapping.confidence !== 'deterministic' ||
        !same(unitMapping.findingIds, []) || !Array.isArray(segmentIds) || segmentIds.length !== 1 ||
        !Array.isArray(refIds) || refIds.length === 0 ||
        unit.unitId !== entityId('unit', {
          namespace: 'techpub-unit-id-v1', sourcePackageId,
          moduleAnchorKey: 'logical-document', sourceAnchorKey: continuityKey, kind: 'heading',
        })) return new Set();
    const segment = segments.get(segmentIds[0]);
    if (!segment || segment.sourceSegmentId !== entityId('source-segment', {
      namespace: 'techpub-source-segment-id-v1', sourcePackageId, continuityKey, kind: 'text_block',
    }) || segment.continuityKey !== continuityKey || segment.kind !== 'text_block' ||
        segment.expectedSemantic !== 'heading' || segment.order !== Number(unit.order) + 1 ||
        !same(segment.sourceRefIds, refIds) || segment.segmentHash !== sha256Text(canonicalJson({
          kind: 'text_block', expectedSemantic: 'heading', sourceRefIds: [...refIds].sort(),
        })) || refIds.some(id => !isPurePdfAnchor(refs.get(id), source.artifactIds))) return new Set();
    ids.add(String(unit.unitId));
  }
  return ids;
}

function isPurePdfAnchor(ref: Record<string, unknown> | undefined, artifactIds: unknown): boolean {
  if (!ref || ref.kind !== 'pdf' || typeof ref.quote !== 'string' ||
      !Array.isArray(artifactIds) || !artifactIds.includes(ref.artifactId) ||
      ref.anchorTextHash !== sha256Text(ref.quote)) return false;
  return ref.sourceRefId === entityId('source-ref', {
    namespace: 'techpub-source-ref-id-v1', kind: 'pdf', artifactId: ref.artifactId,
    pageStart: ref.pageStart, pageEnd: ref.pageEnd, bbox: ref.bbox,
    ...(ref.charStart === undefined ? {} : {
      charStart: ref.charStart, charEnd: ref.charEnd, charOffsetUnit: ref.charOffsetUnit,
    }),
    quote: ref.quote, anchorTextHash: ref.anchorTextHash,
  });
}

/** A diagnostic on the read view; the immutable unit payload and IDs remain untouched. */
export function legacyPdfHeadingFinding(unit: TranslationStructuredSourceUnit): Record<string, unknown> {
  return {
    findingId: entityId('finding', { namespace: 'legacy-pdf-heading-reading-v1', unitId: unit.unitId }),
    code: PDF_HEADING_LEVEL_UNKNOWN_FINDING,
    severity: 'warning', blocking: false, readingImpact: 'LIMITATION',
    message: '旧解析包的标题 level 是粗体行序号，不是原文层级；此处仅作为候选标题导航。',
    affectedUnitIds: [unit.unitId], sourceRefIds: [...unit.sourceRefIds],
    sourceSegmentIds: [...unit.sourceSegmentIds],
    parameters: { legacyHeadingSequence: unit.payload.level, headingLevel: 'unknown', headingBasis: 'bold_candidate' },
  };
}
