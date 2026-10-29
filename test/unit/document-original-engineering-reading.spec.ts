import * as sourcePlanning from '../../server/modules/canonical-host/canonical-translation-source-plan';
import * as adapter from '../../server/modules/document-management/src/hosted/nest/document-original-adapter';
import { buildDocumentSemanticMap } from '../../server/modules/document-management/src/hosted/nest/document-semantic-map';
import { GENERIC_SEMANTIC_PROFILE } from '../../server/modules/document-management/src/hosted/nest/document-semantic-profile';
import {
  documentOriginalEngineeringReading,
  findDocumentOriginalEvidence,
  prepareDocumentOriginalEngineeringReader,
  prepareDocumentOriginalEvidenceFinder,
} from '../../server/modules/canonical-host/document-original-engineering-reading';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';
import { expandJobAidSourceSelection } from '../../server/modules/canonical-host/jobaid-problem-task';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';

function fixture() {
  const original = originalFixture();
  return { original, structuredSource: original.source, run: {
    documentVersionId: original.binding.documentVersionId, parseRunId: original.binding.parseRunId,
    parseRevision: original.binding.parseRevision,
    manifestArtifact: { relativePath: 'original/manifest.json', readback: 'VERIFIED',
      sha256: 'b'.repeat(64), byteLength: 100, mediaType: 'application/json' },
  } } as Parameters<typeof documentOriginalEngineeringReading>[0];
}

function pageFixture(pageStart: number) {
  const loaded = fixture();
  const source = loaded.structuredSource;
  source.sourceLocators[0] = { ...source.sourceLocators[0], pageStart, pageEnd: pageStart,
    normalizedPath: 'body/main', xpath: '/body/p[1]' };
  source.sourceLocators[1] = { ...source.sourceLocators[1], pageStart: 1 - pageStart, pageEnd: 1 - pageStart };
  const sourceRefId = 'SR-TEST-FOOTNOTE';
  source.units.push({ ...source.units[0], unitId: 'footnote', order: 2,
    sourceRefIds: [sourceRefId], sourceSegmentIds: [sourceRefId],
    payload: { text: 'Footnote: retain this exception only while condition X holds.' } });
  source.sourceLocators.push({ ...source.sourceLocators[0], sourceRefId,
    normalizedPath: 'body/footnote', xpath: '/body/aside[1]' });
  loaded.original.locations[0].pageIndex = pageStart;
  loaded.original.locations[1].pageIndex = 1 - pageStart;
  loaded.original.locations.push({ ...loaded.original.locations[0], sourceRefId });
  return loaded;
}

