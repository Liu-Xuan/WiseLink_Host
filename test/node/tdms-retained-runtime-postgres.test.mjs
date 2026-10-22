import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  postgresCapability,
  startOwnedPostgres,
} from '../pg/owned-postgres-cluster.mjs';

process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
});
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { sql } = require('drizzle-orm');
const {
  tdmsRuntimeFixture,
} = require('../unit/fixtures/tdms-runtime.fixture.ts');
const {
  TdmsRetainedRuntimeFacts,
} = require('../../server/modules/tdms-source/tdms-retained-runtime-facts.ts');
const {
  MiaodaTdmsProcessingSetRepository,
} = require('../../server/modules/tdms-source/tdms-processing-set.repository.ts');
const {
  TdmsProcessingSetService,
} = require('../../server/modules/tdms-source/tdms-processing-set.service.ts');
const {
  HostTdmsRuntimeReader,
} = require('../../server/modules/tdms-source/tdms-runtime-reader.adapter.ts');
const {
  projectTdmsProcessingCohortContext,
  tdmsApprovedOpinionRef,
} = require('../../server/modules/canonical-host/tdms-approved-opinion-context.ts');
const capability = await postgresCapability();
const clone = (value) => structuredClone(value);

function metadata(value) {
  const r = value.record;
  return {
    scope: value.scope,
    record: Object.fromEntries(
      [
        'recordRef',
        'sourceRevisionRef',
        'recordKind',
        'sourceRecordId',
        'sourceKey',
        'sourceInstanceId',
        'title',
        'fileType',
        'sourceVersion',
        'businessVersion',
        'state',
        'authors',
        'observedAt',
        'capturedAt',
        'coverage',
        'relatedDocumentVersionIds',
        'fieldSelectors',
        'sourceVerification',
        'currentness',
      ]
        .filter((key) => Object.hasOwn(r, key))
        .map((key) => [key, r[key]]),
    ),
    captureRef: r.captureRef,
    sourceModifiedAt: r.sourceModifiedAt,
    ...(typeof r.rawFields.sourceModifiedRaw === 'string'
      ? { sourceModifiedRaw: r.rawFields.sourceModifiedRaw }
      : {}),
    opinionCollection: r.rawFields.opinionCollection ?? null,
    fieldProvenance: r.fieldProvenance,
  };
}

