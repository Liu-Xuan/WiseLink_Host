import type { CanonicalWorkItemProjection, UnifiedReaderQueryResult } from '@shared/api.interface';
import { CanonicalHostCommonContextService } from '../../server/modules/canonical-host/canonical-host-common-context.service';
import { CanonicalHostVerticalService } from '../../server/modules/canonical-host/canonical-host-vertical.service';
import { CANONICAL_MIAODA_APP_ID } from '../../server/modules/canonical-host/canonical-host.constants';
import type { CanonicalAuthorizationDecision, CanonicalHostActor } from '../../server/modules/canonical-host/canonical-host.types';
import { DocumentManagementHostedService } from '../../server/modules/document-management/src/hosted/nest/document-management-hosted.service';

const code = '777-31-1001';
const actor: CanonicalHostActor = { userId: 'reader', tenantId: 'tenant', roles: [], appId: CANONICAL_MIAODA_APP_ID, env: 'preview' };
const savedSandbox = process.env.SANDBOX_ID;
const savedLocal = process.env.MIAODA_LOCAL_DEV;
beforeAll(() => { process.env.SANDBOX_ID = 'reference-consumers-unit'; delete process.env.MIAODA_LOCAL_DEV; });
afterAll(() => {
  if (savedSandbox === undefined) delete process.env.SANDBOX_ID; else process.env.SANDBOX_ID = savedSandbox;
  if (savedLocal === undefined) delete process.env.MIAODA_LOCAL_DEV; else process.env.MIAODA_LOCAL_DEV = savedLocal;
});