describe('JobAid PAGE selection of engineering original evidence', () => {
  it.each([0, 1])('expands actual reader locators to distinct blocks and footnotes on page %s', pageStart => {
    const loaded = pageFixture(pageStart);
    const catalog = prepareDocumentOriginalEngineeringReader(loaded)(0, 20).evidence;
    const main = catalog.find(item => item.sourceRefId === 'SR-TEST-P1')!;
    const note = catalog.find(item => item.sourceRefId === 'SR-TEST-FOOTNOTE')!;
    expect(JSON.parse(main.locator)).toMatchObject({ pageStart, sourceRefId: main.sourceRefId, xpath: '/body/p[1]' });
    expect(JSON.parse(note.locator)).toMatchObject({ pageStart, sourceRefId: note.sourceRefId, xpath: '/body/aside[1]' });
    const before = structuredClone(catalog);
    const selected = expandJobAidSourceSelection(catalog, [note.evidenceRef, main.evidenceRef], 'PAGE');
    expect(selected).toEqual([main, note]);
    expect(new Set(selected.map(item => item.evidenceRef)).size).toBe(selected.length);
    const oneBlock = expandJobAidSourceSelection(catalog, [main.evidenceRef], 'PAGE');
    expect(oneBlock).toEqual([main, note]);
    oneBlock[0].excerpt = 'Caller mutation';
    expect(catalog).toEqual(before);
    expect(expandJobAidSourceSelection(catalog, [note.evidenceRef, main.evidenceRef], 'EXACT')).toEqual([note, main]);
  });

  it('isolates other documents, parses and pages while retaining explicitly selected non-page evidence', () => {
    const loaded = pageFixture(0);
    const mainCatalog = prepareDocumentOriginalEngineeringReader(loaded)(0, 20).evidence;
    const otherDocument = pageFixture(0);
    otherDocument.run.documentVersionId = otherDocument.original.binding.documentVersionId = 'DV-OTHER';
    const otherParse = pageFixture(0);
    otherParse.run.parseRunId = otherParse.original.binding.parseRunId = 'PR-OTHER';
    const method: AssessmentEvidence = { evidenceRef: 'method:page-selection', kind: 'METHOD_CLAUSE',
      title: 'Constructed method', versionLabel: null, excerpt: 'Retained explicit method',
      packRef: 'pack', methodRef: 'method', sourceIdentity: 'constructed-method',
      locator: 'clause 1', sourceVersionStatus: 'VERSION_UNCONFIRMED' };
    const catalog = [...mainCatalog, ...prepareDocumentOriginalEngineeringReader(otherDocument)(0, 20).evidence,
      ...prepareDocumentOriginalEngineeringReader(otherParse)(0, 20).evidence, method];
    const main = mainCatalog.find(item => item.sourceRefId === 'SR-TEST-P1')!;
    const note = mainCatalog.find(item => item.sourceRefId === 'SR-TEST-FOOTNOTE')!;
    expect(expandJobAidSourceSelection(catalog, [method.evidenceRef, main.evidenceRef], 'PAGE')).toEqual([main, note, method]);
    expect(expandJobAidSourceSelection(catalog, [main.evidenceRef], 'EXACT')).toEqual([main]);
  });

  it.each([
    ['malformed', '{"pageStart":'], ['array', '[]'],
    ['null', 'null'], ['boolean', 'true'], ['number', '0'], ['quoted text', '"bad"'],
    ['blank', ' \n '], ['malformed quoted text', '"bad'],
    ['missing page', JSON.stringify({ parseRunId: 'PR-TEST-2', sourceRefId: 'SR-TEST-P1' })],
    ['negative page', JSON.stringify({ parseRunId: 'PR-TEST-2', sourceRefId: 'SR-TEST-P1', pageStart: -1 })],
    ['fractional page', JSON.stringify({ parseRunId: 'PR-TEST-2', sourceRefId: 'SR-TEST-P1', pageStart: 0.5 })],
    ['unsafe page', JSON.stringify({ parseRunId: 'PR-TEST-2', sourceRefId: 'SR-TEST-P1', pageStart: Number.MAX_SAFE_INTEGER + 1 })],
    ['string page', JSON.stringify({ parseRunId: 'PR-TEST-2', sourceRefId: 'SR-TEST-P1', pageStart: '0' })],
    ['foreign parse', JSON.stringify({ parseRunId: 'PR-OTHER', sourceRefId: 'SR-TEST-P1', pageStart: 0 })],
    ['foreign ref', JSON.stringify({ parseRunId: 'PR-TEST-2', sourceRefId: 'SR-OTHER', pageStart: 0 })],
  ])('rejects a selected %s locator; EXACT remains available', (_label, locator) => {
    const [main] = prepareDocumentOriginalEngineeringReader(pageFixture(0))(0, 20).evidence;
    const bad = { ...main, locator };
    expect(() => expandJobAidSourceSelection([bad], [bad.evidenceRef], 'PAGE')).toThrow('JOBAID_SOURCE_PAGE_LOCATOR_INVALID');
    expect(expandJobAidSourceSelection([bad], [bad.evidenceRef], 'EXACT')).toEqual([bad]);
  });

  it('rejects selected version or original binding drift and skips unrelated invalid structured locators', () => {
    const catalog = prepareDocumentOriginalEngineeringReader(pageFixture(0))(0, 20).evidence;
    const [main, otherPage, note] = catalog;
    for (const bad of [{ ...main, versionLabel: 'PR-OTHER' }, { ...main, documentVersionId: 'DV-OTHER' }]) {
      expect(() => expandJobAidSourceSelection([bad], [bad.evidenceRef], 'PAGE')).toThrow('JOBAID_SOURCE_PAGE_LOCATOR_INVALID');
    }
    for (const locator of ['{"pageStart":', 'null', 'true', '0', '"bad"', ' \n ']) {
      const invalid = { ...otherPage, locator };
      expect(expandJobAidSourceSelection([main, invalid, note], [main.evidenceRef], 'PAGE')).toEqual([main, note]);
    }
  });

  it('keeps legacy text locator revision isolation and the existing selection limits', () => {
    const [main] = prepareDocumentOriginalEngineeringReader(pageFixture(0))(0, 20).evidence;
    const legacy = { ...main, locator: 'page 1' };
    const samePage = { ...legacy, evidenceRef: 'DOCUMENT_ORIGINAL:DV-TEST:PR-TEST-2:SR-SAME', sourceRefId: 'SR-SAME' };
    const previousParse = { ...samePage, evidenceRef: 'DOCUMENT_ORIGINAL:DV-TEST:PR-OLD:SR-SAME', versionLabel: 'PR-OLD' };
    const otherDocument = { ...samePage, evidenceRef: 'DOCUMENT_ORIGINAL:DV-OTHER:PR-TEST-2:SR-SAME', documentVersionId: 'DV-OTHER' };
    const catalog = [legacy, samePage, previousParse, otherDocument];
    expect(expandJobAidSourceSelection(catalog, [legacy.evidenceRef], 'PAGE')).toEqual([legacy, samePage]);
    expect(() => expandJobAidSourceSelection(catalog, ['unregistered'], 'PAGE')).toThrow('JOBAID_SOURCE_NOT_REGISTERED');
    expect(() => expandJobAidSourceSelection(catalog, [], 'PAGE')).toThrow('JOBAID_SOURCE_SELECTION_INVALID');
    expect(() => expandJobAidSourceSelection(catalog, [legacy.evidenceRef, legacy.evidenceRef], 'PAGE')).toThrow('JOBAID_SOURCE_SELECTION_INVALID');
    const many = Array.from({ length: 97 }, (_, index) => ({ ...legacy,
      evidenceRef: `DOCUMENT_ORIGINAL:DV-TEST:PR-TEST-2:SR-${index}`, sourceRefId: `SR-${index}` }));
    expect(expandJobAidSourceSelection(many, many.slice(0, 96).map(item => item.evidenceRef), 'PAGE')).toHaveLength(97);
    expect(() => expandJobAidSourceSelection(many, many.map(item => item.evidenceRef), 'PAGE')).toThrow('JOBAID_SOURCE_SELECTION_INVALID');
  });
});

