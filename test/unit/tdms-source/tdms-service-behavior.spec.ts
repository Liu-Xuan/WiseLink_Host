import { createHash } from 'node:crypto';
import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import { HostDecisionTdmsSourceAuthorization } from '../../../server/modules/tdms-source/tdms-source.authorization';
import {
  tdmsError,
  type TdmsArtifactStore,
  type TdmsPublicActor,
} from '../../../server/modules/tdms-source/tdms-source.types';
import { MemoryTdmsRepository, nativeScope } from './tdms-memory-double';
import { actor, fixture } from './tdms-fixtures';

function setup() {
  const db = new MemoryTdmsRepository();
  let revision = 'policy1',
    enabled = true;
  const deniedActors = new Set<string>();
  const blockedRefs = new Set<string>();
  const auth = new HostDecisionTdmsSourceAuthorization(
    async (i) => {
      if (
        !enabled ||
        i.actor.tenantId !== nativeScope.tenantId ||
        deniedActors.has(i.actor.canonicalSubject.id)
      )
        return [];
      if (i.context.matterId && i.context.matterId !== 'owned-matter')
        return [];
      if (i.scope && JSON.stringify(i.scope) !== JSON.stringify(nativeScope))
        return [];
      return [{ scope: nativeScope, permissionRevision: revision }];
    },
    async ({ scope, claims, grant }) => ({
      ...grant,
      scope,
      authorityRef: 'approved-source-members-v1',
      captureRetentionAllowed: true as const,
      nativeProjectionAllowed: true as const,
      permittedMembers: {
        records: claims.records.filter(
          (r) =>
            r.recordKind === 'ENGINEERING_FILE' &&
            ['AEO-1', 'CEO-S-2'].includes(r.sourceRecordId),
        ),
        artifacts: claims.artifacts.filter((a) =>
          ['s', 'attachment', 'meta'].includes(a.sourceAttachmentId),
        ),
        relationIds: claims.relationIds.filter((id) => id === 'edge'),
      },
    }),
  );
  const artifacts: TdmsArtifactStore = {
    acquire: jest.fn(async (i) => ({
      memberId: i.artifact.memberId,
      sourceArtifactId: 'SA',
      acquisitionId: 'ACQ',
      fileName: i.artifact.fileName,
      mediaType: i.artifact.mediaType,
      sha256: i.artifact.sha256,
      byteLength: i.artifact.byteLength,
      immutableReadbackVerified: true as const,
      documentVersionId: null,
      registrationGap:
        'FORMAL_REGISTRATION_REQUIRES_INDEPENDENT_RETENTION_AUTHORITY',
    })),
  };
  const documents = {
    assertRead: jest.fn(async (_a: TdmsPublicActor, id: string) => {
      if (id !== 'DV-owned') throw tdmsError('DOCUMENT_NOT_FOUND', 404);
    }),
  };
  const service = new TdmsSourceService(db, auth, artifacts, documents);
  return {
    db,
    service,
    artifacts,
    documents,
    deniedActors,
    blockedRefs,
    setRevision: (v: string) => {
      revision = v;
    },
    revoke: () => {
      enabled = false;
    },
  };
}
const target = {
  sourceKey: 'TDMS',
  sourceInstanceId: 'instance',
  scopeId: 'narrow',
};

