import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PDF_HEADING_LEVEL_UNKNOWN_REASON } from '@shared/pdf-heading-semantics';
import { buildTranslationSourcePlan } from '../../../server/modules/canonical-host/canonical-translation-source-plan';
import { projectCanonicalStructuredContentUnit } from '../../../server/modules/canonical-host/canonical-structured-content-projection';
import { verifyStructuredParsePackageIntegrity } from '../../../server/modules/professional-input/builders/structured-parse-package.builder';
import type { StructuredParsePackage } from '../../../server/modules/professional-input/pure/professional-input-pure.types';
import { Frozen2CandidateReaderService } from '../../../server/modules/unified-reader/frozen2-candidate-reader.service';
import { legacyPdfHeadingIds } from '../../../server/modules/unified-reader/pdf-heading-reading-projection';
import { StructuredDocumentArticle } from '../../../client/src/pages/DocumentParsingPage/StructuredDocumentArticle';
import { bindSyntheticContent, syntheticLegacyPdfHeadingPackage, syntheticPackageBytes,
  syntheticPdfHeadingPackage } from '../../support/pdf-heading-test-package';

const reader = new Frozen2CandidateReaderService();
function translationPlan(pkg: Record<string, unknown>) {
  const { bytes, artifact } = syntheticPackageBytes(pkg);
  const source = reader.readStructuredSource(artifact, bytes);
  return { source, plan: buildTranslationSourcePlan({ source, documentVersionId: 'synthetic-version',
    packageId: String(pkg.packageId), parsedArtifact: artifact, title: 'Invented' }) };
}

