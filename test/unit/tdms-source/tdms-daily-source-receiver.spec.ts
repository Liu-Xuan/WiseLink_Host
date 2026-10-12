import { createHash } from 'node:crypto';
import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import {
  HostDecisionTdmsSourceAuthorization,
  UnconfiguredTdmsSourceAuthorization,
} from '../../../server/modules/tdms-source/tdms-source.authorization';
import {
  adaptTdmsDailySource,
  TDMS_DAILY_SOURCE_ADAPTER_VERSION,
} from '../../../server/modules/tdms-source/tdms-daily-source-adapter';
import {
  hash,
  sourcePackage,
} from '../../../server/modules/tdms-source/tdms-source.validation';
import type { TdmsArtifactStore } from '../../../server/modules/tdms-source/tdms-source.types';
import { MemoryTdmsRepository, nativeScope } from './tdms-memory-double';
import { actor } from './tdms-fixtures';
import {
  dailyIdentity,
  seal,
  syntheticFullDailyEnvelope,
  syntheticOwnedEnvelope,
  sourceTime,
  syntheticBoundedEnvelope,
  sealBounded,
  type BoundedProfile,
} from './tdms-daily-source.fixture';
import { prepareTdmsDailyMetadataImport } from '../../../server/modules/tdms-source/tdms-daily-metadata-contract';

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('Source51 bounded body through the existing receiver (synthetic only)', () => {
  it.each<BoundedProfile>(['AD_PROCESSING_FORM', 'SB_PROCESSING_FORM', 'SB_ASSESSMENT_FORM', 'ENGINEERING_INDEPENDENT'])(
    'retains %s v2 raw/provenance and partial/unread state without authority promotion', async profile => {
      const { envelope, proof } = syntheticBoundedEnvelope(profile), before = JSON.stringify(envelope);
      const s = setup(envelope), first = await s.service.importDailyMetadata(actor(), envelope);
      expect(Object.keys(first)).toHaveLength(10); expect(first.relationCount).toBe(0); expect(first.artifactCount).toBe(0);
      expect(JSON.stringify(envelope)).toBe(before);
      expect(s.prepared.envelope).toEqual(envelope);
      const native = s.prepared.output.nativePackage.records[0];
      expect(native.content.boundedOwnedBody).toEqual(envelope.package.records[0].content.boundedOwnedBody);
      expect(native.content).not.toHaveProperty('ownedVisibleBusinessContent'); expect(native.content).not.toHaveProperty('opinions');
      expect(native.rawFields.profileOwnedBody).toEqual(proof);
      expect(native.fieldProvenance).toEqual(envelope.package.records[0].provenance);
      expect(proof).toMatchObject({ sourceReady: false, requiredContentComplete: false, purpose: 'COVERAGE' });
      expect(proof.relationManifest.every(r => r.state === 'UNREAD' && r.reportedCount === null && r.capturedCount === null && r.targetOwnerReads === 0)).toBe(true);
      expect(native.coverage).toEqual(envelope.package.coverage);
      if (profile !== 'ENGINEERING_INDEPENDENT') expect(native.sourceVersion).toEqual({ rawRevision: null, rawIteration: null, confirmation: 'VERSION_UNCONFIRMED' });
      expect(await s.service.importDailyMetadata(actor(), copy(envelope))).toEqual(first);
      expect(s.repository.state.captures).toHaveLength(1);
      const stored = await s.service.readDailyMetadataImport(actor(), envelope.requestId);
      expect(stored.package).toEqual(envelope.package);
      expect(s.repository.state.captures[0].packageHash).toBe(hash(envelope.package));
      expect(s.repository.state.captures[0].dailyMetadata?.adapter?.outputDigest).toBe(hash(s.prepared.output));
      expect(s.artifacts.acquire).not.toHaveBeenCalled(); expect(s.documents.assertRead).not.toHaveBeenCalled();
    });
  it('requires current independent import/read authority and memberships for the new body too', async () => {
    const { envelope } = syntheticBoundedEnvelope(); const s = setup(envelope);
    const unavailable = new TdmsSourceService(s.repository, new UnconfiguredTdmsSourceAuthorization(), s.artifacts, s.documents);
    await expect(unavailable.importDailyMetadata(actor(), envelope)).rejects.toMatchObject({ statusCode: 503 });
    expect(s.repository.state.captures).toEqual([]);
    await s.service.importDailyMetadata(actor(), envelope); s.state.readAllowed = false;
    await expect(s.service.readDailyMetadataImport(actor(), envelope.requestId)).rejects.toThrow();
    s.state.readAllowed = true; s.state.scopes = [];
    await expect(s.service.importDailyMetadata(actor(), envelope)).rejects.toThrow();
    expect(s.repository.state.captures).toHaveLength(1);
  });
  it('keeps legacy metadata preparation closed to bounded bodies', () => {
    expect(() => prepareTdmsDailyMetadataImport(syntheticBoundedEnvelope().envelope)).toThrow('TDMS_DAILY_METADATA_KIND_UNSUPPORTED');
  });
  it('preserves blank/absent/not-loaded distinctions and exact bounded unicode/whitespace truncation', () => {
    const { envelope, proof } = syntheticBoundedEnvelope();
    for (const read of proof.reads) {
      const f = read.fields[3]; f.rawBoundedValue = ' 560 / 760 TBD\n😀 '.repeat(10);
      f.truncation = { limit: 8000, truncated: true, capturedCodepoints: [...f.rawBoundedValue].length, observedTotalCodepoints: 999 };
    }
    envelope.package.records[0].content.boundedOwnedBody = copy(proof.reads[1].fields);
    envelope.package.records[0].coverage.gaps.push('CONTENT_TRUNCATED'); envelope.package.coverage.gaps.push('CONTENT_TRUNCATED'); sealBounded(envelope);
    const native = adaptTdmsDailySource(envelope).output.nativePackage.records[0];
    expect(native.content.boundedOwnedBody).toEqual(proof.reads[1].fields);
    expect(new Set(native.content.boundedOwnedBody?.map(f => f.presence))).toEqual(new Set(['PRESENT_BLANK', 'PRESENT_VALUE', 'ABSENT', 'NOT_LOADED']));
  });
  it('uses dynamic locator comparison only for snapshot identity while preserving original bytes/digest', () => {
    const { envelope } = syntheticBoundedEnvelope('ENGINEERING_INDEPENDENT');
    const changed = JSON.parse(JSON.stringify(envelope).replaceAll('jcaGen_101', 'jcaGen_999')) as typeof envelope;
    sealBounded(changed);
    expect(changed.package.records[0].snapshotId).toBe(envelope.package.records[0].snapshotId);
    expect(changed.requestId).not.toBe(envelope.requestId);
    expect(adaptTdmsDailySource(changed).envelope).toEqual(changed);
    expect(JSON.stringify(adaptTdmsDailySource(changed).output)).toContain('jcaGen_999');
  });
  it.each(['version', 'purpose', 'sourceReady', 'requiredContentComplete', 'alias', 'missing-proof', 'legacy-mix', 'not-loaded-as-absent',
    'double-read', 'owner', 'source-version', 'panel', 'field-order', 'count', 'limit', 'truncation', 'manifest', 'provenance', 'gaps'])(
    'rejects %s on the native receiver boundary before storage', change => {
      const p = copy(adaptTdmsDailySource(syntheticBoundedEnvelope().envelope).output.nativePackage);
      const r = p.records[0], body = r.rawFields.profileOwnedBody as ReturnType<typeof syntheticBoundedEnvelope>['proof'];
      switch (change) {
        case 'version': body.bodyRevision = 'tdms-owned-body-observation@1'; break;
        case 'purpose': body.purpose = 'PROBE'; break;
        case 'sourceReady': body.sourceReady = true; break;
        case 'requiredContentComplete': body.requiredContentComplete = true; break;
        case 'alias': r.content = { ownedVisibleBusinessContent: r.content.boundedOwnedBody as unknown as Array<Record<string, unknown>> }; break;
        case 'missing-proof': delete r.rawFields.profileOwnedBody; break;
        case 'legacy-mix': r.rawFields.ownedBusinessContent = {}; break;
        case 'not-loaded-as-absent': for (const read of body.reads) read.fields.at(-1)!.nativeControl = null; break;
        case 'double-read': body.reads[0].fields[3].rawBoundedValue = 'changed'; break;
        case 'owner': for (const read of body.reads) read.owner.sourceRecordId = 'OR:wt.change2.WTChangeRequest2:999'; break;
        case 'source-version': r.sourceVersion = { rawRevision: 'A', rawIteration: '1', confirmation: 'SOURCE_DECLARED' }; break;
        case 'panel': for (const read of body.reads) read.fields[0].panelLocator = '#infoPage_myTab_object_changeRequestDetailsTab'; break;
        case 'field-order': for (const read of body.reads) read.fields.reverse(); break;
        case 'count': for (const read of body.reads) read.fields[3].truncation.capturedCodepoints += 1; break;
        case 'limit': for (const read of body.reads) read.fields[3].truncation.limit = 7999 as 8000; break;
        case 'truncation': for (const read of body.reads) read.fields[3].truncation.truncated = true; break;
        case 'manifest': body.relationManifest[0].reportedCount = 0 as unknown as null; break;
        case 'provenance': r.fieldProvenance[0].observationRef = 'OR:wt.change2.WTChangeRequest2:999'; break;
        case 'gaps': r.coverage.gaps = ['PROBE_ONLY']; break;
      }
      expect(() => sourcePackage(p)).toThrow('TDMS_');
    });
  it.each(['edges', 'artifacts', 'scope-complete', 'scope-match', 'complete-coverage'])(
    'refuses package-level %s promotion in the daily path', change => {
      const { envelope } = syntheticBoundedEnvelope();
      if (change === 'edges') envelope.package.edges.push({} as never);
      if (change === 'artifacts') envelope.package.artifactBindings.push({} as never);
      if (change === 'scope-complete') envelope.package.query.scopeComplete = true;
      if (change === 'scope-match') envelope.package.query.scopeMatch = 'MATCHED';
      if (change === 'complete-coverage') envelope.package.coverage.status = 'COMPLETE';
      sealBounded(envelope); expect(() => adaptTdmsDailySource(envelope)).toThrow('TDMS_');
    });
});
function setup(envelope = syntheticFullDailyEnvelope()) {
  const prepared = adaptTdmsDailySource(envelope),
    allowed = copy(prepared.memberClaims);
  const state = {
    enabled: true,
    importAllowed: true,
    readAllowed: true,
    revision: 'synthetic-1',
    scopes: [nativeScope],
  };
  const repository = new MemoryTdmsRepository();
  // Independent synthetic authority only. Never bound in production AppModule.
  const authorization = new HostDecisionTdmsSourceAuthorization(
    async ({ actor: a, action }) =>
      a.tenantId === 'tenant-a' &&
      a.canonicalSubject.id === '123' &&
      state.enabled &&
      (action !== 'IMPORT' || state.importAllowed)
        ? state.scopes.map((scope) => ({
            scope,
            permissionRevision: state.revision,
          }))
        : [],
    async ({ grant }) => ({
      ...grant,
      authorityRef: 'synthetic-import',
      captureRetentionAllowed: true,
      nativeProjectionAllowed: true,
      permittedMembers: copy(allowed),
    }),
    async ({ grant }) => ({
      ...grant,
      authorityRef: 'synthetic-read',
      retainedCaptureReadAllowed: true,
      permittedMembers: state.readAllowed
        ? copy(allowed)
        : { records: [], relationIds: [], artifacts: [] },
    }),
  );
  const artifacts: TdmsArtifactStore = { acquire: jest.fn() },
    documents = { assertRead: jest.fn() };
  return {
    envelope,
    prepared,
    allowed,
    state,
    repository,
    artifacts,
    documents,
    service: new TdmsSourceService(
      repository,
      authorization,
      artifacts,
      documents,
    ),
  };
}
describe('versioned daily source adapter through the existing native receiver/storage', () => {
  it('keeps SB/AD + parallel same-business-version forms and exact source literals, storing original and output hashes', async () => {
    const env = syntheticFullDailyEnvelope();
    const s = setup(env),
      receipt = await s.service.importDailyMetadata(actor(), env);
    expect(Object.keys(receipt)).toHaveLength(10);
    expect(receipt.objectCount).toBe(2);
    expect(receipt.artifactCount).toBe(0);
    expect(s.repository.state.revisions).toHaveLength(2);
    expect(s.repository.state.captures).toHaveLength(1);
    const c = s.repository.state.captures[0]!;
    expect(c.dailyMetadata?.envelope).toEqual(env);
    expect(c.packageHash).toBe(hash(env.package));
    expect(c.dailyMetadata?.adapter?.adapterVersion).toBe(
      TDMS_DAILY_SOURCE_ADAPTER_VERSION,
    );
    expect(c.dailyMetadata?.adapter?.outputDigest).toBe(
      hash(s.prepared.output),
    );
    expect(
      c.dailyMetadata?.nativeRetention?.records.map((r) => r.sourceRevisionRef),
    ).toEqual(c.receipt.recordRevisionRefs);
    const saved = await s.service.readDailyMetadataImport(
      actor(),
      env.requestId,
    );
    expect(saved.package).toEqual(env.package);
    for (const observed of [
      syntheticOwnedEnvelope(201, 'PROCESSING_SHEET'),
      syntheticOwnedEnvelope(301, 'ENGINEER_ASSESSMENT'),
      syntheticOwnedEnvelope(302, 'ENGINEER_ASSESSMENT'),
    ]) {
      s.allowed.records.push(
        ...adaptTdmsDailySource(observed).memberClaims.records,
      );
      await s.service.importDailyMetadata(actor(), observed);
      expect(
        (await s.service.readDailyMetadataImport(actor(), observed.requestId))
          .package,
      ).toEqual(observed.package);
    }
    expect(s.repository.state.revisions).toHaveLength(5);
    expect(s.repository.state.captures).toHaveLength(4);
    expect(
      s.repository.state.revisions.filter(
        (r) => r.record.recordKind === 'ENGINEER_ASSESSMENT',
      ),
    ).toHaveLength(2);
    expect(s.repository.state.revisions[2]!.record.content).toEqual(
      syntheticOwnedEnvelope(201, 'PROCESSING_SHEET').package.records[0]!
        .content,
    );
    expect(s.repository.state.revisions[2]!.record.businessVersion).toEqual({
      rawRevision: '1',
      rawIteration: null,
      confirmation: 'SOURCE_DECLARED',
    });
    expect(s.documents.assertRead).not.toHaveBeenCalled();
    expect(s.artifacts.acquire).not.toHaveBeenCalled();
  });
  it('preserves unresolved observed edges with null native relation and does not promote either endpoint', async () => {
    const env = syntheticFullDailyEnvelope(),
      a = env.package.records[0]!,
      b = env.package.records[1]!;
    const edgeBody = {
        fromSourceRecordId: a.sourceRecordId,
        toSourceRecordId: b.sourceRecordId,
        fromSnapshotId: a.snapshotId,
        toSnapshotId: b.snapshotId,
        nativeRelationId: null,
        relationKind: 'source link observation',
        evidenceLocator: '#observed-link',
        observedAt: sourceTime,
        confidence: 'observed_unresolved' as const,
      },
      edge = {
        edgeId: 'TDMSEDGE-' + hash(dailyIdentity(edgeBody)),
        ...edgeBody,
      };
    env.package.edges.push(edge);
    seal(env);
    const s = setup(env);
    await s.service.importDailyMetadata(actor(), env);
    const ast = s.repository.state.assertions[0]!.assertion;
    expect(ast.authority).toBe('CANDIDATE_ONLY');
    expect(ast.controlledKind).toBeNull();
    expect(ast.from.kind).toBe('UNRESOLVED');
    expect(ast.to.kind).toBe('UNRESOLVED');
    expect(ast.rawFields.dailyObservedEdge).toEqual(edge);
    expect(
      (
        await s.service.readDailySourceRef(
          actor(),
          'TDMS:RELATION:' + edge.edgeId,
        )
      ).relation,
    ).toEqual(edge);
  });
  it('replays exact immutable requests and rejects conflicting or corrupt originals without cropping', async () => {
    const s = setup();
    const first = await s.service.importDailyMetadata(actor(), s.envelope);
    expect(
      await s.service.importDailyMetadata(actor(), copy(s.envelope)),
    ).toEqual(first);
    expect(s.repository.state.revisions).toHaveLength(2);
    const changed = copy(s.envelope);
    changed.package.records[0]!.number = 'changed';
    await expect(
      s.service.importDailyMetadata(actor(), changed),
    ).rejects.toMatchObject({ code: 'TDMS_DAILY_NUMBER_CONFLICT' });
    const anotherKey = copy(s.envelope);
    anotherKey.package.packageId = 'changed-package';
    await expect(
      s.service.importDailyMetadata(actor(), anotherKey),
    ).rejects.toMatchObject({ code: 'TDMS_DAILY_REQUEST_DIGEST_MISMATCH' });
    s.repository.state.captures[0]!.dailyMetadata!.adapter!.outputDigest =
      '0'.repeat(64);
    await expect(
      s.service.readDailyMetadataImport(actor(), s.envelope.requestId),
    ).rejects.toMatchObject({ code: 'TDMS_DAILY_CAPTURE_INTEGRITY_CONFLICT' });
  });
  it('same source record with a later observation becomes a separate normal revision, not a merged business version', async () => {
    const s = setup();
    await s.service.importDailyMetadata(actor(), s.envelope);
    const next = copy(s.envelope);
    next.package.packageId = 'new-observation';
    next.package.observedAt = '2026-10-11T00:01:00.000Z';
    next.package.records.forEach((r) => {
      r.observedAt = next.package.observedAt;
    });
    seal(next);
    await s.service.importDailyMetadata(actor(), next);
    expect(s.repository.state.revisions).toHaveLength(4);
    expect(s.repository.state.captures).toHaveLength(2);
    await expect(
      s.service.readDailySourceRef(
        actor(),
        'TDMS:SNAPSHOT:' + next.package.records[0]!.snapshotId,
      ),
    ).rejects.toMatchObject({ code: 'TDMS_DAILY_REFERENCE_AMBIGUOUS' });
  });
  it('failed authorization never silently trims a denied member and a later denied reader sees no saved body', async () => {
    const s = setup();
    s.allowed.records.pop();
    await expect(
      s.service.importDailyMetadata(actor(), s.envelope),
    ).rejects.toMatchObject({
      code: 'TDMS_IMPORT_MEMBER_SCOPE_ADMISSION_REQUIRED',
    });
    expect(s.repository.state.captures).toEqual([]);
    const ok = setup();
    await ok.service.importDailyMetadata(actor(), ok.envelope);
    ok.state.readAllowed = false;
    await expect(
      ok.service.readDailyMetadataImport(actor(), ok.envelope.requestId),
    ).rejects.toMatchObject({
      code: 'TDMS_READ_MEMBER_SCOPE_ADMISSION_REQUIRED',
    });
    await expect(
      ok.service.readDailySourceRef(
        actor(),
        'TDMS:SNAPSHOT:' + ok.envelope.package.records[0]!.snapshotId,
      ),
    ).rejects.toMatchObject({
      code: 'TDMS_READ_MEMBER_SCOPE_ADMISSION_REQUIRED',
    });
    ok.state.scopes = [{ ...nativeScope, scopeId: 'other' }];
    await expect(
      ok.service.readDailyMetadataImport(actor(), ok.envelope.requestId),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
  });
  it('retained success with response withheld is reconciled by the same request and never imported twice', async () => {
    const s = setup();
    let commits = 0;
    s.repository.beforeCommit = () => {
      if (++commits === 3) s.state.enabled = false;
    };
    await expect(
      s.service.importDailyMetadata(actor(), s.envelope),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
    expect(s.repository.state.captures).toHaveLength(1);
    s.repository.beforeCommit = undefined;
    s.state.enabled = true;
    const saved = await s.service.readDailyMetadataImport(
      actor(),
      s.envelope.requestId,
    );
    expect(await s.service.importDailyMetadata(actor(), s.envelope)).toEqual(
      saved.receipt,
    );
    expect(s.repository.state.captures).toHaveLength(1);
    expect(s.repository.state.revisions).toHaveLength(2);
  });
  it('artifact source declarations require a separately bound transport and current read membership', async () => {
    const env = syntheticFullDailyEnvelope(),
      owner = env.package.records[0]!,
      bytes = Buffer.from('%PDF-1.7\nsynthetic');
    const binding = {
        ownerSnapshotId: owner.snapshotId,
        sourceAttachmentId: 'OR:wt.content.ApplicationData:401',
        role: 'primary',
        filename: 'synthetic.pdf',
        mediaType: 'application/pdf',
        blobSha256: createHash('sha256').update(bytes).digest('hex'),
        byteLength: bytes.length,
        sourceVersion: owner.sourceVersion,
        observedAt: sourceTime,
        evidenceLocator: '#source-primary',
      },
      b = { bindingId: 'TDMSBIND-' + hash(dailyIdentity(binding)), ...binding };
    env.package.artifactBindings.push(b);
    seal(env);
    const s = setup(env);
    await expect(
      s.service.importDailyMetadata(actor(), env),
    ).rejects.toMatchObject({
      code: 'TDMS_DAILY_ARTIFACT_TRANSPORT_UNCONFIGURED',
    });
    expect(s.repository.state.captures).toEqual([]);
    s.artifacts.resolveDailySelection = jest.fn(async () => ({
      memberId: b.bindingId,
      sourceAttachmentId: b.sourceAttachmentId,
      sourceAttachmentVersion: null,
      fileName: b.filename,
      mediaType: b.mediaType,
      sha256: b.blobSha256,
      byteLength: b.byteLength,
      ownerItemIds: [b.ownerSnapshotId],
      selection: {
        bucketId: 'synthetic-bucket',
        filePath: 'tdms-source/uploads/synthetic.pdf',
        expectedProviderObjectId: 'synthetic-provider-object',
      },
    }));
    s.artifacts.acquireSelection = jest.fn(async ({ artifact: a }) => ({
      memberId: a.memberId,
      sourceArtifactId: 'synthetic-artifact',
      acquisitionId: 'synthetic-acquisition',
      fileName: a.fileName,
      mediaType: a.mediaType,
      sha256: a.sha256,
      byteLength: a.byteLength,
      immutableReadbackVerified: true as const,
      documentVersionId: null,
      registrationGap: 'IDENTITY_NOT_REGISTERED',
    }));
    const receipt = await s.service.importDailyMetadata(actor(), env);
    expect(receipt.artifactCount).toBe(1);
    expect(receipt.documentVersionMappings[0]).toMatchObject({
      status: 'REVIEW_REQUIRED',
      documentVersionId: null,
      readbackVerified: false,
    });
    expect(
      s.repository.state.captures[0]!.dailyMetadata!.nativeRetention!
        .artifacts[0],
    ).toMatchObject({
      ownerSourceVersion: owner.sourceVersion,
      sourceAttachmentVersion: null,
      sourceArtifactId: 'synthetic-artifact',
      acquisitionId: 'synthetic-acquisition',
      documentVersionId: null,
    });
    const read = await s.service.readDailySourceRef(
      actor(),
      'TDMS:ARTIFACT:' + b.bindingId,
    );
    expect(read.artifactBinding).toEqual(b);
    expect(read.reference.locator).toBe(b.evidenceLocator);
    s.allowed.artifacts.length = 0;
    await expect(
      s.service.readDailySourceRef(actor(), 'TDMS:ARTIFACT:' + b.bindingId),
    ).rejects.toMatchObject({
      code: 'TDMS_READ_MEMBER_SCOPE_ADMISSION_REQUIRED',
    });
  });
  it('rejects unbound own-visible bodies, changed native type/panel/labels or double-read values without storage', async () => {
    const env = syntheticOwnedEnvelope(201, 'PROCESSING_SHEET');
    const mutate = [
      (r: any) => {
        delete r.rawFields.ownedBusinessContent;
      },
      (r: any) => {
        for (const read of r.rawFields.ownedBusinessContent.reads)
          read.owner.nativeTypeId = 'WCTYPE|wt.change2.WTChangeRequest2|wrong';
      },
      (r: any) => {
        for (const read of r.rawFields.ownedBusinessContent.reads)
          read.section.panelLocator = '#unbound';
      },
      (r: any) => {
        for (const read of r.rawFields.ownedBusinessContent.reads)
          read.fields[0].actualLabel = 'unrecognized label';
        r.content.ownedVisibleBusinessContent =
          r.rawFields.ownedBusinessContent.reads[1].fields;
      },
      (r: any) => {
        r.rawFields.ownedBusinessContent.reads[0].owner.stateRaw =
          'changed between reads';
      },
      (r: any) => {
        for (const read of r.rawFields.ownedBusinessContent.reads)
          read.owner.observedAt = '2026-10-11 00:00:00Z';
      },
    ];
    for (const edit of mutate) {
      const bad = copy(env);
      edit(bad.package.records[0]);
      seal(bad);
      expect(() => adaptTdmsDailySource(bad)).toThrow(
        'TDMS_OWN_VISIBLE_SOURCE_PROOF_INVALID',
      );
    }
    const copied = copy(env);
    copied.package.records.push(
      syntheticOwnedEnvelope(202, 'PROCESSING_SHEET').package.records[0]!,
    );
    seal(copied);
    expect(() => adaptTdmsDailySource(copied)).toThrow(
      'TDMS_DAILY_OWN_CONTENT_PROBE_REQUIRED',
    );
  });
  it('rejects native unread attachment metadata that is not part of the owner-only probe', () => {
    const native = copy(
      adaptTdmsDailySource(syntheticOwnedEnvelope(201, 'PROCESSING_SHEET'))
        .output.nativePackage,
    );
    native.records[0]!.unreadAttachments!.push({
      sourceAttachmentId: 'unread-attachment',
      sourceAttachmentVersion: null,
      fileName: 'unread.pdf',
      mediaType: null,
      byteLength: null,
      readStatus: 'NOT_READ',
      gap: 'not probed',
      selector: '#unread',
    });
    expect(() => sourcePackage(native)).toThrow(
      'TDMS_OWN_VISIBLE_SOURCE_PROOF_INVALID',
    );
  });
  it('retains blank/absent/truncated fields and original whitespace instead of claiming full content', async () => {
    const env = syntheticOwnedEnvelope(201, 'PROCESSING_SHEET'),
      r = env.package.records[0]!,
      proof = r.rawFields.ownedBusinessContent as any;
    for (const read of proof.reads) {
      const f = read.fields.find((f: any) => f.actualLabel === 'Description:');
      f.rawBoundedValue = '  ' + 'x'.repeat(7996) + '\n ';
      f.truncation = {
        truncated: true,
        limit: 8000,
        capturedCodepoints: 8000,
        observedTotalCodepoints: 9000,
      };
    }
    r.content.ownedVisibleBusinessContent = copy(proof.reads[1].fields);
    r.coverage.gaps.push('CONTENT_TRUNCATED');
    env.package.coverage = copy(r.coverage);
    seal(env);
    const s = setup(env);
    await s.service.importDailyMetadata(actor(), env);
    const saved = await s.service.readDailySourceRef(
      actor(),
      'TDMS:SNAPSHOT:' + r.snapshotId,
    );
    expect(saved.snapshot!.content).toEqual(r.content);
    expect(
      saved.snapshot!.content.ownedVisibleBusinessContent![0],
    ).toMatchObject({ presence: 'PRESENT_BLANK', rawBoundedValue: '' });
    expect(
      saved.snapshot!.content.ownedVisibleBusinessContent![1],
    ).toMatchObject({ presence: 'ABSENT', rawBoundedValue: null });
    expect(saved.snapshot!.coverage.gaps).toContain('CONTENT_TRUNCATED');
  });
  it('keeps AD item links unresolved, refusing a made-up native relationship or an unrelated edge', async () => {
    const env = syntheticOwnedEnvelope(201, 'PROCESSING_SHEET', true),
      r = env.package.records[0]!,
      proof = r.rawFields.ownedBusinessContent as any,
      table = proof.reads[1].relationTables[0];
    const link = {
      targetRef: 'VR:wt.change2.WTChangeActivity2:401',
      evidenceLocator: '#infoPage_myTab_ad_adItemTable .observed-row',
      nativeRole: 'NUMBER_LINK',
      numberRaw: 'SYNTHETIC-ACTIVITY',
    };
    for (const read of proof.reads) {
      const t = read.relationTables[0];
      t.reportedCount = 1;
      t.rows = [
        {
          rowIndex: 0,
          cells: [
            {
              actualLabel: 'Number',
              rawBoundedValue: 'SYNTHETIC-ACTIVITY',
              truncated: false,
              observedTotalCodepoints: 18,
            },
          ],
          sourceLinks: [copy(link)],
          nativeRelationId: null,
          targetOwnerRead: false,
          confidence: 'observed_unresolved',
        },
      ];
    }
    seal(env);
    const e = {
      fromSourceRecordId: r.sourceRecordId,
      toSourceRecordId: link.targetRef,
      fromSnapshotId: r.snapshotId,
      toSnapshotId: null,
      nativeRelationId: null,
      relationKind: table.tableTitle,
      evidenceLocator: link.evidenceLocator,
      observedAt: sourceTime,
      confidence: 'observed_unresolved' as const,
    };
    env.package.edges = [
      { edgeId: 'TDMSEDGE-' + hash(dailyIdentity(e)), ...e },
    ];
    seal(env);
    const s = setup(env);
    await s.service.importDailyMetadata(actor(), env);
    expect(s.repository.state.assertions[0]!.assertion.to).toEqual({
      kind: 'UNRESOLVED',
      rawIdentity: link.targetRef,
      versionGap: 'RELATION_ID_UNOBSERVED',
    });
    const wrong = copy(env);
    wrong.package.edges[0]!.evidenceLocator = '#different-link';
    expect(() => adaptTdmsDailySource(wrong)).toThrow(
      'TDMS_DAILY_RELATION_EVIDENCE_INVALID',
    );
  });
  it('preserves a null attachment source identity and explicitly refuses materialization', async () => {
    const env = syntheticFullDailyEnvelope(),
      r = env.package.records[0]!,
      binding = {
        ownerSnapshotId: r.snapshotId,
        sourceAttachmentId: null,
        role: 'primary',
        filename: 'synthetic.pdf',
        mediaType: 'application/pdf',
        blobSha256: 'a'.repeat(64),
        byteLength: 3,
        sourceVersion: r.sourceVersion,
        observedAt: sourceTime,
        evidenceLocator: '#source-primary',
      };
    env.package.artifactBindings = [
      { bindingId: 'TDMSBIND-' + hash(dailyIdentity(binding)), ...binding },
    ];
    seal(env);
    const s = setup(env);
    expect(
      s.prepared.output.artifactObservations[0]!.sourceAttachmentId,
    ).toBeNull();
    await expect(
      s.service.importDailyMetadata(actor(), env),
    ).rejects.toMatchObject({
      code: 'TDMS_DAILY_ARTIFACT_IDENTITY_UNCONFIRMED',
      statusCode: 503,
    });
    expect(s.repository.state.captures).toEqual([]);
    expect(s.artifacts.acquire).not.toHaveBeenCalled();
  });
  it('rejects a changed native head between adapter binding and the existing import CAS', async () => {
    const s = setup(),
      transaction = s.repository.transaction.bind(s.repository);
    let reads = 0;
    s.repository.transaction = async (fn) => {
      if (++reads === 2) {
        const r = s.prepared.output.nativePackage.records[0]!;
        s.repository.state.heads.push({
          scope: nativeScope,
          recordRef: 'concurrent-record',
          recordKind: r.recordKind,
          sourceRecordId: r.sourceRecordId,
          sourceRevisionRef: 'concurrent-revision',
          observedAt: sourceTime,
        });
      }
      return transaction(fn);
    };
    await expect(
      s.service.importDailyMetadata(actor(), s.envelope),
    ).rejects.toMatchObject({
      code: 'TDMS_RECORD_HEAD_CAS_CONFLICT',
      statusCode: 409,
    });
    expect(s.repository.state.captures).toEqual([]);
    expect(s.repository.state.revisions).toEqual([]);
  });
  it('unconfigured source authority rejects the entire new wire before storage or artifact resolution', async () => {
    const repository = { transaction: jest.fn() },
      artifacts = { acquire: jest.fn(), resolveDailySelection: jest.fn() };
    const service = new TdmsSourceService(
      repository,
      new UnconfiguredTdmsSourceAuthorization(),
      artifacts,
      { assertRead: jest.fn() },
    );
    await expect(
      service.importDailyMetadata(actor(), syntheticFullDailyEnvelope()),
    ).rejects.toMatchObject({
      code: 'TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED',
      statusCode: 503,
    });
    expect(repository.transaction).not.toHaveBeenCalled();
    expect(artifacts.resolveDailySelection).not.toHaveBeenCalled();
  });
});

describe('AD expected field panels from the frozen native profile', () => {
  const primary =
      '#wrap_infoPage_myTab_object_changeNoticeDetailsTab_objectprimaryAttributes',
    additional =
      '#wrap_infoPage_myTab_object_changeNoticeDetailsTab_objectattributes';

  it('retains all 20 ordered fields, their expected panels and the immutable original package', async () => {
    const env = syntheticOwnedEnvelope(201, 'PROCESSING_SHEET', true),
      original = copy(env),
      s = setup(env),
      receipt = await s.service.importDailyMetadata(actor(), env);
    expect(Object.keys(receipt)).toHaveLength(10);
    expect(receipt.requestId).toBe(original.requestId);
    expect(receipt.payloadDigest).toBe(hash(original.package));
    expect(env).toEqual(original);
    expect(
      (await s.service.readDailyMetadataImport(actor(), env.requestId)).package,
    ).toEqual(original.package);
    const fields = env.package.records[0]!.content.ownedVisibleBusinessContent!;
    expect(fields).toHaveLength(20);
    expect(fields.slice(0, 15).map((f) => f.panelLocator)).toEqual(
      Array(15).fill(primary),
    );
    expect(fields.slice(15).map((f) => f.panelLocator)).toEqual(
      Array(5).fill(additional),
    );
    expect(
      fields.every((f) => String(f.locator).startsWith(f.panelLocator + ' ')),
    ).toBe(true);
    expect(s.repository.state.captures[0]!.receipt.executionVerified).toBe(
      false,
    );
    expect(env.package.records[0]!.sourceVersion.confirmation).toBe(
      'VERSION_UNCONFIRMED',
    );
    expect(env.package.query.scopeMatch).toBe('UNKNOWN');
    expect(env.package.coverage).toMatchObject({
      status: 'PARTIAL',
      readback: 'NON_ATOMIC',
    });
    expect(env.package.coverage.gaps).toContain('PROBE_ONLY');
    expect(s.documents.assertRead).not.toHaveBeenCalled();
    expect(s.artifacts.acquire).not.toHaveBeenCalled();
  });

  it('rejects every AD label grafted with a matching locator onto the other legal wrapper before storage', async () => {
    const env = syntheticOwnedEnvelope(201, 'PROCESSING_SHEET', true),
      s = setup(env);
    for (let i = 0; i < 20; i++) {
      const bad = copy(env),
        r = bad.package.records[0]!,
        proof = r.rawFields.ownedBusinessContent as any;
      for (const read of proof.reads) {
        const f = read.fields[i];
        f.panelLocator = i < 15 ? additional : primary;
        f.locator = f.panelLocator + ' .source-value-' + i;
      }
      r.content.ownedVisibleBusinessContent = copy(proof.reads[1].fields);
      seal(bad);
      await expect(
        s.service.importDailyMetadata(actor(), bad),
      ).rejects.toMatchObject({
        code: 'TDMS_OWN_VISIBLE_SOURCE_PROOF_INVALID',
      });
    }
    expect(s.repository.state.captures).toEqual([]);
    expect(s.repository.state.revisions).toEqual([]);
    expect(s.artifacts.acquire).not.toHaveBeenCalled();
  });

  it('rejects locator grafts even when each label retains its expected panel', () => {
    for (const i of [1, 15]) {
      const bad = syntheticOwnedEnvelope(201, 'PROCESSING_SHEET', true),
        r = bad.package.records[0]!,
        proof = r.rawFields.ownedBusinessContent as any;
      for (const read of proof.reads)
        read.fields[i].locator =
          (i < 15 ? additional : primary) + ' .source-value-' + i;
      r.content.ownedVisibleBusinessContent = copy(proof.reads[1].fields);
      seal(bad);
      expect(() => adaptTdmsDailySource(bad)).toThrow(
        'TDMS_OWN_VISIBLE_SOURCE_PROOF_INVALID',
      );
    }
  });

  it('still rejects same-panel duplicates whether they replace or append a field', () => {
    for (const extra of [false, true]) {
      const bad = syntheticOwnedEnvelope(201, 'PROCESSING_SHEET', true),
        r = bad.package.records[0]!,
        proof = r.rawFields.ownedBusinessContent as any;
      for (const read of proof.reads) {
        const duplicate = copy(read.fields[1]);
        if (extra) read.fields.push(duplicate);
        else read.fields[2] = duplicate;
      }
      r.content.ownedVisibleBusinessContent = copy(proof.reads[1].fields);
      seal(bad);
      expect(() => adaptTdmsDailySource(bad)).toThrow(
        'TDMS_OWN_VISIBLE_SOURCE_PROOF_INVALID',
      );
    }
  });

  it.each(['ABSENT', 'NOT_LOADED'])(
    'keeps %s in its expected panel without borrowing a value or blank from another region',
    async (presence) => {
      const env = syntheticOwnedEnvelope(201, 'PROCESSING_SHEET', true),
        r = env.package.records[0]!,
        proof = r.rawFields.ownedBusinessContent as any;
      for (const read of proof.reads) {
        for (const i of [1, 15]) {
          Object.assign(read.fields[i], {
            presence,
            labelOrigin: 'PROFILE_EXPECTED_LABEL',
            fieldType: 'UNOBSERVED',
            rawBoundedValue: null,
            nativeControl: null,
            truncation: {
              truncated: false,
              limit: 8000,
              capturedCodepoints: 0,
              observedTotalCodepoints: 0,
            },
          });
        }
        read.unreadFields.push('Description:');
      }
      r.content.ownedVisibleBusinessContent = copy(proof.reads[1].fields);
      r.coverage.gaps.push('CONTENT_FIELDS_UNAVAILABLE');
      env.package.coverage = copy(r.coverage);
      seal(env);
      const s = setup(env);
      await s.service.importDailyMetadata(actor(), env);
      const saved = await s.service.readDailySourceRef(
        actor(),
        'TDMS:SNAPSHOT:' + r.snapshotId,
      );
      expect(saved.snapshot!.content).toEqual(r.content);
      for (const i of [1, 15]) {
        expect(
          saved.snapshot!.content.ownedVisibleBusinessContent![i],
        ).toMatchObject({
          presence,
          panelLocator: i < 15 ? primary : additional,
          rawBoundedValue: null,
          labelOrigin: 'PROFILE_EXPECTED_LABEL',
        });
        const bad = copy(env),
          badRecord = bad.package.records[0]!,
          badProof = badRecord.rawFields.ownedBusinessContent as any;
        for (const read of badProof.reads) {
          read.fields[i].panelLocator = i < 15 ? additional : primary;
          read.fields[i].locator =
            read.fields[i].panelLocator + ' .absent-value';
        }
        badRecord.content.ownedVisibleBusinessContent = copy(
          badProof.reads[1].fields,
        );
        seal(bad);
        expect(() => adaptTdmsDailySource(bad)).toThrow(
          'TDMS_OWN_VISIBLE_SOURCE_PROOF_INVALID',
        );
      }
      expect(saved.snapshot!.coverage.gaps).toContain(
        'CONTENT_FIELDS_UNAVAILABLE',
      );
    },
  );

  it.each(['PROCESSING_SHEET', 'ENGINEER_ASSESSMENT'] as const)(
    'keeps the SB %s profile on its existing detail panel',
    async (kind) => {
      const env = syntheticOwnedEnvelope(301, kind),
        fields = env.package.records[0]!.content.ownedVisibleBusinessContent!,
        panel =
          kind === 'PROCESSING_SHEET'
            ? '#infoPage_myTab_object_changeRequestDetailsTab'
            : '#infoPage_myTab_object_changeNoticeDetailsTab',
        s = setup(env);
      expect(fields.every((f) => f.panelLocator === panel)).toBe(true);
      expect(
        fields.find((f) => f.actualLabel === 'Description:'),
      ).toMatchObject({
        panelLocator: panel,
        presence: 'PRESENT_VALUE',
      });
      await s.service.importDailyMetadata(actor(), env);
      expect(
        (await s.service.readDailyMetadataImport(actor(), env.requestId))
          .package,
      ).toEqual(env.package);
    },
  );
});
