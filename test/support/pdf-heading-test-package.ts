import { buildSourceUnitSet } from '../../server/modules/professional-input/builders/source-unit-set.builder';
import { buildStructuredParsePackage } from '../../server/modules/professional-input/builders/structured-parse-package.builder';
import type { ParsedPdfLayout } from '../../server/modules/professional-input/pure/professional-input-pure.types';
import { canonicalJson, contentView, sha256Raw, sha256Text } from '../../server/modules/unified-reader/unified-reader.utils';
import type { UnifiedPackageArtifactDescriptor } from '@shared/api.interface';

/** Invented text only: no engineering document, holdout or PDF input is used. */
export function syntheticPdfHeadingPackage(headingCount = 3): Record<string, unknown> {
  const texts = Array.from({ length: headingCount }, (_, index) => [
    { text: `Synthetic title ${index + 1}`, bold: true },
    { text: `Body ${index + 1} stays beside its title.`, bold: false },
  ]).flat();
  const layout: ParsedPdfLayout = {
    kind: 'pdf', pdfVersion: '1.7', pageCount: 1,
    pageBoxes: [{ page: 1, mediaBox: [0, 0, 612, texts.length * 14 + 50] }],
    metadata: { title: 'Invented heading regression' },
    textRuns: texts.map((entry, index) => ({ ...entry,
      page: 1, fontName: entry.bold ? 'Bold' : 'Regular', fontSize: 10,
      x: 30, y: texts.length * 14 + 30 - index * 14,
    })),
    sourceSha256: `sha256:${'8'.repeat(64)}`, sourceByteLength: 100,
    pageTextLayerDiagnostics: [{
      page: 1, status: 'PRESENT', textRunCount: texts.length,
      nonWhitespaceCharacterCount: texts.reduce((sum, entry) => sum + entry.text.replace(/\s/g, '').length, 0),
      rasterVisualCoverage: { status: 'NO_MATERIAL_RASTER', materialUnverifiedRasterPageFraction: 0,
        rasterRegionCount: 0, rasterPageAreaRatio: 0, unverifiedRasterRegionCount: 0,
        unverifiedRasterPageAreaRatio: 0, unverifiedRasterRegions: [] },
    }],
  };
  const artifact = { artifactRef: 'artifact://synthetic/title.pdf', normalizedPath: 'title.pdf' };
  const document = { documentCode: 'SYNTHETIC-HEADING', documentType: 'oem_reference' as const, language: 'en-US' };
  return buildStructuredParsePackage({ layout,
    unitSet: buildSourceUnitSet(layout, { ...document, artifact }), artifact, document,
    lineage: { generatedAt: '2026-10-13T00:00:00Z',
      producerName: 'WiseLinkCanonicalHostProfessionalInput',
      producerVersion: 'professional-input-pure.v1.candidate.2' },
  }) as unknown as Record<string, unknown>;
}

/** Recreate the prior serializer shape in memory; never rewrite a saved artifact. */
export function syntheticLegacyPdfHeadingPackage(headingCount = 3): Record<string, unknown> {
  const pkg = syntheticPdfHeadingPackage(headingCount);
  const sourcePackageId = (pkg.source as Record<string, unknown>).sourcePackageId;
  const oldIdToNew = new Map<string, string>();
  let sequence = 0;
  for (const unit of pkg.contentUnits as Array<Record<string, unknown>>) {
    if (unit.kind !== 'preserved_source') continue;
    sequence += 1;
    const unitId = `urn:techpub:unit:v1:${sha256Text(canonicalJson({
      namespace: 'techpub-unit-id-v1', sourcePackageId, moduleAnchorKey: 'logical-document',
      sourceAnchorKey: unit.continuityKey, kind: 'heading',
    }))}`;
    oldIdToNew.set(String(unit.unitId), unitId);
    unit.unitId = unitId;
    unit.kind = 'heading';
    unit.payload = { text: (unit.payload as Record<string, unknown>).rawText, level: sequence };
    unit.mapping = { status: 'mapped_exactly', confidence: 'deterministic', findingIds: [] };
    const hashView = { ...unit };
    delete hashView.unitHash;
    unit.unitHash = sha256Text(canonicalJson(hashView));
  }
  (pkg.modules as Array<Record<string, unknown>>)[0].contentUnitIds =
    (pkg.contentUnits as Array<Record<string, unknown>>).map(unit => unit.unitId);
  const coverage = pkg.coverage as Record<string, unknown>;
  for (const entry of coverage.entries as Array<Record<string, unknown>>) {
    entry.disposition = 'mapped_exactly'; entry.findingIds = [];
    entry.targetIds = (entry.targetIds as string[]).map(id => oldIdToNew.get(id) ?? id);
  }
  const summary = coverage.summary as Record<string, unknown>;
  summary.mappedExactlyCount = summary.requiredSourceSegmentCount;
  summary.preservedAsTextCount = 0; summary.structuredCoverageComplete = true;
  pkg.result = { status: 'complete', accountingComplete: true, contentPreserved: true, structuredCoverageComplete: true };
  pkg.findings = [];
  const legacyVersion = 'professional-input-pure.v1.candidate.1';
  ((pkg.lineage as Record<string, unknown>).producer as Record<string, unknown>).version = legacyVersion;
  ((pkg.lineage as Record<string, unknown>).producer as Record<string, unknown>).buildHash = sha256Text(legacyVersion);
  ((pkg.profile as Record<string, unknown>).mappingProfile as Record<string, unknown>).hash = sha256Text(`${legacyVersion}@frozen.2`);
  return bindSyntheticContent(pkg);
}

export function bindSyntheticContent(pkg: Record<string, unknown>): Record<string, unknown> {
  const contentHash = sha256Text(canonicalJson(contentView(pkg)));
  (pkg.integrity as Record<string, unknown>).contentHash = contentHash;
  pkg.packageId = `urn:techpub:package:v1:${contentHash}`;
  return pkg;
}

export function syntheticPackageBytes(pkg: Record<string, unknown>): {
  bytes: Uint8Array; artifact: UnifiedPackageArtifactDescriptor;
} {
  const bytes = new TextEncoder().encode(JSON.stringify(pkg));
  return { bytes, artifact: { storeRole: 'UnifiedArtifactStoreCandidate',
    ref: 'artifact://synthetic/package.json', sha256: sha256Raw(bytes),
    byteLength: bytes.byteLength, mediaType: 'application/json' } };
}
