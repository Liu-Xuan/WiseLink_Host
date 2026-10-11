import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import {
  HostDecisionTdmsSourceAuthorization,
  UnconfiguredTdmsSourceAuthorization,
} from '../../../server/modules/tdms-source/tdms-source.authorization';
import {
  prepareTdmsDailyMetadataImport,
  validateTdmsDailyMetadataImportReadback,
} from '../../../server/modules/tdms-source/tdms-daily-metadata-contract';
import { dailyReferenceRead } from '../../../server/modules/tdms-source/tdms-daily-metadata.readback';
import { hash } from '../../../server/modules/tdms-source/tdms-source.validation';
import type { TdmsSourceAuthorization } from '../../../server/modules/tdms-source/tdms-source.types';
import { actor } from './tdms-fixtures';
import { MemoryTdmsRepository, nativeScope } from './tdms-memory-double';
import { syntheticDailyEnvelope } from './tdms-daily-metadata.fixture';

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
function setup(envelope = syntheticDailyEnvelope()) {
  const repository = new MemoryTdmsRepository();
  const allowed = prepareTdmsDailyMetadataImport(envelope).memberClaims;
  const state = {
    enabled: true,
    importAllowed: true,
    readAllowed: true,
    revision: 'fixture-1',
    scopes: [nativeScope],
    importChecks: 0,
    readChecks: 0,
  };
  // Test-only, independently fixed fixture allowlist. This is never registered in AppModule.
  const authorization = new HostDecisionTdmsSourceAuthorization(
    async ({ actor: a, action }) =>
      a.canonicalSubject.id === '123' &&
      a.tenantId === 'tenant-a' &&
      state.enabled &&
      (action !== 'IMPORT' || state.importAllowed)
        ? state.scopes.map((scope) => ({
            scope,
            permissionRevision: state.revision,
          }))
        : [],
    async ({ grant }) => {
      state.importChecks++;
      return {
        ...grant,
        authorityRef: 'fixture-retention',
        captureRetentionAllowed: true,
        nativeProjectionAllowed: true,
        permittedMembers: cloneJson(allowed),
      };
    },
    async ({ grant }) => {
      state.readChecks++;
      return {
        ...grant,
        authorityRef: 'fixture-read',
        retainedCaptureReadAllowed: true,
        permittedMembers: state.readAllowed
          ? cloneJson(allowed)
          : { records: [], relationIds: [], artifacts: [] },
      };
    },
  );
  const artifacts = { acquire: jest.fn() },
    documents = { assertRead: jest.fn() };
  const service = new TdmsSourceService(
    repository,
    authorization,
    artifacts,
    documents,
  );
  return {
    service,
    repository,
    authorization,
    state,
    allowed,
    artifacts,
    documents,
    envelope,
  };
}

