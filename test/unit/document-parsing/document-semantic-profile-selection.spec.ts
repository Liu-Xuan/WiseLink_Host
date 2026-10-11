import { PgDialect } from 'drizzle-orm/pg-core';
import type { DocumentOriginalResult } from '../../../shared/document-original.interface';
import type { DocumentSemanticMap } from '../../../shared/document-semantic-map.interface';
import { buildDocumentSemanticMap } from '../../../server/modules/document-management/src/hosted/nest/document-semantic-map';
import { GENERIC_SEMANTIC_PROFILE } from '../../../server/modules/document-management/src/hosted/nest/document-semantic-profile';
import { DocumentSemanticRevisionRepository } from '../../../server/modules/canonical-host/document-semantic-revision.repository';
import { DocumentSemanticService } from '../../../server/modules/canonical-host/document-semantic.service';
import { originalFixture } from './fixtures/document-original.fixture';

// Synthetic author headings exercise the authorized service/storage boundaries.
// They are not a PDF, OEM or model execution receipt.
function document(rows: Array<[string, number?]> = [
  ['1. Planning Information', 1], ['A. Effectivity', 2], ['Group 1, configuration 2 only.'],
  ['2. Material Information', 1], ['Kit K-12 is necessary unless the previous modification is installed.'],
]): DocumentOriginalResult {
  const original = originalFixture();
  const template = original.source.units[0];
  original.source.units = rows.map(([text, level], order) => ({
    ...template, unitId: `profile-u${order}`, order, sourceSegmentIds: [`profile-s${order}`],
    sourceRefIds: [`SR-PROFILE-${order}`], kind: level === undefined ? 'paragraph' : 'heading',
    mapping: {}, payload: level === undefined ? { text } : { text, level },
  }));
  original.source.sourceLocators = original.source.units.map(unit => ({
    ...original.source.sourceLocators[0], sourceRefId: unit.sourceRefIds[0], pageStart: 0, pageEnd: 0,
  }));
  original.locations = original.source.units.map(unit => ({
    ...original.locations[0], sourceRefId: unit.sourceRefIds[0], pageIndex: 0,
  }));
  original.coverage = { knownPageCount: 1, readPageIndexes: [0], unresolvedRanges: [] };
  return original;
}

function setup(original: DocumentOriginalResult, family = 'SB', issuer = 'BOEING') {
  const execute = jest.fn().mockResolvedValue([{ family, issuer }]);
  const revisions = {
    read: jest.fn().mockResolvedValue(null),
    append: jest.fn().mockImplementation(async (_scope, _original, map) => JSON.parse(JSON.stringify(map))),
    readReady: jest.fn(),
  };
  const service = new DocumentSemanticService(
    { execute } as unknown as ConstructorParameters<typeof DocumentSemanticService>[0],
    revisions as unknown as ConstructorParameters<typeof DocumentSemanticService>[1],
  );
  const scope = { tenantId: 'tenant', actorUserId: 'actor', documentVersionId: original.binding.documentVersionId, roles: [] };
  const loaded = { original, run: { tenantId: 'tenant', parseRunId: original.binding.parseRunId,
    manifestArtifact: { readback: 'VERIFIED', sha256: 'f'.repeat(64) } } } as unknown as Parameters<DocumentSemanticService['ensure']>[1];
  return { service, scope, loaded, execute, revisions, ensure: () => service.ensure(scope, loaded) };
}

