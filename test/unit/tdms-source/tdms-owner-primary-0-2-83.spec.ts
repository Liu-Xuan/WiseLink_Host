import { prepareTdmsDailySourceImport as prepare } from '../../../server/modules/tdms-source/tdms-daily-metadata-contract';
import { adaptTdmsDailySource as adapt } from '../../../server/modules/tdms-source/tdms-daily-source-adapter';
import { hash } from '../../../server/modules/tdms-source/tdms-source.validation';
import { actor } from './tdms-fixtures';
import { proofOfCurrent } from './tdms-current-contract.fixture';
import {
  syntheticOwnerPrimaryStage,
  ownerPrimaryServices,
} from './tdms-owner-primary-0-2-83.fixture';

function rejectRaw(
  env: ReturnType<typeof syntheticOwnerPrimaryStage>['env'],
  code?: string,
) {
  env.requestId = 'TDMSIMPORT-' + hash(env.package);
  const raw = JSON.stringify(env);
  for (const consume of [prepare, adapt]) {
    let error: unknown;
    try {
      consume(env);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      statusCode: 400,
      code: code ?? expect.stringMatching(/^TDMS_/u),
    });
    expect(error).not.toBeInstanceOf(TypeError);
  }
  expect(JSON.stringify(env)).toBe(raw);
}

