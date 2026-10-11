import {
  prepareTdmsDailyMetadataImport,
  validateTdmsDailyMetadataImportReceipt,
  validateTdmsDailyMetadataImportReadback,
} from '../../../server/modules/tdms-source/tdms-daily-metadata-contract';
import {
  canonical,
  hash,
} from '../../../server/modules/tdms-source/tdms-source.validation';
import { UnconfiguredTdmsSourceAuthorization } from '../../../server/modules/tdms-source/tdms-source.authorization';
import { actor } from './tdms-fixtures';
import {
  syntheticDailyEnvelope,
  syntheticSavedReceipt,
} from './tdms-daily-metadata.fixture';

function repack(envelope: ReturnType<typeof syntheticDailyEnvelope>) {
  envelope.requestId = 'TDMSIMPORT-' + hash(envelope.package);
  return envelope;
}

describe('bounded TDMS daily metadata compatibility', () => {
  it('round-trips every raw/null field and PROBE/NON_ATOMIC coverage without granting rights', () => {
    const envelope = syntheticDailyEnvelope();
    const before = JSON.stringify(envelope);
    const prepared = prepareTdmsDailyMetadataImport(envelope);
    expect(JSON.stringify(prepared.envelope)).toBe(before);
    expect(prepared.envelope).not.toBe(envelope);
    expect(prepared.authority).toBe('NOT_GRANTED_BY_PREPARATION');
    expect(prepared).not.toHaveProperty('status');
    expect(prepared.envelope.package.records[0].sourceVersion).toEqual({
      rawRevision: 'A',
      rawIteration: '9',
      confirmation: 'SOURCE_DECLARED',
    });
    expect(prepared.envelope.package.records[0].businessVersion).toEqual({
      rawRevision: 'R00',
      rawIteration: null,
      confirmation: 'SOURCE_DECLARED',
    });
    expect(prepared.envelope.package.query).toEqual({
      requestedCriteria: {},
      actualCriteria: null,
      scopeComplete: false,
      scopeMatch: 'UNKNOWN',
    });
    expect(prepared.envelope.package.coverage).toEqual({
      status: 'PARTIAL',
      gaps: ['PROBE_ONLY'],
      readback: 'NON_ATOMIC',
    });
    expect(prepared.memberClaims.records.map((r) => r.recordKind)).toEqual([
      'AEO',
      'EXECUTION_STATUS',
    ]);
    expect(prepared.sourceRefs).toHaveLength(4);
    envelope.package.records[0].number = 'Caller mutation';
    expect(prepared.envelope.package.records[0].number).toBe('AEO-SYNTHETIC');
  });
  it('keeps OR/VR distinct and a null unknown endpoint unresolved', () => {
    const prepared = prepareTdmsDailyMetadataImport(syntheticDailyEnvelope());
    expect(prepared.envelope.package.records[0].sourceRecordId).toBe(
      'OR:wt.epm.EPMDocument:1',
    );
    expect(prepared.envelope.package.edges[0]).toMatchObject({
      toSourceRecordId: 'VR:wt.epm.EPMDocument:1',
      toSnapshotId: null,
      nativeRelationId: null,
      confidence: 'observed_unresolved',
    });
    expect(prepared.memberClaims.relationIds).toEqual(
      prepared.envelope.package.edges.map((e) => e.edgeId),
    );
    expect(prepared.memberClaims.relatedDocumentVersionIds).toEqual([]);
  });
  it('canonical key ordering preserves the request digest and exact receipt shape', () => {
    const envelope = syntheticDailyEnvelope();
    const reordered = JSON.parse(canonical(envelope));
    expect(prepareTdmsDailyMetadataImport(reordered).payloadDigest).toBe(
      prepareTdmsDailyMetadataImport(envelope).payloadDigest,
    );
    const receipt = syntheticSavedReceipt(envelope);
    expect(validateTdmsDailyMetadataImportReceipt(receipt, envelope)).toEqual(
      receipt,
    );
    expect(Object.keys(receipt)).toHaveLength(10);
    expect(
      validateTdmsDailyMetadataImportReadback(
        { receipt, package: envelope.package },
        envelope,
      ),
    ).toEqual(receipt);
  });
  it('denies stale requestDigest or reused requestId after payload changes', () => {
    const envelope = syntheticDailyEnvelope();
    envelope.package.packageId = 'Changed package';
    expect(() => prepareTdmsDailyMetadataImport(envelope)).toThrow(
      'TDMS_DAILY_REQUEST_DIGEST_MISMATCH',
    );
  });
  it('does not infer a VR endpoint from an observed OR object', () => {
    const envelope = syntheticDailyEnvelope();
    envelope.package.edges[0].toSnapshotId =
      envelope.package.records[0].snapshotId;
    expect(() => prepareTdmsDailyMetadataImport(repack(envelope))).toThrow(
      'TDMS_DAILY_RELATION_ENDPOINT_INVALID',
    );
  });
  it('rejects source-relation authority upgrades', () => {
    const envelope = syntheticDailyEnvelope();
    (
      envelope.package.edges[0] as unknown as Record<string, unknown>
    ).confidence = 'native';
    expect(() => prepareTdmsDailyMetadataImport(repack(envelope))).toThrow(
      'TDMS_DAILY_NATIVE_RELATION_UNPROVEN',
    );
  });
  it('rejects PROBE coverage being promoted to COMPLETE', () => {
    const envelope = syntheticDailyEnvelope();
    envelope.package.coverage.status = 'COMPLETE';
    expect(() => prepareTdmsDailyMetadataImport(repack(envelope))).toThrow(
      'TDMS_DAILY_COMPLETE_COVERAGE_UNPROVEN',
    );
  });
  it('rejects duplicate snapshots without dropping any record', () => {
    const envelope = syntheticDailyEnvelope();
    envelope.package.records.push(
      JSON.parse(JSON.stringify(envelope.package.records[0])),
    );
    expect(() => prepareTdmsDailyMetadataImport(repack(envelope))).toThrow(
      'TDMS_DAILY_SNAPSHOT_INVALID',
    );
  });
  it('does not admit artifacts or opinion bodies through a metadata preparation', () => {
    const envelope = syntheticDailyEnvelope();
    (envelope.package.artifactBindings as unknown[]).push({
      bindingId: 'unsupported',
    });
    expect(() => prepareTdmsDailyMetadataImport(repack(envelope))).toThrow(
      'TDMS_DAILY_ARTIFACT_INGRESS_NOT_IMPLEMENTED',
    );
    const opinion = syntheticDailyEnvelope();
    (
      opinion.package.records[0].content as unknown as Record<string, unknown>
    ).opinions = ['unadmitted'];
    expect(() => prepareTdmsDailyMetadataImport(repack(opinion))).toThrow(
      'TDMS_DAILY_FIELDS_INVALID',
    );
  });
  it('rejects client identity claims and accessors without executing a getter', () => {
    const envelope = syntheticDailyEnvelope();
    expect(() =>
      prepareTdmsDailyMetadataImport({ ...envelope, tenantId: 'invented' }),
    ).toThrow('TDMS_DAILY_RESERVED_CLAIM_REJECTED');
    const get = jest.fn(() => envelope.package);
    const accessor = { requestId: envelope.requestId };
    Object.defineProperty(accessor, 'package', { get, enumerable: true });
    expect(() => prepareTdmsDailyMetadataImport(accessor)).toThrow(
      'TDMS_DAILY_ACCESSOR_REJECTED',
    );
    expect(get).not.toHaveBeenCalled();
  });
  it('leaves the real default authorizer fail closed for all prepared member claims', async () => {
    const authorization = new UnconfiguredTdmsSourceAuthorization();
    const prepared = prepareTdmsDailyMetadataImport(syntheticDailyEnvelope());
    expect(authorization.available).toBe(false);
    await expect(authorization.catalogue()).resolves.toEqual([]);
    // Call the actual port with synthetic actor/source claims; nothing is authorized or persisted.
    const port: import('../../../server/modules/tdms-source/tdms-source.types').TdmsSourceAuthorization =
      authorization;
    await expect(
      port.authorizeImport(
        actor(),
        {
          tenantId: 'tenant-a',
          sourceKey: 'synthetic',
          sourceInstanceId: 'synthetic',
          scopeId: 'synthetic',
        },
        prepared.memberClaims,
      ),
    ).rejects.toMatchObject({
      code: 'TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED',
      statusCode: 503,
    });
  });
  it.each([
    [
      'extra top-level packageId',
      (r: Record<string, unknown>) => {
        r.packageId = 'extra';
      },
      'FIELDS_INVALID',
    ],
    [
      'extra coverage',
      (r: Record<string, unknown>) => {
        r.coverage = {};
      },
      'FIELDS_INVALID',
    ],
    [
      'missing required key',
      (r: Record<string, unknown>) => {
        delete r.importedAt;
      },
      'FIELDS_INVALID',
    ],
    [
      'wrong request',
      (r: Record<string, unknown>) => {
        r.requestId = 'wrong';
      },
      'RECEIPT_IDENTITY_MISMATCH',
    ],
    [
      'wrong digest',
      (r: Record<string, unknown>) => {
        r.payloadDigest = '0'.repeat(64);
      },
      'RECEIPT_PAYLOAD_MISMATCH',
    ],
    [
      'wrong counts',
      (r: Record<string, unknown>) => {
        r.relationCount = 0;
      },
      'RECEIPT_COUNTS_MISMATCH',
    ],
    [
      'duplicate reference',
      (r: Record<string, unknown>) => {
        const refs = r.sourceRefs as string[];
        refs[1] = refs[0];
      },
      'RECEIPT_SOURCE_REFS_INVALID',
    ],
    [
      'missing reference',
      (r: Record<string, unknown>) => {
        (r.sourceRefs as string[]).pop();
      },
      'RECEIPT_SOURCE_REFS_INVALID',
    ],
    [
      'invented document mapping',
      (r: Record<string, unknown>) => {
        r.documentVersionMappings = [{ documentVersionId: 'invented' }];
      },
      'RECEIPT_DOCUMENT_MAPPINGS_INVALID',
    ],
    [
      'invalid date',
      (r: Record<string, unknown>) => {
        r.importedAt = '2026-02-30T00:00:00Z';
      },
      'TIME_INVALID',
    ],
  ])('rejects saved receipt %s', (_name, mutate, code) => {
    const envelope = syntheticDailyEnvelope();
    const receipt = syntheticSavedReceipt(envelope);
    mutate(receipt);
    expect(() =>
      validateTdmsDailyMetadataImportReceipt(receipt, envelope),
    ).toThrow('TDMS_DAILY_' + code);
  });
  it('rejects an unknown-outcome readback package change or additional envelope key', () => {
    const envelope = syntheticDailyEnvelope(),
      receipt = syntheticSavedReceipt(envelope);
    const changed = JSON.parse(JSON.stringify(envelope.package));
    changed.query.scopeMatch = 'MATCHED';
    expect(() =>
      validateTdmsDailyMetadataImportReadback(
        { receipt, package: changed },
        envelope,
      ),
    ).toThrow('TDMS_DAILY_READBACK_PACKAGE_MISMATCH');
    expect(() =>
      validateTdmsDailyMetadataImportReadback(
        { receipt, package: envelope.package, coverage: {} },
        envelope,
      ),
    ).toThrow('TDMS_DAILY_FIELDS_INVALID');
  });
});
