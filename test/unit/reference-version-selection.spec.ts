import type { CanonicalStructuredContentUnit, UnifiedReaderQueryResult } from '@shared/api.interface';
import {
  canonicalReferenceSelectionKey,
  deriveCanonicalReferenceMentionPreview,
  finalizeCanonicalReferenceMentionPreview,
} from '../../server/modules/canonical-host/canonical-reference-mention-preview';
import { projectCanonicalStructuredContentUnit } from '../../server/modules/canonical-host/canonical-structured-content-projection';
import { buildCanonicalRelatedContextSnapshot } from '../../server/modules/canonical-host/canonical-related-context-snapshot';
import { DocumentManagementHostedService } from '../../server/modules/document-management/src/hosted/nest/document-management-hosted.service';
import { CANONICAL_MIAODA_APP_ID } from '../../server/modules/canonical-host/canonical-host.constants';

const code = '777-31-1001';
const context = { actorUserId: 'reader', tenantId: 'tenant', roles: [], appId: CANONICAL_MIAODA_APP_ID, env: 'preview' };
const savedSandbox = process.env.SANDBOX_ID;
const savedLocal = process.env.MIAODA_LOCAL_DEV;
beforeAll(() => { process.env.SANDBOX_ID = 'reference-selection-unit'; delete process.env.MIAODA_LOCAL_DEV; });
afterAll(() => {
  if (savedSandbox === undefined) delete process.env.SANDBOX_ID; else process.env.SANDBOX_ID = savedSandbox;
  if (savedLocal === undefined) delete process.env.MIAODA_LOCAL_DEV; else process.env.MIAODA_LOCAL_DEV = savedLocal;
});

function mentions(text: string, primary = '747-FTD-31-18001') {
  const source: UnifiedReaderQueryResult = { unitId: 'U1', kind: 'paragraph', text,
    sourceRefIds: ['SOURCE'], sourceLocators: [] };
  return fromUnits([source], primary);
}

function fromUnits(sources: UnifiedReaderQueryResult[], primary = '747-FTD-31-18001') {
  const units = sources.map((source, i) => projectCanonicalStructuredContentUnit(source, i + 1))
    .filter((unit): unit is CanonicalStructuredContentUnit => unit !== null);
  return deriveCanonicalReferenceMentionPreview(units, primary, sources);
}

function row(id: string, businessRevision: string, current = false, familyId = 'FAMILY') {
  return { familyId, documentVersionId: id, versionStatus: current ? 'CANONICAL_CURRENT' : 'CANONICAL_HISTORICAL',
    detail: { documentCode: code, documentFamily: 'SB', issuerAuthority: 'BOEING', businessRevision } };
}

function dm(rows: ReturnType<typeof row>[]) {
  const catalog = { listIngressDocuments: jest.fn(async () => rows) };
  return { catalog, service: new DocumentManagementHostedService({ from: () => {
    throw new Error('REFERENCE_SELECTION_MUST_NOT_READ_ORIGINAL_BYTES');
  } } as never, catalog as never, {} as never) };
}

