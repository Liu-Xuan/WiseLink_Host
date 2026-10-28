import { TdmsSourceController } from '@server/modules/tdms-source/tdms-source.controller';
import { TdmsSourceService } from '@server/modules/tdms-source/tdms-source.service';
import { MiaodaTdmsDocumentAccess } from '@server/modules/tdms-source/miaoda-tdms-document-access';
import { DocumentManagementHostedController } from '@server/modules/document-management/src/hosted/nest/document-management-hosted.controller';
import type { TdmsDocumentCataloguePage, TdmsRepository, TdmsTransaction } from '@server/modules/tdms-source/tdms-source.types';
import { canonical } from '@server/modules/tdms-source/tdms-source.validation';
import { current092Original, source092RecordProof } from './tdms-source092-dto.fixture';
import { fixture } from './tdms-single-primary-formal-registration.fixture';
import { syntheticFormalOriginal } from './tdms-receiver-legacy-original.fixture';

async function setup() {
  const synthetic = syntheticFormalOriginal();
  const input = current092Original('SL', { bytes: synthetic.bytes, number: '737-SL-31-093', businessRevision: 'ORIGINAL ISSUE' });
  const f = fixture({ bytes: input.bytes, package: input.env.package });
  const authorizer: ConstructorParameters<typeof MiaodaTdmsDocumentAccess>[0] = Reflect.get(f.documents, 'authorizer');
  // Reuse the same catalog already injected into the typed Host service by the baseline fixture.
  const catalog: ConstructorParameters<typeof MiaodaTdmsDocumentAccess>[1] = Reflect.get(f.documents, 'catalog');
  const access = new MiaodaTdmsDocumentAccess(authorizer, catalog);
  const repository: TdmsRepository = { transaction: <T>(operation: (tx: TdmsTransaction) => Promise<T>) =>
    f.repository.transaction(tx => operation({ ...tx,
      documentVersionCatalogue: async (scope, page: TdmsDocumentCataloguePage) =>
        f.repository.state.revisions.filter(row => canonical(row.scope) === canonical(scope) &&
          (row.record.relatedDocumentVersionIds.includes(page.documentVersionId) ||
            page.sourceRevisionRefs?.includes(row.record.sourceRevisionRef)) &&
          (page.permittedRecords === undefined || page.permittedRecords.some(member =>
            member.recordKind === row.record.recordKind && member.sourceRecordId === row.record.sourceRecordId)))
          .slice(0, page.limit),
    })) };
  const service = new TdmsSourceService(repository, Reflect.get(f.service, 'authorization'),
    Reflect.get(f.service, 'artifacts'), access, f.formal);
  return { ...f, source: new TdmsSourceController(service) };
}

describe('Source0.2.92 single primary enters the existing receiver/PDF/read consumers', () => {
  it('keeps the retained current DTO a candidate while exact DM registration and DVI source readback succeed', async () => {
    const f = await setup();
    await f.stage();
    const retained = await f.dailyController.submit(f.request, f.env, {});
    expect(retained.documentVersionMappings[0].documentVersionId).toBeNull();
    const capture = canonical(f.repository.state.captures);
    const registered = await f.register();
    expect(registered.status).toBe('COMMITTED');
    const dv = registered.documentVersionId!;
    const read = await f.source.documentVersion(f.request, dv, {});
    expect(read.records).toHaveLength(1);
    expect(read.records[0].record.sourceVersion).toEqual(f.env.package.records[0].sourceVersion);
    expect(read.records[0].record.businessVersion).toEqual(f.env.package.records[0].businessVersion);
    expect(read.records[0].record.relatedDocumentVersionIds).toEqual([dv]);
    expect(source092RecordProof(read.records[0].record).requestedCriteria.collectionStage).toBe('OWNER_PRIMARY');
    const original = await new DocumentManagementHostedController(f.documents, f.readSessions)
      .readDocumentOriginal(dv, f.request);
    const chunks: Buffer[] = [];
    for await (const chunk of original.getStream()) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(f.bytes);
    expect(await f.register()).toEqual(registered);
    expect(canonical(f.repository.state.captures)).toBe(capture);
    expect(f.catalog.commits).toBe(1);
  });
  it('does not release a registered original or DVI source after current Source rights are revoked', async () => {
    const f = await setup(); await f.stage(); await f.dailyController.submit(f.request, f.env, {});
    const registered = await f.register();
    f.f.actions.READ_RECORD.allowed = false;
    await expect(f.source.documentVersion(f.request, registered.documentVersionId!, {}))
      .rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND', statusCode: 404 });
    await expect(new DocumentManagementHostedController(f.documents, f.readSessions)
      .readDocumentOriginal(registered.documentVersionId!, f.request))
      .rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND', statusCode: 404 });
    expect(f.catalog.commits).toBe(1);
  });
});
