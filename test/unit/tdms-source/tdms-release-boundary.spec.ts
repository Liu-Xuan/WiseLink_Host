import type { TdmsSourcePackage } from '../../../shared/tdms-source.interface';
import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import {
  HostDecisionTdmsSourceAuthorization,
  sameScope,
  UnconfiguredTdmsDocumentAccess,
  UnconfiguredTdmsSourceAuthorization,
} from '../../../server/modules/tdms-source/tdms-source.authorization';
import { UnconfiguredTdmsArtifactStore } from '../../../server/modules/tdms-source/unconfigured-tdms-artifact-store';
import {
  tdmsError,
  type TdmsDocumentAccess,
  type TdmsTransaction,
} from '../../../server/modules/tdms-source/tdms-source.types';
import { MemoryTdmsRepository, nativeScope } from './tdms-memory-double';
import { actor, fixture } from './tdms-fixtures';

type Phase = 'saveReceipt' | 'commit';
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
function releaseGate(phase: Phase) {
  const entered = deferred();
  const released = deferred();
  return {
    phase, entered: entered.promise, release: released.resolve,
    pause: async () => { entered.resolve(); await released.promise; },
  };
}
/** Synthetic waits around a real service transaction; no DB, installed provider or runtime ACL proof. */
class DelayedRepository extends MemoryTdmsRepository {
  gate?: ReturnType<typeof releaseGate>;
  override async transaction<T>(operation: (tx: TdmsTransaction) => Promise<T>): Promise<T> {
    return super.transaction(async tx => {
      const result = await operation({
        ...tx,
        saveReceipt: async receipt => {
          await tx.saveReceipt(receipt);
          if (this.gate?.phase === 'saveReceipt') await this.gate.pause();
        },
      });
      if (this.gate?.phase === 'commit') await this.gate.pause();
      return result;
    });
  }
}

async function setup(packet = fixture()) {
  const repository = new DelayedRepository();
  const deniedDocuments = new Map<string, number>();
  let denyReadRecord = false;
  const authorization = new HostDecisionTdmsSourceAuthorization(async input => {
    if (input.actor.tenantId !== nativeScope.tenantId ||
        (input.scope && !sameScope(input.scope, nativeScope)) ||
        (denyReadRecord && input.action === 'READ_RECORD')) return [];
    return [{ scope: nativeScope, permissionRevision: 'stable-root-grant' }];
  }, async ({ grant, claims }) => ({
    ...grant, authorityRef: 'synthetic-exact-members',
    captureRetentionAllowed: true, nativeProjectionAllowed: true,
    permittedMembers: structuredClone(claims),
  }));
  const documents: TdmsDocumentAccess = {
    assertRead: jest.fn(async (_actor, id) => {
      const status = deniedDocuments.get(id);
      if (status) throw tdmsError('DOCUMENT_NOT_FOUND', status);
    }),
  };
  const service = new TdmsSourceService(repository, authorization,
    new UnconfiguredTdmsArtifactStore(), documents);
  const imported = await service.importPackage(actor(), {
    sourceKey: nativeScope.sourceKey, sourceInstanceId: nativeScope.sourceInstanceId,
    scopeId: nativeScope.scopeId,
  }, packet);
  return { service, repository, documents, deniedDocuments, imported,
    revokeReadRecord: () => { denyReadRecord = true; } };
}

function linkedPacket(count = 1) {
  const packet = fixture();
  const original = packet.records[0]!;
  packet.records = Array.from({ length: count }, (_, i) => ({
    ...structuredClone(original), itemId: `member-${i}`, sourceRecordId: `record-${i}`,
    title: `synthetic title ${i}`, relatedDocumentVersionIds: [`DV-${i}`],
  }));
  return packet;
}
function relationPacket(): TdmsSourcePackage {
  const packet = linkedPacket(2);
  const base = {
    expectedHeadAssertionRef: null, rawKind: 'synthetic source relationship',
    controlledKind: 'REFERENCES' as const, authority: 'SOURCE_EXPLICIT' as const,
    selector: 'synthetic relation row', observedAt: packet.observedAt,
    coverage: packet.coverage, scope: {}, completionEffect: 'UNSPECIFIED' as const,
    changeClass: 'UNSPECIFIED' as const, rawFields: {},
    from: { kind: 'PACKAGE_RECORD' as const, itemId: 'member-0' },
  };
  packet.relations = [
    { ...base, sourceRelationId: 'native-edge', to: { kind: 'PACKAGE_RECORD', itemId: 'member-1' } },
    { ...base, sourceRelationId: 'document-edge', to: { kind: 'DOCUMENT_VERSION', documentVersionId: 'DV-endpoint' } },
    { ...base, sourceRelationId: 'readable-edge', to: { kind: 'DOCUMENT_VERSION', documentVersionId: 'DV-readable' } },
  ];
  return packet;
}