describe('engineering original evidence', () => {
  it('retains long original text, table content and honest coverage across pages', () => {
    const loaded = fixture();
    const first = documentOriginalEngineeringReading(loaded, 0, 1);
    expect(first.evidence[0].excerpt).toEqual(loaded.original.source.units[0].payload.text);
    expect(first.evidence[0].workItemId).toBeNull();
    expect(first.nextOffset).toBe(1);
    expect(first.coverage.unresolvedRanges).toHaveLength(2);
    const second = documentOriginalEngineeringReading(loaded, 1, 1);
    expect(second.evidence[0].excerpt).toContain('12 kPa');
    expect(second.evidence[0].excerpt).toContain('Only when X');
    expect(second.nextOffset).toBeNull();
    expect(second.sourceRefs).toEqual(second.evidence.map(item => item.evidenceRef));
  });

  it('gives one locator identical complete evidence when it spans multiple units', () => {
    const loaded = fixture();
    loaded.structuredSource.units.push({ ...loaded.structuredSource.units[0], unitId: 'u3', order: 2,
      payload: { text: 'Retained exception from the same source locator.' } });
    const first = documentOriginalEngineeringReading(loaded, 0, 1);
    const last = documentOriginalEngineeringReading(loaded, 2, 1);
    expect(first.evidence).toEqual(last.evidence);
    expect(first.evidence[0].excerpt).toContain('Retained exception');
  });

  it('rejects drifted manifest binding and invalid offsets', () => {
    const loaded = fixture();
    expect(() => documentOriginalEngineeringReading(loaded, -1, 1)).toThrow('RANGE_INVALID');
    loaded.run.parseRunId = 'different';
    expect(() => documentOriginalEngineeringReading(loaded, 0, 1)).toThrow('BINDING_INVALID');
  });
});

