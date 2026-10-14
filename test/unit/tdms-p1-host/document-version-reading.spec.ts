import type { Request } from 'express';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import type { TdmsRecordRevision } from '@shared/tdms-source.interface';
import { TdmsSourceService } from '@server/modules/tdms-source/tdms-source.service';
import { TdmsSourceController } from '@server/modules/tdms-source/tdms-source.controller';
import { UnconfiguredTdmsSourceAuthorization } from '@server/modules/tdms-source/tdms-source.authorization';
import {
  tdmsError,
  type TdmsCataloguePage,
  type TdmsPublicActor,
  type TdmsRepository,
  type TdmsSourceAuthorization,
  type TdmsSourceScope,
  type TdmsStoredRevision,
  type TdmsTransaction,
} from '@server/modules/tdms-source/tdms-source.types';
import { miaodaHostedFinalUserActor } from '@server/modules/work-item/production-miaoda-browser-ingress';
import { CANONICAL_MIAODA_APP_ID } from '@server/modules/canonical-host/canonical-host.constants';
import { actor } from '../tdms-source/tdms-fixtures';
import { MemoryTdmsRepository, nativeScope } from '../tdms-source/tdms-memory-double';

function sourceRow(
  index: number,
  documentVersionIds: string[],
  state = 'Estimated',
  discipline = 'ATA 27',
): TdmsStoredRevision {
  const record: TdmsRecordRevision = {
    recordRef: `TDMS-REC-${index}`,
    sourceRevisionRef: `TDMS-REV-${String(index).padStart(4, '0')}`,
    captureRef: `TDMS-CAP-${index}`,
    sourceRecordId: `OR:wt.change2.WTChangeOrder2:${index}`,
    recordKind: 'ENGINEER_ASSESSMENT',
    sourceKey: nativeScope.sourceKey,
    sourceInstanceId: nativeScope.sourceInstanceId,
    title: `SYNTHETIC-ASSESSMENT-${index}`,
    fileType: { rawName: 'SB评估单', rawCode: null },
    sourceVersion: { rawRevision: 'A', rawIteration: '2', confirmation: 'SOURCE_DECLARED' },
    businessVersion: { rawRevision: 'R00', rawIteration: null, confirmation: 'SOURCE_DECLARED' },
    state: { rawName: state, rawCode: null },
    authors: [{ sourcePersonId: `SOURCE-PERSON-${index}`, name: `Synthetic ${index}`, role: discipline }],
    sourceModifiedAt: '2026-10-13T00:00:00.000Z',
    observedAt: '2026-10-14T00:00:00.000Z',
    capturedAt: '2026-10-14T00:01:00.000Z',
    rawFields: { discipline, nativeState: state },
    content: {
      completeOwnedFields: [{
        fieldId: 'assessment-body', tabId: 'own', sectionId: 'opinion',
        labelOrigin: 'NATIVE_SOURCE_DECLARED',
        nativeControl: { tag: 'TD', readOnly: true, disabled: null },
        value: {
          state: 'VALUE', actualLabel: '评估意见', rawValue: `Synthetic raw opinion ${index}`,
          locator: '#own-body', observedTotalCodepoints: 23,
        },
        links: [],
      }],
    },
    coverage: { status: 'PARTIAL', gaps: ['RELATION_TARGETS_UNVERIFIED'], readback: 'NON_ATOMIC' },
    fieldSelectors: [{ fieldPath: 'content.completeOwnedFields.0.value.rawValue', selector: '#own-body' }],
    fieldProvenance: [{
      fieldPath: 'content.completeOwnedFields.0.value.rawValue', selector: '#own-body',
      sourceModifiedAt: '2026-10-13T00:00:00.000Z', observationRef: `TDMS-REV-${index}`,
    }],
    relatedDocumentVersionIds: documentVersionIds,
    artifacts: [], unreadAttachments: [],
    sourceVerification: 'DECLARED_ONLY', currentness: 'SELECTED_HOST_OBSERVATION', selectedHead: true,
  };
  record.rawFields.completeOwnedSource = {
    reads: [1, 2].map(() => ({ owner: {
      sourceRecordId: record.sourceRecordId, stateRaw: state, sourceVersion: record.sourceVersion,
    } })),
  };
  // Synthetic stored Host bindings test reading only, not collector/DM registration authority.
  return { scope: nativeScope, record };
}

