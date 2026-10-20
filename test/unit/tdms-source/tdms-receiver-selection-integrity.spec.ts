import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { TdmsReceiverRepository } from '../../../server/modules/tdms-source/tdms-receiver.repository';
import {
  checkedReceiverSelection,
  receiverSelectionPackage,
} from '../../../server/modules/tdms-source/tdms-receiver-selection.validation';
import { withTdmsReceiverDatabase } from '../../../server/modules/tdms-source/tdms-receiver-sql-context';
import { receiverAuthority } from '../../../server/modules/tdms-source/tdms-receiver-authorization.validation';
import type { TdmsStoredSelection } from '../../../server/modules/tdms-source/tdms-receiver.types';
import { object } from '../../../server/modules/tdms-source/tdms-source.validation';
import { actor } from './tdms-fixtures';
import { ownerPrimaryServices } from './tdms-owner-primary-0-2-83.fixture';
import { syntheticReceiverFixture } from './tdms-real-receiver.fixture';

async function staged() {
  const s = ownerPrimaryServices();
  const requestId = s.env.requestId, bindingId = s.binding.bindingId;
  await s.receiver.stage(s.request, requestId, bindingId, {
    package: s.env.package, selection: s.selection,
  });
  const repository = Reflect.get(s.receiver, 'receivers') as TdmsReceiverRepository;
  const scope = receiverAuthority(s.f.row, actor(), 'IMPORT')!.scope;
  const stored = await repository.selection(actor(), scope, requestId, bindingId);
  if (!stored) throw new Error('TEST_SELECTION_MISSING');
  return { ...s, repository, stored, scope, requestId, bindingId };
}

describe('selected attachment claims and current receiver decisions', () => {
  it('derives only the selected owner and attachment from a validated multi-record package', () => {
    const f = syntheticReceiverFixture();
    expect(f.envelope.package.records.length).toBeGreaterThan(1);
    const selected = receiverSelectionPackage(
      f.envelope.requestId, f.binding.bindingId, f.envelope.package,
    );
    const owner = f.envelope.package.records.find(
      (record) => record.snapshotId === f.binding.ownerSnapshotId,
    )!;
    expect(selected.ownerRecord).toEqual({
      snapshotId: owner.snapshotId, recordKind: owner.kind, sourceRecordId: owner.sourceRecordId,
    });
    expect(selected.memberClaims).toEqual({
      records: [{ recordKind: owner.kind, sourceRecordId: owner.sourceRecordId }],
      artifacts: [{
        memberId: f.binding.bindingId,
        sourceAttachmentId: f.binding.sourceAttachmentId,
        sourceAttachmentVersion: null,
        owners: [{ recordKind: owner.kind, sourceRecordId: owner.sourceRecordId }],
      }],
      relationIds: [], relatedDocumentVersionIds: [],
    });
  });

  it.each(['empty', 'partial-record', 'partial-owner', 'different-record', 'different-attachment', 'owner-snapshot'])(
    'rejects retained %s claims even when receipt and column mirrors agree',
    async (mode) => {
      const s = await staged();
      const saved = structuredClone(s.stored);
      if (mode === 'empty')
        saved.memberClaims = { records: [], artifacts: [], relationIds: [], relatedDocumentVersionIds: [] };
      if (mode === 'partial-record') delete object(saved.memberClaims.records[0]).sourceRecordId;
      if (mode === 'partial-owner') delete object(saved.memberClaims.artifacts[0].owners[0]).recordKind;
      if (mode === 'different-record') {
        saved.memberClaims.records[0].sourceRecordId = 'OR:wt.doc.WTDocument:999';
        saved.memberClaims.artifacts[0].owners[0].sourceRecordId = 'OR:wt.doc.WTDocument:999';
      }
      if (mode === 'different-attachment') {
        saved.observation.sourceAttachmentId = 'OR:wt.content.ApplicationData:999';
        saved.artifact.sourceAttachmentId = saved.observation.sourceAttachmentId;
        saved.receipt.sourceAttachmentId = saved.observation.sourceAttachmentId;
      }
      if (mode === 'owner-snapshot') saved.ownerRecord.snapshotId = 'snapshot-for-another-owner';
      expect(() => checkedReceiverSelection(
        saved, actor(), s.scope, s.requestId, s.bindingId,
      )).toThrow();
    },
  );

  it('rejects false permission revision through the actual repository before INSERT', async () => {
    const s = await staged();
    const stored: TdmsStoredSelection = { ...s.stored, permissionRevision: 'forged-current' };
    const dialect = new PgDialect();
    const inserted = jest.fn();
    const database = {
      execute: async (query: SQL) => {
        const text = dialect.sqlToQuery(query).sql;
        if (text.includes('current_schema()')) return [{
          actorId: actor().canonicalSubject.id,
          schemaName: 'workspace_aadkpkjef3slu',
          roleName: 'service_role_workspace_aadkpkjef3slu',
        }];
        if (text.includes('tdms_act_bound_identity')) return [{ bound: true }];
        inserted();
        return [];
      },
    } as unknown as PostgresJsDatabase;
    const repository = new TdmsReceiverRepository(database, {
      current: () => ({ tenantId: actor().tenantId, clientId: 'synthetic-client' }),
    });
    const authority = receiverAuthority(s.f.row, actor(), 'IMPORT')!;
    await expect(withTdmsReceiverDatabase(database, () =>
      repository.insertSelection(actor(), authority, stored),
    )).rejects.toMatchObject({ code: 'TDMS_SOURCE_PERMISSION_CHANGED', statusCode: 409 });
    expect(inserted).not.toHaveBeenCalled();
  });

  it.each(['READ_RECORD', 'READ_HISTORY'] as const)(
    'uses independently current %s for retained projection after IMPORT changes',
    async (action) => {
      const s = await staged();
      delete s.f.actions.IMPORT;
      s.f.row.grantRevision++;
      s.f.row.permissionRevision = 'current-read-only-revision';
      const selected = await s.receiver.registrationSelection(
        actor(), s.scope, s.requestId, s.bindingId, undefined,
        { action, claims: s.stored.memberClaims, bindingIds: [s.bindingId] },
      );
      expect(selected?.stored).toEqual(s.stored);
      await expect(selected!.checkpoint()).resolves.toBeUndefined();
      await expect(s.receiver.read(s.request, s.requestId, s.bindingId))
        .rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
    },
  );

  it('does not release a receipt when IMPORT is revoked immediately after the save', async () => {
    const s = ownerPrimaryServices();
    const repository = Reflect.get(s.receiver, 'receivers') as TdmsReceiverRepository;
    const insert = repository.insertSelection.bind(repository);
    jest.spyOn(repository, 'insertSelection').mockImplementation(async (...args) => {
      const stored = await insert(...args);
      s.f.row.grantStatus = 'REVOKED';
      s.f.row.grantRevokedAt = new Date().toISOString();
      return stored;
    });
    await expect(s.receiver.stage(s.request, s.env.requestId, s.binding.bindingId, {
      package: s.env.package, selection: s.selection,
    })).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
  });

  it('retains the independent Source identity without requiring the Host actor to be that person', async () => {
    const s = await staged();
    expect(s.f.row.sourceSubjectId).not.toBe(actor().canonicalSubject.id);
    expect(s.stored.actorSubjectId).toBe(actor().canonicalSubject.id);
    expect(await s.receiver.read(s.request, s.requestId, s.bindingId)).toEqual(s.stored.receipt);
  });
});