describe('pure PDF heading reading semantics', () => {
  it('preserves each candidate title, body, source reference and boundary without inventing a rank', () => {
    const pkg = syntheticPdfHeadingPackage();
    expect(verifyStructuredParsePackageIntegrity(pkg as unknown as StructuredParsePackage)).toBe(true);
    expect(pkg.result).toEqual({ status: 'partial', accountingComplete: true,
      contentPreserved: true, structuredCoverageComplete: false });
    expect((pkg.coverage as Record<string, unknown>).summary).toMatchObject({
      mappedExactlyCount: 4, preservedAsTextCount: 3, blockedCount: 0,
      accountingComplete: true, contentPreserved: true, structuredCoverageComplete: false,
    });
    const { bytes, artifact } = syntheticPackageBytes(pkg);
    const sourcePackage = reader.readSourcePackage(artifact, bytes);
    expect(sourcePackage.inspection).toMatchObject({ resultStatus: 'partial', candidateHeadingCount: 3,
      contentUnitCount: 6, sourceBoundUnitCount: 6 });
    const units = sourcePackage.units;
    expect(units.map(unit => unit.text)).toEqual([
      'Synthetic title 1', 'Body 1 stays beside its title.',
      'Synthetic title 2', 'Body 2 stays beside its title.',
      'Synthetic title 3', 'Body 3 stays beside its title.',
    ]);
    expect(units.filter(unit => unit.kind === 'preserved_source').map(unit => unit.reading))
      .toEqual(Array(3).fill({ kind: 'heading', level: null, basis: 'bold_candidate' }));
    expect((pkg.contentUnits as Array<Record<string, unknown>>).filter(unit => unit.kind === 'preserved_source')
      .every(unit => (unit.payload as Record<string, unknown>).reasonCode === PDF_HEADING_LEVEL_UNKNOWN_REASON)).toBe(true);
    const displayed = units.map((unit, index) => projectCanonicalStructuredContentUnit(unit, index + 1)!);
    expect(displayed).toHaveLength(6);
    expect(displayed.filter(unit => unit.outlineKind === 'SECTION').map(unit => unit.sectionTitle))
      .toEqual(['Synthetic title 1', 'Synthetic title 2', 'Synthetic title 3']);
    expect(displayed.map(unit => unit.sourceRefIds)).toEqual(units.map(unit => unit.sourceRefIds));
    const html = renderToStaticMarkup(createElement(StructuredDocumentArticle, {
      units: displayed, requestedSourceRef: '', onLocateSourceRef: jest.fn(),
    }));
    expect(html).toContain('候选标题 · 层级未知');
    expect(html).not.toMatch(/<h[1-6]\b|aria-level=/);
    expect(html.match(/<p\b/g)).toHaveLength(6);
    expect(html).toContain('structured-unit-5');
    expect(html).toContain('Body 3 stays beside its title.');
    const { plan } = translationPlan(pkg);
    expect(plan.blocks).toHaveLength(6);
    expect(plan.anchors.map(anchor => anchor.sourceText)).toEqual(units.map(unit => unit.text));
    expect(plan.documentContext.outline).toEqual([]);
    expect(plan.blocks.every(block => block.contextBlockIds.length === 0)).toBe(true);
  });

  it('safely reads a legacy 1452-title sequence without rewriting immutable IDs, payloads or bytes', () => {
    const pkg = syntheticLegacyPdfHeadingPackage(1452);
    const original = JSON.stringify(pkg);
    const { bytes, artifact } = syntheticPackageBytes(pkg);
    const read = reader.readSourcePackage(artifact, bytes);
    const lastTitle = read.units[2902];
    expect(lastTitle.reading).toEqual({ kind: 'heading', level: null, basis: 'bold_candidate' });
    expect(read.inspection).toMatchObject({ resultStatus: 'complete', candidateHeadingCount: 1452 });
    expect(lastTitle.unitId).toBe((pkg.contentUnits as Array<Record<string, unknown>>)[2902].unitId);
    const { source, plan } = translationPlan(pkg);
    expect(source.units[2902].payload).toEqual({ text: 'Synthetic title 1452', level: 1452 });
    expect(source.units[2902].mapping.headingLevelStatus).toBe('unknown');
    expect(source.units[2903].payload.text).toBe('Body 1452 stays beside its title.');
    expect(plan.documentContext.outline).toEqual([]);
    expect(plan.blocks.every(block => block.contextBlockIds.length === 0)).toBe(true);
    expect(plan.anchors[2902].payloadPath).toBe('/payload/text');
    expect(plan.blocks[2902].kind).toBe('preserved_source');
    expect(plan.blocks[2902].sourceStructure[0].payload).toEqual({ text: 'Synthetic title 1452' });
    expect(source.units.map(unit => unit.sourceRefIds)).toEqual(
      (pkg.contentUnits as Array<Record<string, unknown>>).map(unit => unit.sourceRefIds));
    expect(JSON.stringify(pkg)).toBe(original);
    expect(new TextDecoder().decode(bytes)).toBe(original);
  });

  it.each([
    ['producer name', (pkg: Record<string, unknown>) => { ((pkg.lineage as Record<string, unknown>).producer as Record<string, unknown>).name = 'Other'; }],
    ['producer version', (pkg: Record<string, unknown>) => { ((pkg.lineage as Record<string, unknown>).producer as Record<string, unknown>).version = 'other.1'; }],
    ['pipeline fingerprint', (pkg: Record<string, unknown>) => { ((pkg.lineage as Record<string, unknown>).producer as Record<string, unknown>).buildHash = `sha256:${'1'.repeat(64)}`; }],
    ['mapping profile', (pkg: Record<string, unknown>) => { ((pkg.profile as Record<string, unknown>).mappingProfile as Record<string, unknown>).id = 'other'; }],
    ['segmentation profile', (pkg: Record<string, unknown>) => { ((pkg.coverage as Record<string, unknown>).basis as Record<string, unknown>).segmentationProfileId = 'other'; }],
    ['heading ordinal', (pkg: Record<string, unknown>) => { ((pkg.contentUnits as Array<Record<string, unknown>>)[2].payload as Record<string, unknown>).level = 9; }],
    ['continuity anchor', (pkg: Record<string, unknown>) => { (pkg.contentUnits as Array<Record<string, unknown>>)[2].continuityKey = 'other'; }],
    ['unit ID', (pkg: Record<string, unknown>) => { (pkg.contentUnits as Array<Record<string, unknown>>)[2].unitId = 'different'; }],
    ['source anchor ID', (pkg: Record<string, unknown>) => { (pkg.sourceRefs as Array<Record<string, unknown>>)[1].quote = 'different'; }],
    ['source segment ID', (pkg: Record<string, unknown>) => { (pkg.contentUnits as Array<Record<string, unknown>>)[2].sourceSegmentIds = ['different']; }],
  ])('keeps ranks unless the complete legacy %s signature agrees', (_name, change) => {
    const pkg = syntheticLegacyPdfHeadingPackage();
    expect(legacyPdfHeadingIds(pkg).size).toBe(3);
    (change as (pkg: Record<string, unknown>) => void)(pkg);
    expect(legacyPdfHeadingIds(pkg).size).toBe(0);
  });

  it('retains legitimate deep heading ranks from another producer through Reader and UI', () => {
    const pkg = syntheticLegacyPdfHeadingPackage(1);
    ((pkg.lineage as Record<string, unknown>).producer as Record<string, unknown>).name = 'TaggedPdfAuthorRankProducer';
    ((pkg.contentUnits as Array<Record<string, unknown>>)[0].payload as Record<string, unknown>).level = 1452;
    bindSyntheticContent(pkg);
    const { bytes, artifact } = syntheticPackageBytes(pkg);
    const heading = reader.readAllSourceUnits(artifact, bytes)[0];
    expect(heading.reading).toEqual({ kind: 'heading', level: 1452 });
    expect(reader.inspect(artifact, bytes).candidateHeadingCount).toBeUndefined();
    const html = renderToStaticMarkup(createElement(StructuredDocumentArticle, {
      units: [projectCanonicalStructuredContentUnit(heading, 1)!], requestedSourceRef: '', onLocateSourceRef: jest.fn(),
    }));
    expect(html).toContain('<h6');
    expect(html).toContain('aria-level="1452"');
    expect(html).not.toContain('候选标题');
  });

  it('clears preceding verified ancestry at an unknown title and resumes only after a verified rank', () => {
    const pkg = syntheticPdfHeadingPackage();
    const { bytes, artifact } = syntheticPackageBytes(pkg);
    const source = reader.readStructuredSource(artifact, bytes);
    source.units[0].kind = 'heading'; source.units[0].payload = { text: 'Verified A', level: 1 };
    source.units[4].kind = 'heading'; source.units[4].payload = { text: 'Verified B', level: 2 };
    const plan = buildTranslationSourcePlan({ source, documentVersionId: 'synthetic', packageId: String(pkg.packageId),
      parsedArtifact: artifact, title: 'Invented' });
    expect(plan.blocks.map(block => block.contextBlockIds)).toEqual([[], ['b1'], [], [], [], ['b5']]);
    expect(plan.documentContext.outline.map(item => [item.blockId, item.level])).toEqual([['b1', 1], ['b5', 2]]);
  });
});
