import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, basename } from 'node:path';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import {
  postgresCapability,
  startOwnedPostgres,
} from '../pg/owned-postgres-cluster.mjs';
import { lcmSdkDatabase } from '../pg/lcm-sdk-database.mjs';
import { localFileService } from '../pg/lcm-local-file-service.mjs';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
});
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const XLSX = require('xlsx');
const {
  lcmHostDatabase,
} = require('../../server/modules/lcm-export-staging/lcm-host-database.ts');
const {
  LcmPersonalSourceRepository,
} = require('../../server/modules/lcm-export-staging/lcm-personal-source.repository.ts');
const {
  LcmPersonalImportService,
} = require('../../server/modules/lcm-export-staging/lcm-personal-import.service.ts');
const {
  LcmFileOriginalStore,
} = require('../../server/modules/lcm-export-staging/lcm-file-original.store.ts');
const {
  LcmHostSourceReadAuthorization,
} = require('../../server/modules/lcm-export-staging/lcm-host-source-read.authorization.ts');
const {
  LcmSnapshotBrowserRepository,
} = require('../../server/modules/lcm-export-staging/lcm-snapshot-browser.repository.ts');
const {
  LcmSourceReadingService,
} = require('../../server/modules/lcm-export-staging/lcm-source-reading.service.ts');
const {
  LcmNativeMatrixReadingService,
} = require('../../server/modules/lcm-export-staging/lcm-native-matrix-reading.service.ts');
const {
  parseLcmPersonalExport,
} = require('../../server/modules/lcm-export-staging/lcm-native-matrix.parser.ts');
const {
  buildLcmNativeIndex,
  lcmNativeWindow,
  lcmNativeSummary,
  lcmNativePartCell,
  lcmNativeAircraftRows,
} = require('../../shared/lcm-native-matrix-core.ts');
const { lcmAircraftRef } = require('../../shared/lcm-matrix-core.ts');
const { actor } = require('../unit/tdms-source/tdms-fixtures.ts');
const capability = await postgresCapability();

function synthetic() {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      [
        'ATA章',
        '系统',
        '类型',
        '软件名称',
        '软件件号',
        'FIN号',
        'B-1001',
        'B-1002',
      ],
      ['22', 'FCC', 'OPS', '22 FCC OPS', 'PN-A', 'LEFT', '1', ''],
      ['22', 'FCC', 'OPS', '22 FCC OPS', 'PN-A', 'RIGHT', '1', '2'],
      ['22', 'FCC', 'OPS', '22 FCC OPS', 'PN-B', null, '', '1'],
    ]),
    'Sheet0',
  );
  return {
    model: 'B737-800',
    name: 'synthetic-native.xls',
    bytes: XLSX.write(book, { type: 'buffer', bookType: 'xls' }),
  };
}

function verifyEveryCell(bytes, matrix) {
  const book = XLSX.read(bytes, { type: 'buffer', cellFormula: true });
  assert.deepEqual(book.SheetNames, [matrix.sheet]);
  const sheet = book.Sheets[matrix.sheet];
  let cells = 0;
  const check = (row, column, value) => {
    const cell = sheet[XLSX.utils.encode_cell({ r: row - 1, c: column - 1 })];
    assert.equal(value, cell?.v ?? null);
    assert.equal(cell?.f ?? null, null);
    cells++;
  };
  for (const column of [...matrix.fixedColumns, ...matrix.aircraft])
    check(1, column.sourceColumn, column.rawValue);
  for (const row of matrix.rows) {
    matrix.fixedColumns.forEach((column, index) =>
      check(row.sourceRow, column.sourceColumn, row.fixed[index]),
    );
    matrix.aircraft.forEach((column, index) =>
      check(row.sourceRow, column.sourceColumn, row.states[index]),
    );
  }
  assert.equal(cells, matrix.range.lastRow * matrix.range.lastColumn);
  return cells;
}

