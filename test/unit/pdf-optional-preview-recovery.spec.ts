import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { CanonicalWorkItemProjection, UnifiedPackageArtifactDescriptor, UnifiedPackageReadbackRequest } from '@shared/api.interface';
import { isRetryableParseFailureCode, isRetryableReaderPreviewFailure } from '@shared/parse-retry-policy';
import { availableParseAction } from '../../client/src/pages/WorkspaceHomePage/reparse-completed-work-item';
import { Frozen2CandidateReaderService } from '../../server/modules/unified-reader/frozen2-candidate-reader.service';
import { UnifiedReaderService } from '../../server/modules/unified-reader/unified-reader.service';
import { sha256Raw } from '../../server/modules/unified-reader/unified-reader.utils';
import { readerPreviewFailureProjection, readerPreviewFullValidator } from '../support/reader-preview-failure';

describe('optional PDF preview preserves strict package validation', () => {
  const values = new Map<string, Uint8Array>();
  const store = {
    persistAndReadback: async (bytes: Uint8Array) => {
      const digest = sha256Raw(bytes);
      const artifact: UnifiedPackageArtifactDescriptor = {
        storeRole: 'UnifiedArtifactStoreCandidate',
        ref: `artifact://UnifiedArtifactStoreCandidate/unified-parsed-packages/sha256/${digest}`,
        sha256: digest, byteLength: bytes.byteLength, mediaType: 'application/json',
      };
      values.set(artifact.ref, Uint8Array.from(bytes));
      return { artifact, bytes: Uint8Array.from(bytes), reused: false };
    },
    readActualBytes: async (artifact: UnifiedPackageArtifactDescriptor) => {
      const bytes = values.get(artifact.ref);
      if (!bytes) throw new Error('SOURCE_ARTIFACT_NOT_FOUND');
      return Uint8Array.from(bytes);
    },
  };
  const reader = new UnifiedReaderService(store, new Frozen2CandidateReaderService(), readerPreviewFullValidator(), {
    mode: 'HOST_CONFIGURED', artifactStoreConfigured: true, fullU0ValidatorConfigured: true,
    immutableAcceptanceReceiptOwnerConfigured: false, aeoSpecialistReaderConfigured: false,
    authority: 'COMPOSITION_STATE_NOT_ACTIVATION_NOT_WRITE_AUTHORIZATION',
  });
  let bytes: Uint8Array;
  let context: Parameters<UnifiedReaderService['persistAndReadback']>[1];
  beforeAll(async () => {
    bytes = new Uint8Array(await readFile(resolve(process.cwd(),
      'server/runtime-assets/technical-publication-parsed-package/v1-frozen-2/fixtures/positive/minimal-pdf-complete.json')));
    const pkg = JSON.parse(new TextDecoder().decode(bytes)) as { packageId: string };
    context = {
      workItemId: 'WI-SYNTHETIC-PREVIEW', requestId: 'REQ-SYNTHETIC-PREVIEW',
      documentVersionId: 'DV-SYNTHETIC-PREVIEW', permissionSnapshotVersion: 'PERMISSION-SYNTHETIC-PREVIEW',
      packageId: pkg.packageId, contractId: 'techpub.parsed-package.v1', contractRevision: 'frozen.2', query: 'applicability',
    };
  });

  it('returns actual zero results after the real frozen.2 validator, with a must-match default', async () => {
    await expect(reader.persistAndReadback(bytes, context)).rejects.toThrow('READER_QUERY_NO_RESULTS');
    const result = await reader.persistAndReadback(bytes, context, { allowEmptyResults: true });
    expect(result).toMatchObject({
      status: 'CANDIDATE_READBACK_VERIFIED', queryResults: [],
      package: { packageId: context.packageId, contentUnitCount: 2, sourceRefCount: 1 },
      fullValidatorProof: { status: 'FULL_STRICT_VALIDATOR_PASSED', validatorRevision: 'optional-preview-local-real-frozen2-validator' },
      receipt: { queryProbe: { query: 'applicability', resultCount: 0 }, sourceBoundUnitCount: 2 },
    });
    const { packageId, contractId, contractRevision, ...correlation } = context;
    const request: UnifiedPackageReadbackRequest = { ...correlation,
      package: { packageId, contractId, contractRevision, artifact: result.artifact } };
    await expect(reader.readback(request)).rejects.toThrow('READER_QUERY_NO_RESULTS');
    await expect(reader.readback(request, undefined, { allowEmptyResults: true })).resolves.toMatchObject({ queryResults: [] });
    await expect(reader.readback({ ...request, query: 'electrical' })).resolves.toMatchObject({
      receipt: { queryProbe: { resultCount: 1 } },
    });
  });

  it.each(['invalid schema', 'missing source reference'])('rejects %s using the actual frozen.2 strict validator', async (mutation) => {
    const invalid = JSON.parse(new TextDecoder().decode(bytes));
    if (mutation === 'invalid schema') invalid.$schema = 'urn:techpub:schema:v1:invalid';
    else invalid.contentUnits[0].sourceRefIds = ['missing-source-ref'];
    const changed = new TextEncoder().encode(JSON.stringify(invalid));
    await expect(reader.persistAndReadback(changed, context, { allowEmptyResults: true }))
      .rejects.toThrow('FULL_U0_VALIDATOR_REJECTED:STRICT_VALIDATION');
  });

  it('rejects a package-id mismatch even when the optional query has no matches', async () => {
    await expect(reader.persistAndReadback(bytes, { ...context,
      packageId: `urn:techpub:package:v1:sha256:${'f'.repeat(64)}` }, { allowEmptyResults: true }))
      .rejects.toThrow('FULL_U0_VALIDATOR_REJECTED:STRICT_VALIDATION');
  });

  it('rejects changed actual bytes and a contract mismatch before returning any preview', async () => {
    const { artifact } = await store.persistAndReadback(bytes);
    const { packageId, contractId, contractRevision, ...correlation } = context;
    const request = { ...correlation, package: { packageId, contractId, contractRevision, artifact } };
    values.set(artifact.ref, new TextEncoder().encode('{}'));
    await expect(reader.readback(request, undefined, { allowEmptyResults: true }))
      .rejects.toThrow('FULL_U0_VALIDATOR_REJECTED:ACTUAL_BYTE_MISMATCH');
    await expect(reader.readback({ ...request, package: { ...request.package, contractRevision: 'frozen.1' } }, undefined,
      { allowEmptyResults: true })).rejects.toThrow('CANONICAL_ROLE_NOT_VERIFIED:PACKAGE_CONTRACT');
  });
});

