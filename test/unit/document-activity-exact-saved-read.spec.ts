import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { DocumentActivityRevision, DocumentActivitySourceBinding } from '@shared/document-activity.interface';
import type { DocumentOriginalBinding } from '@shared/document-original.interface';
import { DocumentActivityRunRepository, type DocumentActivityRun } from '../../server/modules/canonical-host/document-activity-run.repository';
import { EngineeringMatterWorkingRepository } from '../../server/modules/canonical-host/engineering-matter-working.repository';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';

const original = originalFixture().binding;
const scope = { tenantId: 'tenant-test', actorUserId: 'reader-two', documentVersionId: original.documentVersionId };
const expectedBinding: DocumentActivitySourceBinding = { original, semanticRevision: 1 };
const reference = { runRef: 'DAR-one', candidateRevision: 3 };
const manifestSha256 = 'b'.repeat(64);
type Row = DocumentActivityRun & { tenantId: string; actorUserId: string };
type RegisteredParse = { tenantId: string; original: DocumentOriginalBinding; manifestSha256: string;
  status: string; relativePath: string; role: string; readback: string };
type RegisteredSemantic = { tenantId: string; original: DocumentOriginalBinding; semanticRevision: number; manifestSha256: string };

function savedRow(overrides: Partial<Row> = {}): Row {
  const row: Row = { tenantId: scope.tenantId, actorUserId: 'producer-one',
    runRef: reference.runRef, requestId: 'production-request', documentVersionId: original.documentVersionId,
    parseRunId: original.parseRunId, parseRevision: original.parseRevision, semanticRevision: 1,
    manifestSha256, selection: { sectionIds: ['section-test'] }, expectedRevision: 2,
    candidateRevision: reference.candidateRevision, status: 'SAVED', deadline: '2026-09-17T00:00:00Z',
    deliveredRanges: [], result: null, saveCommand: {}, errorCode: null, ...overrides };
  row.result = { schemaVersion: 'wiselink.document.activity-candidate.v1', candidateOnly: true,
    runRef: row.runRef, candidateRevision: row.candidateRevision ?? 3,
    sourceBinding: { original: { ...original, documentVersionId: row.documentVersionId,
      parseRunId: row.parseRunId, parseRevision: row.parseRevision }, semanticRevision: row.semanticRevision },
    statements: [], readCoverage: { status: 'DELIVERED_RANGES_ONLY', selection: row.selection,
      deliveredRanges: row.deliveredRanges, sourceCoverage: originalFixture().coverage }, sourceAnchors: [],
    producer: { skillVersion: 'saved-skill-version', modelVersion: 'saved-model-version' }, savedAt: '2026-09-16T00:00:00Z' };
  return row;
}

