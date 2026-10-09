import { buildDocumentActivitySourceContext, type DocumentActivitySourceContextInput } from
  '../../server/modules/canonical-host/document-activity-source-context';
import { buildDocumentSemanticMap, selectDocumentSemanticSection } from
  '../../server/modules/document-management/src/hosted/nest/document-semantic-map';
import { BOEING_FTD_SEMANTIC_PROFILE, BOEING_AIRFRAME_SB_SEMANTIC_PROFILE, GENERIC_SEMANTIC_PROFILE } from
  '../../server/modules/document-management/src/hosted/nest/document-semantic-profile';
import type { DocumentSemanticProfile } from '../../shared/document-semantic-map.interface';
import type { DocumentActivityDeliveryRange } from '../../shared/document-activity.interface';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';

/** Constructed source/receipts only: no model, OEM file, database or interpreted-semantic claim. */
function fixture(rows: Array<[string, number?]>, profile: DocumentSemanticProfile = GENERIC_SEMANTIC_PROFILE) {
  const original = originalFixture();
  original.source.units = rows.map(([text, level], order) => ({
    ...original.source.units[0], unitId: `u${order}`, order, sourceSegmentIds: [`s${order}`],
    kind: level ? 'heading' : 'paragraph', payload: level ? { text, level } : { text },
  }));
  original.coverage = { knownPageCount: 2, readPageIndexes: [0, 1], unresolvedRanges: [] };
  const semanticMap = buildDocumentSemanticMap({ original, semanticRevision: 3, profile });
  return { original, semanticMap };
}

function input(f: ReturnType<typeof fixture>, sectionIds: string[]): DocumentActivitySourceContextInput {
  return { ...f, sourceBinding: { original: structuredClone(f.original.binding), semanticRevision: 3 },
    selection: { sectionIds }, deliveredRanges: [] };
}

function page(f: ReturnType<typeof fixture>, sectionId: string, offset = 0, limit = 50): DocumentActivityDeliveryRange {
  const selected = selectDocumentSemanticSection(f.original, f.semanticMap, sectionId);
  const allowed = new Set([...selected.unitIds, ...selected.contextUnitIds]);
  const available = f.original.source.units.filter(unit => allowed.has(unit.unitId)).map(unit => unit.unitId);
  const unitIds = available.slice(offset, offset + limit);
  return { sectionId, offset, unitIds, anchorIds: unitIds.map(id => `anchor:${id}`),
    nextOffset: offset + unitIds.length < available.length ? offset + unitIds.length : null };
}