it('returns only source findings bound to the selected original range, keeping diagnostics out of engineering input', () => {
  const loaded = fixture();
  loaded.structuredSource.findings = [
    { findingId: 'diagnostic', code: 'TEXT_CONFLICT', message: 'internal diagnostic', severity: 'warning',
      readingImpact: 'DIAGNOSTIC', affectedUnitIds: ['u1'], sourceRefIds: [] },
    { findingId: 'unlocated', code: 'UNKNOWN', message: 'no specific location', severity: 'warning',
      affectedUnitIds: [], sourceRefIds: [] },
    { findingId: 'local', code: 'STRUCTURE_UNCERTAIN', message: 'local table limit', severity: 'warning',
      readingImpact: 'LIMITATION', affectedUnitIds: ['u2'], sourceRefIds: [] },
  ];
  expect(documentOriginalEngineeringReading(loaded, 0, 1).findings).toEqual([]);
  expect(documentOriginalEngineeringReading(loaded, 1, 1).findings.map(finding => finding.findingId)).toEqual(['local']);
});


it('prepares plan/coverage once, keeps cross-page quotes complete, and detaches returned mutable coverage/evidence', () => {
  const loaded = fixture();
  loaded.structuredSource.units.push({ ...loaded.structuredSource.units[0], unitId: 'u3', order: 2,
    payload: { text: 'Retained final exception for the same locator.' } });
  const before = structuredClone(loaded);
  const plan = jest.spyOn(sourcePlanning, 'buildTranslationSourcePlan');
  const coverage = jest.spyOn(adapter, 'documentOriginalReadingCoverage');
  try {
    const read = prepareDocumentOriginalEngineeringReader(loaded);
    const first = read(0, 1);
    const expected = structuredClone(first.evidence);
    first.evidence[0].excerpt = 'Caller changed its returned evidence.';
    first.coverage.unresolvedRanges.length = 0;
    const table = read(1, 1);
    const last = read(2, 1);
    expect(last.evidence).toEqual(expected);
    expect(last.evidence[0].excerpt).toContain('Retained final exception');
    expect(last.coverage.unresolvedRanges).toHaveLength(2);
    expect(table.evidence[0].excerpt).toContain('12 kPa');
    expect(table.sourceLocators.map(locator => locator.sourceRefId)).toEqual(['SR-TEST-P2']);
    expect(last.nextOffset).toBeNull();
    expect(read(3, 20).evidence).toEqual([]);
    expect(() => read(0, 21)).toThrow('RANGE_INVALID');
    expect(() => read(-1, 1)).toThrow('RANGE_INVALID');
    expect(plan).toHaveBeenCalledTimes(1);
    expect(coverage).toHaveBeenCalledTimes(1);
    expect(loaded).toEqual(before);
  } finally { plan.mockRestore(); coverage.mockRestore(); }
});

it('each separately loaded original prepares its own exact content, with no cross-request plan cache', () => {
  const first = fixture(); const second = fixture();
  second.original.source.units[0].payload.text = 'New independently loaded source content.';
  const originalRead = prepareDocumentOriginalEngineeringReader(first);
  const changedRead = prepareDocumentOriginalEngineeringReader(second);
  expect(originalRead(0, 1).evidence[0].excerpt).toContain('Do not use method M');
  expect(changedRead(0, 1).evidence[0].excerpt).toBe('New independently loaded source content.');
  const invalid = fixture(); invalid.run.parseRunId = 'another-parse';
  expect(() => prepareDocumentOriginalEngineeringReader(invalid)).toThrow('BINDING_INVALID');
});

