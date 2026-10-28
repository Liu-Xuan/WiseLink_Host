import { completeOriginalMetadata } from '@server/modules/tdms-source/tdms-complete-original.validation';
import reference from '../../fixtures/tdms-source/source092-sb-reference-models.json';
import { adaptTdmsDailySource } from '@server/modules/tdms-source/tdms-daily-source-adapter';
import { current092Envelope, current092Original, sbProof, source092RecordProof, type Source092Scope } from './tdms-source092-dto.fixture';
import { current092AdEnvelope } from './tdms-source092-ad-native.fixture';

const scopes: Source092Scope[] = ['SB', 'SL', 'AD', 'MT'];
describe('current Source0.2.92 independent pure DTO consumers', () => {
  it('uses current Source profile/native model data qualified by exact frozen module hashes', () => {
    expect(reference.sourceVersion).toBe('0.2.92');
    expect(reference.sourceDigest).toBe('399d30107308f31676083ed904c60468f234cf3e7bd5c210f90fdbc076a4f57d');
    expect(Object.keys(reference.profiles)).toEqual(scopes);
    expect(reference.sources).toHaveLength(10);
    for (const source of reference.sources) expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each(scopes)('%s OWNER_PRIMARY retains exact own identity and explicitly deferred surfaces', scope => {
    const input = current092Envelope(scope);
    const before = JSON.stringify(input);
    const prepared = adaptTdmsDailySource(input);
    const proof = source092RecordProof(prepared.envelope.package.records[0]);
    expect(proof.requestedCriteria.collectionStage).toBe('OWNER_PRIMARY');
    expect(proof.scopeId).toBe(scope);
    expect(proof.reads[1].rosterEvidence.layoutEvidencePending).toBe(true);
    expect(proof.reads[1].relationTables).toEqual([]);
    expect(prepared.envelope.package.records[0].sourceVersion).toEqual(input.package.records[0].sourceVersion);
    expect(prepared.envelope.package.coverage.status).toBe('PARTIAL');
    expect(JSON.stringify(input)).toBe(before);
  });
  it.each(scopes)('%s current full-observation package remains a distinct partial source observation', scope => {
    const input = scope === 'AD' ? current092AdEnvelope() : current092Envelope(scope, 'FULL');
    const prepared = adaptTdmsDailySource(input);
    const proof = source092RecordProof(prepared.envelope.package.records[0]);
    expect(proof.requestedCriteria.collectionStage).toBeUndefined();
    expect(proof.scopeId).toBe(scope);
    if (scope === 'AD') {
      expect(proof.reads[1].relationTables).toHaveLength(1);
      expect(proof.reads[1].relationTables[0].relatedSurfaceEvidence.schemaVersion)
        .toBe('wiselink.tdms-ad-same-row-business-version.v1');
      expect(proof.reads[1].rosterEvidence.layoutEvidencePending).toBe(true);
    } else expect(proof.reads[1].relationTables.length).toBeGreaterThan(0);
    expect(prepared.envelope.package.coverage.status).toBe('PARTIAL');
    expect(prepared.memberClaims.records).toContainEqual({ recordKind: 'MANUFACTURER_FILE',
      sourceRecordId: input.package.records[0].sourceRecordId });
  });
  it.each(scopes)('%s binds current primary metadata to the exact byte observation without claiming a formal DVI', scope => {
    const { env, bytes } = current092Original(scope);
    const prepared = adaptTdmsDailySource(env);
    expect(prepared.envelope.package.artifactBindings[0]).toMatchObject({
      ownerSnapshotId: env.package.records[0].snapshotId, byteLength: bytes.length,
      sourceVersion: env.package.records[0].sourceVersion,
    });
    expect(prepared.memberClaims.artifacts).toHaveLength(1);
    expect(prepared.memberClaims.artifacts[0].sourceAttachmentId).toBe(env.package.artifactBindings[0].sourceAttachmentId);
    expect(prepared.memberClaims.relatedDocumentVersionIds).toEqual([]);
  });
  it.each(scopes)('%s refuses primary metadata bound to another technical version', scope => {
    const { env } = current092Original(scope);
    sbProof(env).reads[1].attachments[0]
      .primaryMetadata.ownerTechnicalVersion.rawRevision = 'FOREIGN';
    expect(() => completeOriginalMetadata(env.package.query.originalAcquisition, env.package.records[0]))
      .toThrow(expect.objectContaining({ code: 'TDMS_COMPLETE_ORIGINAL_PACKAGE_MARKER_INVALID' }));
  });

});
