import { createHash } from 'node:crypto';
import type {
  TdmsPackageRecord,
  TdmsSourcePackage,
} from '../../../shared/tdms-source.interface';
import { sourcePackage } from '../../../server/modules/tdms-source/tdms-source.validation';
import { fileServiceImport } from '../../../server/modules/tdms-source/tdms-file-service-import.validation';
import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import {
  HostDecisionTdmsSourceAuthorization,
  UnconfiguredTdmsSourceAuthorization,
} from '../../../server/modules/tdms-source/tdms-source.authorization';
import { actor, fixture } from './tdms-fixtures';
import { MemoryTdmsRepository, nativeScope } from './tdms-memory-double';

const target = {
  sourceKey: 'TDMS',
  sourceInstanceId: 'instance',
  scopeId: 'narrow',
};
const state = (name: string) => ({ rawCode: name, rawName: name });
const metadata = (reason = 'STATE_NOT_ESTIMATED') => ({
  schemaVersion: 'wiselink.tdms-opinion-collection.v1',
  mode: 'METADATA_ONLY',
  reason,
  approvalSubject: null,
  before: null,
  after: null,
});
function assessment(approved = true): TdmsPackageRecord {
  const r = fixture().records[0]!;
  r.itemId = 'assessment';
  r.recordKind = 'ENGINEER_ASSESSMENT';
  r.sourceRecordId = 'OR:wt.change2.WTChangeOrder2:123';
  r.sourceVersion = {
    rawRevision: 'A',
    rawIteration: '2',
    confirmation: 'SOURCE_DECLARED',
  };
  r.title = 'Assessment-123';
  r.fileType = { rawCode: null, rawName: 'SB评估单' };
  r.state = state(approved ? 'Estimated' : 'Estimating');
  r.content = {};
  r.rawFields = {
    number: r.title,
    storageType: { ...r.fileType },
    opinionCollection: metadata(),
  };
  if (approved) {
    const observation = {
      sourceRecordId: r.sourceRecordId,
      recordKind: 'ENGINEER_ASSESSMENT',
      sourceVersion: { ...r.sourceVersion },
      state: { ...r.state },
      sourceModifiedAt: r.sourceModifiedAt,
      observedAt: r.observedAt,
      identitySelector: '#infoPageIdentityObjectIdentifier',
      stateSelector:
        '.attributePanel[oid] .attributePanel-label[State] => .attributePanel-value',
      versionSelector:
        '.attributePanel[oid] .attributePanel-label[Version] => .attributePanel-value',
      objectBinding: 'EXACT_CURRENT_DETAIL',
    };
    r.rawFields.opinionCollection = {
      schemaVersion: 'wiselink.tdms-opinion-collection.v1',
      mode: 'ESTIMATED_OPINION',
      reason: 'APPROVED_CURRENT_EXACT_VERSION',
      approvalSubject: {
        sourceRecordId: r.sourceRecordId,
        sourceVersion: { ...r.sourceVersion },
      },
      before: { ...observation, observedAt: '2026-10-05T09:59:59Z' },
      after: structuredClone(observation),
    };
    r.content.opinions = [
      {
        text: 'APPROVED-EXACT-BODY',
        author: null,
        state: { ...r.state },
        conditions: ['approved condition'],
        requiredActions: ['approved action'],
        sourceSelector:
          '.attributePanel[oid] .attributePanel-label[评估意见] => .attributePanel-value',
      },
    ];
  }
  return r;
}
function packet(approved = true): TdmsSourcePackage {
  const p = fixture();
  p.records = [assessment(approved)];
  return p;
}
function objectPacket(): TdmsSourcePackage {
  const p = packet();
  const r = p.records[0]!;
  r.sourceVersion = {
    rawRevision: null,
    rawIteration: null,
    confirmation: 'VERSION_UNCONFIRMED',
  };
  r.businessVersion = {
    rawRevision: 'R00',
    rawIteration: null,
    confirmation: 'SOURCE_DECLARED',
  };
  r.fileType = { rawCode: null, rawName: 'SB评估单' };
  r.rawFields.storageType = { ...r.fileType };
  r.rawFields.sourceModifiedRaw = '2026-09-22 11:35CST';
  r.coverage = {
    status: 'PARTIAL',
    readback: 'NON_ATOMIC',
    gaps: ['TECHNICAL_VERSION_UNEXPOSED'],
  };
  p.coverage = structuredClone(r.coverage);
  const e = evidence(p);
  e.reason = 'APPROVED_CURRENT_OBJECT_OBSERVATION';
  e.approvalSubject.sourceVersion = { ...r.sourceVersion };
  e.approvalSubject.businessVersion = { ...r.businessVersion };
  for (const o of [e.before, e.after]) {
    o.sourceVersion = { ...r.sourceVersion };
    o.businessVersion = { ...r.businessVersion };
    o.sourceModifiedRaw = r.rawFields.sourceModifiedRaw;
    o.detailType = 'SB评估单';
    o.detailTypeSelector = '#infoPageIdentityDisplayType';
    o.detailsTabSelector =
      '#infoPageinfoPanelID__infoPage_myTab_object_changeNoticeDetailsTab';
    o.businessVersionSelector =
      'fieldset#General td.attributePanel-label[SB评估单版本] + td.attributePanel-value';
    o.modifiedSelector =
      'fieldset#System td.attributePanel-label[Last Modified] + td.attributePanel-value';
    o.stateSelector = '#infoPageinfoPageTitleBarLifeCycleState';
    o.versionSelector = null;
  }
  r.content.opinions![0]!.sourceSelector =
    'fieldset td.attributePanel-label[评估意见] + td.attributePanel-value';
  return p;
}
function artifact() {
  const bytes = Buffer.from('LEGITIMATE-FILE');
  return {
    memberId: 'member',
    sourceAttachmentId: 'attachment',
    sourceAttachmentVersion: '1',
    fileName: 'source.pdf',
    mediaType: 'application/pdf',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.length,
    bytesBase64: bytes.toString('base64'),
  };
}
function setup() {
  const db = new MemoryTdmsRepository();
  const auth = new HostDecisionTdmsSourceAuthorization(
    async () => [{ scope: nativeScope, permissionRevision: '1' }],
    async ({ claims, grant }) => ({
      ...grant,
      authorityRef: 'host-only-authority',
      captureRetentionAllowed: true,
      nativeProjectionAllowed: true,
      permittedMembers: claims,
    }),
  );
  const authorizeImport = jest.spyOn(auth, 'authorizeImport');
  const transaction = jest.spyOn(db, 'transaction');
  const acquire = jest.fn(async ({ artifact: a }) => ({
    memberId: a.memberId,
    sourceArtifactId: 'SA',
    acquisitionId: 'ACQ',
    fileName: a.fileName,
    mediaType: a.mediaType,
    sha256: a.sha256,
    byteLength: a.byteLength,
    immutableReadbackVerified: true as const,
    documentVersionId: null,
    registrationGap: null,
  }));
  const acquireSelection = jest.fn(acquire.getMockImplementation()!);
  const service = new TdmsSourceService(
    db,
    auth,
    { acquire, acquireSelection },
    { assertRead: jest.fn() },
  );
  return {
    db,
    service,
    acquire,
    acquireSelection,
    authorizeImport,
    transaction,
  };
}
const evidence = (p: TdmsSourcePackage) =>
  p.records[0]!.rawFields.opinionCollection as any;

