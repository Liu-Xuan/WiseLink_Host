import { DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER } from '@server/modules/document-management/src/hosted/nest/document-management-hosted.tokens';
import { Global, Module, type DynamicModule } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  DRIZZLE_DATABASE,
  FileService,
  SqlExecutionContextMiddleware,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  OAUTH_CONFIG,
  type OAuthConfigPort,
} from '../../../server/modules/identity/oauth-config.port';
import { DocumentManagementRuntimeModule } from '../../../server/modules/document-management-runtime/document-management-runtime.module';
import { MiaodaHostedDocumentCatalog } from '../../../server/modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog';
import { DocumentManagementHostedService } from '../../../server/modules/document-management/src/hosted/nest/document-management-hosted.service';
import { TdmsReceiverRuntimeModule } from '../../../server/modules/tdms-source/tdms-receiver-runtime.module';
import { TdmsReceiverRepository } from '../../../server/modules/tdms-source/tdms-receiver.repository';
import { TdmsReceiverIdentityProfile } from '../../../server/modules/tdms-source/tdms-receiver-identity-profile';
import { MiaodaTdmsSourceAuthorization } from '../../../server/modules/tdms-source/miaoda-tdms-source-authorization';
import { MiaodaTdmsDailyArtifactStore } from '../../../server/modules/tdms-source/miaoda-tdms-daily-artifact-store';
import { receiverAuthority } from '../../../server/modules/tdms-source/tdms-receiver-authorization.validation';
import {
  receiverArtifact,
  receiverSelectionPackage,
} from '../../../server/modules/tdms-source/tdms-receiver-selection.validation';
import {
  withTdmsReceiverDatabase,
  withTdmsReceiverExpectation,
} from '../../../server/modules/tdms-source/tdms-receiver-sql-context';
import type { TdmsStoredSelection } from '../../../server/modules/tdms-source/tdms-receiver.types';
import { actor } from './tdms-fixtures';
import { syntheticReceiverFixture } from './tdms-real-receiver.fixture';

const oauth: OAuthConfigPort = {
  clientId: 'synthetic-client',
  redirectUri: 'https://synthetic.invalid/callback',
  tokenApiVersion: 'v3',
  mappingBootstrap: { kind: 'DISABLED' },
  configured: true,
  applicationScopeId: 'app_17bzc551rsg',
  sessionEnvironment: 'preview',
};

function setup() {
  const fixture = syntheticReceiverFixture();
  const dialect = new PgDialect();
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const state = {
    actorId: actor().canonicalSubject.id,
    schemaName: 'workspace_aadkpkjef3slu',
    roleName: 'authenticated_workspace_aadkpkjef3slu',
    bound: true,
    helperError: null as unknown,
    configuredClient: 'synthetic-client',
    sourceQueries: 0,
  };
  const execute = jest.fn(async (query: SQL) => {
    const compiled = dialect.sqlToQuery(query);
    calls.push(compiled);
    if (compiled.sql.includes('current_schema()')) return [{ ...state }];
    if (compiled.sql.includes('tdms_act_bound_identity')) {
      if (state.helperError) throw state.helperError;
      return [
        { bound: state.bound && compiled.params[1] === 'synthetic-client' },
      ];
    }
    state.sourceQueries++;
    return [fixture.row];
  });
  const database = { execute } as unknown as PostgresJsDatabase;
  // This explicit synthetic port cannot fall back to a production profile.
  const profile = {
    current: () => ({ tenantId: 'tenant-a', clientId: state.configuredClient }),
  };
  const receivers = new TdmsReceiverRepository(database, profile);
  const authorization = new MiaodaTdmsSourceAuthorization(receivers);
  const authority = receiverAuthority(fixture.row, actor(), 'IMPORT')!;
  const artifact = receiverArtifact(fixture.binding, fixture.selection);
  const selected = receiverSelectionPackage(
    fixture.envelope.requestId, fixture.binding.bindingId, fixture.envelope.package,
  );
  const stored: TdmsStoredSelection = {
    scope: authority.scope,
    applicationScopeId: actor().applicationScopeId,
    actorSubjectId: actor().canonicalSubject.id,
    receiverId: authority.row.receiverId,
    receiverRevision: authority.row.revision,
    grantRevision: authority.row.grantRevision,
    permissionRevision: authority.permissionRevision,
    payloadDigest: fixture.prepared.payloadDigest,
    packageId: fixture.envelope.package.packageId,
    memberClaims: selected.memberClaims,
    ownerRecord: selected.ownerRecord,
    observation: fixture.binding,
    artifact,
    receipt: {
      schemaVersion: 'wiselink.tdms-upload-selection-association.v1',
      requestId: fixture.envelope.requestId,
      bindingId: fixture.binding.bindingId,
      receiverId: fixture.row.receiverId,
      packageId: fixture.envelope.package.packageId,
      payloadDigest: fixture.prepared.payloadDigest,
      status: 'STAGED_CANDIDATE',
      selection: fixture.selection,
      sourceAttachmentId: artifact.sourceAttachmentId,
      ownerSnapshotId: fixture.binding.ownerSnapshotId,
      sha256: artifact.sha256,
      byteLength: artifact.byteLength,
      readbackVerified: true,
      documentVersionId: null,
    },
  };
  return {
    fixture,
    state,
    calls,
    execute,
    database,
    receivers,
    authorization,
    authority,
    stored,
  };
}

