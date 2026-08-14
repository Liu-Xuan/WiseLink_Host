import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/postgres-js';

import { MiaodaHostedDocumentCatalog } from '../dist/server/modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog.js';

const realDb = drizzle.mock();
let selectCall = 0;
let withCall = 0;

function fakeRows(rows) {
  const query = {
    from() {
      return query;
    },
    innerJoin() {
      return query;
    },
    where() {
      return query;
    },
    limit() {
      return query;
    },
    then(resolve, reject) {
      return Promise.resolve(rows).then(resolve, reject);
    },
  };
  return query;
}

const preflight = {
  preflightId: 'preflight_test',
  decision: 'INGEST_NEW_FAMILY',
  observedCurrentGeneration: 0,
  observedCurrentDocumentVersionId: null,
  executionAuthorized: false,
  status: 'READY',
};
const family = {
  familyId: 'family_test',
  canonicalIdentityKey: 'FTD|BOEING|777-FTD-31-21002',
  currentGeneration: 0,
  currentDocumentVersionId: null,
};

const db = new Proxy(realDb, {
  get(target, property) {
    if (property === 'select') {
      return (fields) => {
        if (fields === undefined) {
          selectCall += 1;
          if (selectCall === 1) return fakeRows([preflight]);
          if (selectCall === 2 || selectCall === 3) return fakeRows([]);
          return fakeRows([family]);
        }
        return target.select(fields);
      };
    }
    if (property === 'with') {
      return (...ctes) => {
        withCall += 1;
        if (withCall === 1) {
          return {
            select() {
              return fakeRows([{ familyId: family.familyId }]);
            },
          };
        }
        return target.with(...ctes);
      };
    }
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

const now = '2026-08-14T00:00:00.000Z';
const command = {
  idempotencyKey: 'catalog:test',
  preflightId: preflight.preflightId,
  preflightDecision: preflight.decision,
  observedCurrentGeneration: 0,
  observedCurrentDocumentVersionId: null,
  family: {
    familyId: family.familyId,
    canonicalIdentityKey: family.canonicalIdentityKey,
    documentFamily: 'FTD',
    issuerAuthority: 'BOEING',
    canonicalDocumentNumber: '777-FTD-31-21002',
    status: 'ACTIVE',
    createdAt: now,
  },
  document: {
    documentId: 'document_test',
    familyId: family.familyId,
    documentFamily: 'FTD',
    status: 'ACTIVE',
    createdAt: now,
  },
  documentVersion: {
    documentVersionId: 'document_version_test',
    documentId: 'document_test',
    familyId: family.familyId,
    revisionId: 'revision_test',
    canonicalRevisionIdentity: '2025-09-26',
    businessRevision: '2025-09-26',
    revisionDate: '2025-09-26',
    sourceGeneratedDate: '2025-09-26',
    originalFilename: '777-FTD.pdf',
    sourceArtifactId: 'source_test',
    acquisitionId: 'acquisition_test',
    pdfSha256: 'b1'.padEnd(64, '0'),
    byteLength: 122102,
    mediaType: 'application/pdf',
    committedAt: now,
    committedBy: 'user_test',
  },
  currentnessDecision: {
    currentnessDecisionId: 'currentness_test',
    familyId: family.familyId,
    reason: preflight.decision,
    decidedAt: now,
    decidedBy: 'user_test',
    preflightId: preflight.preflightId,
  },
};

const catalog = new MiaodaHostedDocumentCatalog(db);
let observedError;
try {
  await catalog.commitNewVersion(command);
} catch (error) {
  observedError = error;
}

assert.ok(observedError instanceof Error);
assert.doesNotMatch(observedError.message, /Insert select error/u);
assert.match(observedError.message, /^Failed query:/u);
assert.equal(withCall, 2);

process.stdout.write(`${JSON.stringify({
  status: 'PASS',
  drizzleVersion: '0.44.6',
  validatedInsertSelects: [
    'dm_document',
    'dm_document_version',
    'dm_currentness_decision',
  ],
  databaseMutationPerformed: false,
  onlineMutationPerformed: false,
}, null, 2)}\n`);