describe('Source0.2.83 owner/PRIMARY partial stage through actual Host consumers (synthetic)', () => {
  it.each(['SB', 'SL', 'MT', 'AD', 'SIL', 'SB-IN'] as const)(
    'accepts qualified %s without four-scope blacklist or full promotion',
    (scope) => {
      const { env } = syntheticOwnerPrimaryStage(
        scope,
        scope === 'SIL' || scope === 'SB-IN'
          ? 'Estimated'
          : scope === 'AD'
            ? 'Estimated'
            : 'Estimating',
      );
      const raw = JSON.stringify(env);
      expect(prepare(env).envelope).toEqual(env);
      const native = adapt(env).output.nativePackage;
      expect(native.records[0].coverage).toMatchObject({
        status: 'PARTIAL',
        readback: 'NON_ATOMIC',
      });
      expect(native.records[0].formalDocumentArtifactMemberId).toBeNull();
      expect(native.records[0].relatedDocumentVersionIds).toEqual([]);
      expect(env.package.query).toMatchObject({
        scopeComplete: false,
        scopeMatch: 'UNKNOWN',
        actualCriteria: null,
      });
      expect(JSON.stringify(env)).toBe(raw);
    },
  );
  it.each(['SIL', 'SB-IN'] as const)(
    'rejects unqualified %s while preserving its qualified path',
    (scope) => {
      const { env } = syntheticOwnerPrimaryStage('SL', 'Estimating');
      const visit = (value: any): void => {
        if (!value || typeof value !== 'object') return;
        for (const [key, entry] of Object.entries(value)) {
          if (['scopeId', 'businessType'].includes(key) && entry === 'SL')
            value[key] = scope;
          else visit(entry);
        }
      };
      visit(env);
      rejectRaw(env, 'TDMS_COMPLETE_OWNER_PRIMARY_STAGE_INVALID');
    },
  );
  it.each([
    'missing-primary',
    'duplicate-primary',
    'wrong-role',
    'wrong-owner',
    'technical-version',
    'business-version',
    'metadata-gap',
    'bytes-collected',
    'unread-details',
    'resolved-deferred',
    'purpose-on-deferred',
    'relations',
    'unknown-stage',
  ])(
    'rejects %s at actual prepare/adapter rather than treating partial as full',
    (change) => {
      const { env } = syntheticOwnerPrimaryStage();
      for (const read of proofOfCurrent(env).reads) {
        const a = read.attachments[0];
        if (change === 'missing-primary') read.attachments = [];
        if (change === 'duplicate-primary')
          read.attachments.push({
            ...a,
            attachmentId: a.attachmentId + '-duplicate',
          });
        if (change === 'wrong-role') a.role = 'SECONDARY';
        if (change === 'wrong-owner') a.ownerSourceRecordId += '0';
        if (change === 'technical-version')
          a.primaryMetadata.ownerTechnicalVersion.rawRevision = 'B';
        if (change === 'business-version')
          a.primaryMetadata.ownerBusinessVersion.rawRevision = 'changed';
        if (change === 'metadata-gap')
          a.primaryMetadata.metadataGapCodes = ['UNREAD'];
        if (change === 'bytes-collected')
          a.primaryMetadata.bytesCollected = true;
        if (change === 'unread-details') read.tabs[0].state = 'NOT_READ';
        if (change === 'resolved-deferred') read.tabs[1].state = 'VALUE';
        if (change === 'purpose-on-deferred') read.tabs[1].purposeEvidence = {};
        if (change === 'relations') read.relationTables = [{}];
      }
      if (change === 'unknown-stage')
        proofOfCurrent(env).requestedCriteria.collectionStage = 'ALL';
      rejectRaw(env);
    },
  );
  it.each(['NOT_APPLICABLE', 'VALUE', 'unknown-label', 'AD版本'])(
    'retains AD exact business-version fallback, rejecting %s',
    (change) => {
      const { env } = syntheticOwnerPrimaryStage('AD', 'Estimated');
      for (const read of proofOfCurrent(env).reads) {
        const e = read.owner.businessVersionEvidence;
        if (change === 'NOT_APPLICABLE' || change === 'VALUE') e.state = change;
        else e.actualLabel = change;
      }
      rejectRaw(env);
    },
  );
  it.each(['null-roster', 'null-before', 'missing-before', 'roster-array'])(
    'rejects stage roster shape %s with typed 400',
    (change) => {
      const { env } = syntheticOwnerPrimaryStage();
      for (const read of proofOfCurrent(env).reads) {
        if (change === 'null-roster')
          read.rosterEvidence.structuralRosters = [null];
        if (change === 'null-before')
          read.rosterEvidence.structuralRosters[0].before = null;
        if (change === 'missing-before')
          delete read.rosterEvidence.structuralRosters[0].before;
        if (change === 'roster-array')
          read.rosterEvidence.structuralRosters = [[]];
      }
      rejectRaw(env);
    },
  );
  it('does not treat Manufacturer Estimating PRIMARY as an engineer opinion admission', () => {
    const { env } = syntheticOwnerPrimaryStage('SL', 'Estimating');
    expect(prepare(env).envelope.package.records[0].kind).toBe(
      'MANUFACTURER_FILE',
    );
    expect(
      adapt(env).output.nativePackage.records[0].rawFields.completeOwnedSource,
    ).toEqual(proofOfCurrent(env));
    for (const read of proofOfCurrent(env).reads)
      expect(
        read.tabs.filter((t: any) => t.state === 'NOT_READ').length,
      ).toBeGreaterThan(0);
  });
  it('runs real receiver preflight/stage/read plus SourceService POST/replay/GET/every SourceRef, retaining 11/10-field contracts and no formal DVI', async () => {
    const s = ownerPrimaryServices(),
      { env, binding, request } = s;
    const raw = JSON.stringify(env);
    expect(Object.keys(await s.receiver.binding(request))).toHaveLength(11);
    const preflight = await s.receiver.preflight(
      request,
      env.requestId,
      binding.bindingId,
      { package: env.package },
    );
    expect(preflight.status).toBe('AUTHORIZED_UPLOAD');
    expect(s.f.activity.downloads).toBe(0);
    const staged = await s.receiver.stage(
      request,
      env.requestId,
      binding.bindingId,
      { package: env.package, selection: s.selection },
    );
    expect(staged).toMatchObject({
      status: 'STAGED_CANDIDATE',
      readbackVerified: true,
      documentVersionId: null,
    });
    expect(
      await s.receiver.read(request, env.requestId, binding.bindingId),
    ).toEqual(staged);
    const receipt = await s.service.importDailyMetadata(actor(), env);
    expect(Object.keys(receipt)).toHaveLength(10);
    expect(receipt.documentVersionMappings).toHaveLength(1);
    expect(receipt.documentVersionMappings[0]).toMatchObject({
      status: 'REVIEW_REQUIRED',
      documentVersionId: null,
      readbackVerified: false,
    });
    const downloads = s.f.activity.downloads;
    expect(await s.service.importDailyMetadata(actor(), env)).toEqual(receipt);
    expect(s.f.activity.downloads).toBe(downloads);
    expect(
      (await s.service.readDailyMetadataImport(actor(), env.requestId)).package,
    ).toEqual(env.package);
    expect(receipt.sourceRefs).toHaveLength(3);
    for (const ref of receipt.sourceRefs)
      expect(await s.service.readDailySourceRef(actor(), ref)).toBeDefined();
    expect(s.repository.state.captures).toHaveLength(1);
    expect(s.documents.assertRead).not.toHaveBeenCalled();
    expect(JSON.stringify(env)).toBe(raw);
    s.f.actions.READ_HISTORY.allowed = false;
    await expect(
      s.service.readDailyMetadataImport(actor(), env.requestId),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND', statusCode: 404 });
    // Independent READ_RECORD still permits the exact SourceRef, but this
    // three-action subset cannot complete the normal POST + GET client chain.
    expect(
      await s.service.readDailySourceRef(actor(), receipt.sourceRefs[0]),
    ).toBeDefined();
    s.f.actions.READ_RECORD.permittedMembers.artifacts = [];
    await expect(
      s.receiver.read(request, env.requestId, binding.bindingId),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it('does not confer identity or Source rights by accepting stage syntax', async () => {
    const s = ownerPrimaryServices();
    s.identity.valid = false;
    await expect(
      s.receiver.preflight(s.request, s.env.requestId, s.binding.bindingId, {
        package: s.env.package,
      }),
    ).rejects.toMatchObject({
      code: 'OFFICIAL_OAUTH_SESSION_REQUIRED',
      statusCode: 401,
    });
    s.identity.valid = true;
    s.f.actions.IMPORT.allowed = false;
    await expect(
      s.receiver.preflight(s.request, s.env.requestId, s.binding.bindingId, {
        package: s.env.package,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(s.f.activity.downloads).toBe(0);
    expect(s.repository.state.captures).toHaveLength(0);
  });
});