function setup(rows: TdmsStoredRevision[] = []) {
  const memory = new MemoryTdmsRepository();
  memory.state.revisions = structuredClone(rows);
  for (const { scope, record } of rows) {
    const head = {
      scope, recordRef: record.recordRef, recordKind: record.recordKind,
      sourceRecordId: record.sourceRecordId, sourceRevisionRef: record.sourceRevisionRef,
      observedAt: record.observedAt,
    };
    const index: number = memory.state.heads.findIndex((item) => item.recordRef === record.recordRef);
    if (index < 0) memory.state.heads.push(head);
    else if (Date.parse(head.observedAt) >= Date.parse(memory.state.heads[index]!.observedAt))
      memory.state.heads[index] = head;
  }
  const pages: TdmsCataloguePage[] = [];
  const repository: TdmsRepository = {
    transaction: <T>(operation: (tx: TdmsTransaction) => Promise<T>) =>
      memory.transaction((tx: TdmsTransaction) => operation({
        ...tx,
        documentVersionCatalogue: async (scope: TdmsSourceScope, page?: TdmsCataloguePage) => {
          if (!page) throw new Error('UNBOUNDED_QUERY');
          pages.push(page);
          const matching: TdmsStoredRevision[] = rows.filter((row: TdmsStoredRevision) =>
            row.scope.scopeId === scope.scopeId &&
            (!page.documentVersionId || row.record.relatedDocumentVersionIds.includes(page.documentVersionId)),
          );
          const selected: TdmsStoredRevision[] = [];
          const recordRefs: string[] = [...new Set(matching.map((row: TdmsStoredRevision) => row.record.recordRef))];
          for (const recordRef of recordRefs) {
            const head = memory.state.heads.find((item) => item.recordRef === recordRef);
            const history = matching.filter((row: TdmsStoredRevision) => row.record.recordRef === recordRef);
            const current = history.find((row: TdmsStoredRevision) => row.record.sourceRevisionRef === head?.sourceRevisionRef);
            history.sort((left: TdmsStoredRevision, right: TdmsStoredRevision) =>
              Date.parse(right.record.observedAt) - Date.parse(left.record.observedAt) ||
              Date.parse(right.record.capturedAt) - Date.parse(left.record.capturedAt),
            );
            const row: TdmsStoredRevision = current ?? history[0]!;
            selected.push({
              ...row,
              record: { ...row.record, selectedHead: row.record.sourceRevisionRef === head?.sourceRevisionRef },
            });
          }
          return selected.filter((row: TdmsStoredRevision) => !page.after || row.record.sourceRevisionRef > page.after)
            .sort((left: TdmsStoredRevision, right: TdmsStoredRevision) =>
            left.record.sourceRevisionRef.localeCompare(right.record.sourceRevisionRef),
          ).slice(0, page.limit);
        },
      })),
  };
  const state = { readAllowed: true, revision: 'policy-1', documentAllowed: true };
  const authorization: TdmsSourceAuthorization = {
    available: true,
    catalogue: async (subject: TdmsPublicActor) => state.readAllowed && subject.tenantId === nativeScope.tenantId
      ? [{ scope: nativeScope, permissionRevision: state.revision }]
      : [],
    authorize: async (_actor, scope: TdmsSourceScope) => {
      if (!state.readAllowed) throw tdmsError('TDMS_SOURCE_NOT_FOUND', 404);
      return { scope, permissionRevision: state.revision };
    },
    authorizeImport: async () => { throw tdmsError('TDMS_IMPORT_DENIED', 403); },
  };
  const artifacts = { acquire: jest.fn(async () => { throw new Error('UNEXPECTED_ARTIFACT_WRITE'); }) };
  const documents = {
    assertRead: jest.fn(async (_actor, _id: string) => {
      if (!state.documentAllowed) throw tdmsError('DOCUMENT_NOT_FOUND', 404);
    }),
  };
  return {
    state, memory, pages, repository, authorization, artifacts, documents,
    service: new TdmsSourceService(repository, authorization, artifacts, documents),
  };
}

