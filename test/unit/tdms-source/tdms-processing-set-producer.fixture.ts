import { AsyncLocalStorage } from 'node:async_hooks';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import express, { type Request } from 'express';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  DRIZZLE_DATABASE,
  DATAPAAS_CONFIG,
  CapabilityService,
  FileService,
  SqlExecutionContextMiddleware,
} from '@lark-apaas/fullstack-nestjs-core';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type {
  TdmsProcessingRevisionSet,
  TdmsProcessingSetHead,
  TdmsProcessingSetFromRetainedRequest,
} from '@shared/tdms-processing-set.interface';
import type {
  TdmsCapture,
  TdmsAction,
  TdmsImportMemberClaims,
  TdmsStoredRevision,
} from '@server/modules/tdms-source/tdms-source.types';
import type { TdmsReceiverAction } from '@server/modules/tdms-source/tdms-receiver.types';
import type { VerifiedIdentity } from '@server/modules/identity/identity.types';
import { IdentityModule } from '@server/modules/identity/identity.module';
import { SessionResolver } from '@server/modules/identity/session-resolver.service';
import { SessionStore } from '@server/modules/identity/session.store';
import { OAUTH_CONFIG } from '@server/modules/identity/oauth-config.port';
import { TdmsSourceModule } from '@server/modules/tdms-source/tdms-source.module';
import { TdmsReceiverRuntimeModule } from '@server/modules/tdms-source/tdms-receiver-runtime.module';
import { DocumentManagementRuntimeModule } from '@server/modules/document-management-runtime/document-management-runtime.module';
import { TdmsReceiverIdentityProfile } from '@server/modules/tdms-source/tdms-receiver-identity-profile';
import { TdmsReceiverSourceAuthorization } from '@server/modules/tdms-source/tdms-receiver-source-authorization';
import { MiaodaTdmsDocumentAccess } from '@server/modules/tdms-source/miaoda-tdms-document-access';
import {
  TDMS_REPOSITORY,
  TDMS_SOURCE_AUTHORIZATION,
  TDMS_DOCUMENT_ACCESS,
} from '@server/modules/tdms-source/tdms-source.types';
import { TdmsDailyMetadataController } from '@server/modules/tdms-source/tdms-daily-metadata.controller';
import { TdmsProcessingSetController } from '@server/modules/tdms-source/tdms-processing-set.controller';
import { TdmsProcessingSetProducerService } from '@server/modules/tdms-source/tdms-processing-set-producer.service';
import { TdmsReceiverService } from '@server/modules/tdms-source/tdms-receiver.service';
import { TDMS_PROCESSING_METADATA_FIELDS } from '@server/modules/tdms-source/tdms-processing-set.types';
import { processingSet } from '@server/modules/tdms-source/tdms-processing-set.validation';
import {
  canonical,
  object,
} from '@server/modules/tdms-source/tdms-source.validation';
import { adaptTdmsDailySource } from '@server/modules/tdms-source/tdms-daily-source-adapter';
import { MemoryTdmsRepository } from './tdms-memory-double';
import {
  syntheticCompleteEnvelope,
  withCompleteRelation,
  copyComplete,
} from './tdms-complete-owned.fixture';
import { resealCurrent } from './tdms-current-contract.fixture';
import { source092RecordProof } from './tdms-source092-dto.fixture';
import { syntheticReceiverFixture } from './tdms-real-receiver.fixture';
import { actor } from './tdms-fixtures';
import { miaodaHostedFinalUserActor } from '@server/modules/work-item/production-miaoda-browser-ingress';

interface SqlState {
  sets: Map<string, TdmsProcessingRevisionSet>;
  heads: Map<string, TdmsProcessingSetHead>;
  dirty: boolean;
  id: number;
  depth: number;
}
type MutableAction = Omit<
  TdmsReceiverAction,
  | 'allowed'
  | 'captureRetentionAllowed'
  | 'nativeProjectionAllowed'
  | 'retainedCaptureReadAllowed'
> & {
  allowed: boolean;
  captureRetentionAllowed?: boolean;
  nativeProjectionAllowed?: boolean;
  retainedCaptureReadAllowed?: boolean;
};
function relationEnvelope(
  scope: 'SB' | 'SL' | 'SB_PROCESSING_FORM',
  id: number,
  target: string,
) {
  const source = withCompleteRelation(syntheticCompleteEnvelope(scope, id));
  const changed: typeof source = JSON.parse(
    JSON.stringify(source).replaceAll(
      'OR:wt.change2.WTChangeActivity2:999',
      target,
    ),
  );
  return resealCurrent(changed);
}

