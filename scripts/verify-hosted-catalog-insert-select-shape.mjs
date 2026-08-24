import assert from 'node:assert/strict';

import { MiaodaHostedDocumentCatalog } from '../dist/server/modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog.js';

function rows(value) {
  const query = {
    from() { return query; },
    innerJoin() { return query; },
    where() { return query; },
    limit() { return query; },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
  return query;
}

function writeQuery(kind, operations, returningRows) {
  const query = {
    values(value) {
      operations.push({ kind, value });
      return query;
    },
    set(value) {
      operations.push({ kind, value });
      return query;
    },
    onConflictDoNothing() { return query; },
    where() { return query; },
    returning() { return Promise.resolve(returningRows); },
  };
  return query;
}

const now = '2026-08-14T00:00:00.000Z';
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

const operations = [];
let selectCall = 0;
let transactionCall = 0;
const transaction = {
  insert() {
    return writeQuery('transaction.insert', operations, [{ inserted: true }]);
  },
  update() {
    return writeQuery('transaction.update', operations, [{ updated: true }]);
  },
};
const db = {
  select() {
    selectCall += 1;
    if (selectCall === 1) return rows([preflight]);
    if (selectCall === 2 || selectCall === 3) return rows([]);
    return rows([{
      ...family,
      currentDocumentVersionId: command.documentVersion.documentVersionId,
      currentGeneration: 1,
    }]);
  },
  async transaction(callback) {
    transactionCall += 1;
    return callback(transaction);
  },
  update() {
    return writeQuery('finalize.update', operations, [{ updated: true }]);
  },
};

const catalog = new MiaodaHostedDocumentCatalog(db);
const result = await catalog.commitNewVersion(command);

assert.equal(transactionCall, 1);
assert.equal(typeof db.with, 'undefined', 'hosted commit must not require a WITH/CTE API');
assert.deepEqual(
  operations.map(({ kind }) => kind),
  [
    'transaction.insert',
    'transaction.insert',
    'transaction.update',
    'transaction.insert',
    'transaction.insert',
    'finalize.update',
    'finalize.update',
  ],
);
const versionInsert = operations[3].value;
assert.equal(versionInsert.lifecycleStatus, 'COMMITTED_IMMUTABLE');
assert.ok(versionInsert.committedAt instanceof Date);
assert.equal(versionInsert.byteLength, 122102);
assert.deepEqual(result, {
  disposition: 'INGEST_NEW_FAMILY',
  familyId: 'family_test',
  documentId: 'document_test',
  documentVersionId: 'document_version_test',
  currentnessChanged: true,
  currentGeneration: 1,
});

process.stdout.write(`${JSON.stringify({
  status: 'PASS',
  transactionCount: transactionCall,
  transactionWriteCount: 5,
  finalizeWriteCount: 2,
  withCteUsed: false,
  lifecycleStatusParameterized: true,
  timestampValuesAreDates: true,
  databaseMutationPerformed: false,
  onlineMutationPerformed: false,
}, null, 2)}\n`);
