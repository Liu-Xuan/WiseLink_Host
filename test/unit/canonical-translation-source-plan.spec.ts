import { readFileSync } from 'node:fs';
import type {
  UnifiedPackageArtifactDescriptor,
  UnifiedReaderSourceLocator,
} from '@shared/api.interface';
import type {
  TranslationStructuredSource,
  TranslationStructuredSourceUnit,
} from '@shared/canonical-translation-v2.interface';
import { buildTranslationSourcePlan } from '../../server/modules/canonical-host/canonical-translation-source-plan';
import { checkTranslationBlockV2, tableCellKey } from '../../server/modules/canonical-host/canonical-translation-v2-quality';
import { Frozen2CandidateReaderService } from '../../server/modules/unified-reader/frozen2-candidate-reader.service';
import { sha256Raw } from '../../server/modules/unified-reader/unified-reader.utils';

const artifact: UnifiedPackageArtifactDescriptor = {
  storeRole: 'UnifiedArtifactStoreCandidate',
  ref: 'artifact://synthetic/translation-plan',
  sha256: '1'.repeat(64),
  byteLength: 1,
  mediaType: 'application/json',
};

// All technical text below is invented to exercise mapping, not aircraft data.
function unit(
  id: string,
  kind: string,
  payload: Record<string, unknown>,
  order: number,
  parentUnitId: string | null = null,
): TranslationStructuredSourceUnit {
  return {
    unitId: id,
    kind,
    payload,
    order,
    parentUnitId,
    moduleId: 'module-1',
    depth: parentUnitId ? 1 : 0,
    continuityKey: id,
    sourceRefIds: [`sr-${id}`],
    sourceSegmentIds: [`seg-${id}`],
    mapping: {
      status: 'mapped_exactly',
      confidence: 'deterministic',
      findingIds: [],
    },
  };
}

function locator(id: string, page: number): UnifiedReaderSourceLocator {
  return {
    sourceRefId: id,
    kind: 'pdf_page',
    artifactId: 'pdf-test',
    pageStart: page,
    pageEnd: page,
    charStart: null,
    charEnd: null,
    charOffsetUnit: null,
    normalizedPath: null,
    xpath: null,
    elementId: null,
    quote: null,
    bbox: null,
  };
}

function source(
  units: TranslationStructuredSourceUnit[],
): TranslationStructuredSource {
  return {
    units,
    modules: [{ moduleId: 'module-1', order: 0 }],
    findings: [],
    references: [],
    sourceLocators: units.flatMap((entry, index) =>
      entry.sourceRefIds.map((id) => locator(id, index + 1)),
    ),
  };
}

function plan(input: TranslationStructuredSource) {
  return buildTranslationSourcePlan({
    documentVersionId: 'docv-test',
    packageId: 'pkg-test',
    parsedArtifact: artifact,
    title: 'Synthetic',
    source: input,
  });
}

