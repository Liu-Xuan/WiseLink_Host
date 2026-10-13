import { prepareTdmsDailySourceImport } from '../../../server/modules/tdms-source/tdms-daily-metadata-contract';
import { adaptTdmsDailySource } from '../../../server/modules/tdms-source/tdms-daily-source-adapter';
import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import { HostDecisionTdmsSourceAuthorization } from '../../../server/modules/tdms-source/tdms-source.authorization';
import { hash } from '../../../server/modules/tdms-source/tdms-source.validation';
import { MemoryTdmsRepository, nativeScope } from './tdms-memory-double';
import { actor } from './tdms-fixtures';
import {
  copyComplete,
  syntheticCompleteEnvelope,
} from './tdms-complete-owned.fixture';
import { proofOfCurrent } from './tdms-current-contract.fixture';
import { efRequestStructuralRosters } from './tdms-efrequest-contract.fixture';
import {
  metadataAdItemGolden as golden,
  syntheticAdItem,
  syntheticCurrentEngineering,
  syntheticEfNamedMetadata,
  syntheticAdUnknownBusiness,
  currentRecordHash,
  resealMetadata,
} from './tdms-metadata-aditem.fixture';

const validate = prepareTdmsDailySourceImport;
const cases = {
  adItem: syntheticAdItem,
  efMetadata: syntheticEfNamedMetadata,
  adUnknownBusiness: syntheticAdUnknownBusiness,
  currentEpmEf: () => syntheticCurrentEngineering(),
  legacyEpmEf: () =>
    syntheticCurrentEngineering('EF', 'tdms-engineering-own-subtype@1'),
  currentEo: () => syntheticCurrentEngineering('EO'),
};
describe('new Source metadata and partial AD_ITEM through the existing Host consumer', () => {
  it.each(Object.keys(cases) as Array<keyof typeof cases>)(
    'accepts Source-pure-qualified synthetic %s without changing its record or snapshot',
    (name) => {
      const env = cases[name](),
        before = JSON.stringify(env),
        expected = golden.producerQualification[name];
      expect(currentRecordHash(env)).toBe(expected.recordSha256);
      expect(env.package.records[0].snapshotId).toBe(expected.snapshotId);
      expect(validate(env).envelope).toEqual(env);
      const native = adaptTdmsDailySource(env).output.nativePackage;
      expect(JSON.stringify(env)).toBe(before);
      expect(native.coverage.status).toBe('PARTIAL');
      expect(native.query.scopeMatch).toBe('UNKNOWN');
      expect(native.artifacts).toEqual([]);
    },
  );
  it('accounts current EPM EF explicitly without aliasing raw identity to EFRequest; legacy @1 interpretation stays intact', () => {
    const env = syntheticCurrentEngineering(),
      old = syntheticCurrentEngineering('EF', 'tdms-engineering-own-subtype@1');
    validate(env);
    validate(old);
    const record = env.package.records[0],
      p: any = record.rawFields.engineeringClassification;
    expect(p.resolvedSubtype).toBeNull();
    expect(p.disposition).toBe('OUT_OF_SCOPE');
    expect(p.reads[1].owner.scopeEvidence.engineeringSubtype).toBe('EF');
    expect(record.sourceRecordId).toContain(':wt.epm.EPMDocument:');
    expect(p.reads[1].owner.nativeTypeId).toBe(
      'WCTYPE|wt.epm.EPMDocument|com.airchina.DynamicDocument|com.airchina.EODocument',
    );
    expect(record.coverage.gaps).toContain(
      'NATIVE_EPM_EF_NOT_EFREQUEST_OUT_OF_CURRENT_SCOPE',
    );
    const prior: any =
      old.package.records[0].rawFields.engineeringClassification;
    expect(prior.resolvedSubtype).toBe('EF');
    expect(prior.disposition).toBe('IN_SCOPE');
    expect(old.package.records[0].coverage.gaps).not.toContain(
      'NATIVE_EPM_EF_NOT_EFREQUEST_OUT_OF_CURRENT_SCOPE',
    );
  });
  it.each([
    'unknown-revision',
    'wrong-disposition',
    'wrong-resolved',
    'alias-native-type',
    'one-read-drift',
  ])(
    'rejects current subtype %s without accepting a semantic rewrite',
    (change) => {
      const env = syntheticCurrentEngineering(),
        p: any = env.package.records[0].rawFields.engineeringClassification;
      if (change === 'unknown-revision')
        p.classificationRevision = p.requestedCriteria.classificationRevision =
          'tdms-engineering-own-subtype@3';
      if (change === 'wrong-disposition') p.disposition = 'IN_SCOPE';
      if (change === 'wrong-resolved') p.resolvedSubtype = 'EF';
      if (change === 'alias-native-type')
        for (const r of p.reads)
          r.owner.nativeTypeId =
            'WCTYPE|wt.doc.WTDocument|com.airchina.EFRequest';
      if (change === 'one-read-drift') p.reads[0].nativeSubtype.rawValue = 'EO';
      env.requestId = 'TDMSIMPORT-' + hash(env.package);
      expect(() => validate(env)).toThrow('TDMS_');
    },
  );
  it('accepts independent EFRequest and all 23 metadata/10 identity contexts without an SB/AD parent', () => {
    const env = syntheticEfNamedMetadata(),
      p = proofOfCurrent(env),
      read = p.reads[1],
      m = golden.efMetadataModel;
    expect(p.requestedCriteria.sourceProof.kind).toBe('CURRENT_DIRECTORY');
    expect(p.requestedCriteria.sourceProof).not.toHaveProperty(
      'parentSourceRecordId',
    );
    expect(p.scopeId).toBe('ENGINEERING_ASSESSMENT');
    for (const spec of [...m.ownMetadataFields, ...m.ownIdentityFields])
      for (const label of spec.labels)
        expect(
          read.fields.some(
            (f: any) =>
              f.sectionId === m.detailTabId + '::' + spec.sectionId &&
              f.value.actualLabel === label,
          ),
        ).toBe(true);
    const native = adaptTdmsDailySource(env).output.nativePackage.records[0];
    expect(native.sourceRecordId).toContain(':wt.doc.WTDocument:');
    expect(native.content.completeOwnedFields).toEqual(read.fields);
    expect(native.coverage.status).toBe('PARTIAL');
  });
  it('preserves unknown AD business applicability as NOT_READ/null and retains completion blockers', () => {
    const env = syntheticAdUnknownBusiness(),
      native = adaptTdmsDailySource(env).output.nativePackage.records[0];
    const p: any = native.rawFields.completeOwnedSource;
    expect(p.reads[1].owner.businessVersionEvidence.state).toBe('NOT_READ');
    expect(native.businessVersion).toBeNull();
    expect(native.coverage.gaps).toContain('COMPLETION_CERTIFICATE_NOT_ISSUED');
    expect(native.coverage.gaps).toContain('OWN_LAYOUT_REPRESENTATIVE_PENDING');
  });
  it('keeps current AD_ITEM own users reference-only, row creator unresolved, and all unknown own identity facets', () => {
    const env = syntheticAdItem(),
      native = adaptTdmsDailySource(env).output.nativePackage,
      record = native.records[0],
      p: any = record.rawFields.completeOwnedSource;
    expect(p.reads[1].fields).toHaveLength(51);
    expect(p.reads[1].relationTables).toHaveLength(6);
    expect(record.sourceVersion.confirmation).toBe('VERSION_UNCONFIRMED');
    expect(record.businessVersion).toBeNull();
    expect(p.reads[1].owner.nativeTypeId).toBeNull();
    const own = p.targetOccurrences.filter(
      (o: any) => o.origin === 'OWN_FIELD',
    );
    expect(own).toHaveLength(2);
    expect(
      own.every((o: any) => o.relationshipRole === 'OUT_OF_SCOPE_REFERENCE'),
    ).toBe(true);
    const creator = p.targetOccurrences.find(
      (o: any) => o.origin === 'RELATION_TABLE',
    );
    expect(creator.targetRef).toBe('OR:wt.org.WTUser:4321');
    expect(creator.relationshipRole).toBe('UNKNOWN');
    expect(creator.nativeColumnToken).toBe('creator');
    // The existing adapter retains this person reference in the observation;
    // it does not import a source/body relation for a WTUser.
    expect(native.relations).toEqual([]);
  });
  it('keeps historical AD_ITEM without paired native metadata under its old projection', () => {
    const env = syntheticCompleteEnvelope('AD_ITEM'),
      p = proofOfCurrent(env);
    for (const read of p.reads) {
      const f = read.fields[0];
      f.value.actualLabel = 'Created By:';
      f.links = [
        {
          targetRef: 'OR:wt.org.WTUser:1234',
          rawHref: '/infoPage?oid=OR:wt.org.WTUser:1234',
          numberRaw: 'SYNTHETIC-USER',
          nativeRole: 'RELATED',
          locator: f.fieldId + ' a',
        },
      ];
    }
    resealMetadata(env);
    const native = adaptTdmsDailySource(env).output.nativePackage.records[0],
      out: any = native.rawFields.completeOwnedSource;
    expect(out.targetOccurrences[0].relationshipRole).toBe('UNKNOWN');
    expect(out.reads[1].rosterEvidence).not.toHaveProperty('nativeTabStripIds');
  });
  it.each([
    'native-subtype',
    'technical-version',
    'business-version',
    'header',
    'header-version',
    'control-revision',
    'control-caption',
    'missing-pair',
    'strip-extra',
    'field-count',
    'field-order',
    'field-locator',
    'field-section',
    'borrowed-opinion',
    'modified',
    'created',
    'grid-panel',
    'grid-role',
    'grid-direction',
    'grid-duplicate',
    'grid-token',
    'unread-comment',
    'unread-comment-link',
    'tree-complete',
    'missing-read-grid',
    'caller-authority',
    'one-read-drift',
  ])('rejects AD_ITEM %s through strict current own binding', (change) => {
    const env = syntheticAdItem(),
      p = proofOfCurrent(env);
    for (const r of p.reads) {
      const o = r.owner,
        c = r.rosterEvidence.nonContentControls[0],
        t = r.relationTables[0];
      if (change === 'native-subtype') {
        o.nativeTypeId = 'WCTYPE|wt.change2.WTChangeActivity2|guessed.Type';
        o.nativeTypeEvidence.state = 'VALUE';
        o.nativeTypeEvidence.rawValue = o.nativeTypeId;
        o.nativeTypeEvidence.observedTotalCodepoints = o.nativeTypeId.length;
      }
      if (change === 'technical-version') {
        o.sourceVersion = {
          rawRevision: 'A',
          rawIteration: '1',
          confirmation: 'SOURCE_DECLARED',
        };
        o.technicalVersionEvidence = {
          ...o.technicalVersionEvidence,
          state: 'VALUE',
          rawValue: 'A.1',
          observedTotalCodepoints: 3,
        };
        o.technicalVersionFieldEvidence = copyComplete(
          o.technicalVersionEvidence,
        );
      }
      if (change === 'business-version')
        o.businessVersion = {
          rawRevision: '1',
          rawIteration: null,
          confirmation: 'SOURCE_DECLARED',
        };
      if (change === 'header') o.rawHeaderType = 'AD父单';
      if (change === 'header-version') o.rawHeaderIdentifier += ', A.1';
      if (change === 'control-revision')
        c.modelRevision = 'tdms-reviewed-efrequest-readonly-surfaces@1';
      if (change === 'control-caption') c.rawCaption = 'Details';
      if (change === 'missing-pair') delete r.rosterEvidence.nativeTabStripIds;
      if (change === 'strip-extra')
        r.rosterEvidence.nativeTabStripIds.splice(
          0,
          0,
          'infoPageinfoPanelID__unreviewed',
        );
      if (change === 'field-count') r.fields.splice(0, 1);
      if (change === 'field-order')
        [r.fields[0], r.fields[1]] = [r.fields[1], r.fields[0]];
      if (change === 'field-locator') {
        r.fields[0].fieldId = '#wrong td';
        r.fields[0].value.locator = r.fields[0].fieldId;
      }
      if (change === 'field-section')
        r.fields[0].sectionId = r.sections[1].sectionId;
      if (change === 'borrowed-opinion') {
        const f = r.fields.find(
          (f: any) => f.value.actualLabel === '评估意见:',
        );
        f.value.state = 'VALUE';
        f.value.rawValue = 'Borrowed parent approval';
        f.value.observedTotalCodepoints = f.value.rawValue.length;
      }
      if (change === 'modified')
        r.fields.find(
          (f: any) => f.value.actualLabel === 'Last Modified:',
        ).value.rawValue = '2026-10-12 09:00';
      if (change === 'created')
        r.fields.find(
          (f: any) => f.value.actualLabel === 'Created On:',
        ).value.rawValue = '2026-10-12 08:00';
      if (change === 'grid-panel') t.panelLocator += '_other';
      if (change === 'grid-role') t.relationshipRole = 'CURRENT_CONTENT';
      if (change === 'grid-direction') t.direction = 'SOURCE_TO_TARGET';
      if (change === 'grid-duplicate')
        r.relationTables.push({
          ...copyComplete(t),
          tableId: 'duplicate-grid',
        });
      if (change === 'grid-token')
        r.relationTables.find(
          (t: any) => t.gridId === 'mytreetable',
        ).rows[0].sourceLinks[0].nativeColumnToken = 'number';
      if (change === 'unread-comment') {
        const v = t.rows[0].cells[5];
        v.state = 'VALUE';
        v.rawValue = 'Unread description';
        v.observedTotalCodepoints = v.rawValue.length;
      }
      if (change === 'unread-comment-link')
        t.rows[0].sourceLinks = [
          {
            targetRef: 'OR:wt.doc.WTDocument:12',
            rawHref: '/infoPage?oid=OR:wt.doc.WTDocument:12',
            numberRaw: 'SYNTHETIC',
            nativeRole: 'UNREVIEWED_NATIVE_COLUMN',
            nativeColumnLabel: 'Attachment Description',
            nativeColumnToken: 'description',
            locator: t.panelLocator + ' a',
          },
        ];
      if (change === 'tree-complete') {
        const t = r.relationTables.find((t: any) => t.gridId === 'mytreetable');
        t.enumerationState = 'VALUE';
        t.stopReason = null;
        t.terminal.kind = 'NATIVE_END';
        t.terminal.nativeTerminal = true;
        t.terminal.allTreeNodesExpanded = true;
      }
      if (change === 'missing-read-grid') r.relationTables.shift();
      if (change === 'caller-authority') r.owner.reviewedNativeSubtype = true;
      efRequestStructuralRosters(r);
    }
    if (change === 'one-read-drift') p.reads[0].owner.stateRaw = 'Approved';
    resealMetadata(env);
    expect(() => validate(env)).toThrow('TDMS_');
  });
  it.each(['complete-coverage', 'scope-complete', 'business-assertion'])(
    'does not promote unknown AD business via %s',
    (change) => {
      const env = syntheticAdUnknownBusiness();
      if (change === 'complete-coverage')
        env.package.coverage.status = 'COMPLETE';
      if (change === 'scope-complete') env.package.query.scopeComplete = true;
      if (change === 'business-assertion')
        for (const r of proofOfCurrent(env).reads)
          r.owner.businessVersion = {
            rawRevision: '1',
            rawIteration: null,
            confirmation: 'SOURCE_DECLARED',
          };
      env.requestId = 'TDMSIMPORT-' + hash(env.package);
      expect(() => adaptTdmsDailySource(env)).toThrow('TDMS_');
    },
  );
  it('uses normal memory import/reconcile/idempotence and ten-key receipts with retained partial readback', async () => {
    const env = syntheticAdItem(),
      adapted = adaptTdmsDailySource(env),
      claims = copyComplete(adapted.memberClaims),
      repository = new MemoryTdmsRepository();
    const state = { allowed: true };
    const authorization = new HostDecisionTdmsSourceAuthorization(
      async ({ actor: a }) =>
        state.allowed &&
        a.tenantId === 'tenant-a' &&
        a.canonicalSubject.id === '123'
          ? [
              {
                scope: nativeScope,
                permissionRevision: 'synthetic-new-metadata',
              },
            ]
          : [],
      async ({ grant }) => ({
        ...grant,
        authorityRef: 'synthetic-import',
        captureRetentionAllowed: true,
        nativeProjectionAllowed: true,
        permittedMembers: claims,
      }),
      async ({ grant }) => ({
        ...grant,
        authorityRef: 'synthetic-read',
        retainedCaptureReadAllowed: true,
        permittedMembers: claims,
      }),
    );
    const artifacts = { acquire: jest.fn() },
      service = new TdmsSourceService(repository, authorization, artifacts, {
        assertRead: jest.fn(),
      });
    const receipt = await service.importDailyMetadata(actor(), env);
    expect(Object.keys(receipt)).toHaveLength(10);
    expect(receipt.requestId).toBe(env.requestId);
    expect(
      await service.importDailyMetadata(actor(), copyComplete(env)),
    ).toEqual(receipt);
    expect(repository.state.captures).toHaveLength(1);
    expect(
      (await service.readDailyMetadataImport(actor(), env.requestId)).package,
    ).toEqual(env.package);
    expect(repository.state.captures[0].receipt.executionVerified).toBe(false);
    state.allowed = false;
    await expect(service.importDailyMetadata(actor(), env)).rejects.toThrow();
    await expect(
      service.readDailyMetadataImport(actor(), env.requestId),
    ).rejects.toThrow();
    expect(artifacts.acquire).not.toHaveBeenCalled();
  });
});
