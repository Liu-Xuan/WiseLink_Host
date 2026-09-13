import { originalFixture } from './fixtures/document-original.fixture';
import {
  buildDocumentSemanticMap,
  assertDocumentSemanticMap,
  selectDocumentSemanticSection,
  semanticTranslationSource,
  compareDocumentSemanticMaps,
} from '../../../server/modules/document-management/src/hosted/nest/document-semantic-map';
import {
  BOEING_FTD_SEMANTIC_PROFILE,
  BOEING_AIRFRAME_SB_SEMANTIC_PROFILE,
  GENERIC_SEMANTIC_PROFILE,
} from '../../../server/modules/document-management/src/hosted/nest/document-semantic-profile';
import { buildTranslationSourcePlan } from '../../../server/modules/canonical-host/canonical-translation-source-plan';

function document(rows: Array<[string, number?]>) {
  const result = originalFixture();
  result.source.units = rows.map(([text, level], order) => ({
    ...result.source.units[0],
    unitId: `u${order}`,
    order,
    sourceSegmentIds: [`s${order}`],
    kind: level ? 'heading' : 'paragraph',
    payload: level ? { text, level } : { text },
  }));
  result.coverage = {
    knownPageCount: 2,
    readPageIndexes: [0, 1],
    unresolvedRanges: [],
  };
  return result;
}