describe('translation v2 complete semantic source plan', () => {
  it('groups three fragments without rewriting strings or inventing three separate translations', () => {
    const input = source([
      unit(
        'u41',
        'paragraph',
        { text: ' For units with software version V1,\n', role: 'body' },
        0,
      ),
      unit(
        'u42',
        'paragraph',
        {
          text: 'do not replace the controller unless the indication',
          role: 'body',
        },
        1,
      ),
      unit(
        'u43',
        'paragraph',
        { text: 'remains after the test in paragraph 3.B.', role: 'body' },
        2,
      ),
    ]);
    const result = plan(input);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({
      kind: 'prose',
      organization: 'ADJACENT_PROSE_CONTEXT',
      sourceUnitIds: ['u41', 'u42', 'u43'],
      anchorIds: ['a1', 'a2', 'a3'],
    });
    expect(result.anchors.map((anchor) => anchor.sourceText)).toEqual(
      input.units.map((entry) => entry.payload.text),
    );
    expect(
      result.anchors.map((anchor) => anchor.sourceLocators[0].pageStart),
    ).toEqual([1, 2, 3]);
    expect(
      result.anchors.every(
        (anchor) => anchor.sourceLocators[0].charStart === null,
      ),
    ).toBe(true);
    expect(result.documentContext.conditionAnchorIds).toEqual(['a2']);
    expect(result.inventory.map((entry) => entry.blockId)).toEqual([
      'b1',
      'b1',
      'b1',
    ]);
    expect(JSON.stringify(result)).not.toContain('translatedUnits');
  });

  it('uses sibling order within the hierarchy, preserves duplicate warnings and carries their exact scope', () => {
    const heading = unit('h', 'heading', { text: 'Test section', level: 1 }, 0);
    const p1 = unit(
      'p1',
      'paragraph',
      { text: 'Test action A.', role: 'body' },
      1,
      'h',
    );
    const p2 = unit(
      'p2',
      'paragraph',
      { text: 'Test action B.', role: 'body' },
      3,
      'h',
    );
    const warning = (id: string, target: string, order: number) =>
      unit(
        id,
        'advisory',
        {
          advisoryType: 'warning',
          text: 'Do not proceed unless test conditions hold.',
          scope: { kind: 'explicit_units', targetUnitIds: [target] },
        },
        order,
        'h',
      );
    const result = plan(
      source([p2, warning('w2', 'p2', 2), p1, heading, warning('w1', 'p1', 0)]),
    );
    expect(result.inventory.map((entry) => entry.sourceUnitId)).toEqual([
      'h',
      'w1',
      'p1',
      'w2',
      'p2',
    ]);
    expect(
      result.blocks.filter((block) => block.kind === 'advisory'),
    ).toHaveLength(2);
    expect(
      result.blocks.find((block) => block.sourceUnitIds.includes('p1')),
    ).toMatchObject({
      contextBlockIds: ['b1', 'b2'],
      requiredTogetherBlockIds: ['b2'],
    });
    expect(
      result.blocks.find((block) => block.sourceUnitIds.includes('p2'))
        ?.requiredTogetherBlockIds,
    ).toEqual(['b4']);
  });

  it('keeps the complete cross-page grid, repeated header locations, spans and footnote row group', () => {
    const makeTable = (id: string, order: number, second: boolean) => {
      const cell = (
        cellId: string,
        text: string,
        columnStart: number,
        colSpan = 1,
      ) => ({
        cellId,
        order: columnStart,
        columnStart,
        colSpan,
        rowSpan: 1,
        role: 'data',
        sourceRefIds: [`sr-${id}`],
        inlineContent: [
          {
            inlineId: `${cellId}-text`,
            kind: 'text',
            text,
            sourceRefIds: [`sr-${id}`],
          },
        ],
      });
      const row = (rowId: string, cells: unknown[]) => ({
        rowId,
        order: 0,
        sourceRefIds: [`sr-${id}`],
        cells,
      });
      return unit(
        id,
        'table',
        {
          layout: 'grid',
          columnCount: 2,
          continuation: { continuityKey: 'table-1' },
          rowGroups: [
            {
              rowGroupId: `${id}-head`,
              kind: 'thead',
              order: 0,
              rows: [
                row(`${id}-h`, [
                  cell(`${id}-h1`, 'Position', 0),
                  cell(`${id}-h2`, 'Torque (N·m)', 1),
                ]),
              ],
            },
            {
              rowGroupId: `${id}-body`,
              kind: 'tbody',
              order: 1,
              rows: [
                row(`${id}-r`, [
                  cell(
                    `${id}-c1`,
                    second ? 'Right bracket' : 'Left bracket',
                    0,
                  ),
                  cell(`${id}-c2`, second ? '5 ± 1 [a]' : '8 ± 1', 1),
                ]),
              ],
            },
            ...(second
              ? [
                  {
                    rowGroupId: `${id}-foot`,
                    kind: 'tfoot',
                    order: 2,
                    rows: [
                      row(`${id}-f`, [
                        cell(
                          `${id}-f1`,
                          '[a] Upper only; lower uses 3 ± 0.5 N·m.',
                          0,
                          2,
                        ),
                      ]),
                    ],
                  },
                ]
              : []),
          ],
        },
        order,
      );
    };
    const t1 = makeTable('t1', 0, false);
    const t2 = makeTable('t2', 1, true);
    const input = source([t1, t2]);
    const result = plan(input);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].organization).toBe('EXPLICIT_TABLE_CONTINUATION');
    expect(
      result.blocks[0].sourceStructure.map((entry) => entry.payload),
    ).toEqual([t1.payload, t2.payload]);
    expect(
      result.anchors
        .filter((anchor) => anchor.sourceText === 'Position')
        .map((anchor) => anchor.sourceLocators[0].pageStart),
    ).toEqual([1, 2]);
    const footnote = result.anchors.find((anchor) =>
      anchor.sourceText.startsWith('[a]'),
    )!;
    expect(footnote.payloadPath).toBe(
      '/payload/rowGroups/2/rows/0/cells/0/inlineContent/0/text',
    );
    expect(footnote.sourceUnitId).toBe('t2');
    expect(tableCellKey(footnote)).toBe('t2:/payload/rowGroups/2/rows/0/cells/0');
    const candidate = { blockId: result.blocks[0].blockId, elements: result.anchors.map((anchor, index) => ({
      elementId: `e${index}`, kind: 'table_cell' as const, translatedText: anchor.sourceText, anchorIds: [anchor.anchorId],
    })) };
    expect(checkTranslationBlockV2({ plan: result, candidate }).issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SOURCE_STRUCTURE_BINDING_CHANGED' }),
    ]));
    const first = candidate.elements[0];
    const second = candidate.elements[1];
    const merged = { ...candidate, elements: [{ ...first, translatedText: `${first.translatedText} ${second.translatedText}`,
      anchorIds: [...first.anchorIds, ...second.anchorIds] }, ...candidate.elements.slice(2)] };
    expect(checkTranslationBlockV2({ plan: result, candidate: merged }).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SOURCE_STRUCTURE_BINDING_CHANGED', severity: 'BLOCK' }),
    ]));
    expect(result.inventory).toHaveLength(2);
    // A shared continuity key alone does not justify incompatible columns.
    t2.payload.columnCount = 3;
    expect(plan(source([t1, t2])).blocks).toHaveLength(2);
  });

  it('does not count an untranslated figure caption as complete image-text coverage', () => {
    const input = source([
      unit(
        'f',
        'figure',
        {
          figureId: 'fig-1',
          assetIds: ['img-1'],
          referenceIds: [],
          caption: 'Test drawing',
        },
        0,
      ),
      unit(
        'p',
        'paragraph',
        { text: 'Independent source paragraph.', role: 'body' },
        1,
      ),
    ]);
    const result = plan(input);
    expect(result.inventory[0].textAvailability).toBe('SOURCE_REVIEW_REQUIRED');
    expect(result.blocks[0].sourceIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'FIGURE_TEXT_COVERAGE_UNVERIFIED',
          origin: 'SOURCE',
          severity: 'BLOCK',
        }),
      ]),
    );
    expect(result.blocks[1].sourceIssues).toEqual([]);
  });

  it('retains every real 737 source unit and all original payloads through the actual Reader', () => {
    const bytes = readFileSync(
      'server/runtime-assets/assessment-host/real-sb/737-34-3830-original-issue/unified-package.frozen-2.json',
    );
    const actualArtifact = {
      ...artifact,
      byteLength: bytes.byteLength,
      sha256: sha256Raw(bytes),
    };
    const sourcePackage = new Frozen2CandidateReaderService().readSourcePackage(
      actualArtifact,
      bytes,
    );
    const structuredSource =
      new Frozen2CandidateReaderService().readStructuredSource(
        actualArtifact,
        bytes,
      );
    const result = buildTranslationSourcePlan({
      documentVersionId: 'test-real-737',
      packageId: sourcePackage.inspection.packageId,
      parsedArtifact: actualArtifact,
      title: sourcePackage.inspection.title,
      source: structuredSource,
    });
    expect(result.inventory).toHaveLength(
      sourcePackage.inspection.contentUnitCount,
    );
    expect(
      new Set(result.inventory.map((entry) => entry.sourceUnitId)).size,
    ).toBe(sourcePackage.inspection.contentUnitCount);
    const retained = new Map(
      result.blocks.flatMap((block) =>
        block.sourceStructure.map(
          (entry) => [entry.sourceUnitId, entry.payload] as const,
        ),
      ),
    );
    for (const original of structuredSource.units)
      expect(retained.get(original.unitId)).toEqual(original.payload);
    expect(sourcePackage.units[0]).not.toHaveProperty('payload');
    expect(
      result.anchors.every((anchor) => anchor.sourceRefIds.length > 0),
    ).toBe(true);
  });
});