describe('saved reader preview failure has bounded same-WorkItem retry eligibility', () => {
  let saved: CanonicalWorkItemProjection;
  beforeAll(async () => { saved = await readerPreviewFailureProjection(); });
  it('offers the normal retry button only with the full saved and bound receipt', () => {
    expect(isRetryableParseFailureCode('READER_REJECTED')).toBe(false);
    expect(isRetryableReaderPreviewFailure(saved)).toBe(true);
    expect(availableParseAction(true, saved)).toBe('RETRY_FAILED_PARSE');
    expect(availableParseAction(false, saved)).toBeNull();
    expect(saved.failure?.adapterReceipt.strictValidation.status).toBe('FULL_STRICT_FAILURE_REPORT_VALIDATOR_PASSED');
  });

  it.each(['different reader cause', 'missing strict receipt', 'unverified bytes', 'different source hash',
    'different source artifact', 'different document version', 'different WorkItem', 'different request',
    'different failure artifact', 'different write receipt', 'different classification', 'different permission snapshot'])
  ('rejects %s instead of allowing general READER_REJECTED recovery', (mutation) => {
    const changed = structuredClone(saved);
    const failure = changed.failure!;
    if (mutation === 'different reader cause') failure.adapterReceipt.taxonomy.causeCode = 'READER_REJECTED';
    if (mutation === 'missing strict receipt') delete (failure as Partial<typeof failure>).adapterReceipt;
    if (mutation === 'unverified bytes') (failure.adapterReceipt as unknown as { actualByteReadbackVerified: boolean }).actualByteReadbackVerified = false;
    if (mutation === 'different source hash') changed.source.sourceFileSha256 = `sha256:${'e'.repeat(64)}`;
    if (mutation === 'different source artifact') changed.source.sourceArtifactId = 'artifact-other';
    if (mutation === 'different document version') changed.source.documentVersionId = 'document-version-other';
    if (mutation === 'different WorkItem') changed.workItemId = 'WI-OTHER';
    if (mutation === 'different request') changed.requestId = 'REQ-OTHER';
    if (mutation === 'different failure artifact') failure.artifact.sha256 = 'f'.repeat(64);
    if (mutation === 'different write receipt') failure.validationWriteReceipt.workItemId = 'WI-OTHER';
    if (mutation === 'different classification') changed.classification.fingerprint = `sha256:${'e'.repeat(64)}`;
    if (mutation === 'different permission snapshot') changed.permissionSnapshotVersion = 'permission-other';
    expect(isRetryableReaderPreviewFailure(changed)).toBe(false);
    expect(availableParseAction(true, changed)).toBeNull();
  });

  it('does not accept a client-like cause claim without a saved validated failure projection', () => {
    const claimed = { ...saved, failure: { failureCode: 'READER_REJECTED',
      adapterReceipt: { taxonomy: { causeCode: 'READER_QUERY_NO_RESULTS' } } } } as CanonicalWorkItemProjection;
    expect(isRetryableReaderPreviewFailure(claimed)).toBe(false);
    expect(availableParseAction(true, claimed)).toBeNull();
  });

  it('rejects missing source structure even when matching receipt fields are also absent', () => {
    const changed = structuredClone(saved);
    delete (changed as Partial<CanonicalWorkItemProjection>).source;
    const receipt = changed.failure!.adapterReceipt;
    delete (receipt.correlation as Partial<typeof receipt.correlation>).documentId;
    delete (receipt.correlation as Partial<typeof receipt.correlation>).documentVersionId;
    delete (receipt.input as Partial<typeof receipt.input>).sourceArtifactId;
    delete (receipt.input as Partial<typeof receipt.input>).inputRef;
    delete (receipt.input as Partial<typeof receipt.input>).inputHash;
    delete (changed.failure!.validationWriteReceipt as Partial<typeof changed.failure.validationWriteReceipt>).documentVersionId;
    expect(isRetryableReaderPreviewFailure(changed)).toBe(false);
    expect(availableParseAction(true, changed)).toBeNull();
  });
});