describe('source-bound semantic organization (constructed boundary cases)', () => {
  it('preserves None/N/A/empty separately without generating absent FTD sections', () => {
    const original = document([
      ['Interim Action', 1],
      ['None'],
      ['Final Action', 1],
      ['N/A'],
      ['Milestones', 1],
    ]);
    const saved = JSON.stringify(original);
    const map = buildDocumentSemanticMap({
      original,
      semanticRevision: 1,
      profile: BOEING_FTD_SEMANTIC_PROFILE,
    });
    expect(
      map.sections.map((section) => [
        section.roleKey,
        section.contentState,
        section.emptyLiteral,
      ]),
    ).toEqual([
      ['ftd.interim_action', 'EXPLICIT_NONE', 'None'],
      ['ftd.final_action', 'EXPLICIT_NA', 'N/A'],
      ['ftd.milestones', 'EMPTY', null],
    ]);
    expect(JSON.stringify(original)).toBe(saved);
  });
  it('uses the verified FTD peer-section rule when Markdown emphasis nests final under interim', () => {
    const original = document([
      ['Interim Action', 2],
      ['Temporary measure.'],
      ['Final Action', 3],
      ['Permanent measure.'],
      ['Milestones', 3],
      ['TBD'],
    ]);
    const map = buildDocumentSemanticMap({
      original,
      semanticRevision: 1,
      profile: BOEING_FTD_SEMANTIC_PROFILE,
    });
    expect(
      map.sections.every((section) => section.parentSectionId === null),
    ).toBe(true);
    expect(
      selectDocumentSemanticSection(original, map, 'section:u0').unitIds,
    ).toEqual(['u0', 'u1']);
    expect(
      selectDocumentSemanticSection(original, map, 'section:u2').unitIds,
    ).toEqual(['u2', 'u3']);
    expect(original.source.units[2].payload.level).toBe(3);
  });
  it('retains manufacturer SB hierarchy and keeps duplicate scope headings separate', () => {
    const original = document([
      ['1. Planning Information', 1],
      ['For configuration A only.'],
      ['A. Effectivity', 2],
      ['P/N 100'],
      ['2. Material Information', 1],
      ['Group B only.'],
      ['A. Effectivity', 2],
      ['P/N 200'],
    ]);
    const map = buildDocumentSemanticMap({
      original,
      semanticRevision: 1,
      profile: BOEING_AIRFRAME_SB_SEMANTIC_PROFILE,
    });
    const selected = selectDocumentSemanticSection(original, map, 'section:u6');
    expect(selected.unitIds).toEqual(['u6', 'u7']);
    expect(selected.contextUnitIds).toEqual(['u4', 'u5']);
    expect(map.sections[1].parentSectionId).toBe('section:u0');
    expect(map.sections[3].parentSectionId).toBe('section:u4');
    expect(map.sections[1].roleKey).toBe('sb.effectivity');
    expect(map.sections[3].occurrence).toBe(1);
    const source = semanticTranslationSource(original, map);
    expect(source.units[7].parentUnitId).toBe('u6');
    const plan = buildTranslationSourcePlan({
      documentVersionId: original.binding.documentVersionId,
      packageId: original.binding.parseRunId,
      title: 'Constructed SB',
      source,
      parsedArtifact: {
        storeRole: 'UnifiedArtifactStoreCandidate',
        ref: 'fixture',
        sha256: 'b'.repeat(64),
        byteLength: 1,
        mediaType: 'application/json',
      },
    });
    const targetBlock = plan.blocks.find((block) =>
      block.sourceUnitIds.includes('u7'),
    )!;
    const contextUnits = plan.blocks
      .filter((block) => targetBlock.contextBlockIds.includes(block.blockId))
      .flatMap((block) => block.sourceUnitIds);
    expect(contextUnits).toContain('u5');
    expect(contextUnits).not.toContain('u1');
    expect(source.units[7].payload).toEqual(original.source.units[7].payload);
  });
  it('supports arbitrary document families and explicit supplied role rules, without promoting body references to headings', () => {
    const original = document([
      ['AD reference mentions Background and Final Action.'],
      ['Limitations', 1],
      ['Do not operate when X.'],
    ]);
    const generic = buildDocumentSemanticMap({
      original,
      semanticRevision: 1,
      profile: GENERIC_SEMANTIC_PROFILE,
    });
    expect(generic.sections).toHaveLength(1);
    expect(generic.sections[0].roleKey).toBeNull();
    expect(generic.unassignedUnitIds).toEqual(['u0']);
    const specialized = buildDocumentSemanticMap({
      original,
      semanticRevision: 2,
      profile: {
        profileRef: 'verified.operator-manual.v1',
        roles: [{ roleKey: 'manual.limitations', aliases: ['Limitations'] }],
      },
    });
    expect(specialized.sections[0].roleKey).toBe('manual.limitations');
  });
  it('flags styled body text interrupting a known role rather than claiming that role has no content', () => {
    const original = document([
      ['Applicability', 2],
      ['All model X aircraft.', 2],
      ['Status', 2],
      ['Pending.'],
    ]);
    const map = buildDocumentSemanticMap({
      original,
      semanticRevision: 1,
      profile: BOEING_FTD_SEMANTIC_PROFILE,
    });
    expect(map.organizationWarnings).toEqual([
      {
        code: 'EMPTY_ROLE_FOLLOWED_BY_UNCLASSIFIED_HEADING',
        sectionIds: ['section:u0', 'section:u1'],
        unitIds: ['u0', 'u1'],
      },
    ]);
    const read = selectDocumentSemanticSection(original, map, 'section:u0');
    expect(read.organizationWarnings).toHaveLength(1);
    expect(read.contextUnitIds).toContain('u1');
  });
  it('rejects fabricated empty assertions on non-empty source content', () => {
    const original = document([
      ['Interim Action', 1],
      ['Do not use method A.'],
    ]);
    const map = buildDocumentSemanticMap({
      original,
      semanticRevision: 1,
      profile: BOEING_FTD_SEMANTIC_PROFILE,
    });
    map.sections[0].contentState = 'EXPLICIT_NONE';
    map.sections[0].emptyLiteral = 'None';
    expect(() => assertDocumentSemanticMap(map, original)).toThrow(
      'EMPTY_ASSERTION',
    );
  });
  it('rejects foreign bindings, invented IDs, omitted units and cyclic parents', () => {
    const original = document([['Status', 1], ['Pending.']]);
    const build = () =>
      buildDocumentSemanticMap({
        original,
        semanticRevision: 1,
        profile: BOEING_FTD_SEMANTIC_PROFILE,
      });
    const foreign = build();
    foreign.binding.parseRunId = 'different';
    expect(() => assertDocumentSemanticMap(foreign, original)).toThrow(
      'BINDING',
    );
    const invented = build();
    invented.sections[0].bodyUnitIds = ['not-source'];
    expect(() => assertDocumentSemanticMap(invented, original)).toThrow(
      'MEMBER',
    );
    const omitted = build();
    omitted.sections[0].bodyUnitIds = [];
    omitted.sections[0].sourceRefIds = ['SR-TEST-P1'];
    expect(() => assertDocumentSemanticMap(omitted, original)).toThrow(
      'COVERAGE',
    );
    const cycle = build();
    cycle.sections[0].parentSectionId = cycle.sections[0].sectionId;
    expect(() => assertDocumentSemanticMap(cycle, original)).toThrow('PARENT');
  });
  it('preserves unread/figure limits on section reads and does not invent complete coverage', () => {
    const original = document([['Interim Action', 1], ['None']]);
    original.coverage.unresolvedRanges = [
      {
        reason: 'UNREAD',
        unitIds: ['u1'],
        pageIndexes: [1],
        message: 'Constructed incomplete extraction',
      },
    ];
    const map = buildDocumentSemanticMap({
      original,
      semanticRevision: 1,
      profile: BOEING_FTD_SEMANTIC_PROFILE,
    });
    expect(map.sections[0].contentState).toBe('UNREAD');
    expect(
      selectDocumentSemanticSection(original, map, 'section:u0')
        .unresolvedRanges,
    ).toEqual(original.coverage.unresolvedRanges);
  });
  it('mapping revision or generated ID changes alone do not invalidate work, but moved parent conditions do', () => {
    const original = document([
      ['Planning Information', 1],
      ['Only for A.'],
      ['Effectivity', 2],
      ['P/N 100'],
      ['Material Information', 1],
      ['Only for B.'],
    ]);
    const previous = buildDocumentSemanticMap({
      original,
      semanticRevision: 1,
      profile: BOEING_AIRFRAME_SB_SEMANTIC_PROFILE,
    });
    const next = structuredClone(previous);
    next.semanticRevision = 2;
    next.sections[0].sectionId = 'renamed';
    next.sections[1].parentSectionId = 'renamed';
    expect(compareDocumentSemanticMaps(original, previous, next)).toEqual({
      changed: false,
      affectedUnitIds: [],
    });
    next.sections[1].parentSectionId = next.sections[2].sectionId;
    expect(
      compareDocumentSemanticMaps(original, previous, next).affectedUnitIds,
    ).toEqual(['u2', 'u3']);
  });
});
