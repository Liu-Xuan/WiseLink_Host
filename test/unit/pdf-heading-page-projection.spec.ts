import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import { Frozen2CandidateReaderService } from '../../server/modules/unified-reader/frozen2-candidate-reader.service';
import { CanonicalHostVerticalService } from '../../server/modules/canonical-host/canonical-host-vertical.service';
import { CanonicalTranslationV2Service } from '../../server/modules/canonical-host/canonical-translation-v2.service';
import { translationSourcePlanSchemaV2 } from '../../server/modules/canonical-host/canonical-translation-v2.contract';
import { semanticReadingHeading } from '../../client/src/pages/DocumentParsingPage/semantic-reading';
import { SemanticBlockContent } from '../../client/src/pages/DocumentParsingPage/SemanticBlockContent';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { syntheticLegacyPdfHeadingPackage, syntheticPackageBytes, syntheticPdfHeadingPackage } from '../support/pdf-heading-test-package';

jest.mock('../../server/modules/canonical-host/canonical-host-page-projections', () => ({
  buildCanonicalPageProjections: () => ({}),
}));

/** Exercise the actual page/browse methods; only unrelated storage and transport are stubbed. */
function syntheticPageService(legacy: boolean) {
  const pkg = legacy ? syntheticLegacyPdfHeadingPackage() : syntheticPdfHeadingPackage();
  const { bytes, artifact } = syntheticPackageBytes(pkg);
  const reader = new Frozen2CandidateReaderService();
  const sourcePackage = reader.readSourcePackage(artifact, bytes);
  const projection = {
    workItemId: 'synthetic-work', requestId: 'synthetic-request', revision: 1,
    phase: 'CANDIDATE_READBACK_VERIFIED', permissionSnapshotVersion: 'synthetic-permission',
    source: { documentVersionId: 'synthetic-version' },
    package: { ...sourcePackage.inspection, artifact,
      usagePolicy: { qualityStatus: legacy ? 'PASS' : 'NEEDS_REVIEW', projectionSource: 'IMMUTABLE_PACKAGE_ACTUAL_BYTES' } },
  } as unknown as CanonicalWorkItemProjection;
  const original = JSON.stringify(projection);
  const service = Object.assign(Object.create(CanonicalHostVerticalService.prototype), {
    registrar: { getTenantScopedByWorkItemId: jest.fn().mockResolvedValue(projection) },
    reader: {
      inspectSourcePackage: jest.fn().mockResolvedValue(sourcePackage.inspection),
      readSourcePackage: jest.fn().mockResolvedValue(sourcePackage),
      readAllSourceUnits: jest.fn().mockResolvedValue(sourcePackage.units),
    },
    authorizeAction: jest.fn().mockResolvedValue({ decision: {
      decisionId: 'synthetic-decision', permissionSnapshotVersion: 'synthetic-permission',
    } }),
    readTranslationConsumptionAxes: jest.fn().mockResolvedValue({ status: 'NOT_REQUESTED' }),
    readPackage: jest.fn().mockResolvedValue({ package: sourcePackage.inspection,
      queryResults: sourcePackage.units.filter(unit => unit.text.includes('Body')) }),
    entryFacade: { status: jest.fn().mockReturnValue({}) },
  }) as CanonicalHostVerticalService;
  return { service, projection, original, sourcePackage };
}