it('reuses one exact finder plan across refs without sharing source state or mutable evidence', () => {
  const loaded = fixture();
  loaded.structuredSource.units.push({ ...loaded.structuredSource.units[0], unitId: 'u3', order: 2,
    payload: { text: 'Final condition from the same locator stays in its complete quote.' } });
  const before = structuredClone(loaded);
  const refs = loaded.structuredSource.sourceLocators.map(locator => locator.sourceRefId);
  const expected = refs.map(ref => findDocumentOriginalEvidence(loaded, ref));
  const plan = jest.spyOn(sourcePlanning, 'buildTranslationSourcePlan');
  const coverage = jest.spyOn(adapter, 'documentOriginalReadingCoverage');
  try {
    const find = prepareDocumentOriginalEvidenceFinder(loaded);
    expect(refs.map(find)).toEqual(expected);
    const first = find(refs[0]);
    first.excerpt = 'Caller changed its returned evidence.';
    first.locator = 'Caller changed its returned locator.';
    expect(find(refs[0])).toEqual(expected[0]);
    expect(find(refs[1])).toEqual(expected[1]);
    expect(() => find('SR-UNKNOWN')).toThrow('DOCUMENT_ORIGINAL_SOURCE_LOCATOR_MISSING');
    expect(plan).toHaveBeenCalledTimes(1);
    expect(coverage).toHaveBeenCalledTimes(1);
    expect(loaded).toEqual(before);

    // Even the same exact identity in a later authorization gets a fresh
    // projection of the source actually loaded in that request.
    const separatelyLoaded = structuredClone(loaded);
    separatelyLoaded.structuredSource.units[0].payload.text = 'Separately loaded exact text.';
    const fresh = prepareDocumentOriginalEvidenceFinder(separatelyLoaded);
    expect(fresh(refs[0]).excerpt).toContain('Separately loaded exact text.');
    expect(find(refs[0])).toEqual(expected[0]);
    expect(plan).toHaveBeenCalledTimes(2);
    expect(coverage).toHaveBeenCalledTimes(2);
  } finally { plan.mockRestore(); coverage.mockRestore(); }
});

it('keeps point evidence identical to range evidence with reversed and repeated refs', () => {
  const loaded = fixture();
  loaded.structuredSource.units[0].sourceRefIds = ['SR-TEST-P2', 'SR-TEST-P1', 'SR-TEST-P2'];
  const read = prepareDocumentOriginalEngineeringReader(loaded);
  const range = read(0, 1);
  const find = prepareDocumentOriginalEvidenceFinder(loaded);
  expect(range.evidence.map(item => item.sourceRefId)).toEqual(['SR-TEST-P2', 'SR-TEST-P1']);
  expect(range.sourceLocators.map(item => item.sourceRefId)).toEqual(['SR-TEST-P1', 'SR-TEST-P2']);
  for (const evidence of range.evidence) expect(find(evidence.sourceRefId)).toEqual(evidence);
  expect(find('SR-TEST-P2').excerpt).toBe([
    loaded.structuredSource.units[0].payload.text,
    loaded.structuredSource.units[0].payload.text,
    'Pressure', '12 kPa', 'Only when X',
  ].join('\n'));
  expect(read(1, 1).evidence[0]).toEqual(find('SR-TEST-P2'));
  expect(() => find('SR-UNKNOWN')).toThrow('DOCUMENT_ORIGINAL_SOURCE_LOCATOR_MISSING');
});

