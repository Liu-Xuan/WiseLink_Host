import { DocumentSourceProjectionService } from '../../server/modules/canonical-host/document-source-projection.service';
import { DocumentSemanticRevisionRepository } from '../../server/modules/canonical-host/document-semantic-revision.repository';
import { PgDialect } from 'drizzle-orm/pg-core';

const scope = { tenantId: 'tenant', actorUserId: 'actor', documentVersionId: 'document', roles: [] };
function setup() {
  const limit = jest.fn().mockResolvedValue([]);
  const db = { select: () => ({ from: () => ({ where: () => ({ limit }) }) }) };
  const reader = { readDocumentOriginal: jest.fn().mockRejectedValue(new Error('STORAGE_UNAVAILABLE')) };
  const semantics = { readReady: jest.fn().mockResolvedValue({ semanticRevision: 1, profileRef: 'profile' }),
    ensure: jest.fn().mockResolvedValue({ semanticRevision: 1, profileRef: 'profile' }) };
  const service = new DocumentSourceProjectionService(db as never, reader as never, {} as never, semantics as never);
  return { service, reader, semantics, limit };
}

describe('source projection idle readiness', () => {
  it('returns registered readiness without original or semantic content when no pending work exists', async () => {
    const f = setup();
    await expect(f.service.step(scope, 'parse')).resolves.toEqual({ status: 'NO_PENDING',
      documentVersionId: 'document', parseRunId: 'parse', semanticRevision: 1, profileRef: 'profile' });
    expect(f.reader.readDocumentOriginal).not.toHaveBeenCalled();
    expect(f.semantics.ensure).not.toHaveBeenCalled();
    expect(f.semantics.readReady).toHaveBeenCalledWith(scope, 'parse');
  });

  it('prepares first semantics even without pending rows', async () => {
    const f = setup();
    f.semantics.readReady.mockResolvedValueOnce(null);
    f.reader.readDocumentOriginal.mockResolvedValueOnce({ exact: true });
    await expect(f.service.step(scope, 'parse')).resolves.toMatchObject({ status: 'NO_PENDING', semanticRevision: 1 });
    expect(f.reader.readDocumentOriginal).toHaveBeenCalledWith('document', 'parse', scope);
    expect(f.semantics.ensure).toHaveBeenCalledWith(scope, { exact: true });
  });

  it('never skips byte validation for pending work and preserves errors from readiness', async () => {
    const f = setup();
    f.limit.mockResolvedValueOnce([{ sourceNextOffset: 0 }]);
    await expect(f.service.step(scope, 'parse')).rejects.toThrow('STORAGE_UNAVAILABLE');
    expect(f.semantics.readReady).not.toHaveBeenCalled();
    const denied = setup();
    denied.semantics.readReady.mockRejectedValueOnce(new Error('ACCESS_DENIED'));
    await expect(denied.service.step(scope, 'parse')).rejects.toThrow('ACCESS_DENIED');
    expect(denied.reader.readDocumentOriginal).not.toHaveBeenCalled();
  });

  it('queries only readiness columns under exact tenant/version/parse and published manifest registration', async () => {
    const execute = jest.fn().mockResolvedValue([{ semanticRevision: 2, profileRef: 'profile' }]);
    const repository = new DocumentSemanticRevisionRepository({ execute } as never);
    await expect(repository.readReady(scope, 'parse')).resolves.toEqual({ semanticRevision: 2, profileRef: 'profile' });
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(query.params).toEqual(['tenant', 'document', 'parse']);
    expect(query.sql).not.toContain('map_json');
    expect(query.sql).toContain('p.parse_revision=s.parse_revision');
    expect(query.sql).toContain("p.manifest_artifact->>'sha256'=s.original_manifest_sha256");
    expect(query.sql).toContain("p.status='PUBLISHED'");
    expect(query.sql).toContain("'original/manifest.json'");
    expect(query.sql).toContain("'VERIFIED'");
  });
});