describe('TDMS exact version source reading; synthetic authority and records only', () => {
  it('keeps the approved professional body and the other lane metadata while excluding another/unknown version', async () => {
    const rows: TdmsStoredRevision[] = [
      sourceRow(1, ['DV-R00']), sourceRow(2, ['DV-R00'], 'Estimating', 'ATA 28'),
      sourceRow(3, ['DV-R01']), sourceRow(4, []),
    ];
    const f = setup(rows);
    const result = await f.service.readDocumentVersion(actor(), { documentVersionId: 'DV-R00' });
    expect(result.sourceStatus).toBe('AVAILABLE');
    expect(result.records.map((read) => read.record.sourceRevisionRef)).toEqual(['TDMS-REV-0001', 'TDMS-REV-0002']);
    expect(result.records[0]!.record.state?.rawName).toBe('Estimated');
    expect(result.records[0]!.record.content.completeOwnedFields).toEqual(rows[0]!.record.content.completeOwnedFields);
    expect(result.records[0]!.record.content.opinions).toBeUndefined();
    expect(result.records[0]!.record.businessVersion?.rawRevision).toBe('R00');
    expect(result.records[0]!.record.sourceVersion).toEqual({ rawRevision: 'A', rawIteration: '2', confirmation: 'SOURCE_DECLARED' });
    expect(result.records[1]!.record.authors[0]!.role).toBe('ATA 28');
    expect(result.records[1]!.record.state?.rawName).toBe('Estimating');
    expect(result.records[1]!.record.content).toEqual({});
    expect(result.records[1]!.record.rawFields).toEqual({});
    expect(result.records[1]!.bodyReadPolicy?.kind).toBe('METADATA_ONLY');
    expect(result.records[0]!.bodyReadPolicy?.kind).toBe('ESTIMATED_ASSESSMENT');
    expect(JSON.stringify(result)).not.toContain('Synthetic raw opinion 2');
    expect(result.hasMore).toBe(false);
    expect(result.nextAfter).toBeNull();
    expect(f.pages).toEqual([{ documentVersionId: 'DV-R00', limit: 21 }]);
    expect(f.memory.state.receipts).toHaveLength(2);
    for (const read of result.records) {
      expect(read.receipt).toMatchObject({
        sourceRevisionRef: read.record.sourceRevisionRef,
        purpose: 'WIKI_NATIVE_RECORD', taskContextRef: 'DV-R00',
        readPerformed: true, engineeringAdoption: 'NOT_CREATED', executionVerified: false,
      });
    }
    expect(f.artifacts.acquire).not.toHaveBeenCalled();
    expect(f.memory.state.revisions).toEqual(rows);
    expect(f.memory.state.captures).toHaveLength(0);
  });

  it('uses exact-version seek before pagination and saves receipts only for returned records', async () => {
    const rows: TdmsStoredRevision[] = Array.from({ length: 70 }, (_value: unknown, index: number) =>
      sourceRow(index + 1, index < 65 ? ['DV-other'] : ['DV-exact']),
    );
    const f = setup(rows);
    const first = await f.service.readDocumentVersion(actor(), { documentVersionId: 'DV-exact', limit: 2 });
    const second = await f.service.readDocumentVersion(actor(), {
      documentVersionId: 'DV-exact', limit: 2, after: first.nextAfter!,
    });
    const third = await f.service.readDocumentVersion(actor(), {
      documentVersionId: 'DV-exact', limit: 2, after: second.nextAfter!,
    });
    expect([...first.records, ...second.records, ...third.records].map((read) => read.record.sourceRevisionRef))
      .toEqual(['TDMS-REV-0066', 'TDMS-REV-0067', 'TDMS-REV-0068', 'TDMS-REV-0069', 'TDMS-REV-0070']);
    expect(first.hasMore).toBe(true);
    expect(third.hasMore).toBe(false);
    expect(third.nextAfter).toBeNull();
    expect(f.pages.every((page: TdmsCataloguePage) => page.limit === 3)).toBe(true);
    expect(f.memory.state.receipts).toHaveLength(5);
  });

  it('keeps the newest old-version observation after target changes and ignores late older observations', async () => {
    const first: TdmsStoredRevision = sourceRow(1, ['DV-R00']);
    first.record.observedAt = '2026-10-11T00:00:00.000Z';
    first.record.capturedAt = '2026-10-11T00:01:00.000Z';
    const revised: TdmsStoredRevision = sourceRow(2, ['DV-R00'], 'Estimated');
    const current: TdmsStoredRevision = sourceRow(3, ['DV-R01'], 'Estimated');
    current.record.observedAt = '2026-10-15T00:00:00.000Z';
    current.record.capturedAt = '2026-10-15T00:01:00.000Z';
    const late: TdmsStoredRevision = sourceRow(4, ['DV-R00']);
    late.record.observedAt = '2026-10-10T00:00:00.000Z';
    late.record.capturedAt = '2026-10-16T00:01:00.000Z';
    for (const row of [revised, current, late]) {
      row.record.recordRef = first.record.recordRef;
      row.record.sourceRecordId = first.record.sourceRecordId;
      row.record.rawFields.completeOwnedSource = {
        reads: [1, 2].map(() => ({ owner: {
          sourceRecordId: row.record.sourceRecordId, stateRaw: row.record.state?.rawName,
          sourceVersion: row.record.sourceVersion,
        } })),
      };
    }
    const f = setup([first, revised, current, late, sourceRow(5, ['DV-R00'], 'In work', 'ATA 28')]);
    const old = await f.service.readDocumentVersion(actor(), { documentVersionId: 'DV-R00', limit: 1 });
    expect(old.records[0]!.record.sourceRevisionRef).toBe('TDMS-REV-0002');
    expect(old.records[0]!.record.selectedHead).toBe(false);
    expect(old.records[0]!.record.content.completeOwnedFields?.[0]?.value.rawValue).toBe('Synthetic raw opinion 2');
    const tail = await f.service.readDocumentVersion(actor(), {
      documentVersionId: 'DV-R00', limit: 1, after: old.nextAfter!,
    });
    expect(tail.records.map((read) => read.record.sourceRevisionRef)).toEqual(['TDMS-REV-0005']);
    expect(tail.hasMore).toBe(false);
    const newer = await f.service.readDocumentVersion(actor(), { documentVersionId: 'DV-R01' });
    expect(newer.records[0]!.record.sourceRevisionRef).toBe('TDMS-REV-0003');
    expect(newer.records[0]!.record.selectedHead).toBe(true);
    expect(newer.records[0]!.record.content.completeOwnedFields?.[0]?.value.rawValue).toBe('Synthetic raw opinion 3');
  });

  it('allows two currently authorized same-tenant actors to read the same scope', async () => {
    const f = setup([sourceRow(1, ['DV-exact'])]);
    const first = actor();
    const second = miaodaHostedFinalUserActor({
      userId: '456', tenantId: 'tenant-a', appId: CANONICAL_MIAODA_APP_ID,
      env: 'preview', isSystemAccount: false,
    });
    const a = await f.service.readDocumentVersion(first, { documentVersionId: 'DV-exact' });
    const b = await f.service.readDocumentVersion(second, { documentVersionId: 'DV-exact' });
    expect(a.records.map((read) => read.record)).toEqual(b.records.map((read) => read.record));
    expect(f.memory.state.receipts.map((read) => read.actorId)).toEqual(['123', '456']);
  });

  it('distinguishes authorized absence from unavailable or denied source authority', async () => {
    const f = setup();
    await expect(f.service.readDocumentVersion(actor(), { documentVersionId: 'DV-exact' }))
      .resolves.toEqual({ documentVersionId: 'DV-exact', sourceStatus: 'NO_BOUND_RECORDS', records: [], hasMore: false, nextAfter: null });
    const unavailable = new TdmsSourceService(f.repository, new UnconfiguredTdmsSourceAuthorization(), f.artifacts, f.documents);
    await expect(unavailable.readDocumentVersion(actor(), { documentVersionId: 'DV-exact' }))
      .rejects.toMatchObject({ code: 'TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED', statusCode: 503 });
    f.state.readAllowed = false;
    await expect(f.service.readDocumentVersion(actor(), { documentVersionId: 'DV-exact' }))
      .rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND', statusCode: 404 });
  });

  it('rejects cross-tenant and anonymous actors without source reads or receipt writes', async () => {
    const f = setup([sourceRow(1, ['DV-exact'])]);
    actor();
    const foreign = miaodaHostedFinalUserActor({
      userId: '999', tenantId: 'tenant-b', appId: CANONICAL_MIAODA_APP_ID,
      env: 'preview', isSystemAccount: false,
    });
    await expect(f.service.readDocumentVersion(foreign, { documentVersionId: 'DV-exact' }))
      .rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND', statusCode: 404 });
    const anonymous: TdmsPublicActor = { ...actor(), canonicalSubject: { namespace: 'MIAODA_USER_ID', id: '' } };
    await expect(f.service.readDocumentVersion(anonymous, { documentVersionId: 'DV-exact' }))
      .rejects.toMatchObject({ code: 'TDMS_VERIFIED_PUBLIC_ACTOR_REQUIRED', statusCode: 401 });
    expect(f.pages).toHaveLength(0);
    expect(f.memory.state.receipts).toHaveLength(0);
  });

  it.each(['before-receipt', 'after-commit'] as const)('refuses source permission drift %s', async (stage) => {
    const f = setup([sourceRow(1, ['DV-exact'])]);
    const revoke = () => { f.state.revision = 'policy-2'; };
    if (stage === 'before-receipt') f.memory.beforeReceipt = revoke;
    else f.memory.beforeCommit = revoke;
    await expect(f.service.readDocumentVersion(actor(), { documentVersionId: 'DV-exact' }))
      .rejects.toMatchObject({ code: 'TDMS_SOURCE_PERMISSION_CHANGED', statusCode: 409 });
    if (stage === 'before-receipt') expect(f.memory.state.receipts).toHaveLength(0);
  });

  it('refuses selected DV revocation after commit even if the source remains readable', async () => {
    const f = setup([sourceRow(1, ['DV-exact'])]);
    f.memory.beforeCommit = () => { f.state.documentAllowed = false; };
    await expect(f.service.readDocumentVersion(actor(), { documentVersionId: 'DV-exact' }))
      .rejects.toMatchObject({ code: 'DOCUMENT_NOT_FOUND', statusCode: 404 });
  });

  it.each([0, 51, 1.5, Number.NaN])('rejects malformed page limit %s before querying', async (limit: number) => {
    const f = setup();
    await expect(f.service.readDocumentVersion(actor(), { documentVersionId: 'DV-exact', limit }))
      .rejects.toMatchObject({ code: 'TDMS_DOCUMENT_SOURCE_LIMIT_INVALID' });
    expect(f.pages).toHaveLength(0);
  });

  it('controller publishes the exact GET route and forwards verified identity and validated query', async () => {
    const f = setup([sourceRow(1, ['DV-exact'])]);
    actor();
    const controller = new TdmsSourceController(f.service);
    const request = {
      userContext: { userId: '123', tenantId: 'tenant-a', appId: CANONICAL_MIAODA_APP_ID, env: 'preview', isSystemAccount: false },
    } as unknown as Request;
    expect(Reflect.getMetadata(PATH_METADATA, TdmsSourceController)).toBe('api/tdms-source');
    expect(Reflect.getMetadata(PATH_METADATA, controller.documentVersion)).toBe('document-versions/:id');
    expect(Reflect.getMetadata(METHOD_METADATA, controller.documentVersion)).toBe(RequestMethod.GET);
    const result = await controller.documentVersion(request, 'DV-exact', { limit: '1' });
    expect(result.records).toHaveLength(1);
    expect(() => controller.documentVersion(request, 'DV-exact', { tenantId: 'evil' }))
      .toThrow('TDMS_INPUT_UNKNOWN_FIELD');
    await expect(controller.documentVersion(request, 'DV-exact', { limit: '1.0' }))
      .rejects.toMatchObject({ code: 'TDMS_DOCUMENT_SOURCE_LIMIT_INVALID' });
  });
});