describe('source-stated publication edition extraction', () => {
  it.each([
    ['R01', 'R1'], ['REV 1', 'R1'], ['Revision: 001', 'R1'],
    ['Issue #02', 'ISSUE 2'], ['Original Issue', 'ORIGINAL ISSUE'], ['原版', 'ORIGINAL ISSUE'],
  ])('preserves the explicit %s label as the existing business edition %s', (label, expected) => {
    expect(mentions(`Service Bulletin ${code} ${label}.`)).toEqual([
      expect.objectContaining({ normalizedTarget: code, requestedBusinessRevision: expected,
        matchedText: `Service Bulletin ${code} ${label}` }),
    ]);
  });

  it('limits editions to each occurrence, keeping default and two explicitly cited editions distinct', () => {
    const found = mentions(`Service Bulletin ${code} Rev 1; Service Bulletin 777-31-1002 Rev 2; Service Bulletin ${code}.`);
    expect(found.map(item => [item.normalizedTarget, item.requestedBusinessRevision])).toEqual([
      [code, 'R1'], ['777-31-1002', 'R2'], [code, undefined],
    ]);
    expect(mentions(`Revision 9\nService Bulletin ${code} dated 2026-10-01; Service Bulletin 777-31-1002 Rev 2.`)[0])
      .not.toHaveProperty('requestedBusinessRevision');
  });

  it.each(['R1', '(R1)'])('captures an adjacent %s suffix without treating it as an unspecified edition', suffix => {
    const separator = suffix.startsWith('(') ? '' : ' ';
    expect(mentions(`Service Bulletin ${code}${separator}${suffix}.`)[0])
      .toMatchObject({ normalizedTarget: code, requestedBusinessRevision: 'R1' });
  });

  it.each(['Rev A', 'Revision', 'Rev 1 / Rev 2', 'Issue #', 'Issue 2026-10-17', 'Rev 1.2', 'Rev 1/2'])('never defaults a malformed or contradictory %s to current', label => {
    expect(mentions(`Service Bulletin ${code} ${label}.`)[0]).toMatchObject({
      requestedBusinessRevision: null, initialResolutionState: 'UNRESOLVED',
    });
  });

  it('retains an explicit historical self-reference without turning the publication title into a reference', () => {
    expect(mentions(`Service Bulletin ${code} Revision 2`, code)).toEqual([]);
    expect(mentions(`See Service Bulletin ${code} Revision 1.`, code)[0])
      .toMatchObject({ normalizedTarget: code, requestedBusinessRevision: 'R1' });
  });

  it('uses only the structured row edition column, never its date or a neighbouring reference', () => {
    const source = (revisionLabel: unknown, sourceLine: string): UnifiedReaderQueryResult => ({
      unitId: String(revisionLabel), kind: 'paragraph', sourceRefIds: ['SHARED'], sourceLocators: [],
      text: JSON.stringify({ sourceSectionField: 'referenceCategories', referenceFamily: 'SB',
        referenceNumber: code, revisionLabel, referenceDate: '2026-10-01', sourceLine }),
    });
    const found = fromUnits([
      source('V18', `Service Bulletin ${code}; Service Bulletin 777-31-1002 Rev 2`),
      source('18', `Service Bulletin ${code}`),
      source(null, `Service Bulletin ${code} dated 2026-10-01`),
      source('R1', `Service Bulletin ${code} Revision 2`),
      source({ revision: 1 }, `Service Bulletin ${code}`),
    ]);
    expect(found.map(item => item.requestedBusinessRevision)).toEqual(['V18', '18', undefined, null, null]);
    expect(found.slice(3).map(item => item.initialResolutionState)).toEqual(['UNRESOLVED', 'UNRESOLVED']);
  });

  it('does not suppress a different edition sharing the structured row source carrier', () => {
    const sources: UnifiedReaderQueryResult[] = [
      { unitId: 'structured', kind: 'paragraph', sourceRefIds: ['SHARED'], text: JSON.stringify({
        sourceSectionField: 'referenceCategories', referenceFamily: 'SB', referenceNumber: code,
        revisionLabel: 'R1', sourceLine: `Service Bulletin ${code} Rev 1`,
      }) },
      { unitId: 'text', kind: 'paragraph', sourceRefIds: ['SHARED'], text: `Service Bulletin ${code} Rev 2` },
    ];
    expect(fromUnits(sources).map(item => item.requestedBusinessRevision)).toEqual(['R1', 'R2']);
  });

  it.each(['REV1.2', 'REV A', 'REVA'])('preserves a structured literal %s when the complete local line agrees', label => {
    const source: UnifiedReaderQueryResult = { unitId: 'literal', kind: 'paragraph', sourceRefIds: ['LITERAL'], text: JSON.stringify({
      sourceSectionField: 'referenceCategories', referenceFamily: 'SB', referenceNumber: code,
      revisionLabel: label, sourceLine: `Service Bulletin ${code} ${label}`,
    }) };
    const [found] = fromUnits([source]);
    expect(found.requestedBusinessRevision).toBe(label);
    expect(found).not.toHaveProperty('initialResolutionState');
  });

  it.each([
    ['REV1.2', 'REV1.3'], ['REV A', 'REV B'], ['REV A', 'REV A / REV B'],
  ])('does not use a partial or conflicting line %s / %s as structured agreement', (column, line) => {
    const source: UnifiedReaderQueryResult = { unitId: 'different-literal', kind: 'paragraph', sourceRefIds: ['LITERAL'], text: JSON.stringify({
      sourceSectionField: 'referenceCategories', referenceFamily: 'SB', referenceNumber: code,
      revisionLabel: column, sourceLine: `Service Bulletin ${code} ${line}`,
    }) };
    expect(fromUnits([source])[0]).toMatchObject({ requestedBusinessRevision: null, initialResolutionState: 'UNRESOLVED' });
  });

  it('keeps the edition selection key through snapshot grouping, including default and explicit current', () => {
    const found = mentions(`Service Bulletin ${code}; Service Bulletin ${code} Rev 1; Service Bulletin ${code} Rev 2.`);
    const finalized = found.map(candidate => finalizeCanonicalReferenceMentionPreview({ candidate,
      primaryDocumentVersionRef: 'PRIMARY', targetResolution: { status: 'UNRESOLVED' }, targetApplicability: 'NOT_EVALUATED' }));
    const snapshot = buildCanonicalRelatedContextSnapshot({ workItemId: 'WI', inputRevision: 1,
      primaryDocumentVersionId: 'PRIMARY', mentions: finalized }).snapshot;
    expect(snapshot.items.map(item => item.requestedBusinessRevision)).toEqual([undefined, 'R1', 'R2']);
    expect(new Set(snapshot.items.map(canonicalReferenceSelectionKey)).size).toBe(3);
  });
});