function fixture(text: string, denied: string[] = [], ambiguous = false) {
  const versions = [
    { id: 'DV1', revision: 'R1', current: false, familyId: 'FAMILY' },
    { id: 'DV2', revision: 'R2', current: true, familyId: 'FAMILY' },
    ...(ambiguous ? [{ id: 'DV-OTHER', revision: 'R1', current: true, familyId: 'OTHER' }] : []),
  ];
  const documentManagement = new DocumentManagementHostedService({ from: () => {
    throw new Error('REFERENCE_SELECTION_MUST_NOT_READ_ORIGINAL_BYTES');
  } } as never, {
    listIngressDocuments: jest.fn(async () => versions.map(version => ({ familyId: version.familyId,
      documentVersionId: version.id, versionStatus: version.current ? 'CANONICAL_CURRENT' : 'CANONICAL_HISTORICAL',
      detail: { documentCode: code, documentFamily: 'SB', issuerAuthority: 'BOEING', businessRevision: version.revision },
    }))),
  } as never, {} as never);
  const selection = jest.spyOn(documentManagement, 'listReferenceTargets');
  const binding = (id: string) => ({ workItemId: `WI-${id}`, documentVersionId: id, requestId: `REQ-${id}`,
    tenantId: actor.tenantId, requestedByUserId: actor.userId, revision: 1 });
  const projection = (id: string, documentCode = code): CanonicalWorkItemProjection => ({
    ...binding(id), schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    phase: 'CANDIDATE_READBACK_VERIFIED', permissionSnapshotVersion: 'PERMISSION-1',
    parseAuthorization: { action: 'PARSE_PDF', actorFingerprint: 'actor', decisionId: 'DECISION',
      decisionHash: 'HASH', permissionSnapshotVersion: 'PERMISSION-1' },
    source: { documentVersionId: id, documentId: `DOC-${id}`, parserRequestId: `PARSE-${id}`,
      sourceArtifactId: `SOURCE-${id}`, sourceFileSha256: 'a'.repeat(64), sourceByteLength: 100,
      driveFileToken: `FILE-${id}`, driveSourceVersion: `VERSION-${id}` },
    classification: { status: 'CONFIRMED', normalizedFamily: 'SB', classifierReleaseId: 'CLASSIFIER',
      classifierReleaseHash: 'CLASSIFIER-HASH', parserProfileId: 'PARSER', parserProfileHash: 'PARSER-HASH', fingerprint: 'CLASSIFICATION' },
    package: { packageId: `PKG-${id}`, contractId: 'techpub.parsed-package.v1', contractRevision: 'frozen.2',
      contentHash: 'CONTENT', semanticHash: 'SEMANTIC', provenanceHash: 'PROVENANCE', coverageHash: 'COVERAGE', resultStatus: 'complete',
      title: documentCode, documentIdentity: { documentCode,
      businessRevision: versions.find(version => version.id === id)?.revision ?? 'R9' },
      artifact: { storeRole: 'UnifiedArtifactStoreCandidate', ref: `artifact://${id}`, sha256: 'a'.repeat(64), byteLength: 100, mediaType: 'application/json' },
      contentUnitCount: 1, sourceRefCount: 1, readerReceiptId: 'RECEIPT', fullValidatorProof: {
        validatorId: 'U0Frozen2SchemaSemanticValidator', validatorRevision: 'UNIT',
        contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900', artifactSha256: 'a'.repeat(64),
      } },
    failure: null, recordingFailure: null,
  });
  const primary = projection('PRIMARY', '747-FTD-31-18001');
  const workItems = {
    listTenantDocumentAuthorizationBindings: jest.fn(async ({ documentVersionId }: { documentVersionId: string }) => [binding(documentVersionId)]),
    loadAuthorizationBinding: jest.fn(async ({ workItemId }: { workItemId: string }) =>
      denied.includes(workItemId.slice(3)) ? null : binding(workItemId.slice(3))),
    loadTenantScopedProjection: jest.fn(async (workItemId: string) => ({ row: binding(workItemId.slice(3)), projection: projection(workItemId.slice(3)) })),
  };
  const artifacts = {
    persistAndReadback: jest.fn(async (bytes: Uint8Array) => ({ artifact: { ref: 'private://snapshot' }, bytes, reused: false })),
    readActualBytes: jest.fn(async ({ ref }: { ref: string }) => {
      const id = ref.slice('artifact://'.length);
      return new TextEncoder().encode(JSON.stringify({ sourceRefs: [{ sourceRefId: `SOURCE-${id}`,
        pageStart: 1, pageEnd: 1, quote: `Exact text of ${id}` }] }));
    }),
  };
  const units: UnifiedReaderQueryResult[] = [{ unitId: 'U1', kind: 'paragraph', text, sourceRefIds: ['SOURCE-PRIMARY'], sourceLocators: [] }];
  const reader = { readAllSourceUnits: jest.fn(async () => units) };
  const common = new CanonicalHostCommonContextService({ hasActiveOfficialActorMapping: jest.fn(async () => true),
    loadCurrent: jest.fn(async () => null) } as never, workItems as never, artifacts as never, reader as never, documentManagement);
  const authorization = { authorize: jest.fn(async (input: { action: CanonicalAuthorizationDecision['action']; documentVersionId?: string }): Promise<CanonicalAuthorizationDecision> => ({
    action: input.action, allowed: !denied.includes(input.documentVersionId ?? ''), actorFingerprint: 'actor',
    decisionId: 'DECISION', decisionHash: 'HASH', permissionSnapshotVersion: 'PERMISSION-1',
  })) };
  const browser = new CanonicalHostVerticalService({
    getTenantScopedByWorkItemId: jest.fn(async () => primary),
  } as never, {} as never, authorization, { freshRead: jest.fn(async () => ({ permissionSnapshotVersion: 'PERMISSION-1' })) },
  artifacts as never, reader as never, {} as never, {} as never, null,
  undefined, undefined, undefined, documentManagement, workItems as never);
  return { primary, documentManagement, selection, workItems, artifacts, reader, authorization,
    readCommon: () => common.build(primary, { actorId: actor.userId, tenantId: actor.tenantId }, { asOf: '2026-10-17T10:00:00Z' }),
    readBrowser: () => browser.explicitRelatedContextPreview({ workItemId: primary.workItemId, expectedRevision: 1 }, actor) };
}