it('retains range rejection when another ref in the first matching unit is invalid', () => {
  const loaded = fixture();
  const longRef = 'R'.repeat(513);
  loaded.structuredSource.units[0].sourceRefIds = [longRef];
  loaded.structuredSource.units[0].payload.metadata = { sourceRefIds: ['SR-TEST-P1'] };
  loaded.structuredSource.units.push({ ...loaded.structuredSource.units[0], unitId: 'u3', order: 2,
    sourceRefIds: ['SR-TEST-P1'], payload: { text: 'Readable child with the requested ref.' } });
  loaded.structuredSource.sourceLocators.push({ ...loaded.structuredSource.sourceLocators[0], sourceRefId: longRef });
  loaded.original.locations.push({ ...loaded.original.locations[0], sourceRefId: longRef });
  expect(() => documentOriginalEngineeringReading(loaded, 0, 1)).toThrow('DOCUMENT_ORIGINAL_SOURCE_REF_TOO_LONG');
  expect(() => prepareDocumentOriginalEvidenceFinder(loaded)('SR-TEST-P1'))
    .toThrow('DOCUMENT_ORIGINAL_SOURCE_REF_TOO_LONG');
});

it('keeps the missing anchor locator error in point and range reads', () => {
  const loaded = fixture();
  loaded.structuredSource.sourceLocators.shift();
  expect(() => documentOriginalEngineeringReading(loaded, 0, 1))
    .toThrow('TRANSLATION_PLAN_SOURCE_LOCATOR_MISSING');
  expect(() => prepareDocumentOriginalEvidenceFinder(loaded)('SR-TEST-P1'))
    .toThrow('TRANSLATION_PLAN_SOURCE_LOCATOR_MISSING');
});

it('finds 6483 exact refs without re-filtering every locator or finding for each ref', () => {
  const loaded = fixture();
  const sample = loaded.structuredSource.units[0];
  const location = loaded.structuredSource.sourceLocators[0];
  const count = 6483;
  const refs = Array.from({ length: count }, (_, index) => `SR-SYNTHETIC-${index}`);
  loaded.structuredSource.units = refs.map((ref, index) => ({ ...sample,
    unitId: `synthetic-${index}`, kind: 'heading', order: index,
    sourceRefIds: [ref], sourceSegmentIds: [`segment-${index}`],
    payload: { text: `Synthetic heading ${index}`, level: 1 },
  }));
  loaded.structuredSource.sourceLocators = refs.map(ref => ({ ...location, sourceRefId: ref }));
  loaded.structuredSource.findings = [];
  loaded.original.locations = refs.map(ref => ({ ...loaded.original.locations[0], sourceRefId: ref }));
  loaded.original.coverage = { knownPageCount: 1, readPageIndexes: [0], unresolvedRanges: [] };
  const find = prepareDocumentOriginalEvidenceFinder(loaded);
  expect(find(refs[0])).toEqual(prepareDocumentOriginalEngineeringReader(loaded)(0, 1).evidence[0]);
  const locatorFilter = jest.spyOn(loaded.structuredSource.sourceLocators, 'filter');
  const findingFilter = jest.spyOn(loaded.structuredSource.findings, 'filter');
  try {
    const evidence = refs.map(find);
    expect(evidence).toHaveLength(count);
    expect(evidence[count - 1].sourceRefId).toBe(refs[count - 1]);
    expect(new Set(evidence.map(item => item.evidenceRef)).size).toBe(count);
    expect(locatorFilter).not.toHaveBeenCalled();
    expect(findingFilter).not.toHaveBeenCalled();
  } finally { locatorFilter.mockRestore(); findingFilter.mockRestore(); }
});

it('keeps semantic revisions scoped to their prepared reader and rejects a foreign source binding', () => {
  const loaded = fixture();
  const firstMap = buildDocumentSemanticMap({ original: loaded.original, profile: GENERIC_SEMANTIC_PROFILE, semanticRevision: 1 });
  const secondMap = buildDocumentSemanticMap({ original: loaded.original, profile: GENERIC_SEMANTIC_PROFILE, semanticRevision: 2 });
  const first = prepareDocumentOriginalEngineeringReader(loaded, firstMap);
  const second = prepareDocumentOriginalEngineeringReader(loaded, secondMap);
  expect(first(0, 1).semanticMap?.semanticRevision).toBe(1);
  expect(second(0, 1).semanticMap?.semanticRevision).toBe(2);
  const other = fixture(); other.original.binding.parseRunId = 'other-parse'; other.run.parseRunId = 'other-parse';
  expect(() => prepareDocumentOriginalEngineeringReader(other, firstMap)).toThrow();
});