test(
  'native matrix: installed SDK, owned PostgreSQL, exact source cells, authorization and idempotence',
  { skip: !capability.available },
  async (t) => {
    const cluster = await startOwnedPostgres(capability);
    let sdk;
    const evidence = {
      localOnly: true,
      platformCalls: 0,
      actualSdk: true,
      samples: [],
      checks: [],
      metrics: {},
    };
    try {
      await cluster.admin.unsafe('CREATE TYPE user_profile AS (user_id text)');
      await cluster.admin.unsafe(
        await readFile(
          new URL(
            '../../migrations/candidates/lcm_personal_import.hosted.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
      await cluster.admin.unsafe(
        await readFile(
          new URL(
            '../../migrations/candidates/lcm_native_matrix.hosted.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
      sdk = await lcmSdkDatabase(cluster);
      const database = lcmHostDatabase(sdk.database),
        sources = new LcmPersonalSourceRepository(database);
      const files = await localFileService(join(cluster.root, 'files'));
      const imports = new LcmPersonalImportService(
        sources,
        new LcmFileOriginalStore(files.files),
      );
      const repository = new LcmSnapshotBrowserRepository(database);
      const reading = new LcmSourceReadingService(
        new LcmHostSourceReadAuthorization(sources),
        repository,
      );
      const service = new LcmNativeMatrixReadingService(reading, repository);
      const owner = actor();
      const asOwner = (operation) =>
        sdk.withRequest(
          {
            userId: owner.canonicalSubject.id,
            userType: '_employee',
            isSystemAccount: false,
          },
          operation,
        );
      const samples = [synthetic()];
      if (process.env.LCM_NATIVE_SAMPLE_MANIFEST) {
        const manifest = JSON.parse(
          await readFile(process.env.LCM_NATIVE_SAMPLE_MANIFEST, 'utf8'),
        );
        for (const sample of manifest.samples) {
          const bytes = await readFile(sample.paths[0]);
          assert.equal(
            createHash('sha256').update(bytes).digest('hex'),
            sample.sha256,
          );
          samples.push({
            model: sample.model,
            name: basename(sample.paths[0]),
            bytes,
          });
        }
      }
      const inputs = [],
        results = [];
      await t.test(
        'one source matrix body per snapshot, no expanded observation writes, exact byte/cell readback',
        async () => {
          const started = performance.now();
          for (let index = 0; index < samples.length; index++) {
            const sample = samples[index],
              requestId = 'native-owned-' + index;
            const selection = await files.upload(
              sample.bytes,
              sample.name,
              requestId,
            );
            const input = { requestId, aircraftModel: sample.model, selection };
            inputs.push(input);
            const result = await asOwner(() =>
              imports.importExcel(owner, input),
            );
            results.push(result);
            const matrix = parseLcmPersonalExport(sample.bytes, sample.model);
            assert.equal(result.recordCount, matrix.rows.length);
            assert.equal(result.sourceRowCount, matrix.rows.length);
            assert.equal(result.aircraftColumnCount, matrix.aircraft.length);
            assert.equal(
              result.coordinateCount,
              matrix.rows.length * matrix.aircraft.length,
            );
            assert.equal(result.stateCellCount, result.coordinateCount);
            const original = await asOwner(() =>
              imports.original(owner, result.snapshotId),
            );
            assert.ok(original.bytes.equals(sample.bytes));
            const stored = await asOwner(async () => {
              const grant = await sources.authorize(owner);
              return repository.nativeMatrixReadSet(grant.scope, [
                result.snapshotId,
              ]);
            });
            assert.deepEqual(stored.matrices[0].matrix, matrix);
            const stateCounts = {};
            for (const row of matrix.rows)
              for (const state of row.states)
                stateCounts[String(state ?? '')] =
                  (stateCounts[String(state ?? '')] ?? 0) + 1;
            evidence.samples.push({
              file: sample.name,
              model: sample.model,
              sourceRows: matrix.rows.length,
              aircraftColumns: matrix.aircraft.length,
              stateCells: result.coordinateCount,
              stateCounts,
              allCellsVerified: verifyEveryCell(
                sample.bytes,
                stored.matrices[0].matrix,
              ),
              nativeJsonBytes: Buffer.byteLength(JSON.stringify(matrix)),
              sha256: matrix.rawSha256,
              snapshotId: result.snapshotId,
            });
          }
          evidence.metrics.importAndReadbackMs = performance.now() - started;
          const counts = (
            await cluster.admin`SELECT
        (SELECT count(*)::int FROM lcm_native_matrix_snapshot) AS matrices,
        (SELECT count(*)::int FROM lcm_configuration_snapshot) AS snapshots,
        (SELECT count(*)::int FROM lcm_configuration_observation) AS observations`
          )[0];
          assert.equal(counts.matrices, samples.length);
          assert.equal(counts.snapshots, samples.length);
          assert.equal(counts.observations, 0);
          evidence.checks.push(
            'one native body / source snapshot, zero expanded observations; all raw scalar cells and coordinates verified',
          );
        },
      );
      await t.test(
        'same request and same bytes/new request replay one snapshot; changed accepted input fails',
        async () => {
          const result = await asOwner(() =>
            imports.importExcel(owner, inputs[0]),
          );
          assert.equal(result.snapshotId, results[0].snapshotId);
          assert.equal(result.replayed, true);
          const second = await asOwner(() =>
            imports.importExcel(owner, {
              ...inputs[0],
              requestId: 'new-request-same-original',
            }),
          );
          assert.equal(second.snapshotId, results[0].snapshotId);
          assert.equal(second.replayed, true);
          await assert.rejects(
            asOwner(() =>
              imports.importExcel(owner, {
                ...inputs[0],
                aircraftModel: 'A320-200',
              }),
            ),
            { code: 'LCM_IMPORT_REQUEST_CONFLICT' },
          );
          evidence.checks.push(
            'new-chain same request / same bytes repeat idempotent; changed payload conflicts',
          );
        },
      );
      await t.test(
        'concurrent new request has one snapshot and retained historical originals keep source-day order',
        async () => {
          const context = {
            schemaVersion: 'wiselink.lcm.collection_context.v1',
            collectionId: 'concurrent-new-native',
            sourceOrigin: 'local-file',
            pageUrl: null,
            filters: { aircraftModel: inputs[0].aircraftModel, status: null },
            observedAt: null,
            systemStateDate: '2026-10-11',
            systemStateTimeZone: 'Asia/Shanghai',
            systemStateDateBasis: 'user-confirmed-system-state',
            sourceEvidence: 'explicit local test source day',
          };
          const same = {
            ...inputs[0],
            requestId: 'concurrent-native-request',
            context,
          };
          const concurrent = await Promise.all(
            Array.from({ length: 4 }, () =>
              asOwner(() => imports.importExcel(owner, same)),
            ),
          );
          assert.equal(
            new Set(concurrent.map((result) => result.snapshotId)).size,
            1,
          );
          assert.equal(
            concurrent.filter((result) => !result.replayed).length,
            1,
          );
          const older = await asOwner(() =>
            imports.importExcel(owner, {
              ...inputs[0],
              requestId: 'older-history-import',
              context: {
                ...context,
                collectionId: 'older-native-history',
                systemStateDate: '2026-10-09',
              },
            }),
          );
          assert.notEqual(older.snapshotId, concurrent[0].snapshotId);
          const library = await asOwner(() => sources.library(owner));
          assert.ok(
            library.latestSnapshotIds.includes(concurrent[0].snapshotId),
          );
          assert.ok(!library.latestSnapshotIds.includes(older.snapshotId));
          const catalogue = await asOwner(() =>
            reading.catalogue(owner, { limit: 50 }),
          );
          assert.ok(
            catalogue.snapshots.some(
              (snapshot) => snapshot.snapshotId === older.snapshotId,
            ),
          );
          assert.ok(
            catalogue.snapshots.some(
              (snapshot) => snapshot.snapshotId === concurrent[0].snapshotId,
            ),
          );
          const original = await asOwner(() =>
            imports.original(owner, older.snapshotId),
          );
          assert.ok(original.bytes.equals(samples[0].bytes));
          evidence.checks.push(
            'four concurrent native saves create one snapshot; older import retains historical snapshot/original without replacing newer source day',
          );
        },
      );
      const ids = results.slice(1).length
        ? results
            .slice(1)
            .map((result) => result.snapshotId)
            .sort()
        : [results[0].snapshotId];
      let data, index, projection;
      await t.test(
        'authorized native read, local source indices/windows and exact FCC/FAC sample aggregates',
        async () => {
          let started = performance.now();
          data = await asOwner(() => service.read(owner, { snapshotIds: ids }));
          evidence.metrics.authorizedReadMs = performance.now() - started;
          started = performance.now();
          index = buildLcmNativeIndex(data);
          evidence.metrics.buildTwoIndicesMs = performance.now() - started;
          started = performance.now();
          projection = lcmNativeWindow(index, {
            query: { snapshotIds: ids },
            rowLimit: 0,
            columnLimit: 0,
          });
          evidence.metrics.queryProjectionMs = performance.now() - started;
          const fccProjection = lcmNativeWindow(index, {
            query: { snapshotIds: ids, aircraftModel: 'B737-800' },
            rowLimit: 0,
            columnLimit: 0,
          });
          const group = fccProjection.softwareIndex.find(
            (group) => group.lcmSoftwareName === '22 FCC OPS',
          );
          if (group) {
            started = performance.now();
            const sorted = lcmNativeWindow(index, {
              query: {
                snapshotIds: ids,
                aircraftModel: 'B737-800',
                anchorSoftwareRef: group.softwareRef,
              },
              rowLimit: 0,
              columnLimit: 0,
            });
            evidence.metrics.fccSortMs = performance.now() - started;
            const sample = data.matrices.find(
              (entry) => entry.matrix.aircraftModel === 'B737-800',
            );
            if (sample && samples.length > 1) {
              const counts = Object.fromEntries(
                group.parts.map((part) => [
                  part.partNumber,
                  part.confirmedInstalledAircraftCount,
                ]),
              );
              assert.equal(counts['2216-HNP-03B-10'], 16);
              assert.equal(counts['2270-COL-AC2-22'], 126);
              assert.equal(counts['2274-COL-AC1-07'], 7);
              const relevant = sorted.orderGroups.filter((g) =>
                g.installedPartNumbers.some((pn) =>
                  [
                    '2216-HNP-03B-10',
                    '2270-COL-AC2-22',
                    '2274-COL-AC1-07',
                  ].includes(pn),
                ),
              );
              assert.deepEqual(
                relevant.map((g) => g.endIndexExclusive - g.startIndex),
                [126, 16, 7],
              );
              evidence.checks.push(
                'actual FCC 126 / 16 / 7 exact installed PN groups',
              );
            }
          }
          const fac = lcmNativeWindow(index, {
            query: { snapshotIds: ids, aircraftModel: 'A320-200' },
            rowLimit: 0,
            columnLimit: 0,
          }).softwareIndex.find(
            (group) => group.lcmSoftwareName === '22 FAC OPS',
          );
          if (fac) {
            const count = fac.parts.find(
              (part) => part.partNumber === 'C13206AA13',
            )?.confirmedInstalledAircraftCount;
            assert.equal(count, 69);
            evidence.checks.push(
              'actual FAC same PN across FIN 1CC1SW1 / 1CC2SW1 / blank counts 69 distinct aircraft',
            );
          }
          const startedWindow = performance.now();
          for (let iteration = 0; iteration < 20; iteration++) {
            const columns = projection.aircraftOrder.slice(
              iteration % 10,
              (iteration % 10) + 16,
            );
            for (const software of projection.softwareIndex.slice(
              iteration,
              iteration + 20,
            )) {
              for (const plane of columns)
                lcmNativeSummary(index, software, plane);
              for (const part of software.parts)
                for (const plane of columns)
                  lcmNativePartCell(
                    index,
                    software.softwareRef,
                    part.partNumber,
                    plane,
                  );
            }
          }
          evidence.metrics.twentyLocalWindowsMs =
            performance.now() - startedWindow;
          const single = performance.now();
          lcmNativeAircraftRows(
            index,
            { snapshotIds: ids },
            projection.aircraftOrder[0],
          );
          evidence.metrics.singleAircraftLocalMs = performance.now() - single;
        },
      );
      await t.test(
        'metadata-only authorization recheck, source-coordinate details, current grant and immutable/RLS fences',
        async () => {
          const bound = { snapshotIds: ids, binding: data.binding };
          assert.deepEqual(
            await asOwner(() => service.authorize(owner, bound)),
            { binding: data.binding },
          );
          const grant = await asOwner(() => sources.authorize(owner));
          const metadata = await asOwner(() =>
            repository.nativeMatrixReadSet(grant.scope, ids, true),
          );
          assert.deepEqual(metadata.matrices, []);
          const firstSource = data.matrices[0],
            aircraft = lcmAircraftRef(
              firstSource.managementDomainRef,
              firstSource.matrix.aircraft[0].tailNumber,
            );
          const software = projection.softwareIndex.find((group) =>
            index.softwareRows
              .get(group.softwareRef)
              ?.some((location) => location.matrixIndex === 0),
          );
          const details = await asOwner(() =>
            service.details(owner, {
              query: { snapshotIds: ids },
              binding: data.binding,
              softwareRef: software.softwareRef,
              aircraftRef: aircraft,
            }),
          );
          assert.ok(details.records.length > 0);
          for (const entry of details.records) {
            assert.equal(entry.softwareRef, software.softwareRef);
            assert.equal(entry.aircraftRef, aircraft);
            const matrix = data.matrices.find(
              (matrix) => matrix.snapshotId === entry.snapshot.snapshotId,
            ).matrix;
            for (const row of entry.record.sourceRows) {
              const cell = row.cells['矩阵值'];
              const sourceRow = matrix.rows.find(
                (item) => item.sourceRow === cell.row,
              );
              const column = matrix.aircraft.findIndex(
                (item) => item.sourceColumn === cell.column,
              );
              assert.equal(sourceRow.states[column], cell.rawValue);
            }
          }
          await assert.rejects(
            asOwner(() =>
              service.details(owner, {
                query: { snapshotIds: ids },
                binding: { ...data.binding, permissionRevision: 'stale' },
                softwareRef: software.softwareRef,
              }),
            ),
            { code: 'LCM_MATRIX_BINDING_CHANGED' },
          );
          await assert.rejects(
            cluster.admin`UPDATE lcm_native_matrix_snapshot SET source_row_count=1`,
            { code: '55000' },
          );
          await assert.rejects(
            cluster.admin`DELETE FROM lcm_native_matrix_snapshot`,
            { code: '55000' },
          );
          const stranger = {
            ...owner,
            canonicalSubject: { ...owner.canonicalSubject, id: '456' },
          };
          await sdk.withRequest(
            { userId: '456', userType: '_employee', isSystemAccount: false },
            () =>
              assert.rejects(service.read(stranger, { snapshotIds: ids }), {
                code: 'LCM_PERSONAL_SOURCE_EMPTY',
              }),
          );
          await cluster.admin`UPDATE lcm_personal_source SET read_enabled=false,authority_revision=authority_revision+1 WHERE owner_actor_id=${owner.canonicalSubject.id}`;
          await assert.rejects(
            asOwner(() => service.read(owner, { snapshotIds: ids })),
            { code: 'LCM_SOURCE_ACCESS_DENIED' },
          );
          evidence.checks.push(
            'metadata-only reauthorization; exact source-coordinate details; stale binding / wrong actor / revoked grant rejected; native body immutable',
          );
        },
      );
      evidence.metrics.processMaxRssMiB = process.resourceUsage().maxRSS / 1024;
      if (process.env.LCM_NATIVE_EVIDENCE_DIR) {
        await mkdir(process.env.LCM_NATIVE_EVIDENCE_DIR, { recursive: true });
        await writeFile(
          join(
            process.env.LCM_NATIVE_EVIDENCE_DIR,
            'native-matrix-postgres.actual.private.json',
          ),
          JSON.stringify(evidence, null, 2) + '\n',
        );
      }
    } finally {
      if (sdk) await sdk.close();
      await cluster.stop();
    }
  },
);
