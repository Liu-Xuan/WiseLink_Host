import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SemanticSourceGrid } from '../../client/src/pages/DocumentParsingPage/SemanticSourceGrid';
import { composeDocumentOriginal } from '../../server/modules/document-management/src/hosted/nest/document-original-compose';
import { buildTranslationSourcePlan } from '../../server/modules/canonical-host/canonical-translation-source-plan';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';

function fixture() {
  const seed = originalFixture();
  const original = composeDocumentOriginal({
    binding: seed.binding,
    producer: seed.producer,
    markdown:
      '| Object | Value | Revision |\n| --- | --- | --- |\n| Part A | 12 | |\n| Part B | 20 | R2 |',
    extraction: {
      pageCount: 1,
      pages: [
        {
          pageIndex: 0,
          text: 'Object Value Revision Part A 12 Part B 20 R2',
          items: [],
          width: 600,
          height: 800,
          rotation: 0,
          imagePaintOperations: 0,
        },
      ],
    },
  });
  const plan = buildTranslationSourcePlan({
    documentVersionId: original.binding.documentVersionId,
    packageId: original.binding.parseRunId,
    title: 'Constructed table',
    source: original.source,
    parsedArtifact: {
      storeRole: 'UnifiedArtifactStoreCandidate',
      ref: 'fixture',
      sha256: 'b'.repeat(64),
      byteLength: 1,
      mediaType: 'application/json',
    },
  });
  return {
    unit: original.source.units.find((unit) => unit.kind === 'table')!,
    anchors: plan.anchors,
  };
}
describe('existing original grid payload in bilingual Reader', () => {
  it('renders composer columnIndex payload in source and Chinese views, retaining blank cells and object/value rows', () => {
    const { unit, anchors } = fixture();
    expect(unit.payload.columnCount).toBeUndefined();
    const render = (translated: boolean) =>
      renderToStaticMarkup(
        createElement(SemanticSourceGrid, {
          payload: unit.payload,
          sourceUnitId: unit.unitId,
          anchors,
          selectedAnchors: [],
          onFocus: jest.fn(),
          ...(translated
            ? {
                elements: anchors.map((anchor) => ({
                  elementId: anchor.anchorId,
                  kind: 'table_cell' as const,
                  anchorIds: [anchor.anchorId],
                  translatedText: `译 ${anchor.sourceText}`,
                })),
              }
            : {}),
        }),
      );
    for (const translated of [false, true]) {
      const html = render(translated);
      expect(html).not.toContain('暂无法显示');
      expect(html).not.toContain('需核对');
      expect(html.match(/<tr>/g)).toHaveLength(3);
      expect(html.match(/<td /g)).toHaveLength(9);
      expect(html).toMatch(
        new RegExp(
          `<tr>.*${translated ? '译 ' : ''}Part A.*${translated ? '译 ' : ''}12.*</tr>`,
        ),
      );
      expect(html).toContain('<td colSpan="1" rowSpan="1" class=""></td>');
      expect(html).toContain(translated ? '译 Part B' : 'Part B');
    }
  });
  it('does not infer conflicting positions or hide an explicitly invalid column count', () => {
    const { unit, anchors } = fixture();
    const render = (payload: Record<string, unknown>) =>
      renderToStaticMarkup(
        createElement(SemanticSourceGrid, {
          payload,
          sourceUnitId: unit.unitId,
          anchors,
          selectedAnchors: [],
          onFocus: jest.fn(),
        }),
      );
    expect(render({ ...unit.payload, columnCount: 0 })).toContain('暂无法显示');
    const bad = structuredClone(unit.payload);
    const groups = bad.rowGroups as Array<{
      rows: Array<{ cells: Array<Record<string, unknown>> }>;
    }>;
    groups[0].rows[0].cells[0].columnStart = 2;
    expect(render(bad)).toContain('暂无法显示');
  });
});