describe('real daily receiver operations with synthetic local authority fixtures', () => {
  it('persists before returning the exact ten-key receipt and reads the same immutable request', async () => {
    const s = setup();
    const input = cloneJson(s.envelope);
    const receipt = await s.service.importDailyMetadata(actor(), input);
    expect(Object.keys(receipt)).toHaveLength(10);
    expect(s.repository.state.captures).toHaveLength(1);
    expect(s.repository.state.captures[0]!.dailyMetadata!.envelope).toEqual(
      s.envelope,
    );
    const saved = await s.service.readDailyMetadataImport(
      actor(),
      input.requestId,
    );
    expect(
      validateTdmsDailyMetadataImportReadback(cloneJson(saved), s.envelope),
    ).toEqual(receipt);
    input.package.records[0]!.number = 'mutation';
    saved.package.records[0]!.number = 'response mutation';
    expect(s.repository.state.captures[0]!.dailyMetadata!.envelope).toEqual(
      s.envelope,
    );
    expect(s.artifacts.acquire).not.toHaveBeenCalled();
    expect(s.documents.assertRead).not.toHaveBeenCalled();
    expect(s.repository.state.revisions).toEqual([]);
    expect(s.repository.state.assertions).toEqual([]);
  });
  it('same admitted request replays the same receipt without any second capture', async () => {
    const s = setup();
    const first = await s.service.importDailyMetadata(actor(), s.envelope);
    expect(
      await s.service.importDailyMetadata(actor(), cloneJson(s.envelope)),
    ).toEqual(first);
    expect(s.repository.state.captures).toHaveLength(1);
    expect(s.state.importChecks).toBeGreaterThan(2);
  });
  it('reused request with changed package is rejected, preserving the original envelope', async () => {
    const s = setup();
    await s.service.importDailyMetadata(actor(), s.envelope);
    const changed = cloneJson(s.envelope);
    changed.package.packageId = 'changed';
    await expect(
      s.service.importDailyMetadata(actor(), changed),
    ).rejects.toMatchObject({ code: 'TDMS_DAILY_REQUEST_DIGEST_MISMATCH' });
    expect(s.repository.state.captures[0]!.dailyMetadata!.envelope).toEqual(
      s.envelope,
    );
  });
  it('a stored conflicting hash is rejected without overwriting it', async () => {
    const s = setup();
    await s.service.importDailyMetadata(actor(), s.envelope);
    s.repository.state.captures[0]!.packageHash = 'conflicting';
    await expect(
      s.service.importDailyMetadata(actor(), s.envelope),
    ).rejects.toMatchObject({
      code: 'TDMS_DAILY_CAPTURE_INTEGRITY_CONFLICT',
      statusCode: 409,
    });
    expect(s.repository.state.captures[0]!.packageHash).toBe('conflicting');
  });
  it('rolls back when exact stored readback fails, releasing no receipt', async () => {
    const s = setup();
    const transaction = s.repository.transaction.bind(s.repository);
    s.repository.transaction = (fn) =>
      transaction((tx) => fn({ ...tx, capture: async () => null }));
    await expect(
      s.service.importDailyMetadata(actor(), s.envelope),
    ).rejects.toMatchObject({ code: 'TDMS_DAILY_CAPTURE_READBACK_FAILED' });
    expect(s.repository.state.captures).toEqual([]);
  });
  it('never silently drops a member with missing independent retention admission', async () => {
    const s = setup();
    s.allowed.relationIds.length = 0;
    await expect(
      s.service.importDailyMetadata(actor(), s.envelope),
    ).rejects.toMatchObject({
      code: 'TDMS_IMPORT_MEMBER_SCOPE_ADMISSION_REQUIRED',
      statusCode: 403,
    });
    expect(s.repository.state.captures).toEqual([]);
  });
  it('scope absence and ambiguity cannot be resolved from package claims', async () => {
    const s = setup();
    s.state.scopes = [];
    await expect(
      s.service.importDailyMetadata(actor(), s.envelope),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
    s.state.scopes = [nativeScope, { ...nativeScope, scopeId: 'another' }];
    await expect(
      s.service.importDailyMetadata(actor(), s.envelope),
    ).rejects.toMatchObject({
      code: 'TDMS_DAILY_SOURCE_SCOPE_AMBIGUOUS',
      statusCode: 409,
    });
    expect(s.repository.state.captures).toEqual([]);
  });
  it('rechecks revocation after commit without returning an IMPORTED receipt', async () => {
    const s = setup();
    s.repository.beforeCommit = () => {
      s.state.importAllowed = false;
    };
    await expect(
      s.service.importDailyMetadata(actor(), s.envelope),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
    // An unknown caller outcome does not imply rollback; the immutable capture is recoverable by authorized read.
    expect(s.repository.state.captures).toHaveLength(1);
    expect(
      await s.service.readDailyMetadataImport(actor(), s.envelope.requestId),
    ).toHaveProperty('receipt');
  });
  it('read permission is independently required and need not grant import', async () => {
    const s = setup();
    await s.service.importDailyMetadata(actor(), s.envelope);
    s.state.importAllowed = false;
    const before = s.state.importChecks;
    expect(
      await s.service.readDailyMetadataImport(actor(), s.envelope.requestId),
    ).toHaveProperty('package');
    expect(s.state.importChecks).toBe(before);
    s.state.readAllowed = false;
    await expect(
      s.service.readDailyMetadataImport(actor(), s.envelope.requestId),
    ).rejects.toMatchObject({
      code: 'TDMS_READ_MEMBER_SCOPE_ADMISSION_REQUIRED',
      statusCode: 403,
    });
  });
  it('checks current membership again before response; late revoked rows are not returned', async () => {
    const s = setup();
    await s.service.importDailyMetadata(actor(), s.envelope);
    s.repository.beforeCommit = () => {
      s.state.readAllowed = false;
    };
    await expect(
      s.service.readDailyMetadataImport(actor(), s.envelope.requestId),
    ).rejects.toMatchObject({
      code: 'TDMS_READ_MEMBER_SCOPE_ADMISSION_REQUIRED',
    });
  });
  it('exact SourceRef reads preserve snapshot, field and unresolved relation independently', async () => {
    const s = setup();
    const receipt = await s.service.importDailyMetadata(actor(), s.envelope);
    for (const ref of receipt.sourceRefs) {
      expect(await s.service.readDailySourceRef(actor(), ref)).toEqual(
        dailyReferenceRead(s.envelope.package, ref).response,
      );
    }
    const relation = await s.service.readDailySourceRef(
      actor(),
      receipt.sourceRefs.at(-1)!,
    );
    expect(relation.relation).toMatchObject({
      nativeRelationId: null,
      toSnapshotId: null,
      toSourceRecordId: 'VR:wt.epm.EPMDocument:1',
    });
    expect(relation.limitations.nativeRelationsVerified).toBe(false);
    expect(relation.limitations.engineeringEvidenceAuthorization).toBe(
      'NOT_GRANTED_BY_IMPORT',
    );
    expect(relation.snapshot).toBeNull();
  });
  it('does not broaden exact SourceRef to number, prefix, unknown field index or another scope', async () => {
    const s = setup();
    const receipt = await s.service.importDailyMetadata(actor(), s.envelope);
    for (const ref of [
      'AEO-SYNTHETIC',
      receipt.sourceRefs[0]!.slice(0, -1),
      receipt.sourceRefs[0] + '*',
    ])
      await expect(
        s.service.readDailySourceRef(actor(), ref),
      ).rejects.toMatchObject({ code: 'TDMS_DAILY_SOURCE_REF_INVALID' });
    await expect(
      s.service.readDailySourceRef(
        actor(),
        `TDMS:FIELD:${s.envelope.package.records[0]!.snapshotId}:999`,
      ),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
    s.state.scopes = [{ ...nativeScope, scopeId: 'other' }];
    await expect(
      s.service.readDailySourceRef(actor(), receipt.sourceRefs[0]!),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
  });
  it('SourceRef membership includes every returned related observation and cannot trim it', async () => {
    const s = setup();
    const receipt = await s.service.importDailyMetadata(actor(), s.envelope);
    s.allowed.relationIds = [];
    await expect(
      s.service.readDailySourceRef(actor(), receipt.sourceRefs.at(-1)!),
    ).rejects.toMatchObject({
      code: 'TDMS_READ_MEMBER_SCOPE_ADMISSION_REQUIRED',
    });
  });
  it('rejects duplicate captures for one exact SourceRef instead of silently choosing latest', async () => {
    const s = setup();
    const receipt = await s.service.importDailyMetadata(actor(), s.envelope);
    const duplicate = cloneJson(s.repository.state.captures[0]!);
    duplicate.packageId = 'different';
    s.repository.state.captures.push(duplicate);
    await expect(
      s.service.readDailySourceRef(actor(), receipt.sourceRefs[0]!),
    ).rejects.toMatchObject({
      code: 'TDMS_DAILY_REFERENCE_AMBIGUOUS',
      statusCode: 409,
    });
  });
  it('readback binds exact actor, tenant, application and original package digest', async () => {
    const s = setup();
    await s.service.importDailyMetadata(actor(), s.envelope);
    const stored = s.repository.state.captures[0]!;
    stored.actorId = 'another';
    await expect(
      s.service.readDailyMetadataImport(actor(), s.envelope.requestId),
    ).rejects.toMatchObject({ code: 'TDMS_DAILY_CAPTURE_BINDING_CONFLICT' });
    s.repository.state.captures[0]!.actorId = '123';
    s.repository.state.captures[0]!.dailyMetadata!.applicationScopeId =
      'other-app';
    await expect(
      s.service.readDailyMetadataImport(actor(), s.envelope.requestId),
    ).rejects.toMatchObject({ code: 'TDMS_DAILY_CAPTURE_BINDING_CONFLICT' });
    s.repository.state.captures[0]!.dailyMetadata!.applicationScopeId =
      actor().applicationScopeId;
    s.repository.state.captures[0]!.scope.tenantId = 'other-tenant';
    await expect(
      s.service.readDailyMetadataImport(actor(), s.envelope.requestId),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
  });
  it('invalid public actor, system caller or unbound application cannot import', async () => {
    const s = setup();
    for (const a of [
      { ...actor(), principalKind: 'SYSTEM' },
      { ...actor(), tenantId: 'other' },
      { ...actor(), applicationScopeId: 'unbound' },
    ])
      await expect(
        s.service.importDailyMetadata(a as any, s.envelope),
      ).rejects.toMatchObject({ code: 'TDMS_VERIFIED_PUBLIC_ACTOR_REQUIRED' });
    expect(s.repository.state.captures).toEqual([]);
  });
  it('default Unconfigured returns503 on all three operations with zero storage or artifact calls', async () => {
    const repository = { transaction: jest.fn() },
      artifacts = { acquire: jest.fn() };
    const service = new TdmsSourceService(
      repository,
      new UnconfiguredTdmsSourceAuthorization(),
      artifacts,
      { assertRead: jest.fn() },
    );
    const envelope = syntheticDailyEnvelope();
    for (const promise of [
      service.importDailyMetadata(actor(), envelope),
      service.readDailyMetadataImport(actor(), envelope.requestId),
      service.readDailySourceRef(
        actor(),
        `TDMS:SNAPSHOT:${envelope.package.records[0]!.snapshotId}`,
      ),
    ])
      await expect(promise).rejects.toMatchObject({
        code: 'TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED',
        statusCode: 503,
      });
    expect(repository.transaction).not.toHaveBeenCalled();
    expect(artifacts.acquire).not.toHaveBeenCalled();
  });
  it('scope-only configured authority still cannot disclose daily members', async () => {
    const s = setup();
    const scopeOnly = {
      available: true,
      catalogue: async () => [
        { scope: nativeScope, permissionRevision: 'fixture-1' },
      ],
      authorize: async () => ({
        scope: nativeScope,
        permissionRevision: 'fixture-1',
      }),
      authorizeImport: s.authorization.authorizeImport.bind(s.authorization),
    } satisfies TdmsSourceAuthorization;
    const service = new TdmsSourceService(
      s.repository,
      scopeOnly,
      s.artifacts,
      s.documents,
    );
    const transaction = jest.spyOn(s.repository, 'transaction');
    await expect(
      service.readDailyMetadataImport(actor(), s.envelope.requestId),
    ).rejects.toMatchObject({
      code: 'TDMS_READ_MEMBER_ADMISSION_UNCONFIGURED',
      statusCode: 503,
    });
    expect(transaction).not.toHaveBeenCalled();
  });
  it('persists a complete synthetic29-record/84-edge batch without projection or omissions', async () => {
    const envelope = syntheticDailyEnvelope();
    const base = envelope.package.records[1]!;
    envelope.package.records = [
      envelope.package.records[0]!,
      ...Array.from({ length: 28 }, (_, i) => {
        const r = cloneJson(base);
        r.sourceRecordId = `OR:com.airchina.tdms.statuslink.TDMSStatusLink:${i + 10}`;
        const { snapshotId: _snapshot, observedAt: _time, ...identity } = r;
        r.snapshotId = 'TDMSSNAP-' + hash(identity);
        return r;
      }),
    ];
    envelope.package.edges = envelope.package.records.slice(1).flatMap((r) =>
      Array.from({ length: 3 }, (_, i) => {
        const e = {
          ...envelope.package.edges[0]!,
          fromSourceRecordId: r.sourceRecordId,
          fromSnapshotId: r.snapshotId,
          evidenceLocator: `#synthetic-${r.sourceRecordId}-${i}`,
        };
        const { edgeId: _id, observedAt: _time, ...identity } = e;
        e.edgeId = 'TDMSEDGE-' + hash(identity);
        return e;
      }),
    );
    envelope.requestId = 'TDMSIMPORT-' + hash(envelope.package);
    const s = setup(envelope);
    const receipt = await s.service.importDailyMetadata(actor(), envelope);
    const saved = await s.service.readDailyMetadataImport(
      actor(),
      envelope.requestId,
    );
    expect(saved.package).toEqual(envelope.package);
    expect(receipt).toMatchObject({
      objectCount: 29,
      relationCount: 84,
      artifactCount: 0,
      documentVersionMappings: [],
    });
    expect(
      saved.package.edges.every(
        (e) =>
          e.nativeRelationId === null && e.confidence === 'observed_unresolved',
      ),
    ).toBe(true);
    expect(s.repository.state.captures).toHaveLength(1);
    expect(s.repository.state.heads).toEqual([]);
    expect(s.repository.state.relationHeads).toEqual([]);
  });
});