/** External SQL/storage/session doubles only. All producer, authority, receiver, save/read classes and DI are real. */
export async function createProcessingProducerFixture(
  rootScope: 'SB' | 'SL' = 'SL',
) {
  const baseActor = actor();
  const native = miaodaHostedFinalUserActor({
    userId: baseActor.canonicalSubject.id,
    tenantId: 1001,
    appId: baseActor.applicationScopeId,
    env: 'preview',
    isSystemAccount: false,
  });
  const controlled = syntheticReceiverFixture(),
    storage = new MemoryTdmsRepository();
  controlled.row.tenantId = native.tenantId;
  const actions: Record<string, MutableAction> = controlled.actions;
  const scope = {
    tenantId: native.tenantId,
    sourceKey: controlled.row.sourceKey,
    sourceInstanceId: controlled.row.sourceInstanceId,
    scopeId: controlled.row.scopeId,
  };
  // SB and SL share these same processing/assessment profiles; only their exact manufacturer observation differs.
  const envelopes = [
    relationEnvelope(rootScope, 73001, 'OR:wt.change2.WTChangeRequest2:901'),
    relationEnvelope(
      'SB_PROCESSING_FORM',
      901,
      'OR:wt.change2.WTChangeOrder2:902',
    ),
    syntheticCompleteEnvelope('SB_ASSESSMENT_FORM', 902),
    syntheticCompleteEnvelope('SB_ASSESSMENT_FORM', 903),
  ];
  const claims: TdmsImportMemberClaims = {
    records: [],
    artifacts: [],
    relationIds: [],
    relatedDocumentVersionIds: [],
  };
  for (const envelope of envelopes) {
    const current = adaptTdmsDailySource(envelope).memberClaims;
    claims.records.push(...current.records);
    claims.relationIds.push(...current.relationIds);
    claims.artifacts.push(...current.artifacts);
  }
  for (const action of Object.values(actions))
    action.permittedMembers = copyComplete(claims);
  const request = new IncomingMessage(new Socket());
  Object.setPrototypeOf(request, express.request);
  const http = request as Request;
  http.headers.cookie = 'wl_session=synthetic-processing-session';
  http.userContext = {
    userId: native.canonicalSubject.id,
    tenantId: 1001,
    appId: native.applicationScopeId,
    env: 'preview',
    isSystemAccount: false,
  };
  const session = {
    valid: true,
    revision: 1,
    expiresAt: new Date(Date.now() + 60_000),
  };
  const state = {
    sqlActor: native.canonicalSubject.id,
    sqlRole: 'authenticated_workspace_aadkpkjef3slu',
    queries: [] as Array<{
      sql: string;
      params: unknown[];
      transactionId: number;
    }>,
    afterQuery: undefined as ((sql: string) => void) | undefined,
    afterCommit: undefined as (() => void) | undefined,
    proofReads: 0,
    metadataReads: 0,
    nextId: 1,
  };
  const committed: SqlState = {
    sets: new Map(),
    heads: new Map(),
    dirty: false,
    id: 0,
    depth: 0,
  };
  const transactions = new AsyncLocalStorage<SqlState>(),
    dialect = new PgDialect();
  const captureFor = (params: readonly unknown[]) =>
    storage.state.captures.find(
      (capture) =>
        params.includes(capture.receipt.captureRef) &&
        params.includes(scope.tenantId) &&
        params.includes(scope.scopeId) &&
        params.includes(scope.sourceInstanceId) &&
        params.includes(scope.sourceKey),
    );
  function indexOf(capture: TdmsCapture) {
    const retained = capture.dailyMetadata?.nativeRetention;
    if (!retained)
      throw new Error('Synthetic capture has no actual native retention');
    return {
      scope: capture.scope,
      packageId: capture.packageId,
      packageHash: capture.packageHash,
      captureRef: capture.receipt.captureRef,
      applicationScopeId: capture.dailyMetadata!.applicationScopeId,
      records: retained.records,
      relations: retained.relations,
      artifacts: retained.artifacts,
      recordRevisionRefs: capture.receipt.recordRevisionRefs,
      assertionRefs: capture.receipt.assertionRefs,
    };
  }
  function proofOf(capture: TdmsCapture) {
    const daily = capture.dailyMetadata;
    if (!daily?.nativeRetention || !daily.adapter)
      throw new Error('Missing synthetic retained adapter');
    const candidates = daily.nativeRetention.relations.map((mapping) => {
      const edge = daily.envelope.package.edges.find(
        (edge) => edge.edgeId === mapping.edgeId,
      );
      if (!edge) throw new Error('Missing synthetic raw edge');
      return {
        assertionRef: mapping.assertionRef,
        sourceRelationId: mapping.edgeId,
        fromSourceRecordId: edge.fromSourceRecordId,
        toSourceRecordId: edge.toSourceRecordId,
      };
    });
    // These are storage-operation results computed from actual SourceService retention, not a proof authority.
    const consistent =
      daily.receipt.payloadDigest === capture.packageHash &&
      daily.envelope.requestId === capture.packageId &&
      canonical(daily.adapter.mappings.records) ===
        canonical(
          daily.nativeRetention.records.map(
            ({ sourceRevisionRef: ignored, ...row }) => {
              void ignored;
              return row;
            },
          ),
        ) &&
      canonical(daily.adapter.mappings.relations) ===
        canonical(
          daily.nativeRetention.relations.map(
            ({ assertionRef: ignored, ...row }) => {
              void ignored;
              return row;
            },
          ),
        ) &&
      daily.nativeRetention.relations.every((mapping) => {
        const assertion = storage.state.assertions.find(
          (row) => row.assertion.assertionRef === mapping.assertionRef,
        );
        const edge = daily.envelope.package.edges.find(
          (edge) => edge.edgeId === mapping.edgeId,
        );
        return (
          assertion?.assertion.captureRef === capture.receipt.captureRef &&
          assertion.assertion.authority === 'CANDIDATE_ONLY' &&
          assertion.assertion.controlledKind === null &&
          assertion.assertion.from.kind === 'UNRESOLVED' &&
          assertion.assertion.to.kind === 'UNRESOLVED' &&
          canonical(assertion.assertion.rawFields.dailyObservedEdge) ===
            canonical(edge)
        );
      });
    const own = daily.nativeRetention.records.map((mapping) => {
      const source = daily.envelope.package.records.find(
        (record) => record.snapshotId === mapping.snapshotId,
      );
      const stored = storage.state.revisions.find(
        (row) => row.record.sourceRevisionRef === mapping.sourceRevisionRef,
      );
      if (!source)
        throw new Error('Synthetic mapping no longer names an own record');
      const proof = source092RecordProof(source);
      return {
        sourceRevisionRef: mapping.sourceRevisionRef,
        scopeId: proof.scopeId,
        consistent: Boolean(
          stored &&
          stored.record.captureRef === capture.receipt.captureRef &&
          canonical(stored.record.sourceVersion) ===
            canonical(source.sourceVersion) &&
          canonical(stored.record.businessVersion ?? null) ===
            canonical(source.businessVersion) &&
          canonical(stored.record.rawFields) === canonical(source.rawFields) &&
          canonical(stored.record.content) === canonical(source.content),
        ),
        owners: proof.reads.map(({ owner }) => ({
          sourceRecordId: owner.sourceRecordId,
          number: owner.number,
          nativeTypeId: owner.nativeTypeId,
          sourceVersion: owner.sourceVersion,
          businessVersion: owner.businessVersion,
          stateRaw: owner.stateRaw,
          sourceModifiedRaw: owner.sourceModifiedRaw,
          observedAt: owner.observedAt,
        })),
      };
    });
    return {
      captureRef: capture.receipt.captureRef,
      consistent,
      own,
      candidates,
    };
  }
  const database = {
    execute: async (statement: SQL): Promise<unknown[]> => {
      const query = dialect.sqlToQuery(statement),
        params: unknown[] = query.params;
      const tx = transactions.getStore() ?? committed;
      state.queries.push({ sql: query.sql, params, transactionId: tx.id });
      let result: unknown[];
      if (query.sql.includes('current_schema()'))
        result = [
          {
            actorId: state.sqlActor,
            schemaName: 'workspace_aadkpkjef3slu',
            roleName: state.sqlRole,
          },
        ];
      else if (query.sql.includes('current_user'))
        result = [{ roleName: state.sqlRole }];
      else if (query.sql.includes('tdms_act_bound_identity'))
        result = [{ bound: true }];
      else if (query.sql.includes('pg_advisory_xact_lock_shared')) result = [];
      else if (query.sql.includes('SELECT r.receiver_id'))
        result = [{ receiverId: controlled.row.receiverId }];
      else if (query.sql.includes('FROM tdms_source_receiver'))
        result = [copyComplete(controlled.row)];
      else if (query.sql.includes('FROM tdms_capture c')) {
        state.proofReads++;
        const capture = captureFor(params);
        result = capture ? [{ data: proofOf(capture) }] : [];
      } else if (query.sql.includes('FROM tdms_capture')) {
        const capture = captureFor(params);
        result =
          capture &&
          (!query.sql.includes('AND package_id=') ||
            params.includes(capture.packageId))
            ? [{ data: indexOf(capture) }]
            : [];
      } else if (query.sql.includes('FROM tdms_record_revision')) {
        state.metadataReads++;
        const row = storage.state.revisions.find(
          (row) =>
            params.includes(row.record.sourceRevisionRef) &&
            params.includes(row.scope.tenantId),
        );
        result = row
          ? [
              {
                data: {
                  scope: row.scope,
                  record: {
                    ...Object.fromEntries(
                      TDMS_PROCESSING_METADATA_FIELDS.map((key) => [
                        key,
                        row.record[key],
                      ]),
                    ),
                    rawFields: {
                      sourceModifiedRaw: row.record.rawFields.sourceModifiedRaw,
                      opinionCollection: row.record.rawFields.opinionCollection,
                    },
                  },
                },
                data_kind: 'object',
                record_kind: 'object',
                raw_fields_kind: 'object',
              },
            ]
          : [];
      } else if (
        query.sql.includes('INSERT INTO tdms_processing_revision_set')
      ) {
        const payload = params.find(
          (value) =>
            typeof value === 'string' &&
            value.startsWith(
              '{"schemaVersion":"wiselink.tdms-processing-set.v1"',
            ),
        );
        const set = processingSet(JSON.parse(String(payload)));
        if (tx.sets.has(set.setRevisionRef))
          throw new Error('Synthetic unique constraint');
        tx.sets.set(set.setRevisionRef, set);
        tx.dirty = true;
        result = [];
      } else if (query.sql.includes('FROM tdms_processing_revision_set')) {
        const set = [...tx.sets.values()].find((set) =>
          params.includes(set.setRevisionRef),
        );
        result = set ? [{ data: copyComplete(set) }] : [];
      } else if (query.sql.includes('FROM tdms_processing_set_head')) {
        const head = [...tx.heads.values()].find((head) =>
          params.includes(head.processingFamilyRef),
        );
        result = head ? [{ data: copyComplete(head) }] : [];
      } else
        throw new Error('Unexpected synthetic SQL: ' + query.sql.slice(0, 100));
      state.afterQuery?.(query.sql);
      return result;
    },
    transaction: async <T>(
      operation: (port: typeof database) => Promise<T>,
    ): Promise<T> => {
      const outer = transactions.getStore();
      const next: SqlState = {
        sets: new Map(committed.sets),
        heads: new Map(committed.heads),
        dirty: false,
        id: state.nextId++,
        depth: (outer?.depth ?? -1) + 1,
      };
      const result = await transactions.run(next, () => operation(database));
      if (next.dirty) {
        committed.sets = next.sets;
        committed.heads = next.heads;
      }
      if (next.depth === 0) state.afterCommit?.();
      return result;
    },
  };
  const identity: VerifiedIdentity = {
    subjectMappingId: 'synthetic-processing-mapping',
    provenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
    miaodaUserId: native.canonicalSubject.id,
    tenantId: native.tenantId,
    feishuUserId: null,
    feishuOpenId: 'synthetic-processing-open',
    namespacedSubject: {
      namespace: 'FEISHU_OPEN_ID',
      subject: 'synthetic-processing-open',
      tenantKey: 'synthetic-processing',
    },
    verifiedAt: '2026-10-28T00:00:00.000Z',
  };
  @Global()
  @Module({
    providers: [
      { provide: DRIZZLE_DATABASE, useValue: database },
      {
        provide: DATAPAAS_CONFIG,
        useValue: { roleSchema: 'synthetic-role-schema' },
      },
      {
        provide: SqlExecutionContextMiddleware,
        useValue: {
          use: (request: Request, _response: unknown, next: () => void) => {
            state.sqlActor = String(request.userContext?.userId ?? '');
            next();
          },
        },
      },
      { provide: CapabilityService, useValue: {} },
      {
        provide: FileService,
        useValue: {
          from: () => {
            throw new Error('Unexpected file I/O');
          },
        },
      },
    ],
    exports: [
      DRIZZLE_DATABASE,
      DATAPAAS_CONFIG,
      SqlExecutionContextMiddleware,
      CapabilityService,
      FileService,
    ],
  })
  class SyntheticPlatformModule {}
  @Module({
    providers: [
      SessionResolver,
      {
        provide: SessionStore,
        useValue: {
          validate: async (token: string) =>
            token === 'synthetic-processing-session' && session.valid
              ? {
                  identity,
                  sessionId: 'synthetic-processing-session-id',
                  revision: session.revision,
                  expiresAt: session.expiresAt,
                }
              : null,
        },
      },
      {
        provide: OAUTH_CONFIG,
        useValue: {
          applicationScopeId: native.applicationScopeId,
          sessionEnvironment: native.env,
          clientId: 'synthetic-client',
          configured: false,
        },
      },
    ],
    exports: [SessionResolver, OAUTH_CONFIG],
  })
  class SyntheticIdentityModule {}
  const module = await Test.createTestingModule({
    imports: [
      SyntheticPlatformModule,
      TdmsSourceModule.register({
        imports: [TdmsReceiverRuntimeModule, DocumentManagementRuntimeModule],
        authorizationProvider: {
          provide: TDMS_SOURCE_AUTHORIZATION,
          useExisting: TdmsReceiverSourceAuthorization,
        },
        documentAccessProvider: {
          provide: TDMS_DOCUMENT_ACCESS,
          useClass: MiaodaTdmsDocumentAccess,
        },
      }),
    ],
  })
    .overrideModule(IdentityModule)
    .useModule(SyntheticIdentityModule)
    .overrideProvider(TDMS_REPOSITORY)
    .useValue(storage)
    .overrideProvider(TdmsReceiverIdentityProfile)
    .useValue({
      current: () => ({
        tenantId: native.tenantId,
        clientId: 'synthetic-client',
      }),
    })
    .compile();
  await module.init();
  const daily = module.get(TdmsDailyMetadataController),
    controller = module.get(TdmsProcessingSetController);
  async function seed() {
    for (const envelope of envelopes) await daily.submit(http, envelope, {});
    const ref = (kind: string, id: string): string => {
      const row = storage.state.revisions.find(
        (row) =>
          row.record.recordKind === kind && row.record.sourceRecordId === id,
      );
      if (!row)
        throw new Error(
          'Actual synthetic SourceService did not retain requested own observation',
        );
      return row.record.sourceRevisionRef;
    };
    const input: TdmsProcessingSetFromRetainedRequest = {
      scope,
      operationRef: 'synthetic-processing-operation-1',
      captures: storage.state.captures
        .slice(0, 3)
        .map((capture) => ({
          packageId: capture.packageId,
          captureRef: capture.receipt.captureRef,
        })),
      processingObservationRef: ref(
        'PROCESSING_SHEET',
        'OR:wt.change2.WTChangeRequest2:901',
      ),
      rootObservationRefs: [
        ref('MANUFACTURER_FILE', 'OR:wt.doc.WTDocument:73001'),
      ],
      assessmentObservationRefs: [
        ref('ENGINEER_ASSESSMENT', 'OR:wt.change2.WTChangeOrder2:902'),
      ],
      expectedGeneration: null,
    };
    return input;
  }
  return {
    module,
    controller,
    producer: module.get(TdmsProcessingSetProducerService),
    receiver: module.get(TdmsReceiverService),
    request: http,
    storage,
    state,
    committed,
    actions,
    row: controlled.row,
    scope,
    session,
    seed,
    indexOf,
    proofOf,
    query: {
      sourceKey: scope.sourceKey,
      sourceInstanceId: scope.sourceInstanceId,
      scopeId: scope.scopeId,
    },
  };
}

/** For the coordinator's separate temporary PostgreSQL review. No private Source sample is included. */
export function processingProducerRows(
  fixture: Awaited<ReturnType<typeof createProcessingProducerFixture>>,
): Pick<
  MemoryTdmsRepository['state'],
  'captures' | 'revisions' | 'assertions'
> {
  return copyComplete({
    captures: fixture.storage.state.captures,
    revisions: fixture.storage.state.revisions,
    assertions: fixture.storage.state.assertions,
  });
}