/** This double checks emitted predicates and caller context ordering only. It is not RLS evidence. */
function harness(rows: Row[] = [savedRow()]) {
  const dialect = new PgDialect();
  let activeActor = 'ambient-actor';
  let isHostedService = true;
  const events: string[] = [];
  const reads: Array<ReturnType<PgDialect['sqlToQuery']>> = [];
  const access = new Set(['reader-two', 'reader-three', 'producer-one']);
  const parses: RegisteredParse[] = [];
  const semantics: RegisteredSemantic[] = [];
  for (const row of rows) {
    const binding = structuredClone(row.result!.sourceBinding.original);
    parses.push({ tenantId: row.tenantId, original: binding, manifestSha256: row.manifestSha256,
      status: 'PUBLISHED', relativePath: 'original/manifest.json', role: 'MANIFEST', readback: 'VERIFIED' });
    semantics.push({ tenantId: row.tenantId, original: binding, semanticRevision: row.semanticRevision, manifestSha256: row.manifestSha256 });
  }
  const execute = jest.fn(async (statement: SQL) => {
    const query = dialect.sqlToQuery(statement);
    if (query.sql.includes('AS "isHostedService"')) {
      events.push(`role-check:${activeActor}`);
      return [{ isHostedService }];
    }
    reads.push(query);
    events.push(`read:${activeActor}`);
    expect(query.sql).toMatch(/^SELECT/u);
    const value = (expression: string) => {
      const escaped = expression.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      const match = query.sql.match(new RegExp(`${escaped}=\\$(\\d+)`, 'u'));
      return match ? query.params[Number(match[1]) - 1] : undefined;
    };
    const exact = query.sql.includes('JOIN dm_document_parse_run p');
    const selected = rows.filter(row => {
      // Ordinary source-authorization behavior is simulated, never claimed as physically tested RLS.
      if (!access.has(activeActor) || row.tenantId !== 'tenant-test') return false;
      if (!exact) {
        return row.tenantId === value('tenant_id') && row.documentVersionId === value('document_version_id') &&
          (value('actor_user_id') === undefined || row.actorUserId === value('actor_user_id')) &&
          (value('run_ref') === undefined || row.runRef === value('run_ref')) &&
          (value('parse_run_id') === undefined || row.parseRunId === value('parse_run_id')) &&
          (!query.sql.includes("status='SAVED'") || row.status === 'SAVED') &&
          (value('candidate_revision') === undefined || row.candidateRevision === value('candidate_revision'));
      }
      if (value("current_setting('app.user_id',true)") !== activeActor || row.status !== 'SAVED' ||
        row.tenantId !== value('a.tenant_id') || row.documentVersionId !== value('a.document_version_id') ||
        row.parseRunId !== value('a.parse_run_id') || row.parseRevision !== value('a.parse_revision') ||
        row.semanticRevision !== value('a.semantic_revision') ||
        (value('a.run_ref') !== undefined && row.runRef !== value('a.run_ref')) ||
        (value('a.candidate_revision') !== undefined && row.candidateRevision !== value('a.candidate_revision'))) return false;
      const parse = parses.find(p => p.tenantId === row.tenantId && p.original.documentVersionId === row.documentVersionId &&
        p.original.parseRunId === row.parseRunId && p.original.parseRevision === row.parseRevision && p.manifestSha256 === row.manifestSha256 &&
        p.status === 'PUBLISHED' && p.relativePath === 'original/manifest.json' && p.role === 'MANIFEST' && p.readback === 'VERIFIED' &&
        p.original.documentVersionId === value("p.source_binding->>'documentVersionId'") &&
        p.original.sourceArtifactId === value("p.source_binding->>'sourceArtifactId'") &&
        p.original.sourceSha256 === value("p.source_binding->>'pdfSha256'") &&
        JSON.stringify(p.original.sourceByteLength) === value("p.source_binding->'byteLength'"));
      return !!parse && semantics.some(s => s.tenantId === row.tenantId && s.original.documentVersionId === row.documentVersionId &&
        s.original.parseRunId === row.parseRunId && s.original.parseRevision === row.parseRevision &&
        s.semanticRevision === row.semanticRevision && s.manifestSha256 === row.manifestSha256);
    });
    selected.sort((a, b) => (b.candidateRevision ?? 0) - (a.candidateRevision ?? 0));
    return selected.slice(0, 1);
  });
  const transaction = jest.fn();
  const db = { execute, transaction };
  const sqlContext = { use: jest.fn((request: { userContext: { userId: string } }, _response: unknown, next: () => void) => {
    activeActor = request.userContext.userId;
    events.push(`scope:${activeActor}`);
    next();
  }) };
  const actors = new EngineeringMatterWorkingRepository(db as never, sqlContext as never, { roleSchema: 'test' }, {} as never);
  const repository = new DocumentActivityRunRepository(db as never);
  return { repository, actors, db, sqlContext, events, reads, access, rows, parses, semantics,
    setNativeActor: (actor: string) => { activeActor = actor; },
    setHostedRole: (hosted: boolean) => { isHostedService = hosted; },
    read: (actor = scope.actorUserId, binding = expectedBinding, ref = reference) => actors.withActorScope(actor,
      () => repository.readSavedByReference({ ...scope, actorUserId: actor }, ref, binding)),
    latest: (binding = original, revision = 1) => actors.withActorScope(scope.actorUserId,
      () => repository.readLatestSavedForBinding(scope, binding, revision)) };
}