describe('actual-delivery document activity source context', () => {
  it.each([
    ['FTD', BOEING_FTD_SEMANTIC_PROFILE, 'Interim Action', 'ftd.interim_action'],
    ['SB', BOEING_AIRFRAME_SB_SEMANTIC_PROFILE, 'A. Effectivity', 'sb.effectivity'],
    ['generic', GENERIC_SEMANTIC_PROFILE, '作者原章：限制', null],
    ['unknown', { profileRef: 'unknown.manufacturer/章.v7', roles: [] }, 'Final Action', null],
  ] as const)('retains %s saved profile and author role without adding selection provenance', (_name, profile, title, roleKey) => {
    const f = fixture([[title, 1], ['None.']], profile as DocumentSemanticProfile);
    const i = input(f, ['section:u0']);
    i.deliveredRanges = [page(f, 'section:u0')];
    const result = buildDocumentActivitySourceContext(i);
    expect(result).toEqual({
      schemaVersion: 'wiselink.document.activity-source-context.v1', sourceBinding: i.sourceBinding,
      profile: { profileRef: profile.profileRef, selectionBasis: 'NOT_RECORDED', family: null, issuer: null },
      sections: [{ sectionId: 'section:u0', parentSectionId: null, titleRaw: title, roleKey,
        headingUnitId: 'u0', deliveredUnitIds: ['u0', 'u1'], contextForSectionIds: [] }], organizationWarnings: [],
    });
    expect(Object.keys(result.sections[0]).sort()).toEqual([
      'contextForSectionIds', 'deliveredUnitIds', 'headingUnitId', 'parentSectionId', 'roleKey', 'sectionId', 'titleRaw',
    ]);
  });

  it('does not classify a generic source from Boeing, FTD, SB or 787 mentions in its body', () => {
    const f = fixture([['Operator notes', 1], ['File 787_FTD_SB.pdf refers to Boeing 787 and other bulletins.']]);
    const i = input(f, ['section:u0']); i.deliveredRanges = [page(f, 'section:u0')];
    const result = buildDocumentActivitySourceContext(i);
    expect(result.profile).toEqual({ profileRef: 'generic.author-sections.v1', selectionBasis: 'NOT_RECORDED', family: null, issuer: null });
    expect(result.sections[0].roleKey).toBeNull();
    expect(JSON.stringify(result)).not.toContain('787');
  });

  it('connects actual ancestor prerequisite and exception units to their selected leaf receipt', () => {
    const f = fixture([
      ['1. Accomplishment Instructions', 1], ['Before installation obtain document X.'],
      ['For configuration B only; except aircraft with modification Z.'],
      ['Installation', 2], ['Install P/N A-12.'],
      ['Other work', 2], ['Do unrelated work.'],
    ], BOEING_AIRFRAME_SB_SEMANTIC_PROFILE);
    const i = input(f, ['section:u3']); i.deliveredRanges = [page(f, 'section:u3')];
    const result = buildDocumentActivitySourceContext(i);
    expect(result.sections).toEqual([
      { sectionId: 'section:u0', parentSectionId: null, titleRaw: '1. Accomplishment Instructions',
        roleKey: 'sb.accomplishment', headingUnitId: 'u0', deliveredUnitIds: ['u0', 'u1', 'u2'], contextForSectionIds: ['section:u3'] },
      { sectionId: 'section:u3', parentSectionId: 'section:u0', titleRaw: 'Installation', roleKey: null,
        headingUnitId: 'u3', deliveredUnitIds: ['u3', 'u4'], contextForSectionIds: [] },
    ]);
    expect(JSON.stringify(result)).not.toContain('Other work');
    expect(JSON.stringify(result)).not.toContain('Install P/N');
    expect(JSON.stringify(result)).not.toContain('configuration B');
  });

  it('preserves all delivered ancestor levels and exact selected-target identities', () => {
    const f = fixture([
      ['全局规则', 1], ['不得省略条件。'], ['Group A', 2], ['Obtain permission first.'],
      ['Leaf A', 3], ['Replace part.'], ['Leaf B', 3], ['Inspect part.'],
    ]);
    const i = input(f, ['section:u6', 'section:u4']);
    i.deliveredRanges = [page(f, 'section:u4'), page(f, 'section:u6')];
    const result = buildDocumentActivitySourceContext(i);
    expect(result.sections.filter(section => section.contextForSectionIds.length).map(section =>
      [section.sectionId, section.contextForSectionIds, section.deliveredUnitIds])).toEqual([
      ['section:u0', ['section:u6', 'section:u4'], ['u0', 'u1']],
      ['section:u2', ['section:u6', 'section:u4'], ['u2', 'u3']],
    ]);
  });

  it('never counts an ancestor present in the map as delivered when the READ starts at the leaf', () => {
    const f = fixture([['Parent condition', 1], ['Except configuration B.'], ['Leaf', 2], ['Do action.']]);
    const i = input(f, ['section:u2']); i.deliveredRanges = [page(f, 'section:u2', 2)];
    const result = buildDocumentActivitySourceContext(i);
    expect(result.sections).toEqual([{ sectionId: 'section:u2', parentSectionId: 'section:u0', titleRaw: 'Leaf',
      roleKey: null, headingUnitId: 'u2', deliveredUnitIds: ['u2', 'u3'], contextForSectionIds: [] }]);
    expect(result.sections.some(section => section.sectionId === 'section:u0')).toBe(false);
  });

  it('emits no title or heading identity when only section body was actually delivered', () => {
    const f = fixture([['Hidden title: mandatory procedure', 1], ['Delivered source body.'], ['Undelivered body.']]);
    const i = input(f, ['section:u0']); i.deliveredRanges = [page(f, 'section:u0', 1, 1)];
    const result = buildDocumentActivitySourceContext(i);
    expect(result.sections).toEqual([{ sectionId: 'section:u0', parentSectionId: null, titleRaw: null, roleKey: null,
      headingUnitId: null, deliveredUnitIds: ['u1'], contextForSectionIds: [] }]);
    expect(JSON.stringify(result)).not.toMatch(/Hidden title|Delivered source body|Undelivered body/u);
  });

  it('retains ancestor-body context even on a page without either ancestor or leaf heading', () => {
    const f = fixture([['Unreceived ancestor title', 1], ['Prerequisite and exception.'], ['Unreceived leaf title', 2], ['Action.']]);
    const i = input(f, ['section:u2']); i.deliveredRanges = [page(f, 'section:u2', 1, 1)];
    const result = buildDocumentActivitySourceContext(i);
    expect(result.sections).toEqual([{ sectionId: 'section:u0', parentSectionId: null, titleRaw: null, roleKey: null,
      headingUnitId: null, deliveredUnitIds: ['u1'], contextForSectionIds: ['section:u2'] }]);
    expect(JSON.stringify(result)).not.toMatch(/Unreceived ancestor title|Unreceived leaf title|Prerequisite and exception/u);
  });

  it('allows a heading-only page while omitting undelivered sibling sections and all body text', () => {
    const f = fixture([['Read heading', 1], ['Secret body.'], ['Unreceived heading', 1], ['Other body.']]);
    const i = input(f, ['section:u0']); i.deliveredRanges = [page(f, 'section:u0', 0, 1)];
    expect(buildDocumentActivitySourceContext(i).sections).toEqual([{ sectionId: 'section:u0', parentSectionId: null,
      titleRaw: 'Read heading', roleKey: null, headingUnitId: 'u0', deliveredUnitIds: ['u0'], contextForSectionIds: [] }]);
  });

  it('keeps page-varying scope bounded and stable shared metadata suitable for a downstream union', () => {
    const f = fixture([['Parent', 1], ['Prerequisite.'], ['Leaf', 2], ['Action.'], ['More action.']]);
    const i = input(f, ['section:u2']);
    const firstRange = page(f, 'section:u2', 0, 2), secondRange = page(f, 'section:u2', 2, 2), thirdRange = page(f, 'section:u2', 4, 1);
    const pages = [firstRange, secondRange, thirdRange].map(range => buildDocumentActivitySourceContext({ ...i, deliveredRanges: [range] }));
    const cumulative = buildDocumentActivitySourceContext({ ...i, deliveredRanges: [thirdRange, firstRange, secondRange] });
    for (const result of pages) {
      expect(result.sourceBinding).toEqual(cumulative.sourceBinding);
      expect(result.profile).toEqual(cumulative.profile);
      expect(result.schemaVersion).toBe(cumulative.schemaVersion);
    }
    expect(pages[2].sections[0]).toMatchObject({ titleRaw: null, headingUnitId: null, deliveredUnitIds: ['u4'] });
    expect(cumulative.sections.map(section => section.deliveredUnitIds)).toEqual([['u0', 'u1'], ['u2', 'u3', 'u4']]);
    expect(cumulative.sections[1].titleRaw).toBe('Leaf');
  });

  it('restricts organization-warning identifiers to actual supported units and sections', () => {
    const f = fixture([['Applicability', 2], ['All model X aircraft.', 2], ['Status', 2], ['Pending.']], BOEING_FTD_SEMANTIC_PROFILE);
    expect(f.semanticMap.organizationWarnings).toHaveLength(1);
    const i = input(f, ['section:u0']); i.deliveredRanges = [page(f, 'section:u0', 0, 1)];
    expect(buildDocumentActivitySourceContext(i).organizationWarnings).toEqual([
      { code: 'EMPTY_ROLE_FOLLOWED_BY_UNCLASSIFIED_HEADING', sectionIds: ['section:u0'], unitIds: ['u0'] },
    ]);
    i.deliveredRanges = [page(f, 'section:u0', 1, 1)];
    expect(buildDocumentActivitySourceContext(i).organizationWarnings).toEqual([
      { code: 'EMPTY_ROLE_FOLLOWED_BY_UNCLASSIFIED_HEADING', sectionIds: ['section:u1'], unitIds: ['u1'] },
    ]);
    const unconnected = input(f, ['section:u2']); unconnected.deliveredRanges = [page(f, 'section:u2')];
    expect(buildDocumentActivitySourceContext(unconnected).organizationWarnings).toEqual([]);
  });

  it('does not infer calendar dates, applicability or business status from technical-number source text', () => {
    const title = 'Line numbers 1998 through 2002 (inclusive), P/N 2026-10';
    const f = fixture([[title, 1], ['LN 2040; serial 2025; publication 2026-10; estimated work: 10 hours.']]);
    const before = structuredClone(f.original);
    const i = input(f, ['section:u0']); i.deliveredRanges = [page(f, 'section:u0')];
    const result = buildDocumentActivitySourceContext(i);
    expect(result.sections[0].titleRaw).toBe(title);
    expect(result.sections[0].roleKey).toBeNull();
    expect(result).not.toHaveProperty('times');
    expect(result).not.toHaveProperty('dateOrder');
    expect(result.sections[0]).not.toHaveProperty('status');
    expect(f.original).toEqual(before);
  });

  it.each([false, true])('preserves reordered multilingual authors and raw Unicode without normalization (reverse=%s)', reverse => {
    const rows: Array<[string, number?]> = [['運航者：処置 e\u0301\nＡ', 1], ['運航者は点検する。'], ['供应商：措施', 1], ['供应商预计提供修改。']];
    if (reverse) rows.splice(0, rows.length, ...rows.slice(2), ...rows.slice(0, 2));
    const f = fixture(rows, { profileRef: 'maker.multi-language.sections.v4', roles: [
      { roleKey: 'maker.operator', aliases: ['運航者：処置 e\u0301\nＡ'] }, { roleKey: 'maker.supplier', aliases: ['供应商：措施'] },
    ] });
    const i = input(f, ['section:u2', 'section:u0']); i.deliveredRanges = [page(f, 'section:u2'), page(f, 'section:u0')];
    const result = buildDocumentActivitySourceContext(i);
    expect(result.sections.map(section => [section.titleRaw, section.roleKey])).toEqual(f.semanticMap.sections.map(section => [section.titleRaw, section.roleKey]));
    const operator = result.sections.find(section => section.roleKey === 'maker.operator')!;
    expect(operator.titleRaw).toBe('運航者：処置 e\u0301\nＡ');
    expect(operator.titleRaw).not.toBe(operator.titleRaw!.normalize('NFKC'));
  });

  it('does not mutate inputs or share result arrays with the original, map, binding or receipts', () => {
    const f = fixture([['Author heading', 1], ['Source body.']]);
    const i = input(f, ['section:u0']); i.deliveredRanges = [page(f, 'section:u0')];
    const before = structuredClone(i), result = buildDocumentActivitySourceContext(i);
    expect(i).toEqual(before);
    result.sourceBinding.original.sourceArtifactId = 'changed';
    result.sections[0].deliveredUnitIds.push('invented'); result.sections[0].titleRaw = 'changed';
    expect(i).toEqual(before);
  });

  it('returns an empty delivery projection without treating the semantic map as a READ receipt', () => {
    const f = fixture([['Undelivered author title', 1], ['Unreceived body.']]);
    const result = buildDocumentActivitySourceContext(input(f, ['section:u0']));
    expect(result.sections).toEqual([]); expect(result.organizationWarnings).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('Undelivered author title');
  });

  it.each(['documentVersionId', 'parseRunId', 'parseRevision', 'sourceArtifactId', 'sourceSha256', 'sourceByteLength'] as const)(
    'rejects exact original binding drift in %s', key => {
      const f = fixture([['Title', 1], ['Body.']]), i = input(f, ['section:u0']);
      i.deliveredRanges = [page(f, 'section:u0')];
      if (typeof i.sourceBinding.original[key] === 'number') (i.sourceBinding.original as unknown as Record<string, unknown>)[key] = 999;
      else (i.sourceBinding.original as unknown as Record<string, unknown>)[key] = 'different';
      expect(() => buildDocumentActivitySourceContext(i)).toThrow('SOURCE_CONTEXT_BINDING_MISMATCH');
    },
  );

  it('rejects semantic revision drift, map/original binding drift, and altered saved heading text', () => {
    const f = fixture([['Original title', 1], ['Body.']]), i = input(f, ['section:u0']); i.deliveredRanges = [page(f, 'section:u0')];
    expect(() => buildDocumentActivitySourceContext({ ...i, sourceBinding: { ...i.sourceBinding, semanticRevision: 4 } })).toThrow('BINDING_MISMATCH');
    const wrongMap = structuredClone(i.semanticMap); wrongMap.binding.sourceSha256 = 'b'.repeat(64);
    expect(() => buildDocumentActivitySourceContext({ ...i, semanticMap: wrongMap })).toThrow('BINDING_MISMATCH');
    const changedText = structuredClone(i.original); changedText.source.units[0].payload.text = 'Rewritten title';
    expect(() => buildDocumentActivitySourceContext({ ...i, original: changedText })).toThrow('SEMANTIC_HEADING_INVALID');
    const extraBinding = { ...i.sourceBinding.original, unexpectedSource: 'other' };
    expect(() => buildDocumentActivitySourceContext({ ...i, sourceBinding: { ...i.sourceBinding, original: extraBinding } })).toThrow('BINDING_MISMATCH');
    const undefinedExtraBinding = { ...i.sourceBinding.original, unexpectedSource: undefined };
    expect(() => buildDocumentActivitySourceContext({ ...i, sourceBinding: { ...i.sourceBinding, original: undefinedExtraBinding } })).toThrow('BINDING_MISMATCH');
  });

  it('rejects absent, duplicate or drifted selection section identities', () => {
    const f = fixture([['Selected', 1], ['Body.'], ['Sibling', 1], ['Other.']]), i = input(f, ['section:u0']);
    i.deliveredRanges = [page(f, 'section:u0')];
    for (const sectionIds of [[], ['missing'], ['section:u0', 'section:u0']])
      expect(() => buildDocumentActivitySourceContext({ ...i, selection: { sectionIds } })).toThrow('SELECTION_INVALID');
    expect(() => buildDocumentActivitySourceContext({ ...i, deliveredRanges: [page(f, 'section:u2')] })).toThrow('DELIVERY_RANGE_INVALID');
  });

  it.each(['missing', 'sibling', 'reordered', 'offset', 'nextOffset', 'duplicate', 'empty'])(
    'rejects %s delivery-inventory drift', change => {
      const f = fixture([['Selected', 1], ['Body.'], ['Sibling', 1], ['Other.']]), i = input(f, ['section:u0']);
      const range = page(f, 'section:u0');
      if (change === 'missing') range.unitIds[1] = 'not-an-original-unit';
      if (change === 'sibling') range.unitIds[1] = 'u3';
      if (change === 'reordered') range.unitIds.reverse();
      if (change === 'offset') range.offset = 1;
      if (change === 'nextOffset') range.nextOffset = 2;
      if (change === 'duplicate') range.unitIds = ['u0', 'u0'];
      if (change === 'empty') range.unitIds = [];
      expect(() => buildDocumentActivitySourceContext({ ...i, deliveredRanges: [range] })).toThrow('SOURCE_CONTEXT_DELIVERY_RANGE');
    },
  );

  it('rejects repeated page identities and invalid saved ancestry rather than inventing a repair', () => {
    const f = fixture([['Title', 1], ['Body.']]), i = input(f, ['section:u0']); const range = page(f, 'section:u0');
    expect(() => buildDocumentActivitySourceContext({ ...i, deliveredRanges: [range, structuredClone(range)] })).toThrow('DELIVERY_RANGE_DUPLICATE');
    const wrongMap = structuredClone(i.semanticMap); wrongMap.sections[0].parentSectionId = 'section:u0';
    expect(() => buildDocumentActivitySourceContext({ ...i, semanticMap: wrongMap })).toThrow('SEMANTIC_PARENT_INVALID');
  });
});