describe('new native service transactions and permission boundaries', () => {
  it('imports then returns exact history and persisted matching native receipt', async () => {
    const { service, db } = setup();
    const p = fixture();
    const receipt = await service.importPackage(actor(), target, p);
    expect(receipt).toMatchObject({
      status: 'COMPLETE',
      created: true,
      engineeringAdoption: 'NOT_CREATED',
      executionVerified: false,
    });
    const ref = receipt.recordRevisionRefs[0]!;
    const read = await service.readRecord(actor(), ref, {});
    expect(read.record.sourceRevisionRef).toBe(ref);
    expect(read.receipt).toMatchObject({
      sourceRevisionRef: ref,
      readPerformed: true,
      purpose: 'WIKI_NATIVE_RECORD',
      permissionRevision: 'policy1',
    });
    expect(read.selectedFields).toBeNull();
    expect(db.state.receipts).toHaveLength(1);
    expect(read.record.rawFields).toEqual(p.records[0]!.rawFields);
    expect(read.record.content).toEqual(p.records[0]!.content);
  });
  it('catalogue carries metadata only and cannot imply an exact read', async () => {
    const { service, db } = setup();
    await service.importPackage(actor(), target, fixture());
    const c = await service.catalogue(actor());
    expect(c.readPerformed).toBe(false);
    expect(c.records).toHaveLength(1);
    expect(c.records[0]).not.toHaveProperty('rawFields');
    expect(c.records[0]).not.toHaveProperty('content');
    expect(db.state.receipts).toHaveLength(0);
  });
  it('same package+actor is idempotent without repeating acquisitions/revisions', async () => {
    const { service, db, artifacts } = setup();
    const p = fixture();
    const first = await service.importPackage(actor(), target, p);
    const replay = await service.importPackage(actor(), target, p);
    expect(replay).toEqual({ ...first, created: false });
    expect(db.state.revisions).toHaveLength(1);
    expect(db.state.captures).toHaveLength(1);
    expect(artifacts.acquire).not.toHaveBeenCalled();
  });
  it('same package changed content rejects instead of overwriting', async () => {
    const { service, db } = setup();
    const p = fixture();
    await service.importPackage(actor(), target, p);
    p.records[0]!.title = 'changed';
    await expect(
      service.importPackage(actor(), target, p),
    ).rejects.toMatchObject({ code: 'TDMS_PACKAGE_IDEMPOTENCY_CONFLICT' });
    expect(db.state.revisions).toHaveLength(1);
  });
  it('same package different actor is not an authority/replay grant', async () => {
    const { service } = setup();
    await service.importPackage(actor(), target, fixture());
    const other = actor();
    other.canonicalSubject.id = '999';
    await expect(
      service.importPackage(other, target, fixture()),
    ).rejects.toMatchObject({ code: 'TDMS_PACKAGE_IDEMPOTENCY_CONFLICT' });
  });
  it('updates require exact CAS, preserving both revisions and selected-head distinction', async () => {
    const { service, db } = setup();
    const first = await service.importPackage(actor(), target, fixture());
    const p = fixture();
    p.packageId = 'PKG-2';
    p.records[0]!.sourceVersion.rawRevision = '2';
    p.records[0]!.title = 'new';
    p.records[0]!.observedAt = '2026-10-05T11:00:00Z';
    await expect(
      service.importPackage(actor(), target, p),
    ).rejects.toMatchObject({ code: 'TDMS_RECORD_HEAD_CAS_CONFLICT' });
    p.records[0]!.expectedHeadRevisionRef = first.recordRevisionRefs[0]!;
    const second = await service.importPackage(actor(), target, p);
    expect(db.state.revisions).toHaveLength(2);
    expect(
      (await service.readRecord(actor(), first.recordRevisionRefs[0]!)).record
        .selectedHead,
    ).toBe(false);
    expect(
      (await service.readRecord(actor(), second.recordRevisionRefs[0]!)).record
        .selectedHead,
    ).toBe(true);
    expect(
      (await service.readRecord(actor(), first.recordRevisionRefs[0]!)).record
        .title,
    ).toBe('source');
  });
  it('late old observation is retained without moving selected head backwards', async () => {
    const { service, db } = setup();
    const p = fixture();
    p.records[0]!.sourceVersion.rawRevision = '2';
    p.records[0]!.observedAt = '2026-10-05T11:00:00Z';
    const first = await service.importPackage(actor(), target, p);
    const old = fixture();
    old.packageId = 'OLD';
    old.records[0]!.expectedHeadRevisionRef = first.recordRevisionRefs[0]!;
    const past = await service.importPackage(actor(), target, old);
    expect(db.state.heads[0]!.sourceRevisionRef).toBe(
      first.recordRevisionRefs[0],
    );
    expect(
      (await service.readRecord(actor(), past.recordRevisionRefs[0]!)).record
        .selectedHead,
    ).toBe(false);
  });
  it('same declared source version differing content retains both immutable observations and visible conflict', async () => {
    const { service, db } = setup();
    const first = await service.importPackage(actor(), target, fixture());
    const p = fixture();
    p.packageId = 'PKG-2';
    p.records[0]!.expectedHeadRevisionRef = first.recordRevisionRefs[0]!;
    p.records[0]!.content.conditions = ['conflicting replacement'];
    const changed = await service.importPackage(actor(), target, p);
    expect(changed.status).toBe('PARTIAL');
    expect(changed.gaps).toContain('SAME_DECLARED_VERSION_CONTENT_CHANGED');
    expect(db.state.revisions).toHaveLength(2);
    const now = await service.readRecord(
      actor(),
      changed.recordRevisionRefs[0]!,
    );
    expect(now.record.coverage.gaps).toContain(
      'SAME_DECLARED_VERSION_CONTENT_CHANGED',
    );
    expect(now.record.currentness).toBe('SELECTED_HOST_OBSERVATION');
    expect(now.record.sourceVersion).toEqual(p.records[0]!.sourceVersion);
    expect(
      (await service.readRecord(actor(), first.recordRevisionRefs[0]!)).record
        .content.conditions,
    ).toEqual(['body conflicts with checkbox']);
    expect(
      (await service.catalogue(actor())).records[0]!.coverage.gaps,
    ).toContain('SAME_DECLARED_VERSION_CONTENT_CHANGED');
  });
  it('revoking native scope denies old exact history, catalogue and adjacency', async () => {
    const s = setup();
    const first = await s.service.importPackage(actor(), target, fixture());
    s.revoke();
    await expect(
      s.service.readRecord(actor(), first.recordRevisionRefs[0]!),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
    await expect(
      s.service.readRelations(actor(), first.recordRevisionRefs[0]!),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
    expect(await s.service.catalogue(actor())).toMatchObject({
      records: [],
      sourceStatus: 'DISABLED',
    });
    expect(s.db.state.receipts).toHaveLength(0);
  });
  it('permission revision changed during receipt rolls back and exposes no response', async () => {
    const s = setup();
    const first = await s.service.importPackage(actor(), target, fixture());
    s.db.beforeReceipt = () => s.setRevision('policy2');
    await expect(
      s.service.readRecord(actor(), first.recordRevisionRefs[0]!),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_PERMISSION_CHANGED' });
    expect(s.db.state.receipts).toHaveLength(0);
  });
  it('permission revoked after DB read/commit withholds returned body', async () => {
    const s = setup();
    const first = await s.service.importPackage(actor(), target, fixture());
    s.db.beforeCommit = () => s.revoke();
    await expect(
      s.service.readRecord(actor(), first.recordRevisionRefs[0]!),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
  });
  it('cross tenant and actor scopes cannot reuse IDs or prior receipts', async () => {
    const s = setup();
    const first = await s.service.importPackage(actor(), target, fixture());
    const other = actor();
    other.tenantId = 'tenant-b';
    other.subjectDecision.tenantId = 'tenant-b';
    await expect(
      s.service.readRecord(other, first.recordRevisionRefs[0]!),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
    const unallowed = actor();
    s.deniedActors.add(unallowed.canonicalSubject.id);
    await expect(
      s.service.readRecord(unallowed, first.recordRevisionRefs[0]!),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
  });
  it('scope/sourceInstance mismatch denies import; object context is separately decision checked', async () => {
    const s = setup();
    await expect(
      s.service.importPackage(
        actor(),
        { ...target, sourceInstanceId: 'other' },
        fixture(),
      ),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
    const first = await s.service.importPackage(actor(), target, fixture());
    await expect(
      s.service.readRecord(actor(), first.recordRevisionRefs[0]!, {
        matterId: 'someone-elses',
      }),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
    expect(
      (
        await s.service.readRecord(actor(), first.recordRevisionRefs[0]!, {
          matterId: 'owned-matter',
        })
      ).receipt.taskContextRef,
    ).toBe('owned-matter');
  });
  it('explicit package relation resolves exact versions and preserves completion scope independently', async () => {
    const s = setup();
    const p = fixture();
    p.records.push({
      ...structuredClone(p.records[0]!),
      itemId: 'b',
      sourceRecordId: 'CEO-S-2',
      fileType: { rawCode: 'CEO-S', rawName: 'CEO-S' },
    });
    p.relations = [
      {
        sourceRelationId: 'edge',
        expectedHeadAssertionRef: null,
        rawKind: 'source says equivalent',
        controlledKind: 'VERSION_CHANGE',
        from: { kind: 'PACKAGE_RECORD', itemId: 'a' },
        to: { kind: 'PACKAGE_RECORD', itemId: 'b' },
        authority: 'SOURCE_EXPLICIT',
        selector: 'relation.row',
        observedAt: p.observedAt,
        coverage: p.coverage,
        scope: { aircraft: ['one'] },
        completionEffect: 'OLD_COMPLETION_RECOGNIZED',
        changeClass: 'EQUIVALENT',
        rawFields: { basis: 'explicit' },
      },
    ];
    const imported = await s.service.importPackage(actor(), target, p);
    const read = await s.service.readRelations(
      actor(),
      imported.recordRevisionRefs[0]!,
    );
    expect(read.relations).toHaveLength(1);
    expect(read.relations[0]!.from).toEqual({
      kind: 'NATIVE_RECORD_REVISION',
      sourceRevisionRef: imported.recordRevisionRefs[0],
    });
    expect(read.relations[0]!.scope).toEqual({ aircraft: ['one'] });
    expect(read.receipt).toMatchObject({
      purpose: 'WIKI_NATIVE_RELATIONS',
      sourceRevisionRef: imported.recordRevisionRefs[0],
      engineeringAdoption: 'NOT_CREATED',
      executionVerified: false,
    });
  });
  it.each(['CANDIDATE_ONLY', 'SOURCE_EXPLICIT'] as const)(
    'retains %s revision labels but exposes missing exact scope/basis before UI interpretation',
    async (authority) => {
      const s = setup();
      const p = fixture();
      p.relations = [
        {
          sourceRelationId: 'edge',
          expectedHeadAssertionRef: null,
          rawKind: 'supersedes',
          controlledKind: 'VERSION_CHANGE',
          from: { kind: 'PACKAGE_RECORD', itemId: 'a' },
          to: {
            kind: 'UNRESOLVED',
            rawIdentity: 'old-version',
            versionGap: 'mapping not proven',
          },
          authority,
          selector: 'row',
          observedAt: p.observedAt,
          coverage: p.coverage,
          scope: {},
          completionEffect: 'OLD_COMPLETION_RECOGNIZED',
          changeClass: 'REPLACES',
          rawFields: {},
        },
      ];
      const imported = await s.service.importPackage(actor(), target, p);
      expect(imported.status).toBe('PARTIAL');
      const read = await s.service.readRelations(
        actor(),
        imported.recordRevisionRefs[0]!,
      );
      const relation = read.relations[0]!;
      expect(relation.authority).toBe(authority);
      expect(relation.changeClass).toBe('REPLACES');
      expect(relation.completionEffect).toBe('OLD_COMPLETION_RECOGNIZED');
      expect(relation.coverage).toMatchObject({
        status: 'PARTIAL',
        gaps: expect.arrayContaining([
          'REVISION_RULE_EXACT_ENDPOINT_NOT_VERIFIED',
          'REVISION_RULE_SCOPE_NOT_VERIFIED',
          'REVISION_RULE_SOURCE_BASIS_NOT_CAPTURED',
        ]),
      });
      expect(read.receipt.executionVerified).toBe(false);
      expect(read.receipt.engineeringAdoption).toBe('NOT_CREATED');
    },
  );
  it('unknown endpoints remain unresolved without guessing newest version', async () => {
    const s = setup();
    const p = fixture();
    p.relations = [
      {
        sourceRelationId: 'edge',
        expectedHeadAssertionRef: null,
        rawKind: 'references',
        controlledKind: null,
        from: { kind: 'PACKAGE_RECORD', itemId: 'a' },
        to: {
          kind: 'UNRESOLVED',
          rawIdentity: 'OR/VR',
          versionGap: 'mapping absent',
        },
        authority: 'CANDIDATE_ONLY',
        selector: 'row',
        observedAt: p.observedAt,
        coverage: p.coverage,
        scope: {},
        completionEffect: 'UNSPECIFIED',
        changeClass: 'UNSPECIFIED',
        rawFields: {},
      },
    ];
    const imported = await s.service.importPackage(actor(), target, p);
    expect(imported.status).toBe('PARTIAL');
    expect(
      (await s.service.readRelations(actor(), imported.recordRevisionRefs[0]!))
        .relations[0]!.to,
    ).toEqual(p.relations[0]!.to);
  });
  it('query mismatch and unread metadata import are PARTIAL and not attachment byte reads', async () => {
    const s = setup();
    const p = fixture();
    p.query.actualCriteria = { type: 'MT' };
    p.records[0]!.unreadAttachments = [
      {
        sourceAttachmentId: 'meta',
        sourceAttachmentVersion: null,
        fileName: 'only metadata',
        mediaType: null,
        byteLength: null,
        readStatus: 'NOT_READ',
        gap: 'not downloaded',
        selector: 'attachment.row',
      },
    ];
    const imported = await s.service.importPackage(actor(), target, p);
    expect(imported.status).toBe('PARTIAL');
    const read = await s.service.readRecord(
      actor(),
      imported.recordRevisionRefs[0]!,
    );
    expect(read.record.artifacts).toEqual([]);
    expect(read.record.unreadAttachments[0]!.readStatus).toBe('NOT_READ');
    expect(read.record.coverage.status).toBe('PARTIAL');
    expect(s.artifacts.acquire).not.toHaveBeenCalled();
  });
  it('actual artifacts stay candidate-only with no ordinary DV promotion', async () => {
    const s = setup();
    const p = fixture();
    const bytes = Buffer.from('arbitrary MRO attachment, not PDF');
    p.artifacts = [
      {
        memberId: 'm',
        sourceAttachmentId: 's',
        sourceAttachmentVersion: '1',
        fileName: 'mro.txt',
        mediaType: 'text/plain',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        byteLength: bytes.length,
        bytesBase64: bytes.toString('base64'),
      },
    ];
    p.records[0]!.artifactMemberIds = ['m'];
    p.records[0]!.formalDocumentArtifactMemberId = 'm';
    const imported = await s.service.importPackage(actor(), target, p);
    expect(imported.artifactBindings[0]).toMatchObject({
      documentVersionId: null,
      registrationGap:
        'FORMAL_REGISTRATION_REQUIRES_INDEPENDENT_RETENTION_AUTHORITY',
    });
    expect(imported.executionVerified).toBe(false);
  });
  it('same exact acquired attachment version with changed bytes preserves conflict observations', async () => {
    const s = setup();
    const p = fixture();
    const put = (text: string) => {
      const bytes = Buffer.from(text);
      p.artifacts = [
        {
          memberId: 'm',
          sourceAttachmentId: 'attachment',
          sourceAttachmentVersion: 'source-v1',
          fileName: 'x.txt',
          mediaType: 'text/plain',
          sha256: createHash('sha256').update(bytes).digest('hex'),
          byteLength: bytes.length,
          bytesBase64: bytes.toString('base64'),
        },
      ];
      p.records[0]!.artifactMemberIds = ['m'];
    };
    put('old acquired bytes');
    const first = await s.service.importPackage(actor(), target, p);
    p.packageId = 'changed';
    p.records[0]!.expectedHeadRevisionRef = first.recordRevisionRefs[0]!;
    put('changed acquired bytes');
    const second = await s.service.importPackage(actor(), target, p);
    expect(second.gaps).toContain('SAME_ATTACHMENT_VERSION_BYTES_CHANGED');
    expect(
      (await s.service.readRecord(actor(), second.recordRevisionRefs[0]!))
        .record.coverage.gaps,
    ).toContain('SAME_ATTACHMENT_VERSION_BYTES_CHANGED');
    expect(
      (await s.service.readRecord(actor(), first.recordRevisionRefs[0]!)).record
        .artifacts[0]!.sha256,
    ).not.toBe(second.artifactBindings[0]!.sha256);
    expect(s.db.state.revisions).toHaveLength(2);
  });
  it('metadata-only NOT_READ becoming acquired bytes is completion, not a version conflict', async () => {
    const s = setup();
    const p = fixture();
    p.records[0]!.unreadAttachments = [
      {
        sourceAttachmentId: 'attachment',
        sourceAttachmentVersion: 'source-v1',
        fileName: 'x.txt',
        mediaType: 'text/plain',
        byteLength: null,
        readStatus: 'NOT_READ',
        gap: 'bytes not read',
        selector: 'row',
      },
    ];
    const first = await s.service.importPackage(actor(), target, p);
    p.packageId = 'completed';
    p.records[0]!.expectedHeadRevisionRef = first.recordRevisionRefs[0]!;
    p.records[0]!.unreadAttachments = [];
    const bytes = Buffer.from('now acquired');
    p.artifacts = [
      {
        memberId: 'm',
        sourceAttachmentId: 'attachment',
        sourceAttachmentVersion: 'source-v1',
        fileName: 'x.txt',
        mediaType: 'text/plain',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        byteLength: bytes.length,
        bytesBase64: bytes.toString('base64'),
      },
    ];
    p.records[0]!.artifactMemberIds = ['m'];
    const second = await s.service.importPackage(actor(), target, p);
    expect(second.gaps).not.toContain('SAME_ATTACHMENT_VERSION_BYTES_CHANGED');
    expect(second.gaps).not.toContain('SAME_DECLARED_VERSION_CONTENT_CHANGED');
    expect(
      (await s.service.readRecord(actor(), first.recordRevisionRefs[0]!)).record
        .unreadAttachments[0]!.readStatus,
    ).toBe('NOT_READ');
    expect(
      (await s.service.readRecord(actor(), second.recordRevisionRefs[0]!))
        .record.unreadAttachments,
    ).toEqual([]);
  });
  it('artifact promotion attempted by injected store is rejected and native changes roll back', async () => {
    const s = setup();
    const p = fixture();
    const bytes = Buffer.from('candidate');
    p.artifacts = [
      {
        memberId: 'm',
        sourceAttachmentId: 's',
        sourceAttachmentVersion: null,
        fileName: 'x',
        mediaType: 'text/plain',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        byteLength: bytes.length,
        bytesBase64: bytes.toString('base64'),
      },
    ];
    p.records[0]!.artifactMemberIds = ['m'];
    (s.artifacts.acquire as jest.Mock).mockImplementation(async () => ({
      memberId: 'm',
      sha256: p.artifacts[0]!.sha256,
      byteLength: bytes.length,
      immutableReadbackVerified: true as const,
      documentVersionId: 'DV-fake',
    }));
    await expect(
      s.service.importPackage(actor(), target, p),
    ).rejects.toMatchObject({
      code: 'TDMS_CONTROLLED_ARTIFACT_BINDING_INVALID',
    });
    expect(s.db.state.revisions).toHaveLength(0);
  });
  it('related existing document versions require independent actual access', async () => {
    const s = setup();
    const p = fixture();
    p.records[0]!.relatedDocumentVersionIds = ['DV-other'];
    await expect(
      s.service.importPackage(actor(), target, p),
    ).rejects.toMatchObject({ code: 'DOCUMENT_NOT_FOUND' });
    expect(s.db.state.revisions).toHaveLength(0);
    p.records[0]!.relatedDocumentVersionIds = ['DV-owned'];
    await s.service.importPackage(actor(), target, p);
    expect(s.documents.assertRead).toHaveBeenCalled();
  });
  it('server source scope grant alone cannot admit a foreign source record or orphan artifact', async () => {
    const s = setup();
    const p = fixture();
    p.records[0]!.sourceRecordId = 'foreign-source-record';
    await expect(
      s.service.importPackage(actor(), target, p),
    ).rejects.toMatchObject({
      code: 'TDMS_IMPORT_MEMBER_SCOPE_ADMISSION_REQUIRED',
    });
    expect(s.db.state.captures).toHaveLength(0);
    expect(s.artifacts.acquire).not.toHaveBeenCalled();
    const orphan = fixture();
    const bytes = Buffer.from('orphan');
    orphan.artifacts = [
      {
        memberId: 'orphan',
        sourceAttachmentId: 's',
        sourceAttachmentVersion: null,
        fileName: 'x',
        mediaType: 'text/plain',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        byteLength: bytes.length,
        bytesBase64: bytes.toString('base64'),
      },
    ];
    await expect(
      s.service.importPackage(actor(), target, orphan),
    ).rejects.toMatchObject({
      code: 'TDMS_ARTIFACT_OWNER_INVALID',
    });
    expect(s.artifacts.acquire).not.toHaveBeenCalled();
  });
  it('foreign attachment owner/ref cannot self-authorize from package metadata', async () => {
    const s = setup();
    const p = fixture();
    const bytes = Buffer.from('foreign');
    p.artifacts = [
      {
        memberId: 'm',
        sourceAttachmentId: 'foreign-attachment',
        sourceAttachmentVersion: null,
        fileName: 'x',
        mediaType: 'text/plain',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        byteLength: bytes.length,
        bytesBase64: bytes.toString('base64'),
      },
    ];
    p.records[0]!.artifactMemberIds = ['m'];
    await expect(
      s.service.importPackage(actor(), target, p),
    ).rejects.toMatchObject({
      code: 'TDMS_IMPORT_MEMBER_SCOPE_ADMISSION_REQUIRED',
    });
    expect(s.artifacts.acquire).not.toHaveBeenCalled();
  });
  it('native projection/retention rights are required independently of a source-reader grant', async () => {
    const auth = new HostDecisionTdmsSourceAuthorization(
      async () => [{ scope: nativeScope, permissionRevision: 'policy' }],
      async ({ claims, grant }) =>
        ({
          ...grant,
          authorityRef: 'reader-only',
          captureRetentionAllowed: false,
          nativeProjectionAllowed: false,
          permittedMembers: claims,
        }) as any,
    );
    const db = new MemoryTdmsRepository();
    const store = { acquire: jest.fn() };
    const service = new TdmsSourceService(db, auth, store as any, {
      assertRead: jest.fn(),
    });
    await expect(
      service.importPackage(actor(), target, fixture()),
    ).rejects.toMatchObject({ code: 'TDMS_IMPORT_RIGHTS_ADMISSION_REQUIRED' });
    expect(store.acquire).not.toHaveBeenCalled();
    expect(db.state.captures).toHaveLength(0);
  });
  it('configured reader without source-member admission remains closed for imports', async () => {
    const authorization = new HostDecisionTdmsSourceAuthorization(async () => [
      { scope: nativeScope, permissionRevision: 'reader-policy' },
    ]);
    const s = new TdmsSourceService(
      new MemoryTdmsRepository(),
      authorization,
      { acquire: jest.fn() } as any,
      { assertRead: jest.fn() },
    );
    await expect(
      s.importPackage(actor(), target, fixture()),
    ).rejects.toMatchObject({
      code: 'TDMS_IMPORT_MEMBER_ADMISSION_UNCONFIGURED',
      statusCode: 503,
    });
  });
  it('public import cannot override server tenant via target or claim service principal', async () => {
    const s = setup();
    await expect(
      s.service.importPackage(
        actor(),
        { ...target, tenantId: 'evil' } as any,
        fixture(),
      ),
    ).rejects.toMatchObject({ code: 'TDMS_INPUT_UNKNOWN_FIELD' });
    await expect(
      s.service.importPackage(
        { ...actor(), principalKind: 'SERVICE' } as any,
        target,
        fixture(),
      ),
    ).rejects.toMatchObject({ code: 'TDMS_VERIFIED_PUBLIC_ACTOR_REQUIRED' });
  });
});