describe('exact SAVED activity SQL-double contracts (not PostgreSQL/RLS evidence)', () => {
  it('uses the real reader actor scope before each read and never binds the producer', async () => {
    const h = harness();
    await expect(h.read()).resolves.toBe(h.rows[0].result);
    await expect(h.read('reader-three')).resolves.toBe(h.rows[0].result);
    expect(h.events).toEqual(['role-check:ambient-actor', 'scope:reader-two', 'read:reader-two',
      'role-check:reader-two', 'scope:reader-three', 'read:reader-three']);
    expect(h.sqlContext.use.mock.calls.map(call => call[0].userContext.userId)).toEqual(['reader-two', 'reader-three']);
    expect(h.db.transaction).not.toHaveBeenCalled();
    for (const query of h.reads) {
      expect(query.sql).not.toContain('a.actor_user_id=');
      expect(query.sql).not.toMatch(/set_config|SET ROLE|BYPASSRLS|SECURITY DEFINER|INSERT|UPDATE|DELETE|BEGIN/iu);
      expect(query.params).not.toContain('producer-one');
    }
  });

  it('supports a native authenticated reader without a hosted wrapper or role change', async () => {
    const h = harness();
    h.setNativeActor('reader-two'); h.setHostedRole(false);
    await expect(h.repository.readSavedByReference(scope, reference, expectedBinding)).resolves.toBe(h.rows[0].result);
    expect(h.sqlContext.use).not.toHaveBeenCalled();
    expect(h.events).toEqual(['read:reader-two']);
    await expect(h.actors.withActorScope('reader-two', () => h.repository.readSavedByReference(scope, reference, expectedBinding)))
      .rejects.toThrow('RUNTIME_AUTHORIZATION_UNAVAILABLE');
  });

  it('has exact SQL predicates and registered manifest/source identity checks, with no current/latest registry requirement', async () => {
    const h = harness(); await h.read();
    const query = h.reads[0];
    for (const field of ['a.tenant_id', 'a.document_version_id', 'a.parse_run_id', 'a.parse_revision',
      'a.semantic_revision', 'a.run_ref', 'a.candidate_revision']) expect(query.sql).toContain(`${field}=`);
    for (const condition of ["a.status='SAVED'", "p.status='PUBLISHED'", "p.manifest_artifact->>'role'='MANIFEST'",
      "p.manifest_artifact->>'readback'='VERIFIED'", "p.manifest_artifact->>'sha256'=a.original_manifest_sha256",
      's.original_manifest_sha256=a.original_manifest_sha256', 's.semantic_revision=a.semantic_revision',
      's.parse_revision=a.parse_revision']) expect(query.sql).toContain(condition);
    expect(query.params).toEqual(expect.arrayContaining([scope.tenantId, scope.actorUserId, original.documentVersionId,
      original.parseRunId, original.parseRevision, original.sourceArtifactId, original.sourceSha256,
      JSON.stringify(original.sourceByteLength), 1, reference.runRef, reference.candidateRevision]));
    expect(query.sql).not.toMatch(/MAX\(|current_parse|latest|map_json/iu);
  });

  it.each(['tenant', 'document-version', 'parse-run', 'parse-revision', 'semantic-revision', 'run-ref', 'candidate-revision',
    'source-artifact', 'source-sha256', 'source-byte-length'])('returns null for wrong %s without falling back', async dimension => {
    const h = harness();
    const binding = structuredClone(expectedBinding);
    const caller = { ...scope };
    const ref = { ...reference };
    if (dimension === 'tenant') caller.tenantId = 'tenant-other';
    if (dimension === 'document-version') { caller.documentVersionId = 'DV-other'; binding.original.documentVersionId = 'DV-other'; }
    if (dimension === 'parse-run') binding.original.parseRunId = 'PR-other';
    if (dimension === 'parse-revision') binding.original.parseRevision++;
    if (dimension === 'semantic-revision') binding.semanticRevision++;
    if (dimension === 'run-ref') ref.runRef = 'DAR-missing';
    if (dimension === 'candidate-revision') ref.candidateRevision++;
    if (dimension === 'source-artifact') binding.original.sourceArtifactId = 'ART-other';
    if (dimension === 'source-sha256') binding.original.sourceSha256 = 'c'.repeat(64);
    if (dimension === 'source-byte-length') binding.original.sourceByteLength++;
    await expect(h.actors.withActorScope(caller.actorUserId, () => h.repository.readSavedByReference(caller, ref, binding))).resolves.toBeNull();
    expect(h.reads).toHaveLength(1);
  });

  it.each(['QUEUED', 'RUNNING', 'FAILED', 'CANCELLED', 'EXPIRED'] as const)('never reads a %s run as SAVED', async status => {
    const h = harness([savedRow({ status })]);
    await expect(h.read()).resolves.toBeNull();
    await expect(h.latest()).resolves.toBeNull();
  });

  it('keeps nonexistent and unauthorized results indistinguishable and rechecks access after revocation', async () => {
    const h = harness();
    await expect(h.read()).resolves.toBe(h.rows[0].result);
    h.access.delete('reader-two');
    await expect(h.read()).resolves.toBeNull();
    await expect(h.latest()).resolves.toBeNull();
    await expect(h.read('reader-unauthorized')).resolves.toBeNull();
    const missing = harness([]);
    await expect(missing.read()).resolves.toBeNull();
    expect(h.rows[0].actorUserId).toBe('producer-one');
  });

  it('does not let a supplied actor scope impersonate the actual SQL actor', async () => {
    const h = harness(); h.setNativeActor('reader-unauthorized');
    await expect(h.repository.readSavedByReference(scope, reference, expectedBinding)).resolves.toBeNull();
    expect(h.sqlContext.use).not.toHaveBeenCalled();
  });

  it.each([{ runRef: '' }, { runRef: undefined }, { candidateRevision: undefined }, { candidateRevision: 0 }, { candidateRevision: 1.5 }])
    ('requires both exact reference fields and never turns an incomplete reference into latest', async partial => {
      const h = harness();
      await expect(h.read(scope.actorUserId, expectedBinding, { ...reference, ...partial } as typeof reference)).resolves.toBeNull();
      expect(h.reads).toHaveLength(0);
    });

  it('treats a missing exact reference as unavailable without running a catalogue query', async () => {
    const h = harness(); h.setNativeActor(scope.actorUserId);
    await expect(h.repository.readSavedByReference(scope, null as never, expectedBinding)).resolves.toBeNull();
    expect(h.db.execute).not.toHaveBeenCalled();
  });

  it.each(['scope-version', 'invalid-parse-revision', 'invalid-semantic-revision', 'missing-source-artifact', 'invalid-source-length'])
    ('rejects invalid binding %s before querying', async problem => {
      const h = harness(); const binding = structuredClone(expectedBinding);
      if (problem === 'scope-version') binding.original.documentVersionId = 'DV-other';
      if (problem === 'invalid-parse-revision') binding.original.parseRevision = 0;
      if (problem === 'invalid-semantic-revision') binding.semanticRevision = 0;
      if (problem === 'missing-source-artifact') binding.original.sourceArtifactId = '';
      if (problem === 'invalid-source-length') binding.original.sourceByteLength = -1;
      await expect(h.read(scope.actorUserId, binding)).resolves.toBeNull();
      await expect(h.latest(binding.original, binding.semanticRevision)).resolves.toBeNull();
      expect(h.reads).toHaveLength(0);
    });

  it.each(['parse-not-published', 'manifest-not-verified', 'wrong-manifest-role', 'wrong-manifest-path', 'manifest-sha-mismatch',
    'semantic-not-registered', 'semantic-manifest-mismatch'])('fails closed for %s', async problem => {
    const h = harness();
    if (problem === 'parse-not-published') h.parses[0].status = 'STAGING';
    if (problem === 'manifest-not-verified') h.parses[0].readback = 'UPLOADED';
    if (problem === 'wrong-manifest-role') h.parses[0].role = 'RAW_MARKDOWN';
    if (problem === 'wrong-manifest-path') h.parses[0].relativePath = 'legacy/manifest.json';
    if (problem === 'manifest-sha-mismatch') h.parses[0].manifestSha256 = 'c'.repeat(64);
    if (problem === 'semantic-not-registered') h.semantics.splice(0);
    if (problem === 'semantic-manifest-mismatch') h.semantics[0].manifestSha256 = 'c'.repeat(64);
    await expect(h.read()).resolves.toBeNull();
    await expect(h.latest()).resolves.toBeNull();
  });

  it('selects latest only within exact binding+semanticRevision and keeps a pinned historical run stable', async () => {
    const h = harness([savedRow(), savedRow({ runRef: 'DAR-semantic-two', candidateRevision: 12, semanticRevision: 2 }),
      savedRow({ runRef: 'DAR-newer-same-binding', candidateRevision: 7 }),
      savedRow({ runRef: 'DAR-other-parse', parseRunId: 'PR-newer', parseRevision: 4, candidateRevision: 20 })]);
    await expect(h.latest()).resolves.toBe(h.rows[2].result);
    const selected = await h.latest();
    h.rows.push(savedRow({ runRef: 'DAR-newest-same-binding', candidateRevision: 13 }));
    await expect(h.read()).resolves.toBe(h.rows[0].result);
    await expect(h.read(scope.actorUserId, expectedBinding, selected!)).resolves.toBe(h.rows[2].result);
    await expect(h.latest()).resolves.toBe(h.rows[4].result);
    expect(h.reads.find(query => query.sql.includes('ORDER BY a.candidate_revision DESC'))!.sql).toContain('a.semantic_revision=');
    await expect(h.latest(original, 2)).resolves.toBe(h.rows[1].result);
  });

  it('keeps explicit historical parse/semantic bindings readable when newer registered versions exist', async () => {
    const old = savedRow();
    const newer = savedRow({ runRef: 'DAR-other-parse', parseRunId: 'PR-newer', parseRevision: 4, semanticRevision: 2, candidateRevision: 20 });
    const h = harness([old, newer]);
    await expect(h.read()).resolves.toBe(old.result);
    await expect(h.latest()).resolves.toBe(old.result);
  });

  it.each(['runRef', 'candidateRevision', 'semanticRevision', 'documentVersionId', 'parseRunId', 'parseRevision',
    'sourceArtifactId', 'sourceSha256', 'sourceByteLength'])('rejects result JSON %s mismatch with the existing non-private sentinel', async dimension => {
    const h = harness();
    const result = h.rows[0].result!;
    if (dimension === 'runRef') result.runRef = 'DAR-corrupt';
    else if (dimension === 'candidateRevision') result.candidateRevision++;
    else if (dimension === 'semanticRevision') result.sourceBinding.semanticRevision++;
    else {
      const key = dimension as keyof DocumentOriginalBinding;
      const value = result.sourceBinding.original[key];
      Object.assign(result.sourceBinding.original, { [key]: typeof value === 'number' ? value + 1 : `${value}-wrong` });
    }
    await expect(h.read()).rejects.toThrow(/^DOCUMENT_ACTIVITY_RESULT_BINDING_MISMATCH$/u);
    await expect(h.latest()).rejects.toThrow(/^DOCUMENT_ACTIVITY_RESULT_BINDING_MISMATCH$/u);
  });

  it.each([null, {}, { sourceBinding: null }])('rejects malformed stored JSON without a TypeError or repair', async result => {
    const h = harness(); h.rows[0].result = result as DocumentActivityRevision | null;
    await expect(h.read()).rejects.toThrow(/^DOCUMENT_ACTIVITY_RESULT_BINDING_MISMATCH$/u);
    expect(h.rows[0].result).toBe(result);
    expect(h.db.transaction).not.toHaveBeenCalled();
  });

  it('returns the original saved JSON unchanged, including an empty statement list and original provenance', async () => {
    const h = harness(); const before = JSON.stringify(h.rows[0].result);
    await expect(h.read()).resolves.toBe(h.rows[0].result);
    expect(h.rows[0].result?.statements).toEqual([]);
    expect(JSON.stringify(h.rows[0].result)).toBe(before);
    expect(h.db.transaction).not.toHaveBeenCalled();
  });

  it('preserves legacy readSaved parse-wide latest/revision behavior and producer-owned readRun', async () => {
    const h = harness([savedRow(), savedRow({ runRef: 'DAR-semantic-two', candidateRevision: 12, semanticRevision: 2 })]);
    h.setNativeActor(scope.actorUserId);
    await expect(h.repository.readSaved(scope, original.parseRunId)).resolves.toBe(h.rows[1].result);
    await expect(h.repository.readSaved(scope, original.parseRunId, 3)).resolves.toBe(h.rows[0].result);
    await expect(h.repository.readRun(scope, reference.runRef)).resolves.toBeNull();
    h.setNativeActor('producer-one');
    await expect(h.repository.readRun({ ...scope, actorUserId: 'producer-one' }, reference.runRef)).resolves.toBe(h.rows[0]);
    expect(h.reads[0].sql).not.toContain('semantic_revision=');
    expect(h.reads[2].sql).toContain('actor_user_id=');
  });
});


it('exact SAVED lookup preserves a v2 DTO and never silently downgrades its ordered raw semantic fields', async () => {
  const row = savedRow(); row.candidateSchemaVersion = 'wiselink.document.activity-candidate.v2';
  const result = { ...row.result, schemaVersion: row.candidateSchemaVersion,
    sourceContext: { schemaVersion: 'wiselink.document.activity-source-context.v1', sourceBinding: row.result!.sourceBinding,
      profile: { profileRef: 'generic.author-sections.v1', selectionBasis: 'NOT_RECORDED', family: null, issuer: null }, sections: [], organizationWarnings: [] },
    statements: [{ statementId: 'DAS-exact-v2', statementKey: 'source-local', label: 'Source planned/unknown', quotes: [],
      subject: null, action: null, modality: null, status: null, times: [
        { raw: 'TBD', quoteIndex: 0, role: 'TARGET', precision: 'UNKNOWN', expression: 'TBD' },
        { raw: 'after approval', quoteIndex: 0, role: 'CONDITION', precision: 'UNKNOWN', expression: 'RELATIVE' }],
      technicalIds: [{ raw: 'LN 2024-2026', quoteIndex: 0, kind: 'AIRCRAFT_LINE_NUMBER' }],
      scope: { sectionIds: [], conditions: [], completeness: 'UNRESOLVED' }, limitations: ['SQL-double storage only, not candidate validation.'] }] };
  row.result = result as never;
  const h = harness([row]); const read = await h.read();
  expect(read).toBe(result); expect(read!.statements[0]).not.toHaveProperty('time');
  expect(read!.statements[0]).toMatchObject({ times: result.statements[0].times, technicalIds: result.statements[0].technicalIds });
  row.candidateSchemaVersion = 'wiselink.document.activity-candidate.v1';
  await expect(h.read()).rejects.toThrow('RESULT_BINDING_MISMATCH');
});
