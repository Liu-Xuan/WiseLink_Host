import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import { HostDecisionTdmsSourceAuthorization } from '../../../server/modules/tdms-source/tdms-source.authorization';
import {
  assertReadGrantsCurrent,
  assertReadStoredMembers,
} from '../../../server/modules/tdms-source/tdms-read-member-scope';
import type {
  TdmsImportMemberClaims,
  TdmsSourceGrant,
} from '../../../server/modules/tdms-source/tdms-source.types';
import { MemoryTdmsRepository, nativeScope } from './tdms-memory-double';
import { actor, fixture } from './tdms-fixtures';

const allowed: TdmsImportMemberClaims = {
  records: [{ recordKind: 'ENGINEERING_FILE', sourceRecordId: 'AEO-1' }],
  artifacts: [],
  relationIds: [],
};
async function setup() {
  const db = new MemoryTdmsRepository();
  let bounded: TdmsImportMemberClaims | undefined;
  const grant = (): TdmsSourceGrant => ({
    scope: nativeScope,
    permissionRevision: 'r1',
    ...(bounded === undefined
      ? {}
      : { permittedMembers: structuredClone(bounded) }),
  });
  const authorization = new HostDecisionTdmsSourceAuthorization(
    async () => [grant()],
    async ({ claims }) => ({
      ...grant(),
      authorityRef: 'source-authority',
      captureRetentionAllowed: true,
      nativeProjectionAllowed: true,
      permittedMembers: claims,
    }),
  );
  const service = new TdmsSourceService(
    db,
    authorization,
    {
      acquire: async () => {
        throw new Error('not used');
      },
    },
    { assertRead: async () => undefined },
  );
  const receipt = await service.importPackage(
    actor(),
    {
      sourceKey: nativeScope.sourceKey,
      sourceInstanceId: nativeScope.sourceInstanceId,
      scopeId: nativeScope.scopeId,
    },
    fixture(),
  );
  bounded = structuredClone(allowed);
  return {
    db,
    service,
    ref: receipt.recordRevisionRefs[0]!,
    grant,
    setMembers(value: TdmsImportMemberClaims | undefined) {
      bounded = value;
    },
  };
}

describe('bounded Source decisions at native public release boundaries', () => {
  it('reads an allowed exact observation and rejects an explicit empty member scope', async () => {
    const f = await setup();
    expect(
      (await f.service.readRecord(actor(), f.ref)).record.sourceRecordId,
    ).toBe('AEO-1');
    f.setMembers({ records: [], artifacts: [], relationIds: [] });
    await expect(f.service.readRecord(actor(), f.ref)).rejects.toMatchObject({
      code: 'TDMS_RECEIVER_EXACT_MEMBER_DENIED',
    });
    expect(f.db.state.receipts).toHaveLength(1);
  });
  it('denies membership drift even if a provider incorrectly leaves permissionRevision unchanged', async () => {
    const f = await setup();
    f.db.beforeReceipt = () =>
      f.setMembers({ records: [], artifacts: [], relationIds: [] });
    await expect(f.service.readRecord(actor(), f.ref)).rejects.toMatchObject({
      code: 'TDMS_SOURCE_PERMISSION_CHANGED',
    });
    expect(f.db.state.receipts).toHaveLength(0);
  });
  it('does not release a previously authorized record after a commit-wait revocation', async () => {
    const f = await setup();
    f.db.beforeCommit = () =>
      f.setMembers({ records: [], artifacts: [], relationIds: [] });
    await expect(f.service.readRecord(actor(), f.ref)).rejects.toMatchObject({
      code: 'TDMS_SOURCE_PERMISSION_CHANGED',
    });
  });
  it('preserves deliberate whole-scope Host decisions while rejecting malformed bounded claims', async () => {
    const f = await setup();
    f.setMembers(undefined);
    expect(
      (await f.service.readRecord(actor(), f.ref)).record.sourceRecordId,
    ).toBe('AEO-1');
    f.setMembers({
      ...allowed,
      records: null,
    } as unknown as TdmsImportMemberClaims);
    await expect(f.service.readRecord(actor(), f.ref)).rejects.toMatchObject({
      code: 'TDMS_RECEIVER_MEMBER_CONFIGURATION_INVALID',
    });
  });
  it('requires current attachment identity and permission before releasing its acquisition', async () => {
    const f = await setup();
    const stored = f.db.state.revisions[0]!;
    stored.record.artifacts = [
      {
        memberId: 'member',
        sourceArtifactId: 'artifact',
        acquisitionId: 'acq',
        fileName: 'original.eb',
        mediaType: 'application/octet-stream',
        sha256: 'a'.repeat(64),
        byteLength: 5,
        immutableReadbackVerified: true,
        documentVersionId: null,
        registrationGap: null,
      },
    ];
    stored.artifactIdentities = [
      {
        memberId: 'member',
        sourceAttachmentId: 'attachment',
        sourceAttachmentVersion: 'v1',
        sha256: 'a'.repeat(64),
        byteLength: 5,
      },
    ];
    expect(() => assertReadStoredMembers(f.grant(), stored)).toThrow(
      'TDMS_RECEIVER_EXACT_MEMBER_DENIED',
    );
    f.setMembers({
      ...allowed,
      artifacts: [
        {
          memberId: 'member',
          sourceAttachmentId: 'attachment',
          sourceAttachmentVersion: 'v1',
          owners: allowed.records,
        },
      ],
    });
    expect(() => assertReadStoredMembers(f.grant(), stored)).not.toThrow();
    stored.artifactIdentities[0]!.sourceAttachmentVersion = 'v2';
    expect(() => assertReadStoredMembers(f.grant(), stored)).toThrow(
      'TDMS_RECEIVER_EXACT_MEMBER_DENIED',
    );
  });
  it('checks all time-bounded grants synchronously after the last asynchronous recheck', () => {
    const base = {
      scope: nativeScope,
      permissionRevision: 'r1',
      permittedMembers: allowed,
    };
    expect(() =>
      assertReadGrantsCurrent([
        { ...base, validUntil: new Date(Date.now() - 1).toISOString() },
        { ...base, validUntil: new Date(Date.now() + 60000).toISOString() },
      ]),
    ).toThrow('TDMS_SOURCE_PERMISSION_CHANGED');
    expect(() =>
      assertReadGrantsCurrent([{ ...base, validUntil: 'invalid' }]),
    ).toThrow('TDMS_SOURCE_PERMISSION_CHANGED');
  });
});