const FAA_PARSE_RUN = 'PRUN-9db7cac3-dc21-4b9d-a682-1b40edb3406e';
const FAA_DOCUMENT_VERSION = 'document_version_0cda181990c250d381d08c7c';
// Minimal real shapes/text from the accepted FAA AD 2026-05-01 original. Omitted
// surrounding units do not alter the exact parent/child ownership or source refs.
const FAA_LIST_CASES = [
  { blockId: 'page-1-block-1', pageIndex: 0, order: 0, texts: [
    '[Federal Register, Volume 91 Number 48 (Thursday, March 12, 2026)]',
    '[Rules and Regulations]', '[Pages 12068-12071]',
    'From the Federal Register Online via the Government Publishing Office [www.gpo.gov]',
    '[FR Doc No: 2026-04832]',
  ] },
  { blockId: 'page-2-block-6', pageIndex: 1, order: 27, texts: [
    'Michael Closson, Aviation Safety Engineer, FAA, 2200 South 216th St., Des Moines, WA 98198;',
    'phone: 206-231-3973; email: Michael.P.Closson@faa.gov.',
  ] },
];

function faaListFixture(sample: typeof FAA_LIST_CASES[number]) {
  const loaded = fixture();
  Object.assign(loaded.original.binding, { documentVersionId: FAA_DOCUMENT_VERSION, parseRunId: FAA_PARSE_RUN, parseRevision: 1 });
  Object.assign(loaded.run, { documentVersionId: FAA_DOCUMENT_VERSION, parseRunId: FAA_PARSE_RUN, parseRevision: 1 });
  const sourceRefId = `${FAA_PARSE_RUN}:${sample.blockId}:source`;
  const parentId = `${FAA_PARSE_RUN}:${sample.blockId}`;
  const items = sample.texts.map((text, index) => ({
    unitId: `${parentId}:item${index}`, kind: 'list_item', moduleId: 'body', parentUnitId: parentId,
    order: sample.order + index + 1, depth: 1, continuityKey: sample.blockId,
    sourceRefIds: [sourceRefId], sourceSegmentIds: [sourceRefId], mapping: { itemIndex: index }, payload: { text },
  }));
  loaded.structuredSource.units = [{ unitId: parentId, kind: 'list', moduleId: 'body', parentUnitId: null,
    order: sample.order, depth: 0, continuityKey: sample.blockId, sourceRefIds: [sourceRefId],
    sourceSegmentIds: [sourceRefId], mapping: {}, payload: { originalBlockType: 'list',
      rawMineruContent: { list_type: 'text_list', list_items: sample.texts.map(text => ({ text })) },
      itemUnitIds: items.map(item => item.unitId) } }, ...items];
  loaded.structuredSource.sourceLocators = [{ ...loaded.structuredSource.sourceLocators[0], sourceRefId,
    pageStart: sample.pageIndex, pageEnd: sample.pageIndex }];
  loaded.original.locations = [{ ...loaded.original.locations[0], sourceRefId, pageIndex: sample.pageIndex }];
  loaded.original.coverage = { knownPageCount: 2, readPageIndexes: [sample.pageIndex], unresolvedRanges: [
    { pageIndexes: [1 - sample.pageIndex], unitIds: [], reason: 'UNREAD', message: 'Other page omitted from this small regression fixture.' },
  ] };
  return { loaded, sourceRefId };
}