describe('one existing DM catalogue selector', () => {
  it('defaults to the controlled head and separately resolves exact historical editions without fallback', async () => {
    const h = dm([row('DV1', 'R1'), row('DV2', 'R2', true)]);
    expect((await h.service.listCurrentReferenceTargets([code], context)).map(item => item.documentVersionId)).toEqual(['DV2']);
    const selected = await h.service.listReferenceTargets([
      { canonicalDocumentNumber: code }, { canonicalDocumentNumber: code, requestedBusinessRevision: 'R1' },
      { canonicalDocumentNumber: code, requestedBusinessRevision: 'R3' },
      { canonicalDocumentNumber: code, requestedBusinessRevision: null },
    ], context);
    expect(selected.map(item => [item.documentVersionId, item.requestedBusinessRevision])).toEqual([['DV2', undefined], ['DV1', 'R1']]);
    expect(h.catalog.listIngressDocuments).toHaveBeenCalledWith({ tenantId: 'tenant' });
  });

  it('uses registered literal structured labels without guessing a revision axis or sorting by dates', async () => {
    const h = dm([row('DV-V18', 'V18'), row('DV-N18', '18'), row('DV-R18', 'R18', true)]);
    const selected = await h.service.listReferenceTargets(['V18', '18', 'V19'].map(requestedBusinessRevision => ({
      canonicalDocumentNumber: code, requestedBusinessRevision,
    })), context);
    expect(selected.map(item => item.documentVersionId)).toEqual(['DV-V18', 'DV-N18']);
  });

  it('reuses existing REV/ISSUE equivalence and leaves ambiguous family matches to the caller', async () => {
    const h = dm([row('DV0', 'R0'), row('DV-I1', 'ISSUE #01'), row('DV1-A', 'R1', true), row('DV1-B', 'R1', true, 'OTHER-FAMILY')]);
    const select = (requestedBusinessRevision: string) => h.service.listReferenceTargets([{ canonicalDocumentNumber: code, requestedBusinessRevision }], context);
    expect((await select('ORIGINAL ISSUE')).map(item => item.documentVersionId)).toEqual(['DV0']);
    expect((await select('ISSUE 1')).map(item => item.documentVersionId)).toEqual(['DV-I1']);
    expect((await select('R1')).map(item => item.documentVersionId)).toEqual(['DV1-A', 'DV1-B']);
    expect(await select('R9')).toEqual([]);
  });
});