describe('new-ingress approved assessment content boundary', () => {
  const invalid: Array<[string, () => TdmsSourcePackage]> = [
    [
      'draft opinion',
      () => {
        const p = packet(false);
        p.records[0]!.content = assessment().content;
        return p;
      },
    ],
    [
      'unknown opinion',
      () => {
        const p = packet();
        p.records[0]!.state = null;
        return p;
      },
    ],
    [
      'ownerless COMMENT body',
      () => {
        const p = packet();
        p.records[0]!.recordKind = 'COMMENT';
        return p;
      },
    ],
    [
      'draft conditions/actions',
      () => {
        const p = packet(false);
        p.records[0]!.content = {
          conditions: ['DRAFT'],
          requiredActions: ['DRAFT'],
        };
        return p;
      },
    ],
    [
      'draft raw snippet',
      () => {
        const p = packet(false);
        p.records[0]!.rawFields.snippet = 'DRAFT';
        return p;
      },
    ],
    [
      'embedded draft assessment',
      () => {
        const p = fixture();
        p.records[0]!.recordKind = 'MANUFACTURER_FILE';
        p.records[0]!.rawFields.assessments = [assessment(false)];
        return p;
      },
    ],
    [
      'malformed opinions',
      () => {
        const p = packet();
        (p.records[0]!.content as any).opinions = { text: 'DRAFT' };
        return p;
      },
    ],
    [
      'orphan inline artifact',
      () => {
        const p = fixture();
        p.artifacts = [artifact()];
        return p;
      },
    ],
  ];
  it.each(invalid)(
    '%s is rejected before all side effects',
    async (_name, make) => {
      const x = setup();
      const p = make();
      expect(() => sourcePackage(p)).toThrow();
      await expect(
        x.service.importPackage(actor(), target, p),
      ).rejects.toThrow();
      expect(x.authorizeImport).not.toHaveBeenCalled();
      expect(x.transaction).not.toHaveBeenCalled();
      expect(x.acquire).not.toHaveBeenCalled();
      expect(x.acquireSelection).not.toHaveBeenCalled();
      expect(x.db.state.captures).toHaveLength(0);
    },
  );
  it('rejects FileService owner on an unapproved assessment before selection acquisition or persistence', async () => {
    const x = setup();
    const { bytesBase64: _bytes, ...a } = artifact();
    const input = {
      ...target,
      package: packet(false),
      artifactSelections: [
        {
          ...a,
          ownerItemIds: ['assessment'],
          selection: {
            bucketId: 'bucket',
            filePath: 'tdms-source/uploads/file.pdf',
            expectedProviderObjectId: 'object',
          },
        },
      ],
    };
    expect(() => fileServiceImport(input)).toThrow(
      'TDMS_UNAPPROVED_OPINION_ARTIFACT_FORBIDDEN',
    );
    await expect(
      x.service.importFileServicePackage(actor(), input),
    ).rejects.toThrow('TDMS_UNAPPROVED_OPINION_ARTIFACT_FORBIDDEN');
    expect(x.authorizeImport).not.toHaveBeenCalled();
    expect(x.transaction).not.toHaveBeenCalled();
    expect(x.acquire).not.toHaveBeenCalled();
    expect(x.acquireSelection).not.toHaveBeenCalled();
  });
  it('rechecks converted effective ownership at service boundary', async () => {
    const x = setup();
    const p = packet(false);
    p.artifacts = [artifact()];
    p.records[0]!.artifactMemberIds = ['member'];
    await expect(
      (x.service as any).importPrepared(actor(), nativeScope, p, 'untrusted'),
    ).rejects.toThrow('TDMS_UNAPPROVED_OPINION_ARTIFACT_FORBIDDEN');
    expect(x.authorizeImport).not.toHaveBeenCalled();
    expect(x.transaction).not.toHaveBeenCalled();
    expect(x.acquire).not.toHaveBeenCalled();
    expect(x.acquireSelection).not.toHaveBeenCalled();
  });
  it('source-declared approval does not enable an unconfigured Host provider', async () => {
    const x = setup();
    const service = new TdmsSourceService(
      x.db,
      new UnconfiguredTdmsSourceAuthorization(),
      { acquire: x.acquire },
      { assertRead: jest.fn() },
    );
    await expect(
      service.importPackage(actor(), target, packet()),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED' });
    expect(x.transaction).not.toHaveBeenCalled();
    expect(x.acquire).not.toHaveBeenCalled();
    expect(x.acquireSelection).not.toHaveBeenCalled();
  });
  it('accepts approved FileService owner but rejects sharing it with an unapproved assessment', async () => {
    const x = setup();
    const { bytesBase64: _bytes, ...a } = artifact();
    const input = {
      ...target,
      package: packet(),
      artifactSelections: [
        {
          ...a,
          ownerItemIds: ['assessment'],
          selection: {
            bucketId: 'bucket',
            filePath: 'tdms-source/uploads/file.pdf',
            expectedProviderObjectId: 'object',
          },
        },
      ],
    };
    await x.service.importFileServicePackage(actor(), input);
    expect(x.acquireSelection).toHaveBeenCalledTimes(1);
    expect(x.acquire).not.toHaveBeenCalled();
    const draft = assessment(false);
    draft.itemId = 'draft';
    draft.sourceRecordId += '0';
    input.package.records.push(draft);
    input.artifactSelections[0]!.ownerItemIds.push('draft');
    const rejected = setup();
    await expect(
      rejected.service.importFileServicePackage(actor(), input),
    ).rejects.toThrow('TDMS_UNAPPROVED_OPINION_ARTIFACT_FORBIDDEN');
    expect(rejected.authorizeImport).not.toHaveBeenCalled();
    expect(rejected.transaction).not.toHaveBeenCalled();
    expect(rejected.acquire).not.toHaveBeenCalled();
    expect(rejected.acquireSelection).not.toHaveBeenCalled();
  });
  it('accepts independently approved child under Estimating parent; parent never authorizes draft child', async () => {
    const p = fixture();
    p.records[0]!.recordKind = 'MANUFACTURER_FILE';
    p.records[0]!.state = state('Estimating');
    p.records.push(assessment());
    expect(sourcePackage(p)).toEqual(p);
    const x = setup();
    const result = await x.service.importPackage(actor(), target, p);
    expect(result.recordRevisionRefs).toHaveLength(2);
    p.records[0]!.state = state('Estimated');
    p.records[1]!.state = state('Estimating');
    expect(() => sourcePackage(p)).toThrow('TDMS_OPINION_NOT_APPROVED');
  });
  const conflicts: Array<[string, (p: TdmsSourcePackage) => void]> = [
    [
      'missing exact-mode storage type',
      (p) => {
        delete p.records[0]!.rawFields.storageType;
      },
    ],
    [
      'wrong exact-mode file type',
      (p) => {
        p.records[0]!.fileType = { rawCode: null, rawName: 'AEO' };
      },
    ],
    [
      'contradictory exact-mode storage type',
      (p) => {
        p.records[0]!.rawFields.storageType = {
          rawCode: null,
          rawName: 'OTHER',
        };
      },
    ],
    [
      'unsupported exact-mode raw type code',
      (p) => {
        p.records[0]!.fileType!.rawCode = 'other';
        p.records[0]!.rawFields.storageType = { ...p.records[0]!.fileType };
      },
    ],

    [
      'missing collection',
      (p) => {
        delete p.records[0]!.rawFields.opinionCollection;
      },
    ],
    [
      'wrong mode reason',
      (p) => {
        evidence(p).reason = 'STATE_NOT_ESTIMATED';
      },
    ],
    [
      'metadata approved reason',
      (p) => {
        evidence(p).mode = 'METADATA_ONLY';
      },
    ],
    [
      'missing subject',
      (p) => {
        evidence(p).approvalSubject = null;
      },
    ],
    [
      'wrong subject identity',
      (p) => {
        evidence(p).approvalSubject.sourceRecordId += '0';
      },
    ],
    [
      'wrong subject version',
      (p) => {
        evidence(p).approvalSubject.sourceVersion.rawIteration = '3';
      },
    ],
    [
      'missing before',
      (p) => {
        evidence(p).before = null;
      },
    ],
    [
      'missing after',
      (p) => {
        evidence(p).after = null;
      },
    ],
    [
      'missing version',
      (p) => {
        evidence(p).before.sourceVersion.rawIteration = null;
      },
    ],
    [
      'unconfirmed version',
      (p) => {
        evidence(p).after.sourceVersion.confirmation = 'VERSION_UNCONFIRMED';
      },
    ],
    [
      'different after version',
      (p) => {
        evidence(p).after.sourceVersion.rawRevision = 'B';
      },
    ],
    [
      'different after identity',
      (p) => {
        evidence(p).after.sourceRecordId += '0';
      },
    ],
    [
      'different after state',
      (p) => {
        evidence(p).after.state = state('Estimating');
      },
    ],
    [
      'different opinion state',
      (p) => {
        p.records[0]!.content.opinions![0]!.state = state('Estimating');
      },
    ],
    [
      'wrong native type',
      (p) => {
        p.records[0]!.sourceRecordId = 'OR:wt.doc.WTDocument:123';
      },
    ],
    [
      'VR never aliases OR',
      (p) => {
        p.records[0]!.sourceRecordId = 'VR:wt.change2.WTChangeOrder2:123';
      },
    ],
    [
      'synonym never approves',
      (p) => {
        p.records[0]!.state = state('APPROVED');
      },
    ],
    [
      'date-only time',
      (p) => {
        evidence(p).before.observedAt = '2026-10-05';
      },
    ],
    [
      'zone-less time',
      (p) => {
        evidence(p).before.observedAt = '2026-10-05T09:59:59';
      },
    ],
    [
      'missing time',
      (p) => {
        delete evidence(p).after.observedAt;
      },
    ],
    [
      'reversed times',
      (p) => {
        evidence(p).before.observedAt = '2026-10-05T10:00:01Z';
      },
    ],
    [
      'record time differs from after',
      (p) => {
        p.records[0]!.observedAt = '2026-10-05T10:00:01Z';
        p.observedAt = p.records[0]!.observedAt;
      },
    ],
    [
      'package before record',
      (p) => {
        p.observedAt = '2026-10-05T09:00:00Z';
      },
    ],
    [
      'changed modification time',
      (p) => {
        evidence(p).after.sourceModifiedAt = p.observedAt;
      },
    ],
    [
      'missing selector',
      (p) => {
        delete evidence(p).before.stateSelector;
      },
    ],
    [
      'unbound selector',
      (p) => {
        evidence(p).before.stateSelector = 'whole-page';
      },
    ],
    [
      'not exact current detail',
      (p) => {
        evidence(p).before.objectBinding = 'RELATION_ROW';
      },
    ],
    [
      'unexpected evidence body',
      (p) => {
        evidence(p).before.snippet = 'DRAFT';
      },
    ],
    [
      'missing opinion author',
      (p) => {
        delete (p.records[0]!.content.opinions![0] as any).author;
      },
    ],
    [
      'wrong opinion selector',
      (p) => {
        p.records[0]!.content.opinions![0]!.sourceSelector = 'body';
      },
    ],
    [
      'malformed opinion actions',
      (p) => {
        (p.records[0]!.content.opinions![0] as any).requiredActions = 'DRAFT';
      },
    ],
  ];
  it.each(conflicts)('rejects %s', (_name, mutate) => {
    const p = packet();
    mutate(p);
    expect(() => sourcePackage(p)).toThrow();
  });
  it('metadata-only COMMENT preserves its own raw state and forbids all bodies', () => {
    const p = packet(false);
    const r = p.records[0]!;
    r.recordKind = 'COMMENT';
    r.state = state('Comment-Draft');
    r.rawFields.opinionCollection = metadata('COMMENT_OWNER_UNVERIFIED');
    expect(sourcePackage(p).records[0]!.state).toEqual(state('Comment-Draft'));
    r.content.conditions = ['DRAFT'];
    expect(() => sourcePackage(p)).toThrow();
  });
  it.each(['MANUFACTURER_FILE', 'ENGINEERING_FILE'] as const)(
    'retains %s own body, conditions and legitimate artifact',
    async (kind) => {
      const p = fixture();
      const r = p.records[0]!;
      r.recordKind = kind;
      r.rawFields.description = 'LEGITIMATE-DOCUMENT-BODY';
      r.content.requiredActions = ['document action'];
      p.artifacts = [artifact()];
      r.artifactMemberIds = ['member'];
      expect(sourcePackage(p)).toEqual(p);
      const x = setup();
      await x.service.importPackage(actor(), target, p);
      expect(x.acquire).toHaveBeenCalledTimes(1);
      expect(x.db.state.revisions[0]!.record.rawFields).toEqual(r.rawFields);
    },
  );
  it('rejects recognized embedded relation opinions while retaining ordinary relation metadata', () => {
    const p = fixture();
    p.relations = [
      {
        sourceRelationId: 'edge',
        expectedHeadAssertionRef: null,
        rawKind: 'reference',
        controlledKind: 'REFERENCES',
        from: { kind: 'PACKAGE_RECORD', itemId: 'a' },
        to: { kind: 'UNRESOLVED', rawIdentity: 'X', versionGap: 'unknown' },
        authority: 'SOURCE_EXPLICIT',
        selector: 'row',
        observedAt: p.observedAt,
        coverage: p.coverage,
        scope: {},
        completionEffect: 'UNSPECIFIED',
        changeClass: 'UNSPECIFIED',
        rawFields: { basis: 'native relation metadata' },
      },
    ];
    expect(sourcePackage(p)).toEqual(p);
    p.relations[0]!.rawFields.extra = { opinion: 'DRAFT' };
    expect(() => sourcePackage(p)).toThrow('TDMS_EMBEDDED_OPINION_FORBIDDEN');
  });
  it.each([
    'assessment',
    'assessment_details',
    'assessment-opinion',
    'opinionText',
    'comment_body',
  ])('rejects recognized nested %s payloads', (key) => {
    const p = fixture();
    p.records[0]!.rawFields.extra = { [key]: { text: 'DRAFT' } };
    expect(() => sourcePackage(p)).toThrow('TDMS_EMBEDDED_OPINION_FORBIDDEN');
  });
  it('keeps source evidence separate from Host authorization, CAS and idempotency', async () => {
    const x = setup();
    const p = packet();
    const first = await x.service.importPackage(actor(), target, p);
    expect((await x.service.importPackage(actor(), target, p)).created).toBe(
      false,
    );
    const next = structuredClone(p);
    next.packageId = 'next';
    await expect(
      x.service.importPackage(actor(), target, next),
    ).rejects.toMatchObject({ code: 'TDMS_RECORD_HEAD_CAS_CONFLICT' });
    next.records[0]!.expectedHeadRevisionRef = first.recordRevisionRefs[0]!;
    await x.service.importPackage(actor(), target, next);
    expect(x.db.state.revisions).toHaveLength(2);
  });
  it('retains an approved current-object observation with explicit version and atomicity limits', async () => {
    const p = objectPacket();
    const original = structuredClone(p);
    expect(sourcePackage(p)).toEqual(original);
    const x = setup();
    const result = await x.service.importPackage(actor(), target, p);
    const read = await x.service.readRecord(
      actor(),
      result.recordRevisionRefs[0]!,
    );
    expect(read.record.sourceVersion).toEqual({
      rawRevision: null,
      rawIteration: null,
      confirmation: 'VERSION_UNCONFIRMED',
    });
    expect(read.record.businessVersion).toEqual({
      rawRevision: 'R00',
      rawIteration: null,
      confirmation: 'SOURCE_DECLARED',
    });
    expect(read.record.sourceModifiedAt).toBeNull();
    expect(read.record.rawFields.sourceModifiedRaw).toBe('2026-09-22 11:35CST');
    expect(read.record.coverage.readback).toBe('NON_ATOMIC');
    expect(result).toMatchObject({
      status: 'PARTIAL',
      engineeringAdoption: 'NOT_CREATED',
      executionVerified: false,
    });
    expect(result.gaps).toEqual(
      expect.arrayContaining([
        'TECHNICAL_VERSION_UNEXPOSED',
        'SOURCE_VERSION_UNCONFIRMED',
        'SOURCE_READBACK_NOT_ATOMIC_VERIFIED',
      ]),
    );
    expect(read.record.content).toEqual(p.records[0]!.content);
  });
  const objectConflicts: Array<[string, (p: TdmsSourcePackage) => void]> = [
    [
      'false exact-version promotion',
      (p) => {
        evidence(p).reason = 'APPROVED_CURRENT_EXACT_VERSION';
      },
    ],
    [
      'technical revision inferred from R00',
      (p) => {
        p.records[0]!.sourceVersion.rawRevision = 'R00';
      },
    ],
    [
      'invented technical iteration',
      (p) => {
        p.records[0]!.sourceVersion.rawIteration = '1';
      },
    ],
    [
      'invented modification timezone',
      (p) => {
        p.records[0]!.sourceModifiedAt = '2026-09-22T03:35:00Z';
      },
    ],
    [
      'empty raw modification',
      (p) => {
        p.records[0]!.rawFields.sourceModifiedRaw = '';
      },
    ],
    [
      'missing raw modification',
      (p) => {
        delete p.records[0]!.rawFields.sourceModifiedRaw;
      },
    ],
    [
      'changed raw modification',
      (p) => {
        evidence(p).after.sourceModifiedRaw = '2026-09-22 11:36CST';
      },
    ],
    [
      'different own type',
      (p) => {
        p.records[0]!.fileType = { rawCode: null, rawName: 'OTHER' };
      },
    ],
    [
      'missing stored storage type',
      (p) => {
        delete p.records[0]!.rawFields.storageType;
      },
    ],
    [
      'different stored storage type',
      (p) => {
        p.records[0]!.rawFields.storageType = {
          rawCode: null,
          rawName: 'OTHER',
        };
      },
    ],
    [
      'foreign after detail type',
      (p) => {
        evidence(p).after.detailType = 'SB文档';
      },
    ],
    [
      'missing detail binding',
      (p) => {
        delete evidence(p).before.detailsTabSelector;
      },
    ],
    [
      'wrong type selector',
      (p) => {
        evidence(p).before.detailTypeSelector = 'body';
      },
    ],
    [
      'wrong titlebar state selector',
      (p) => {
        evidence(p).before.stateSelector = 'relation-row';
      },
    ],
    [
      'missing own object',
      (p) => {
        delete evidence(p).before.sourceRecordId;
      },
    ],
    [
      'foreign object after',
      (p) => {
        evidence(p).after.sourceRecordId += '1';
      },
    ],
    [
      'business revision substituted as technical selector',
      (p) => {
        evidence(p).before.versionSelector =
          evidence(p).before.businessVersionSelector;
      },
    ],
    [
      'changed business revision',
      (p) => {
        evidence(p).after.businessVersion.rawRevision = 'R01';
      },
    ],
    [
      'missing business subject',
      (p) => {
        delete evidence(p).approvalSubject.businessVersion;
      },
    ],
    [
      'business iteration invented',
      (p) => {
        p.records[0]!.businessVersion!.rawIteration = '1';
      },
    ],
    [
      'missing after object observation',
      (p) => {
        evidence(p).after = null;
      },
    ],
    [
      'after no longer Estimated',
      (p) => {
        evidence(p).after.state = state('Estimating');
      },
    ],
    [
      'atomic record assertion',
      (p) => {
        p.records[0]!.coverage.readback = 'CONSISTENT';
      },
    ],
    [
      'atomic package assertion',
      (p) => {
        p.coverage.readback = 'CONSISTENT';
      },
    ],
    [
      'missing version limitation',
      (p) => {
        p.records[0]!.coverage.gaps = [];
      },
    ],
    [
      'missing package limitation',
      (p) => {
        p.coverage.gaps = [];
      },
    ],
    [
      'complete record assertion',
      (p) => {
        p.records[0]!.coverage.status = 'COMPLETE';
      },
    ],
    [
      'old opinion selector promoted',
      (p) => {
        p.records[0]!.content.opinions![0]!.sourceSelector =
          assessment().content.opinions![0]!.sourceSelector;
      },
    ],
    [
      'object observation artifact',
      (p) => {
        p.artifacts = [artifact()];
        p.records[0]!.artifactMemberIds = ['member'];
      },
    ],
  ];
  it.each(objectConflicts)(
    'rejects object observation %s before side effects',
    async (_name, mutate) => {
      const p = objectPacket();
      mutate(p);
      const x = setup();
      expect(() => sourcePackage(p)).toThrow();
      await expect(
        x.service.importPackage(actor(), target, p),
      ).rejects.toThrow();
      expect(x.authorizeImport).not.toHaveBeenCalled();
      expect(x.transaction).not.toHaveBeenCalled();
      expect(x.acquire).not.toHaveBeenCalled();
      expect(x.acquireSelection).not.toHaveBeenCalled();
    },
  );
  it('cannot claim the object-observation reason for an exact-version evidence shape', () => {
    const p = packet();
    evidence(p).reason = 'APPROVED_CURRENT_OBJECT_OBSERVATION';
    expect(() => sourcePackage(p)).toThrow();
  });
  it('approved object observation is independent of the parent state', () => {
    const p = objectPacket();
    const parent = fixture().records[0]!;
    parent.recordKind = 'MANUFACTURER_FILE';
    parent.state = state('Estimating');
    p.records.push(parent);
    expect(sourcePackage(p)).toEqual(p);
    parent.state = state('Estimated');
    p.records[0]!.state = state('Estimating');
    expect(() => sourcePackage(p)).toThrow('TDMS_OPINION_NOT_APPROVED');
  });
  it('body-limit metadata fallback can retain or clear valid object evidence without carrying a body', () => {
    const p = objectPacket();
    evidence(p).mode = 'METADATA_ONLY';
    evidence(p).reason = 'CONTENT_LIMIT_EXCEEDED';
    p.records[0]!.content = {};
    expect(sourcePackage(p)).toEqual(p);
    evidence(p).before = null;
    evidence(p).after = null;
    evidence(p).approvalSubject = null;
    expect(sourcePackage(p)).toEqual(p);
  });
  it('historical immutable draft observations remain readable without new-ingress validation or rewrite', async () => {
    const x = setup();
    const result = await x.service.importPackage(actor(), target, packet());
    // Seed an existing pre-policy observation directly; this is a historical-read regression, not new import permission.
    const stored = x.db.state.revisions[0]!.record;
    stored.state = state('Estimating');
    stored.rawFields = { oldSnapshot: 'OLD-DRAFT' };
    stored.content = {
      opinions: [
        {
          ...assessment().content.opinions![0]!,
          text: 'OLD-DRAFT',
          state: state('Estimating'),
        },
      ],
    };
    const before = structuredClone(x.db.state.revisions);
    expect(
      (await x.service.readRecord(actor(), result.recordRevisionRefs[0]!))
        .record.content,
    ).toEqual(stored.content);
    expect(x.db.state.revisions).toEqual(before);
  });
});