describe('normal browser and server reference consumers', () => {
  it('uses the same Host selector for default, explicit old and explicit current occurrences without mixed-version refs', async () => {
    const h = fixture(`Service Bulletin ${code}; Service Bulletin ${code} Revision 1; Service Bulletin ${code} Rev 2.`);
    const server = await h.readCommon();
    const browser = await h.readBrowser();
    const expected = [[undefined, 'DV2'], ['R1', 'DV1'], ['R2', 'DV2']];
    expect(browser.mentions.map(item => [item.requestedBusinessRevision, item.resolvedDocumentVersionRef])).toEqual(expected);
    expect(server.related.items.map(item => [item.requestedBusinessRevision, item.resolvedDocumentVersionRef])).toEqual(expected);
    expect(h.selection.mock.calls.map(([requests]) => requests)).toEqual([[
      { canonicalDocumentNumber: code }, { canonicalDocumentNumber: code, requestedBusinessRevision: 'R1' },
      { canonicalDocumentNumber: code, requestedBusinessRevision: 'R2' },
    ], [
      { canonicalDocumentNumber: code }, { canonicalDocumentNumber: code, requestedBusinessRevision: 'R1' },
      { canonicalDocumentNumber: code, requestedBusinessRevision: 'R2' },
    ]]);
    expect(server.common.relatedMaterials.items.map(item => [item.documentVersionRef, item.availableSourceRefIds, item.readFragments])).toEqual([
      ['DV2', ['SOURCE-DV2'], [{ sourceRefId: 'SOURCE-DV2', excerpt: 'Exact text of DV2' }]],
      ['DV1', ['SOURCE-DV1'], [{ sourceRefId: 'SOURCE-DV1', excerpt: 'Exact text of DV1' }]],
      ['DV2', ['SOURCE-DV2'], [{ sourceRefId: 'SOURCE-DV2', excerpt: 'Exact text of DV2' }]],
    ]);
    expect(server.related.context.items).toEqual([
      expect.objectContaining({ availableRelatedSourceRefIds: ['SOURCE-DV2'] }),
      expect.objectContaining({ availableRelatedSourceRefIds: ['SOURCE-DV1'] }),
      expect.objectContaining({ availableRelatedSourceRefIds: ['SOURCE-DV2'] }),
    ]);
    expect(server.related.resourceRefs.map(item => item.sourceRefId)).toEqual(['SOURCE-DV2', 'SOURCE-DV1']);
    expect(server.readingEvidence.map(item => item.kind === 'DOCUMENT_PASSAGE' ? item.documentVersionId : null)).toEqual(['DV2', 'DV1']);
    expect(h.workItems.listTenantDocumentAuthorizationBindings).toHaveBeenCalledWith({ tenantId: 'tenant', documentVersionId: 'DV1' });
    expect(h.authorization.authorize).toHaveBeenCalledWith(expect.objectContaining({ documentVersionId: 'DV1', workItemId: 'WI-DV1', requestId: 'REQ-DV1' }));
  });

  it('keeps a missing or malformed edition as an item-level gap and still reads the unrelated default reference', async () => {
    const h = fixture(`Service Bulletin ${code} Revision 7; Service Bulletin ${code} Rev A; Service Bulletin ${code}.`);
    const server = await h.readCommon();
    const browser = await h.readBrowser();
    for (const items of [server.related.items, browser.snapshot.items]) {
      expect(items.map(item => [item.requestedBusinessRevision, item.availability, item.resolvedDocumentVersionRef ?? null])).toEqual([
        ['R7', 'NOT_INGESTED', null], [null, 'UNRESOLVED', null], [undefined, 'AVAILABLE', 'DV2'],
      ]);
    }
    expect(server.common.documentReading.status).toBe('AVAILABLE');
    expect(server.readingEvidence.map(item => item.kind === 'DOCUMENT_PASSAGE' ? item.documentVersionId : null)).toEqual(['DV2']);
    expect(h.workItems.listTenantDocumentAuthorizationBindings.mock.calls.map(([request]) => request.documentVersionId)).toEqual(['DV2', 'DV2']);
  });

  it('denies the specifically selected old DVI without substituting a readable current edition', async () => {
    const h = fixture(`Service Bulletin ${code} Revision 1; Service Bulletin ${code}.`, ['DV1']);
    const server = await h.readCommon();
    const browser = await h.readBrowser();
    expect(browser.mentions.map(item => item.targetResolution.status)).toEqual(['ACCESS_DENIED', 'RESOLVED_EXACT']);
    expect(server.common.relatedMaterials.items.map(item => [item.availability, item.documentVersionRef, item.availableSourceRefIds]))
      .toEqual([['ACCESS_DENIED', null, []], ['AVAILABLE', 'DV2', ['SOURCE-DV2']]]);
    expect(h.artifacts.readActualBytes.mock.calls.every(([artifact]) => artifact.ref !== 'artifact://DV1')).toBe(true);
  });

  it('does not choose a family when two registered families have the explicitly cited edition', async () => {
    const h = fixture(`Service Bulletin ${code} Revision 1.`, [], true);
    const server = await h.readCommon();
    const browser = await h.readBrowser();
    expect(browser.mentions[0].targetResolution).toEqual({ status: 'RESOLVED_MULTIPLE', candidateCount: 2 });
    expect(server.related.items[0]).toMatchObject({ availability: 'AMBIGUOUS', requestedBusinessRevision: 'R1' });
    expect(h.workItems.listTenantDocumentAuthorizationBindings).not.toHaveBeenCalled();
    expect(server.readingEvidence).toEqual([]);
  });
});
