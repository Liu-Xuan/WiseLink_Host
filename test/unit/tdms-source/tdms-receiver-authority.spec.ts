import { MiaodaTdmsSourceAuthorization } from '../../../server/modules/tdms-source/miaoda-tdms-source-authorization';
import { TdmsReceiverRepository } from '../../../server/modules/tdms-source/tdms-receiver.repository';
import { receiverAuthority } from '../../../server/modules/tdms-source/tdms-receiver-authorization.validation';
import {
  receiverArtifact,
  receiverSelectionPackage,
} from '../../../server/modules/tdms-source/tdms-receiver-selection.validation';
import { syntheticReceiverFixture } from './tdms-real-receiver.fixture';
import { actor } from './tdms-fixtures';
import {
  expectedTdmsReceiver,
  assertExpectedTdmsReceiver,
} from '../../../server/modules/tdms-source/tdms-receiver-expectation';
import type { Request } from 'express';

describe('controlled Source authority decisions (synthetic fixture; physical DB separately)', () => {
  function setup() {
    const f = syntheticReceiverFixture();
    const repo = {
      authorities: async () => [f.row],
    } as unknown as TdmsReceiverRepository;
    const authorization = new MiaodaTdmsSourceAuthorization(repo);
    const scope = receiverAuthority(f.row, actor(), 'IMPORT')!.scope;
    return { ...f, authorization, scope };
  }
  it('login and package do not create an absent Source grant', async () => {
    const f = setup();
    f.row.actions = {};
    await expect(
      f.authorization.authorizeImport(
        actor(),
        f.scope,
        f.prepared.memberClaims,
      ),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND', statusCode: 404 });
  });
  it('IMPORT, READ_HISTORY and READ_RECORD are independently approved', async () => {
    const f = setup();
    delete f.actions.READ_RECORD;
    await expect(
      f.authorization.authorizeImport(
        actor(),
        f.scope,
        f.prepared.memberClaims,
      ),
    ).resolves.toBeDefined();
    await expect(
      f.authorization.authorizeReadMembers(
        actor(),
        f.scope,
        'READ_HISTORY',
        f.prepared.memberClaims,
      ),
    ).resolves.toBeDefined();
    await expect(
      f.authorization.authorizeReadMembers(
        actor(),
        f.scope,
        'READ_RECORD',
        f.prepared.memberClaims,
      ),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
  });
  it('exact DVI read context preserves independent Source decisions while Matter context stays unconfigured', async () => {
    const f = setup();
    const context = { documentVersionId: 'DV-synthetic-exact' };
    await expect(f.authorization.catalogue(actor(), context)).resolves.toEqual([
      expect.objectContaining({ scope: f.scope, permittedMembers: f.prepared.memberClaims }),
    ]);
    f.actions.READ_RECORD.allowed = false;
    await expect(f.authorization.authorize(actor(), f.scope, 'READ_RECORD', context))
      .rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND', statusCode: 404 });
    await expect(f.authorization.catalogue(actor(), { matterId: 'synthetic-matter' }))
      .rejects.toMatchObject({ code: 'TDMS_RECEIVER_CONTEXT_AUTHORITY_UNCONFIGURED', statusCode: 503 });
  });
  it.each([
    'grant',
    'registry',
    'expired-action',
    'expired-grant',
    'expired-registration',
    'source-identity',
  ])(
    'closes %s without borrowing login ownership or another action',
    async (mode) => {
      const f = setup();
      if (mode === 'grant') {
        f.row.grantStatus = 'REVOKED';
        f.row.grantRevokedAt = new Date().toISOString();
      }
      if (mode === 'registry') {
        f.row.status = 'REVOKED';
        f.row.revokedAt = new Date().toISOString();
      }
      if (mode === 'expired-action')
        f.actions.IMPORT.validUntil = '2000-01-01T00:00:00Z';
      if (mode === 'expired-grant')
        f.row.grantValidUntil = '2000-01-01T00:00:00Z';
      if (mode === 'expired-registration')
        f.row.validUntil = '2000-01-01T00:00:00Z';
      if (mode === 'source-identity')
        f.row.grantSourceSubjectId = 'someone-else';
      await expect(
        f.authorization.authorizeImport(
          actor(),
          f.scope,
          f.prepared.memberClaims,
        ),
      ).rejects.toBeDefined();
    },
  );
  it.each(['tenant', 'application', 'actor', 'instance', 'scope'])(
    'does not admit another %s',
    async (mode) => {
      const f = setup(),
        a = actor(),
        s = { ...f.scope };
      if (mode === 'tenant') {
        a.tenantId = 'other';
        a.subjectDecision.tenantId = 'other';
        s.tenantId = 'other';
      }
      if (mode === 'application') {
        a.applicationScopeId = 'other';
        a.subjectDecision.applicationScopeId = 'other';
      }
      if (mode === 'actor') a.canonicalSubject.id = 'other';
      if (mode === 'instance') s.sourceInstanceId = 'other';
      if (mode === 'scope') s.scopeId = 'other';
      await expect(
        f.authorization.authorizeImport(a, s, f.prepared.memberClaims),
      ).rejects.toBeDefined();
    },
  );
  it.each(['record', 'member', 'attachment', 'version', 'owner'])(
    'requires exact approved %s membership',
    async (mode) => {
      const f = setup(),
        claims = structuredClone(f.prepared.memberClaims);
      if (mode === 'record')
        claims.records[0]!.sourceRecordId = 'OR:wt.doc.WTDocument:999';
      if (mode === 'member') claims.artifacts[0]!.memberId = 'unknown';
      if (mode === 'attachment')
        claims.artifacts[0]!.sourceAttachmentId = 'unknown';
      if (mode === 'version')
        claims.artifacts[0]!.sourceAttachmentVersion = 'unapproved-version';
      if (mode === 'owner')
        claims.artifacts[0]!.owners[0]!.sourceRecordId =
          'OR:wt.doc.WTDocument:999';
      await expect(
        f.authorization.authorizeImport(actor(), f.scope, claims),
      ).rejects.toMatchObject({ code: 'TDMS_RECEIVER_EXACT_MEMBER_DENIED' });
    },
  );
  it('permission revision is common across actions, stable across observation, and changes on controlled revision', async () => {
    const f = setup();
    const first = await f.authorization.authorize(
      actor(),
      f.scope,
      'IMPORT',
      {},
    );
    expect(
      (await f.authorization.authorize(actor(), f.scope, 'READ_RECORD', {}))
        .permissionRevision,
    ).toBe(first.permissionRevision);
    expect(
      (await f.authorization.authorize(actor(), f.scope, 'IMPORT', {}))
        .permissionRevision,
    ).toBe(first.permissionRevision);
    f.row.grantRevision++;
    expect(
      (await f.authorization.authorize(actor(), f.scope, 'IMPORT', {}))
        .permissionRevision,
    ).not.toBe(first.permissionRevision);
  });
  it('keeps package binding and strict upload path separate from authority', () => {
    const f = setup();
    const p = receiverSelectionPackage(
      f.envelope.requestId,
      f.binding.bindingId,
      f.envelope.package,
    );
    expect(
      receiverArtifact(p.observation, f.selection).sourceAttachmentVersion,
    ).toBeNull();
    expect(() =>
      receiverArtifact(p.observation, {
        ...f.selection,
        filePath: 'ordinary/synthetic.pdf',
      }),
    ).toThrow();
    expect(() =>
      receiverSelectionPackage(
        f.envelope.requestId,
        'other',
        f.envelope.package,
      ),
    ).toThrow('TDMS_UPLOAD_SELECTION_BINDING_NOT_FOUND');
  });
});

describe('conditional receiver pin is never a grant', () => {
  const binding = {
    schemaVersion: 'wiselink.tdms-native-host-receiver-binding.v1' as const,
    receiverId: 'synthetic',
    tenantRef: 't',
    applicationRef: 'a',
    principalRef: 'p',
    sourceSystem: 'TDMS' as const,
    sourceInstanceRef: 's',
    authorityRevision: 'r1',
    authorityEvidenceRef: 'e',
    sessionEvidenceRef: 'session1',
    observedAt: '2026-10-18T00:00:00.000Z',
  };
  const req = (value: unknown) =>
    ({
      headers: { 'x-wiselink-tdms-expected-receiver': value },
    }) as unknown as Request;
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  it('requires exact11 and compares observedAt only for format', () => {
    expect(expectedTdmsReceiver({ headers: {} } as Request)).toBeNull();
    expect(expectedTdmsReceiver(req(encode(binding)))).toEqual(binding);
    expect(() =>
      assertExpectedTdmsReceiver(binding, {
        ...binding,
        observedAt: '2026-10-19T00:00:00.000Z',
      }),
    ).not.toThrow();
    expect(() =>
      assertExpectedTdmsReceiver(binding, {
        ...binding,
        sessionEvidenceRef: 'session2',
      }),
    ).toThrow('TDMS_RECEIVER_IDENTITY_CHANGED');
  });
  it.each([
    'not-base64!',
    ['duplicate-header'],
    encode({ ...binding, observedAt: 'yesterday' }),
    encode({ ...binding, extra: 'caller-grant' }),
    encode({ ...binding, principalRef: null }),
  ])('rejects malformed or extra expectation fields', (value) => {
    expect(() => expectedTdmsReceiver(req(value))).toThrow(
      'TDMS_RECEIVER_EXPECTATION_INVALID',
    );
  });
});
