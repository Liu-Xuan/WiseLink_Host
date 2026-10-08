import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import {
  UnconfiguredTdmsSourceAuthorization,
  UnconfiguredTdmsDocumentAccess,
} from '../../../server/modules/tdms-source/tdms-source.authorization';
import { UnconfiguredTdmsArtifactStore } from '../../../server/modules/tdms-source/tdms-source.module';
import { UnconfiguredTdmsRuntimeReader } from '../../../server/modules/tdms-source/tdms-runtime-reader.port';
import {
  sourcePackage,
  packageGaps,
} from '../../../server/modules/tdms-source/tdms-source.validation';

import { actor, fixture } from './tdms-fixtures';

describe('TDMS native rebuilt first stage', () => {
  const originalSandbox = process.env.SANDBOX_ID;
  afterAll(() => {
    if (originalSandbox === undefined) delete process.env.SANDBOX_ID;
    else process.env.SANDBOX_ID = originalSandbox;
  });
  it('disabled catalogue is empty and does not read DB', async () => {
    const db = { transaction: jest.fn() };
    const s = new TdmsSourceService(
      db,
      new UnconfiguredTdmsSourceAuthorization(),
      new UnconfiguredTdmsArtifactStore(),
      new UnconfiguredTdmsDocumentAccess(),
    );
    expect(await s.catalogue(actor())).toMatchObject({
      records: [],
      sourceStatus: 'DISABLED',
      readPerformed: false,
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it('disabled exact and relation routes fail closed before touching absent native DB tables', async () => {
    const db = { transaction: jest.fn() };
    const s = new TdmsSourceService(
      db,
      new UnconfiguredTdmsSourceAuthorization(),
      new UnconfiguredTdmsArtifactStore(),
      new UnconfiguredTdmsDocumentAccess(),
    );
    await expect(
      s.readRecord(actor(), 'known-or-guessed-ref'),
    ).rejects.toMatchObject({
      code: 'TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED',
      statusCode: 503,
    });
    await expect(
      s.readRelations(actor(), 'known-or-guessed-ref'),
    ).rejects.toMatchObject({
      code: 'TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED',
      statusCode: 503,
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it('package cannot enable source import', async () => {
    const db = { transaction: jest.fn() };
    const s = new TdmsSourceService(
      db,
      new UnconfiguredTdmsSourceAuthorization(),
      new UnconfiguredTdmsArtifactStore(),
      new UnconfiguredTdmsDocumentAccess(),
    );
    await expect(
      s.importPackage(
        actor(),
        { sourceKey: 'TDMS', sourceInstanceId: 'instance', scopeId: 'narrow' },
        fixture(),
      ),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED' });
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it('rejects unknown caller actor/tenant data in package', () => {
    expect(() => sourcePackage({ ...fixture(), tenantId: 'attacker' })).toThrow(
      'TDMS_INPUT_UNKNOWN_FIELD',
    );
  });
  it('retains unknown type, raw checkbox and contradictory body', () => {
    const p = fixture();
    p.records[0]!.fileType = { rawCode: 'NEW_TYPE', rawName: 'unknown' };
    expect(sourcePackage(p).records[0]).toEqual(p.records[0]);
  });
  it('query requested/actual mismatch prevents COMPLETE', () => {
    const p = fixture();
    p.query.actualCriteria = { type: 'MT' };
    expect(packageGaps(sourcePackage(p))).toContain(
      'QUERY_CRITERIA_NOT_VERIFIED_MATCH',
    );
  });
  it('unread metadata attachments remain NOT_READ', () => {
    const p = fixture();
    p.records[0]!.unreadAttachments = [
      {
        sourceAttachmentId: 'A',
        sourceAttachmentVersion: null,
        fileName: 'x',
        mediaType: null,
        byteLength: null,
        readStatus: 'NOT_READ',
        gap: 'not acquired',
        selector: 'row',
      },
    ];
    expect(packageGaps(sourcePackage(p))).toContain('ATTACHMENTS_NOT_READ');
    expect(sourcePackage(p).records[0]!.unreadAttachments![0]!.readStatus).toBe(
      'NOT_READ',
    );
  });
  it('runtime service port cannot impersonate public actor', async () => {
    await expect(
      new UnconfiguredTdmsRuntimeReader().read(),
    ).rejects.toMatchObject({
      code: 'TDMS_RUNTIME_CALLER_AUTHORIZATION_NOT_CONNECTED',
    });
  });
});