describe('heading quality in actual canonical page consumers', () => {
  it.each([true, false])('prepares translation from real Reader projection without false heading ancestors (legacy=%s)', async legacy => {
    const { projection } = syntheticPageService(legacy);
    const pkg = legacy ? syntheticLegacyPdfHeadingPackage() : syntheticPdfHeadingPackage();
    const { bytes, artifact } = syntheticPackageBytes(pkg);
    const source = new Frozen2CandidateReaderService().readStructuredSource(artifact, bytes);
    const prepare = jest.fn().mockImplementation(input => Promise.resolve(input));
    const service = Object.assign(Object.create(CanonicalTranslationV2Service.prototype), {
      reader: { readStructuredSource: jest.fn().mockResolvedValue(source) },
      workspaces: { prepare },
    }) as CanonicalTranslationV2Service;
    await service.prepare(projection, 'synthetic-tenant');
    const plan = prepare.mock.calls[0][0].plan;
    expect(translationSourcePlanSchemaV2.safeParse(plan).success).toBe(true);
    expect(plan.documentContext.title).toBe('Synthetic title 1');
    expect(plan.documentContext.outline).toEqual([]);
    expect(plan.blocks.map((block: { kind: string }) => block.kind)).toEqual([
      'preserved_source', 'prose', 'preserved_source', 'prose', 'preserved_source', 'prose',
    ]);
    expect(plan.blocks.every((block: { contextBlockIds: string[] }) => block.contextBlockIds.length === 0)).toBe(true);
    expect(plan.anchors).toHaveLength(6);
    if (legacy) expect(plan.blocks[0].sourceStructure[0].payload.level).toBeUndefined();
    const readingBlock = { source: plan.blocks[0], readingStatus: 'MISSING' as const, selected: null, issues: [] };
    expect(semanticReadingHeading(readingBlock)).toBe('candidate');
    const html = renderToStaticMarkup(createElement(SemanticBlockContent, {
      block: readingBlock, anchors: [plan.anchors[0]], original: true,
      selectedAnchors: [], onFocus: jest.fn(),
    }));
    expect(html).toContain('Synthetic title 1');
    expect(html).toContain('候选标题 · 层级未知');
    expect(html).not.toMatch(/<h[1-6]\b|aria-level=/);
  });
  it.each([true, false])('exposes independent reading limitations on initial/search/source page reads (legacy=%s)', async legacy => {
    const { service, projection, original, sourcePackage } = syntheticPageService(legacy);
    const actor = { tenantId: 'synthetic-tenant', userId: 'synthetic-user', appId: 'synthetic-app', roles: [], env: 'test' };
    for (const input of [{ workItemId: 'synthetic-work' },
      { workItemId: 'synthetic-work', query: 'Body' },
      { workItemId: 'synthetic-work', sourceRef: sourcePackage.units[0].sourceRefIds[0] }]) {
      const page = await service.page(input, actor);
      expect(page.readerProjection?.readingQuality).toEqual({ qualityStatus: 'NEEDS_REVIEW',
        reason: 'CANDIDATE_HEADING_RANK_UNKNOWN', candidateHeadingCount: 3 });
      expect(page.workItem.package?.resultStatus).toBe(legacy ? 'complete' : 'partial');
      expect(page.workItem.package?.usagePolicy?.qualityStatus).toBe(legacy ? 'PASS' : 'NEEDS_REVIEW');
    }
    expect(JSON.stringify(projection)).toBe(original);
  });

  it.each([true, false])('keeps all titles and adjacent body browsable with NEEDS_REVIEW (legacy=%s)', async legacy => {
    const { service, projection, original } = syntheticPageService(legacy);
    const actor = { tenantId: 'synthetic-tenant', userId: 'synthetic-user', appId: 'synthetic-app', roles: [], env: 'test' };
    const first = await service.browseStructuredContent({ workItemId: 'synthetic-work', limit: 2 }, actor);
    expect(first).toMatchObject({ qualityStatus: 'NEEDS_REVIEW', resultStatus: legacy ? 'complete' : 'partial',
      totalSourceUnitCount: 6, totalDisplayUnitCount: 6, omittedUnitCount: 0,
      returnedUnitCount: 2, nextCursor: '2', hasMore: true });
    expect(first.units.map(unit => unit.displayText)).toEqual(['Synthetic title 1', 'Body 1 stays beside its title.']);
    const next = await service.browseStructuredContent({ workItemId: 'synthetic-work', limit: 2,
      cursor: first.nextCursor!, expectedRevision: first.revision }, actor);
    expect(next.units.map(unit => unit.displayText)).toEqual(['Synthetic title 2', 'Body 2 stays beside its title.']);
    expect(next.units[0].reading).toEqual({ kind: 'heading', level: null, basis: 'bold_candidate' });
    expect(JSON.stringify(projection)).toBe(original);
  });
});