describe('semantic selection service persistence and exact readback', () => {
  it.each(['recorded historical decision', 'legacy map without receipt'])('reads a %s without current registration or recomputation', async kind => {
    const original = document();
    const map = buildDocumentSemanticMap({ original, semanticRevision: 1, profile: GENERIC_SEMANTIC_PROFILE });
    map.profileRef = 'historical.unfamiliar-template.v0';
    if (kind === 'recorded historical decision') {
      map.profileSelection = { policyVersion: 'host-family-original-headings.v1', reason: 'REGISTERED_FAMILY_ISSUER',
        registeredIdentity: { family: ' SB ', issuer: ' Boeing ' }, evidenceSourceRefIds: ['SR-PROFILE-0'] };
    }
    const bytes = JSON.stringify(map);
    const context = setup(original, 'FTD', 'OTHER');
    context.revisions.read.mockResolvedValue(map);
    expect(await context.ensure()).toBe(map);
    expect(await context.service.read(context.scope, context.loaded, 1)).toBe(map);
    expect(JSON.stringify(map)).toBe(bytes);
    expect(context.execute).not.toHaveBeenCalled();
    expect(context.revisions.append).not.toHaveBeenCalled();
  });

  it('persists and reads the selection receipt through actual repository SQL serialization', async () => {
    const original = document();
    const context = setup(original);
    let persisted: DocumentSemanticMap | null = null;
    const tx = { execute: jest.fn() };
    tx.execute.mockResolvedValueOnce([{ document_version_id: original.binding.documentVersionId }])
      .mockResolvedValueOnce([{ parse_run_id: original.binding.parseRunId }]).mockResolvedValueOnce([])
      .mockImplementationOnce(async query => {
        const serialized = new PgDialect().sqlToQuery(query).params.find(value =>
          typeof value === 'string' && value.includes('wiselink.document.semantic-map.v1'));
        expect(typeof serialized).toBe('string');
        persisted = JSON.parse(serialized as string);
        return [{ map: persisted }];
      });
    const store = { execute: jest.fn().mockImplementation(async () => persisted ? [{ map: persisted }] : []),
      transaction: jest.fn().mockImplementation(async callback => callback(tx)) };
    const repository = new DocumentSemanticRevisionRepository(
      store as unknown as ConstructorParameters<typeof DocumentSemanticRevisionRepository>[0],
    );
    const service = new DocumentSemanticService(
      { execute: context.execute } as unknown as ConstructorParameters<typeof DocumentSemanticService>[0], repository,
    );
    const saved = await service.ensure(context.scope, context.loaded);
    expect(saved.profileSelection).toEqual({ policyVersion: 'registered-metadata-existing-dispatch.v1', reason: 'UNSUPPORTED_LAYOUT',
      registeredIdentity: { family: 'SB', issuer: 'BOEING' }, evidenceSourceRefIds: [] });
    expect(persisted?.profileSelection).toEqual(saved.profileSelection);
    expect(await service.read(context.scope, context.loaded, 1)).toEqual(saved);
    expect(store.transaction).toHaveBeenCalledTimes(1);
    expect(tx.execute).toHaveBeenCalledTimes(4);
  });

  it('selects again for a later parse/version rather than carrying an earlier registered profile', async () => {
    const first = await setup(document([['Interim Action', 1], ['None']]), 'FTD').ensure();
    const original = document([['Changed supplier-specific template', 1], ['All changed source text is retained.']]);
    original.binding = { ...original.binding, documentVersionId: 'DV-NEXT', parseRunId: 'PR-NEXT', parseRevision: 2 };
    const context = setup(original, 'SB');
    const second = await context.ensure();
    expect(first.profileRef).toBe('boeing.ftd.sections.v1');
    expect(second.profileRef).toBe('generic.author-sections.v1');
    expect(second.profileSelection?.reason).toBe('UNSUPPORTED_LAYOUT');
    expect(second.binding).toEqual(original.binding);
    expect(context.execute).toHaveBeenCalledTimes(1);
    expect(context.revisions.append).toHaveBeenCalledWith(context.scope, original, second, 0, 'f'.repeat(64));
    expect(second.sections.flatMap(section => [section.headingUnitId, ...section.bodyUnitIds])).toEqual(['profile-u0', 'profile-u1']);
  });

  it('uses the TFU section template only for the registered Airbus TFU identity', async () => {
    const original = document([
      ['Engineering Support', 1], ['Open'], ['Mitigation / Interim Action', 2],
      ['Interim source requirement.'], ['Terminating Action', 2], ['Planned action, not completed.'],
    ]);
    const sourceBytes = JSON.stringify(original);
    const map = await setup(original, 'TFU', 'AIRBUS').ensure();
    expect(map.profileRef).toBe('airbus.tfu.sections.v1');
    expect(map.profileSelection).toEqual({ policyVersion: 'registered-airbus-tfu-dispatch.v1',
      reason: 'REGISTERED_METADATA_TEMPLATE', registeredIdentity: { family: 'TFU', issuer: 'AIRBUS' }, evidenceSourceRefIds: [] });
    expect(map.sections.map(section => section.roleKey)).toEqual(['tfu.engineering_support', 'tfu.interim_action', 'tfu.terminating_action']);
    expect(map.sections[1].parentSectionId).toBe('section:profile-u0');
    expect(map.sections[2].parentSectionId).toBe('section:profile-u0');
    expect(map.sections.flatMap(section => [section.headingUnitId, ...section.bodyUnitIds])).toEqual(original.source.units.map(unit => unit.unitId));
    expect(JSON.stringify(original)).toBe(sourceBytes);
    for (const [family, issuer] of [['GENERIC', 'AIRBUS'], ['TFU', 'TEST SUPPLIER'], ['OEM_REFERENCE', 'AIRBUS']]) {
      expect((await setup(original, family, issuer).ensure()).profileRef).toBe('generic.author-sections.v1');
    }
  });

  it('returns the equal concurrent map after a CAS retry', async () => {
    const original = document();
    const context = setup(original);
    let competingMap: DocumentSemanticMap | null = null;
    context.revisions.append.mockImplementationOnce(async (_scope, _original, map) => {
      // The builder's native structuredClone arrays cross Jest's realm. Keep
      // their prototypes while supplying distinct equal map/receipt objects.
      competingMap = { ...map, profileSelection: { ...map.profileSelection } };
      expect(competingMap).not.toBe(map);
      expect(competingMap.profileSelection).not.toBe(map.profileSelection);
      expect(require('node:util').isDeepStrictEqual(competingMap, map)).toBe(true);
      context.revisions.read.mockResolvedValueOnce(competingMap);
      throw new Error('DOCUMENT_SEMANTIC_REVISION_CONFLICT');
    });
    const saved = await context.ensure();
    expect(saved).toBe(competingMap);
    expect(context.revisions.read).toHaveBeenLastCalledWith(context.scope, original.binding.parseRunId, 1);
    expect(context.revisions.append).toHaveBeenCalledTimes(1);
  });

  it('rejects a different receipt as the same concurrent CAS result', async () => {
    const context = setup(document());
    context.revisions.append.mockImplementationOnce(async (_scope, _original, map) => {
      context.revisions.read.mockResolvedValueOnce({ ...map,
        profileSelection: { ...map.profileSelection, policyVersion: 'different-policy' } });
      throw new Error('DOCUMENT_SEMANTIC_REVISION_CONFLICT');
    });
    await expect(context.ensure()).rejects.toThrow('DOCUMENT_SEMANTIC_REVISION_CONFLICT');
    expect(context.revisions.append).toHaveBeenCalledTimes(1);
  });

  it.each(['duplicate', 'foreign'])('rejects %s receipt evidence through saved-map readback', async failure => {
    const original = document();
    const map = await setup(original).ensure();
    map.profileSelection!.evidenceSourceRefIds = failure === 'duplicate'
      ? ['SR-PROFILE-0', 'SR-PROFILE-0'] : ['SR-FOREIGN-ORIGINAL'];
    const context = setup(original);
    context.revisions.read.mockResolvedValueOnce(map);
    await expect(context.service.read(context.scope, context.loaded)).rejects.toThrow('SEMANTIC_PROFILE_SELECTION_INVALID');
    expect(context.execute).not.toHaveBeenCalled();
    expect(context.revisions.append).not.toHaveBeenCalled();
  });

  it('preserves scope and verified-manifest requirements before persistence', async () => {
    const context = setup(document());
    await expect(context.service.ensure({ ...context.scope, tenantId: 'foreign' }, context.loaded))
      .rejects.toThrow('DOCUMENT_SEMANTIC_SCOPE_MISMATCH');
    expect(context.execute).not.toHaveBeenCalled();
    for (const manifest of [null, { readback: 'PENDING', sha256: 'f'.repeat(64) }]) {
      context.loaded.run.manifestArtifact = manifest as typeof context.loaded.run.manifestArtifact;
      await expect(context.ensure()).rejects.toThrow('DOCUMENT_ORIGINAL_MANIFEST_REQUIRED');
      expect(context.revisions.append).not.toHaveBeenCalled();
    }
  });
});