test(
  'retained processing facts and actual runtime consumer use exact scoped PG metadata',
  { skip: capability.available ? false : capability.reason, timeout: 30000 },
  async (t) => {
    const owned = await startOwnedPostgres(capability);
    try {
      const f = tdmsRuntimeFixture();
      const { scope, set, binding } = f;
      const admin = owned.admin;
      const provider = new TdmsRetainedRuntimeFacts();
      await admin`CREATE SCHEMA retained_fixture`;
      await admin`SET search_path TO retained_fixture,pg_catalog`;
      const role = `tdms_fixture_app_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
      await admin.unsafe(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS`);
      await admin.unsafe(`GRANT USAGE ON SCHEMA retained_fixture TO ${role}`);
      const client = await owned.connect(role);
      await client`SET search_path TO retained_fixture,pg_catalog`;
      await client`SELECT set_config('app.fixture_tenant',${scope.tenantId},false)`;
      const database = drizzle(client);
      const rawResults = [];
      const observe = (db) => ({
        execute: async (query) => {
          const result = await db.execute(query);
          rawResults.push(JSON.stringify(result));
          return result;
        },
      });
      const select = (db, extra = {}) =>
        provider.resolveSelections({
          binding,
          scope,
          rootSourceRevisionRefs: ['source'],
          database: db,
          ...extra,
        });
      await t.test(
        'ordinary task touches no storage; exact TDMS binding on undeployed schema fails explicitly',
        async () => {
          let calls = 0;
          assert.deepEqual(
            await select(
              {
                execute: async () => {
                  calls++;
                  throw new Error('NO_SQL_ALLOWED');
                },
              },
              { rootSourceRevisionRefs: [] },
            ),
            [],
          );
          assert.equal(calls, 0);
          await assert.rejects(
            select(database),
            (error) =>
              error.code === 'TDMS_RUNTIME_PROCESSING_STORAGE_UNCONFIGURED' &&
              error.statusCode === 503,
          );
          const denied = Object.assign(new Error('permission denied'), {
            code: '42501',
          });
          await assert.rejects(
            select({
              execute: async () => {
                throw denied;
              },
            }),
            (error) => error === denied,
          );
        },
      );
      for (const name of [
        'tdms-source-rebuild-v1.draft.sql',
        'tdms-processing-set-v1.draft.sql',
      ])
        await admin.unsafe(
          await readFile(
            new URL(`../../server/database/${name}`, import.meta.url),
            'utf8',
          ),
        );
      const insertSet = async (value, selected = true) => {
        await admin`INSERT INTO tdms_processing_revision_set (tenant_id,source_key,source_instance_id,scope_id,set_revision_ref,processing_family_ref,cohort_ref,processing_observation_ref,data) VALUES (${scope.tenantId},${scope.sourceKey},${scope.sourceInstanceId},${scope.scopeId},${value.setRevisionRef},${value.processingFamilyRef},${value.cohortRef},${value.processingObservationRef},${JSON.stringify(value)}::text::jsonb)`;
        if (selected) {
          const head = {
            scope,
            processingFamilyRef: value.processingFamilyRef,
            selectedSetRevisionRef: value.setRevisionRef,
            generation: 1,
          };
          await admin`INSERT INTO tdms_processing_set_head (tenant_id,source_key,source_instance_id,scope_id,processing_family_ref,selected_set_revision_ref,generation,data) VALUES (${scope.tenantId},${scope.sourceKey},${scope.sourceInstanceId},${scope.scopeId},${head.processingFamilyRef},${head.selectedSetRevisionRef},1,${JSON.stringify(head)}::text::jsonb)`;
        }
      };
      const storedRevisions = new Map();
      for (const [ref, value] of f.revisions) {
        const stored = JSON.parse(JSON.stringify(value));
        stored.record.rawFields.opaque = 'RAW_OPAQUE_BODY_MUST_STAY_IN_DB';
        stored.attachmentAcquisitions = [
          { opaque: 'ACQUISITION_BODY_MUST_STAY_IN_DB' },
        ];
        storedRevisions.set(ref, stored);
        await admin`INSERT INTO tdms_record_revision (tenant_id,source_key,source_instance_id,scope_id,source_revision_ref,record_ref,data) VALUES (${scope.tenantId},${scope.sourceKey},${scope.sourceInstanceId},${scope.scopeId},${ref},${stored.record.recordRef},${JSON.stringify(stored)}::text::jsonb)`;
      }
      for (const [ref, value] of f.assertions)
        await admin`INSERT INTO tdms_relation_assertion (tenant_id,source_key,source_instance_id,scope_id,assertion_ref,relation_ref,data) VALUES (${scope.tenantId},${scope.sourceKey},${scope.sourceInstanceId},${scope.scopeId},${ref},${value.assertion.relationRef},${JSON.stringify(value)}::text::jsonb)`;
      await insertSet(set);
      await insertSet(
        { ...clone(set), setRevisionRef: 'historical-unselected' },
        false,
      );
      for (const table of [
        'tdms_record_revision',
        'tdms_relation_assertion',
        'tdms_processing_revision_set',
        'tdms_processing_set_head',
        'tdms_read_receipt',
      ]) {
        await admin.unsafe(`GRANT SELECT ON ${table} TO ${role}`);
        await admin.unsafe(
          `CREATE POLICY fixture_tenant ON ${table} FOR SELECT TO ${role} USING (tenant_id=current_setting('app.fixture_tenant',true))`,
        );
      }
      await admin.unsafe(`GRANT UPDATE ON tdms_processing_set_head TO ${role}`);
      await admin.unsafe(`CREATE POLICY fixture_head_lock ON tdms_processing_set_head FOR UPDATE TO ${role}
        USING (tenant_id=current_setting('app.fixture_tenant',true))`);
      await admin.unsafe(`GRANT INSERT ON tdms_read_receipt TO ${role}`);
      await admin.unsafe(`CREATE POLICY fixture_receipt_write ON tdms_read_receipt FOR INSERT TO ${role}
        WITH CHECK (tenant_id=current_setting('app.fixture_tenant',true))`);
      f.control.bodyReads = 0;
      const args = {
        set,
        records: [...f.revisions.values()].map(metadata),
        assertions: [...f.assertions.values()],
      };
      const facts = () =>
        database.transaction((tx) =>
          provider.readProjectionFacts({ ...args, database: observe(tx) }),
        );
      const opinionRef = (ref) =>
        tdmsApprovedOpinionRef({
          scope,
          sourceRevisionRef: ref,
          opinionIndex: 0,
        });
      const project = (value, selected = set) =>
        projectTdmsProcessingCohortContext({
          ...value,
          sets: [selected],
          selectedSetRevisionRefs: [selected.setRevisionRef],
        });
      const withAssessment = async (mutate, operation) => {
        const stored = clone(storedRevisions.get('a'));
        mutate(stored.record);
        await admin`UPDATE tdms_record_revision SET data=${JSON.stringify(stored)}::text::jsonb WHERE source_revision_ref='a'`;
        try {
          return await operation({
            ...args,
            records: args.records.map((r) =>
              r.record.sourceRevisionRef === 'a' ? metadata(stored) : r,
            ),
          });
        } finally {
          await admin`UPDATE tdms_record_revision SET data=${JSON.stringify(storedRevisions.get('a'))}::text::jsonb WHERE source_revision_ref='a'`;
        }
      };
      await t.test(
        'selection follows current exact head, all native roots and document root; ignores history and foreign scope',
        async () => {
          assert.deepEqual(await select(observe(database)), [
            {
              scope,
              processingFamilyRef: 'family',
              setRevisionRef: 'set-c1',
              generation: 1,
              sourceRevisionRefs: ['source'],
            },
          ]);
          assert.deepEqual(
            await select(database, { rootSourceRevisionRefs: ['unrelated'] }),
            [],
          );
          assert.deepEqual(
            await select(database, { scope: { ...scope, scopeId: 'other' } }),
            [],
          );
          assert.deepEqual(
            await select(database, {
              scope: { ...scope, tenantId: 'other' },
              binding: { ...binding, tenantId: 'other' },
            }),
            [],
          );
          await assert.rejects(
            select(database, { rootSourceRevisionRefs: ['source', 'source'] }),
            (error) => error.code === 'TDMS_RUNTIME_SOURCE_BINDING_MISMATCH',
          );
          for (const [family, endpoint] of [
            [
              'unbound-root',
              { kind: 'NATIVE_RECORD_REVISION', sourceRevisionRef: 'unbound' },
            ],
            [
              'wrong-document',
              {
                kind: 'DOCUMENT_VERSION',
                documentVersionId: 'another-document',
              },
            ],
          ]) {
            await insertSet({
              ...clone(set),
              processingFamilyRef: family,
              setRevisionRef: family,
              rootBindings: [
                ...clone(set.rootBindings),
                {
                  endpoint,
                  fileProcessingAssertionRefs: [],
                  applicabilityEvidenceRefs: [],
                },
              ],
            });
          }
          assert.deepEqual(
            (await select(database)).map((s) => s.setRevisionRef),
            ['set-c1'],
          );
        },
      );
      await t.test(
        'each retained Estimated assessment supplies its own active validity without inventing latestness or contributors',
        async () => {
          const value = await facts();
          assert.equal(value.assessments.length, 2);
          assert.deepEqual(
            value.assessments.map((a) => [a.sourceRevisionRef, a.validity]),
            ['a', 'b'].map((ref) => [
              ref,
              { status: 'ACTIVE', assertionRef: ref },
            ]),
          );
          assert.ok(
            value.sources.every(
              (s) =>
                s.latestness.length === 0 && s.assessmentCoverage.length === 0,
            ),
          );
          assert.deepEqual(value.contributions, []);
          const projection = project(value);
          assert.deepEqual(projection.selectedSetApprovedRefs, [
            opinionRef('a'),
            opinionRef('b'),
          ]);
          assert.equal(
            JSON.stringify(projection).includes('VALIDITY_UNKNOWN'),
            false,
          );
          for (const member of projection.cohorts[0].members) {
            assert.equal(member.status, 'APPROVED');
            assert.ok(
              member.evidenceRefs.includes(member.assessmentObservationRef),
            );
          }
          await assert.rejects(
            provider.readProjectionFacts({
              ...args,
              records: args.records.map((r) => ({
                ...r,
                captureRef: 'substituted',
              })),
              database,
            }),
            (error) => error.code === 'TDMS_RUNTIME_STORED_METADATA_CHANGED',
          );
          await assert.rejects(
            provider.readProjectionFacts({
              ...args,
              set: { ...set, gaps: ['injected'] },
              database,
            }),
            (error) => error.code === 'TDMS_RUNTIME_CONTEXT_CHANGED',
          );
        },
      );
      await t.test(
        'actual runtime reader discovers metadata, then READs both approved bodies with exact persisted receipts',
        async () => {
          await database.transaction(async (tx) => {
            const db = observe(tx);
            const repository = new MiaodaTdmsProcessingSetRepository({
              transaction: async (operation) => operation(db),
            });
            const sets = new TdmsProcessingSetService(repository, {
              available: true,
              assertScopeAccess: async () => {},
              assertAccess: async () => {},
              compare: async () => {
                throw new Error('unused');
              },
            });
            let consumed = 0;
            const authority = {
              ...f.authority,
              resolveSelections: async () => select(db),
              readProjectionFacts: async (input) => {
                consumed++;
                return provider.readProjectionFacts({ ...input, database: db });
              },
              assertCurrentSnapshot: async (_principal, input) => {
                const current = project(
                  await provider.readProjectionFacts({
                    ...args,
                    database: db,
                  }),
                );
                for (const context of input.contexts)
                  assert.deepEqual(context.projection, current);
                for (const evidence of input.evidence ?? []) {
                  const rows =
                    await db.execute(sql`SELECT data FROM tdms_read_receipt
                    WHERE tenant_id=${scope.tenantId}
                      AND receipt_ref=${evidence.nativeReadReceipt.receiptRef}`);
                  assert.equal(rows.length, 1);
                  assert.equal(rows[0].data.actorId, binding.actorUserId);
                  assert.deepEqual(
                    rows[0].data.receipt,
                    evidence.nativeReadReceipt,
                  );
                  assert.equal(
                    rows[0].data.receipt.sourceRevisionRef,
                    evidence.nativeSource.sourceRevisionRef,
                  );
                }
              },
            };
            const reader = new HostTdmsRuntimeReader(
              sets,
              repository,
              f.authorization,
              f.documents,
              authority,
            );
            const context = await reader.discover(f.principal, binding);
            assert.ok(consumed > 0);
            assert.deepEqual(context.projection.selectedSetApprovedRefs, [
              opinionRef('a'),
              opinionRef('b'),
            ]);
            assert.equal(f.control.bodyReads, 0);
            const discovery = [...rawResults, JSON.stringify(context)];
            for (const body of [
              'Unique complete opinion',
              'RAW_OPAQUE_BODY_MUST_STAY_IN_DB',
              'ACQUISITION_BODY_MUST_STAY_IN_DB',
            ])
              assert.equal(
                discovery.some((result) => result.includes(body)),
                false,
                body,
              );
            assert.deepEqual(
              context.projection.cohorts[0].qualifiedOpinionRefs,
              [],
            );
            const result = await reader.read(f.principal, {
              context: JSON.parse(JSON.stringify(context)),
              evidenceRefs: context.projection.selectedSetApprovedRefs,
              purpose: 'JOB_AID_NATIVE_RECORD',
              taskContextRef: binding.taskContextRef,
            });
            assert.deepEqual(
              result.evidence.map((e) => e.nativeSource.sourceRevisionRef),
              ['a', 'b'],
            );
            assert.equal(
              new Set(result.receipts.map((r) => r.receiptRef)).size,
              2,
            );
            for (const [index, ref] of ['a', 'b'].entries()) {
              const evidence = result.evidence[index];
              const receipt = result.receipts[index];
              assert.equal(evidence.evidenceRef, opinionRef(ref));
              assert.equal(
                JSON.parse(evidence.excerpt).text,
                `Unique complete opinion ${ref}`,
              );
              assert.equal(
                evidence.nativeScope.processingSetBinding
                  .assessmentObservationRef,
                ref,
              );
              assert.equal(
                evidence.nativeScope.approval.approvalSubject.sourceRecordId,
                storedRevisions.get(ref).record.sourceRecordId,
              );
              assert.equal(receipt.sourceRevisionRef, ref);
              assert.equal(receipt.taskContextRef, binding.taskContextRef);
              assert.deepEqual(receipt.fieldPaths, ['content.opinions[0]']);
              assert.equal(receipt.readPerformed, true);
              assert.equal(receipt.engineeringAdoption, 'NOT_CREATED');
              assert.equal(receipt.executionVerified, false);
              assert.deepEqual(receipt, evidence.nativeReadReceipt);
            }
            assert.deepEqual(f.receipts, []);
          });
          const saved = await client`SELECT source_revision_ref,actor_id,data
            FROM tdms_read_receipt ORDER BY source_revision_ref`;
          assert.deepEqual(
            saved.map((r) => r.source_revision_ref),
            ['a', 'b'],
          );
          assert.ok(
            saved.every(
              (r) =>
                r.actor_id === binding.actorUserId &&
                r.data.receipt.readPerformed === true,
            ),
          );
        },
      );
      await t.test(
        'own Estimated with an unexposed raw code uses the same retained state policy',
        async () => {
          await withAssessment(
            (record) => {
              record.state = { rawName: 'Estimated', rawCode: null };
              for (const side of ['before', 'after'])
                record.rawFields.opinionCollection[side].state = clone(
                  record.state,
                );
              record.content.opinions[0].state = clone(record.state);
            },
            async (input) => {
              const value = await provider.readProjectionFacts({
                ...input,
                database,
              });
              assert.deepEqual(value.assessments[0].validity, {
                status: 'ACTIVE',
                assertionRef: 'a',
              });
              assert.deepEqual(project(value).selectedSetApprovedRefs, [
                opinionRef('a'),
                opinionRef('b'),
              ]);
            },
          );
        },
      );
      const stateCheck = {
        ...clone(set),
        setRevisionRef: 'own-state-check',
        approvalReadiness: 'UNKNOWN',
      };
      await insertSet(stateCheck, false);
      for (const [label, state] of [
        ['missing state', null],
        ['Estimating', { rawName: 'Estimating', rawCode: 'Estimating' }],
        [
          'conflicting raw code',
          { rawName: 'Estimated', rawCode: 'Estimating' },
        ],
        [
          'unsupported approval name',
          { rawName: 'Approved', rawCode: 'Estimated' },
        ],
      ]) {
        await t.test(
          `${label} stays unknown despite stable exact version and Estimated parent`,
          async () => {
            await withAssessment(
              (record) => {
                record.state = state;
              },
              async (input) => {
                assert.equal(
                  input.records.find(
                    (r) => r.record.sourceRevisionRef === 'processing',
                  ).record.state.rawName,
                  'Estimated',
                );
                assert.deepEqual(
                  input.records.find((r) => r.record.sourceRevisionRef === 'a')
                    .record.sourceVersion,
                  storedRevisions.get('a').record.sourceVersion,
                );
                await assert.rejects(
                  provider.readProjectionFacts({ ...input, database }),
                  (error) => error.code === 'TDMS_SET_ALL_APPROVED_UNCONFIRMED',
                );
                const value = await provider.readProjectionFacts({
                  ...input,
                  set: stateCheck,
                  database,
                });
                assert.deepEqual(value.assessments[0].validity, {
                  status: 'UNKNOWN',
                  assertionRef: null,
                });
                const projection = project(value, stateCheck);
                assert.deepEqual(projection.selectedSetApprovedRefs, [
                  opinionRef('b'),
                ]);
                assert.deepEqual(
                  projection.cohorts[0].members[0].opinionRefs,
                  [],
                );
                assert.ok(
                  projection.cohorts[0].gaps.includes('APPROVAL_UNCONFIRMED'),
                );
              },
            );
          },
        );
      }
      for (const [label, mutate] of [
        [
          'foreign approval owner',
          (record) => {
            record.rawFields.opinionCollection.approvalSubject.sourceRecordId =
              'foreign';
          },
        ],
        [
          'foreign approval version',
          (record) => {
            record.rawFields.opinionCollection.approvalSubject.sourceVersion.rawIteration =
              '2';
          },
        ],
        ...['before', 'after'].map((side) => [
          `${side} approval state mismatch`,
          (record) => {
            record.rawFields.opinionCollection[side].state = {
              rawName: 'Estimating',
              rawCode: 'Estimating',
            };
          },
        ]),
      ]) {
        await t.test(
          `${label} cannot qualify a retained active Estimated assessment`,
          async () => {
            await withAssessment(mutate, async (input) => {
              const value = await provider.readProjectionFacts({
                ...input,
                database,
              });
              assert.deepEqual(value.assessments[0].validity, {
                status: 'ACTIVE',
                assertionRef: 'a',
              });
              const projection = project(value);
              assert.deepEqual(projection.selectedSetApprovedRefs, [
                opinionRef('b'),
              ]);
              assert.deepEqual(
                projection.cohorts[0].members[0].opinionRefs,
                [],
              );
              assert.ok(
                projection.cohorts[0].gaps.includes('APPROVAL_UNCONFIRMED'),
              );
            });
          },
        );
      }
      await t.test(
        'retained assessment identity must still match the exact member owner',
        async () => {
          await withAssessment(
            (record) => {
              record.sourceRecordId = 'foreign';
            },
            async (input) => {
              await assert.rejects(
                provider.readProjectionFacts({ ...input, database }),
                (error) => error.code === 'TDMS_SET_REFERENCE_INVALID',
              );
            },
          );
        },
      );
      await t.test(
        'active Estimated state cannot supply missing exact source applicability',
        async () => {
          const unmapped = {
            ...clone(set),
            setRevisionRef: 'missing-applicability',
            versionMappingCoverage: 'PARTIAL',
            rootBindings: set.rootBindings.map((root) => ({
              ...clone(root),
              applicabilityEvidenceRefs: [],
            })),
          };
          await insertSet(unmapped, false);
          const value = await provider.readProjectionFacts({
            ...args,
            set: unmapped,
            database,
          });
          assert.ok(
            value.assessments.every((a) => a.validity.status === 'ACTIVE'),
          );
          const projection = project(value, unmapped);
          assert.deepEqual(projection.selectedSetApprovedRefs, []);
          assert.ok(projection.cohorts[0].gaps.includes('MAPPING_UNCONFIRMED'));
          assert.ok(
            projection.cohorts[0].gaps.includes(
              'VERSION_MAPPING_COVERAGE_INCOMPLETE',
            ),
          );
        },
      );
      await t.test(
        'missing source family/cohort proof remains UNKNOWN without invented membership',
        async () => {
          const unknown = {
            ...clone(set),
            setRevisionRef: 'unresolved-cohort',
            cohortRef: null,
            familyIdentityEvidenceRefs: [],
            cohortIdentityEvidenceRefs: [],
            rosterEvidenceRefs: [],
            sourceRosterRevision: null,
            sourceConsistency: 'UNKNOWN',
            sourceTransactionRef: null,
            membershipCoverage: 'PARTIAL',
            versionMappingCoverage: 'PARTIAL',
            approvedBodyCaptureCoverage: 'PARTIAL',
            approvalReadiness: 'UNKNOWN',
            currentness: 'UNKNOWN',
            currentnessEvidenceRefs: [],
            members: set.members.map((member) => ({
              ...clone(member),
              membershipResolution: 'OBSERVED_ONLY',
              cohortMembershipEvidenceRefs: [],
            })),
          };
          await insertSet(unknown, false);
          const value = await provider.readProjectionFacts({
            ...args,
            set: unknown,
            database,
          });
          const projection = projectTdmsProcessingCohortContext({
            ...value,
            sets: [unknown],
            selectedSetRevisionRefs: [unknown.setRevisionRef],
          });
          assert.deepEqual(projection.selectedSetApprovedRefs, []);
          assert.ok(
            projection.cohorts[0].members.every(
              (member) => member.status === 'UNKNOWN',
            ),
          );
          assert.ok(
            projection.cohorts[0].gaps.includes('MEMBER_IDENTITY_UNCONFIRMED'),
          );
        },
      );
      await t.test(
        'metadata-only approval never inspects opinion locators',
        async () => {
          const pending = {
            ...clone(set),
            setRevisionRef: 'pending-opinion',
            approvedBodyCaptureCoverage: 'PARTIAL',
            approvalReadiness: 'UNKNOWN',
          };
          await insertSet(pending, false);
          const stored = JSON.parse(JSON.stringify(f.revisions.get('a')));
          stored.record.rawFields.opinionCollection = {
            schemaVersion: 'wiselink.tdms-opinion-collection.v1',
            mode: 'METADATA_ONLY',
            reason: 'OPINION_FIELD_UNAVAILABLE',
            approvalSubject: null,
            before: null,
            after: null,
          };
          // Deliberately invalid locator: reading it would throw, but own approval is absent.
          stored.record.fieldProvenance = [];
          await admin`UPDATE tdms_record_revision SET data=${JSON.stringify(stored)}::text::jsonb WHERE source_revision_ref='a'`;
          try {
            const value = await provider.readProjectionFacts({
              ...args,
              set: pending,
              records: args.records.map((r) =>
                r.record.sourceRevisionRef === 'a' ? metadata(stored) : r,
              ),
              database,
            });
            const projection = projectTdmsProcessingCohortContext({
              ...value,
              sets: [pending],
              selectedSetRevisionRefs: [pending.setRevisionRef],
            });
            assert.equal(
              projection.cohorts[0].members.find(
                (m) => m.memberRef === 'member-a',
              ).status,
              'UNKNOWN',
            );
            assert.ok(
              projection.cohorts[0].gaps.includes('APPROVAL_UNCONFIRMED'),
            );
          } finally {
            await admin`UPDATE tdms_record_revision SET data=${JSON.stringify(f.revisions.get('a'))}::text::jsonb WHERE source_revision_ref='a'`;
          }
        },
      );
      await t.test(
        'candidate-only relation is rejected instead of becoming source applicability',
        async () => {
          const candidate = clone(f.assertions.get('fp-a'));
          candidate.assertion.authority = 'CANDIDATE_ONLY';
          candidate.assertion.controlledKind = null;
          candidate.assertion.scope = {};
          await admin`UPDATE tdms_relation_assertion SET data=${JSON.stringify(candidate)}::text::jsonb WHERE assertion_ref='fp-a'`;
          await assert.rejects(
            facts(),
            (error) => error.code === 'TDMS_SET_RELATION_INVALID',
          );
        },
      );
    } finally {
      await owned.stop();
    }
  },
);