@Global()
@Module({})
class FixturePlatformModule {
  static register(database: PostgresJsDatabase): DynamicModule {
    return {
      module: FixturePlatformModule,
      providers: [
        { provide: DRIZZLE_DATABASE, useValue: database },
        {
          provide: FileService,
          useValue: {
            from() {
              throw new Error('unexpected FileService I/O');
            },
          },
        },
        { provide: SqlExecutionContextMiddleware, useValue: {} },
      ],
      exports: [DRIZZLE_DATABASE, FileService, SqlExecutionContextMiddleware],
    };
  }
}
@Module({
  providers: [
    { provide: MiaodaHostedDocumentCatalog, useValue: {} },
    { provide: DocumentManagementHostedService, useValue: {} },
    { provide: DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER, useValue: {} },
  ],
  exports: [MiaodaHostedDocumentCatalog, DocumentManagementHostedService, DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER],
})
class FixtureDocumentModule {}

describe('actual receiver identity consumer boundary (SQL results are unit doubles)', () => {
  it('wires the actual IdentityModule OAuth export to the production profile and repository', async () => {
    const before = process.env.WISELINK_TDMS_BOUND_TENANT_ID;
    process.env.WISELINK_TDMS_BOUND_TENANT_ID = 'tenant-a';
    const f = setup();
    const module = await Test.createTestingModule({
      imports: [
        FixturePlatformModule.register(f.database),
        TdmsReceiverRuntimeModule,
      ],
    })
      .overrideProvider(OAUTH_CONFIG)
      .useValue(oauth)
      .overrideModule(DocumentManagementRuntimeModule)
      .useModule(FixtureDocumentModule)
      .compile();
    try {
      expect(module.get(TdmsReceiverIdentityProfile)).toBeInstanceOf(
        TdmsReceiverIdentityProfile,
      );
      expect(module.get(TdmsReceiverIdentityProfile).current()).toEqual({
        tenantId: 'tenant-a',
        clientId: oauth.clientId,
      });
      expect(
        await module.get(TdmsReceiverRepository).authorities(actor()),
      ).toEqual([f.fixture.row]);
      expect(f.calls[1]).toMatchObject({
        sql: expect.stringContaining(
          'workspace_aadkpkjef3slu.tdms_act_bound_identity',
        ),
        params: ['tenant-a', 'synthetic-client'],
      });
    } finally {
      await module.close();
      if (before === undefined)
        delete process.env.WISELINK_TDMS_BOUND_TENANT_ID;
      else process.env.WISELINK_TDMS_BOUND_TENANT_ID = before;
    }
  });

  it('keeps the actual modules constructible without T/OAuth and rejects only the receiver call', async () => {
    const before = process.env.WISELINK_TDMS_BOUND_TENANT_ID;
    delete process.env.WISELINK_TDMS_BOUND_TENANT_ID;
    const f = setup();
    const module = await Test.createTestingModule({
      imports: [
        FixturePlatformModule.register(f.database),
        TdmsReceiverRuntimeModule,
      ],
    })
      .overrideProvider(OAUTH_CONFIG)
      .useValue({ ...oauth, configured: false, clientId: null })
      .overrideModule(DocumentManagementRuntimeModule)
      .useModule(FixtureDocumentModule)
      .compile();
    try {
      await module.init();
      expect(module.get(TdmsReceiverIdentityProfile)).toBeInstanceOf(
        TdmsReceiverIdentityProfile,
      );
      await expect(
        module.get(TdmsReceiverRepository).authorities(actor()),
      ).rejects.toMatchObject({
        code: 'TDMS_RECEIVER_IDENTITY_PROFILE_UNCONFIGURED',
        statusCode: 503,
      });
      expect(f.calls).toHaveLength(0);
    } finally {
      await module.close();
      if (before === undefined)
        delete process.env.WISELINK_TDMS_BOUND_TENANT_ID;
      else process.env.WISELINK_TDMS_BOUND_TENANT_ID = before;
    }
  });

  it.each(['tenant', 'app'])(
    'rejects wrong Native %s before receiver SQL or Source/File I/O',
    async (field) => {
      const f = setup();
      const a = actor();
      if (field === 'tenant') {
        a.tenantId = 'foreign';
        a.subjectDecision.tenantId = 'foreign';
      } else {
        a.applicationScopeId = 'foreign';
        a.subjectDecision.applicationScopeId = 'foreign';
      }
      const store = new MiaodaTdmsDailyArtifactStore(
        f.fixture.files as unknown as FileService,
        f.fixture.catalog as unknown as MiaodaHostedDocumentCatalog,
        f.authorization,
        f.receivers,
      );
      await expect(
        store.resolveDailySelection({
          actor: a,
          scope: f.authority.scope,
          packageId: f.fixture.envelope.requestId,
          observation: f.fixture.binding,
          payloadDigest: f.fixture.prepared.payloadDigest,
        }),
      ).rejects.toMatchObject({
        code: 'TDMS_RECEIVER_IDENTITY_PROFILE_MISMATCH',
        statusCode: 403,
      });
      expect(f.calls).toHaveLength(0);
      expect(f.state.sourceQueries).toBe(0);
      expect(f.fixture.activity).toMatchObject({
        downloads: 0,
        uploads: 0,
        acquisitions: 0,
      });
      // This exercises the Source consumer boundary, not SessionResolver's prior identity SQL.
    },
  );

  it.each(['authorities', 'selection', 'insertSelection'] as const)(
    'guards the real %s entry before business SQL and conditional callbacks',
    async (entry) => {
      const f = setup();
      const a = actor();
      a.tenantId = 'foreign';
      a.subjectDecision.tenantId = 'foreign';
      const expectation = jest.fn(async () => f.authority.scope);
      const operation = async (): Promise<unknown> =>
        entry === 'authorities'
          ? f.receivers.authorities(a, f.authority.scope)
          : entry === 'selection'
            ? f.receivers.selection(
                a,
                f.authority.scope,
                f.stored.receipt.requestId,
                f.stored.receipt.bindingId,
              )
            : f.receivers.insertSelection(a, f.authority, f.stored);
      const run = () => withTdmsReceiverExpectation(expectation, operation);
      // Enter the existing transaction carrier before adding this test pin, so
      // this assertion measures the repository method, not a prior transaction.
      await expect(
        entry === 'insertSelection'
          ? withTdmsReceiverDatabase(f.database, run)
          : run(),
      ).rejects.toMatchObject({
        code: 'TDMS_RECEIVER_IDENTITY_PROFILE_MISMATCH',
      });
      expect(f.calls).toHaveLength(0);
      expect(expectation).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['actorId', 'foreign', 'TDMS_RECEIVER_SQL_ACTOR_MISMATCH', 401],
    ['schemaName', 'other_schema', 'TDMS_RECEIVER_SQL_CONTEXT_MISMATCH', 503],
    [
      'roleName',
      'anon_workspace_aadkpkjef3slu',
      'TDMS_RECEIVER_SQL_CONTEXT_MISMATCH',
      503,
    ],
    ['roleName', 'dataloom_user', 'TDMS_RECEIVER_SQL_CONTEXT_MISMATCH', 503],
    ['roleName', 'authenticated', 'TDMS_RECEIVER_SQL_CONTEXT_MISMATCH', 503],
  ] as const)(
    'rejects observed SQL %s=%s before the helper/Source queries',
    async (field, value, code, statusCode) => {
      const f = setup();
      f.state[field] = value;
      await expect(f.receivers.authorities(actor())).rejects.toMatchObject({
        code,
        statusCode,
      });
      expect(f.calls).toHaveLength(1);
      expect(f.state.sourceQueries).toBe(0);
    },
  );

  it('accepts service suffix and rechecks false helper results without caching mapping/grants', async () => {
    const f = setup();
    f.state.roleName = 'service_role_workspace_aadkpkjef3slu';
    await expect(f.receivers.authorities(actor())).resolves.toHaveLength(1);
    const before = f.state.sourceQueries;
    f.state.bound = false;
    await expect(f.receivers.authorities(actor())).rejects.toMatchObject({
      code: 'TDMS_RECEIVER_BOUND_IDENTITY_MISMATCH',
      statusCode: 403,
    });
    expect(f.state.sourceQueries).toBe(before);
    f.state.bound = true;
    f.state.configuredClient = 'other-client';
    await expect(f.receivers.authorities(actor())).rejects.toMatchObject({
      code: 'TDMS_RECEIVER_BOUND_IDENTITY_MISMATCH',
    });
    expect(f.calls.at(-1)?.params).toEqual(['tenant-a', 'other-client']);
  });

  it.each(['42883', '42P01'])(
    'reports missing helper/storage %s as typed503',
    async (code) => {
      const f = setup();
      f.state.helperError = { cause: { code } };
      await expect(f.receivers.authorities(actor())).rejects.toMatchObject({
        code: 'TDMS_RECEIVER_BOUND_IDENTITY_STORAGE_UNCONFIGURED',
        statusCode: 503,
      });
      expect(f.state.sourceQueries).toBe(0);
    },
  );
  it.each(['42501', '08006'])(
    'does not swallow unrelated DB/permission failure %s',
    async (code) => {
      const f = setup();
      const error = Object.assign(new Error('synthetic SQL failure'), { code });
      f.state.helperError = error;
      await expect(f.receivers.authorities(actor())).rejects.toBe(error);
    },
  );
});