const savedSandbox = process.env.SANDBOX_ID;
afterAll(() => {
  if (savedSandbox === undefined) delete process.env.SANDBOX_ID;
  else process.env.SANDBOX_ID = savedSandbox;
});

describe('TDMS exact dependency checks after asynchronous release boundaries', () => {
  it.each([403, 404])('withholds catalogue metadata when linked DM is revoked during commit (%s)', async status => {
    const s = await setup(linkedPacket());
    const gate = s.repository.gate = releaseGate('commit');
    const response = s.service.catalogue(actor());
    const assertion = expect(response).rejects.toMatchObject({ statusCode: status });
    await gate.entered;
    s.deniedDocuments.set('DV-0', status);
    gate.release();
    await assertion;
  });

  it('reauthorizes the lookahead member that determines catalogue hasMore', async () => {
    const s = await setup(linkedPacket(51));
    const sorted = [...s.repository.state.revisions].sort((a, b) =>
      a.record.sourceRevisionRef.localeCompare(b.record.sourceRevisionRef));
    const hiddenLookahead = sorted[50]!.record.relatedDocumentVersionIds[0]!;
    const gate = s.repository.gate = releaseGate('commit');
    const assertion = expect(s.service.catalogue(actor())).rejects.toMatchObject({ statusCode: 403 });
    await gate.entered;
    s.deniedDocuments.set(hiddenLookahead, 403);
    gate.release();
    await assertion;
  });

  it('does not recheck an unrelated member outside the catalogue page and lookahead', async () => {
    const s = await setup(linkedPacket(52));
    const sorted = [...s.repository.state.revisions].sort((a, b) =>
      a.record.sourceRevisionRef.localeCompare(b.record.sourceRevisionRef));
    const unrelated = sorted[51]!.record.relatedDocumentVersionIds[0]!;
    const gate = s.repository.gate = releaseGate('commit');
    const response = s.service.catalogue(actor());
    await gate.entered;
    s.deniedDocuments.set(unrelated, 403);
    gate.release();
    const result = await response;
    expect(result.records).toHaveLength(50);
    expect(result.hasMore).toBe(true);
    expect(result.nextAfter).toBe(result.records[49]!.sourceRevisionRef);
    expect(result.records.some(r => r.relatedDocumentVersionIds.includes(unrelated))).toBe(false);
  });

  it.each(['saveReceipt', 'commit'] as const)('withholds record body when linked DM is revoked during %s', async phase => {
    const s = await setup(linkedPacket());
    const gate = s.repository.gate = releaseGate(phase);
    const assertion = expect(s.service.readRecord(actor(), s.imported.recordRevisionRefs[0]!))
      .rejects.toMatchObject({ statusCode: 403 });
    await gate.entered;
    s.deniedDocuments.set('DV-0', 403);
    gate.release();
    await assertion;
  });

  it.each(['saveReceipt', 'commit'] as const)('retains exact record and receipt when grants stay unchanged during %s', async phase => {
    const s = await setup(linkedPacket());
    const gate = s.repository.gate = releaseGate(phase);
    const response = s.service.readRecord(actor(), s.imported.recordRevisionRefs[0]!);
    await gate.entered;
    gate.release();
    const result = await response;
    expect(result.record.sourceRevisionRef).toBe(s.imported.recordRevisionRefs[0]);
    expect(result.record.title).toBe('synthetic title 0');
    expect(result.receipt.permissionRevision).toBe('stable-root-grant');
    expect(s.repository.state.receipts[0]!.receipt).toEqual(result.receipt);
  });

  it.each([
    ['saveReceipt', 'DV-endpoint', 'document-edge', 403],
    ['commit', 'DV-endpoint', 'document-edge', 404],
    ['saveReceipt', 'DV-1', 'native-edge', 403],
    ['commit', 'DV-1', 'native-edge', 404],
  ] as const)('omits only the edge whose exact endpoint was revoked during %s (%s)', async (phase, document, edge, status) => {
    const s = await setup(relationPacket());
    const gate = s.repository.gate = releaseGate(phase);
    const response = s.service.readRelations(actor(), s.imported.recordRevisionRefs[0]!);
    await gate.entered;
    s.deniedDocuments.set(document, status);
    gate.release();
    const result = await response;
    expect(result.relations.map(r => r.sourceRelationId)).toEqual(
      ['native-edge', 'document-edge', 'readable-edge'].filter(id => id !== edge));
    expect(JSON.stringify(result.relations)).not.toContain(edge);
    expect(result.receipt.permissionRevision).toBe('stable-root-grant');
  });

  it.each(['saveReceipt', 'commit'] as const)('withholds the relation response when its root linked DM was revoked during %s', async phase => {
    const s = await setup(relationPacket());
    const gate = s.repository.gate = releaseGate(phase);
    const assertion = expect(s.service.readRelations(actor(), s.imported.recordRevisionRefs[0]!))
      .rejects.toMatchObject({ statusCode: 403 });
    await gate.entered;
    s.deniedDocuments.set('DV-0', 403);
    gate.release();
    await assertion;
  });

  it.each(['saveReceipt', 'commit'] as const)('rechecks native endpoint READ_RECORD separately from stable root READ_RELATIONS during %s', async phase => {
    const s = await setup(relationPacket());
    const gate = s.repository.gate = releaseGate(phase);
    const response = s.service.readRelations(actor(), s.imported.recordRevisionRefs[0]!);
    await gate.entered;
    s.revokeReadRecord();
    gate.release();
    const result = await response;
    expect(result.relations).toEqual([]);
    expect(result.receipt.permissionRevision).toBe('stable-root-grant');
  });

  it('does not hide an endpoint verification failure as an empty adjacency result', async () => {
    const s = await setup(relationPacket());
    const gate = s.repository.gate = releaseGate('commit');
    const assertion = expect(s.service.readRelations(actor(), s.imported.recordRevisionRefs[0]!))
      .rejects.toMatchObject({ statusCode: 500 });
    await gate.entered;
    s.deniedDocuments.set('DV-endpoint', 500);
    gate.release();
    await assertion;
  });

  it('retains every readable edge and selected head after delayed commit', async () => {
    const s = await setup(relationPacket());
    const gate = s.repository.gate = releaseGate('commit');
    const response = s.service.readRelations(actor(), s.imported.recordRevisionRefs[0]!);
    await gate.entered;
    gate.release();
    const result = await response;
    expect(result.relations.map(r => r.sourceRelationId)).toEqual(['native-edge', 'document-edge', 'readable-edge']);
    expect(result.relations.every(r => r.selectedHead)).toBe(true);
    expect(result.receipt.purpose).toBe('WIKI_NATIVE_RELATIONS');
  });

  it('keeps default-deny reads and catalogue closed without any repository call', async () => {
    const repository = new DelayedRepository();
    const transaction = jest.spyOn(repository, 'transaction');
    const service = new TdmsSourceService(repository, new UnconfiguredTdmsSourceAuthorization(),
      new UnconfiguredTdmsArtifactStore(), new UnconfiguredTdmsDocumentAccess());
    expect(await service.catalogue(actor())).toMatchObject({ records: [], sourceStatus: 'DISABLED', readPerformed: false });
    await expect(service.readRecord(actor(), 'TDMS-REV-synthetic')).rejects.toMatchObject({ statusCode: 503 });
    await expect(service.readRelations(actor(), 'TDMS-REV-synthetic')).rejects.toMatchObject({ statusCode: 503 });
    expect(transaction).not.toHaveBeenCalled();
  });
});