describe('exact original evidence lookup', () => {
  it.each(FAA_LIST_CASES)('reads $blockId child anchors when its list container owns the first matching ref', sample => {
    const { loaded, sourceRefId } = faaListFixture(sample);
    expect(documentOriginalEngineeringReading(loaded, 0, 1).evidence).toEqual([]);
    const expected = documentOriginalEngineeringReading(loaded, 1, 1).evidence;
    const before = structuredClone(loaded);
    const plan = jest.spyOn(sourcePlanning, 'buildTranslationSourcePlan');
    try {
      const evidence = findDocumentOriginalEvidence(loaded, sourceRefId);
      expect(evidence).toEqual(expected[0]);
      expect(evidence.excerpt).toBe(sample.texts.join('\n'));
      expect(evidence.documentVersionId).toBe(FAA_DOCUMENT_VERSION);
      expect(evidence.versionLabel).toBe(FAA_PARSE_RUN);
      expect(evidence.sourceRefId).toBe(sourceRefId);
      expect(evidence.evidenceRef).toBe(`DOCUMENT_ORIGINAL:${FAA_DOCUMENT_VERSION}:${FAA_PARSE_RUN}:${sourceRefId}`);
      expect(evidence.workItemId).toBeNull();
      expect(plan).toHaveBeenCalledTimes(1);
      expect(loaded).toEqual(before);
      plan.mockClear();
      const find = prepareDocumentOriginalEvidenceFinder(loaded);
      expect(find(sourceRefId)).toEqual(evidence);
      expect(find(sourceRefId)).toEqual(evidence);
      expect(plan).toHaveBeenCalledTimes(1);
      expect(loaded).toEqual(before);
    } finally { plan.mockRestore(); }
  });

  it('returns the one complete quote for a ref shared by multiple readable units', () => {
    const loaded = fixture();
    loaded.structuredSource.units.push({ ...loaded.structuredSource.units[0], unitId: 'u3', order: 2,
      payload: { text: 'Same locator, independently retained final condition.' } });
    const evidence = findDocumentOriginalEvidence(loaded, 'SR-TEST-P1');
    expect(evidence).toEqual(documentOriginalEngineeringReading(loaded, 2, 1).evidence[0]);
    expect(evidence.excerpt).toBe([loaded.structuredSource.units[0].payload.text,
      loaded.structuredSource.units[2].payload.text].join('\n'));
  });

  it.each([false, true])('rejects duplicate locators even when their coordinates conflict=%s', conflict => {
    const loaded = fixture();
    loaded.structuredSource.sourceLocators.push({ ...loaded.structuredSource.sourceLocators[0],
      pageStart: conflict ? 1 : 0 });
    expect(() => findDocumentOriginalEvidence(loaded, 'SR-TEST-P1')).toThrow('DOCUMENT_ORIGINAL_DUPLICATE_SOURCE_REF');
  });

  it('rejects a foreign parse binding rather than borrowing the matching ref', () => {
    const { loaded, sourceRefId } = faaListFixture(FAA_LIST_CASES[0]);
    loaded.run.parseRunId = 'PRUN-FOREIGN';
    expect(() => findDocumentOriginalEvidence(loaded, sourceRefId)).toThrow('DOCUMENT_ORIGINAL_ENGINEERING_BINDING_INVALID');
  });

  it.each([false, true])('does not accept raw container content without readable child body; empty child=%s', emptyChild => {
    const { loaded, sourceRefId } = faaListFixture(FAA_LIST_CASES[0]);
    const parent = loaded.structuredSource.units[0];
    loaded.structuredSource.units = emptyChild ? [parent, loaded.structuredSource.units[1]] : [parent];
    parent.payload.itemUnitIds = loaded.structuredSource.units.slice(1).map(unit => unit.unitId);
    if (emptyChild) loaded.structuredSource.units[1].payload.text = '   ';
    expect(() => findDocumentOriginalEvidence(loaded, sourceRefId)).toThrow('DOCUMENT_ORIGINAL_SOURCE_TEXT_MISSING');
  });

  it('rejects an unknown source ref without substituting nearby evidence', () => {
    expect(() => findDocumentOriginalEvidence(fixture(), 'SR-UNKNOWN')).toThrow('DOCUMENT_ORIGINAL_SOURCE_LOCATOR_MISSING');
  });
});