describe('exact saved template selection provenance', () => {
  it('copies a historical receipt without relabeling its policy, reason, identity or unfamiliar profile', () => {
    const f = fixture([['Delivered author section', 1], ['Exact body.'], ['Unreceived section', 1], ['Other body.']]);
    f.semanticMap.profileRef = 'historical.unfamiliar-template.v3';
    f.semanticMap.profileSelection = {
      policyVersion: 'host-family-original-headings.v1', reason: 'REGISTERED_FAMILY_ISSUER',
      registeredIdentity: { family: ' sb ', issuer: ' Boeing ' },
      evidenceSourceRefIds: [f.original.source.sourceLocators[0].sourceRefId],
    };
    const before = JSON.stringify(f);
    const i = input(f, ['section:u0']); i.deliveredRanges = [page(f, 'section:u0', 1, 1)];
    const result = buildDocumentActivitySourceContext(i);
    expect(result.profile).toEqual({
      profileRef: 'historical.unfamiliar-template.v3', selectionBasis: 'RECORDED',
      selectionSchemaVersion: 'wiselink.document.semantic-profile-selection.v1', selection: f.semanticMap.profileSelection,
    });
    expect(result.sections.flatMap(section => section.deliveredUnitIds)).toEqual(['u1']);
    expect(Object.keys(result.profile).sort()).toEqual(['profileRef', 'selection', 'selectionBasis', 'selectionSchemaVersion']);
    expect(JSON.stringify(f)).toBe(before);
    if (result.profile.selectionBasis === 'RECORDED') result.profile.selection.registeredIdentity.issuer = 'mutated result';
    expect(JSON.stringify(f)).toBe(before);
  });

  it('preserves recorded unknown and explicit OTHER decisions rather than inferring from the profile name', () => {
    const f = fixture([['Service Bulletin', 1], ['Boeing 787.']]);
    f.semanticMap.profileSelection = {
      policyVersion: 'registered-metadata-existing-dispatch.v1', reason: 'UNSUPPORTED_FAMILY',
      registeredIdentity: { family: 'OTHER', issuer: null }, evidenceSourceRefIds: [],
    };
    const i = input(f, ['section:u0']); i.deliveredRanges = [page(f, 'section:u0')];
    expect(buildDocumentActivitySourceContext(i).profile).toMatchObject({
      selectionBasis: 'RECORDED', selection: { registeredIdentity: { family: 'OTHER', issuer: null }, reason: 'UNSUPPORTED_FAMILY' },
    });
  });

  it('rejects invented receipt fields before source-context delivery', () => {
    const f = fixture([['Heading', 1], ['Body']]);
    f.semanticMap.profileSelection = {
      policyVersion: 'registered-metadata-existing-dispatch.v1', reason: 'UNKNOWN_FAMILY',
      registeredIdentity: { family: null, issuer: null }, evidenceSourceRefIds: [],
      authority: 'PUBLISHER_CONFIRMED',
    } as never;
    expect(() => buildDocumentActivitySourceContext(input(f, ['section:u0']))).toThrow('SEMANTIC_PROFILE_SELECTION_INVALID');
  });
});
