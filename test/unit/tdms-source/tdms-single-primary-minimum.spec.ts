import { createHash } from 'node:crypto';
import type { Request } from 'express';
import type { TdmsSourceVersion } from '../../../shared/tdms-source.interface';
import { TdmsDailyMetadataController } from '../../../server/modules/tdms-source/tdms-daily-metadata.controller';
import { prepareTdmsDailySourceImport } from '../../../server/modules/tdms-source/tdms-daily-metadata-contract';
import { adaptTdmsDailySource } from '../../../server/modules/tdms-source/tdms-daily-source-adapter';
import { MiaodaTdmsArtifactStore } from '../../../server/modules/tdms-source/miaoda-tdms-artifact-store';
import { TDMS_EXPECTED_RECEIVER_HEADER } from '../../../server/modules/tdms-source/tdms-receiver-expectation';
import { UnconfiguredTdmsSourceAuthorization } from '../../../server/modules/tdms-source/tdms-source.authorization';
import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import { hash } from '../../../server/modules/tdms-source/tdms-source.validation';
import { copyComplete } from './tdms-complete-owned.fixture';
import { proofOfCurrent } from './tdms-current-contract.fixture';
import { actor } from './tdms-fixtures';
import { ownerPrimaryServices } from './tdms-owner-primary-0-2-83.fixture';
import { sealSb } from './tdms-reviewed-sb-0-2-73.fixture';

interface PrimaryProof {
  scopeId: string;
  requestedCriteria: { collectionStage: string };
  reads: Array<{
    owner: {
      businessVersion: TdmsSourceVersion;
      businessVersionEvidence: {
        rawValue: string;
        observedTotalCodepoints: number;
      };
    };
    attachments: Array<{
      filename: string;
      primaryMetadata: {
        filename: string;
        ownerBusinessVersion: TdmsSourceVersion;
      };
    }>;
    tabs: Array<{ state: string }>;
  }>;
}

// Generated locally, not the real TDMS original or its digest. No PDF parser runs.
function syntheticPdf(): Buffer {
  const stream =
    'BT /F1 12 Tf 20 100 Td (SYNTHETIC SINGLE PRIMARY ONLY) Tj ET\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 150] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.7\n';
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(pdf);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

function minimumServices() {
  // Reuses syntheticReceiverFixture through the existing actual-service fixture.
  // Identity, FileService, catalog and persistence are local doubles, not PG/RLS.
  const s = ownerPrimaryServices();
  const record = s.env.package.records[0];
  const proof = proofOfCurrent(s.env) as PrimaryProof;
  const businessVersion: TdmsSourceVersion = {
    rawRevision: '00',
    rawIteration: null,
    confirmation: 'SOURCE_DECLARED',
  };
  record.businessVersion = copyComplete(businessVersion);
  for (const read of proof.reads) {
    read.owner.businessVersion = copyComplete(businessVersion);
    read.owner.businessVersionEvidence.rawValue = '00';
    read.owner.businessVersionEvidence.observedTotalCodepoints = 2;
    read.attachments[0].filename = 'synthetic-single-primary.pdf';
    read.attachments[0].primaryMetadata.filename =
      'synthetic-single-primary.pdf';
    read.attachments[0].primaryMetadata.ownerBusinessVersion =
      copyComplete(businessVersion);
  }
  sealSb(s.env);
  const bytes = syntheticPdf();
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  Object.assign(s.binding, {
    ownerSnapshotId: record.snapshotId,
    filename: 'synthetic-single-primary.pdf',
    blobSha256: sha256,
    byteLength: bytes.length,
  });
  const {
    bindingId: _bindingId,
    observedAt: _observedAt,
    ...identity
  } = s.binding;
  void _bindingId;
  void _observedAt;
  s.binding.bindingId = 'TDMSBIND-' + hash(identity);
  Object.assign(s.env.package.query.originalAcquisition as object, {
    bytesSha256: sha256,
    byteLength: bytes.length,
  });
  s.env.requestId = 'TDMSIMPORT-' + hash(s.env.package);
  const prepared = adaptTdmsDailySource(s.env);
  for (const action of Object.values(s.f.actions))
    action.permittedMembers = copyComplete(prepared.memberClaims);
  s.f.actions.READ_RELATIONS.allowed = false;
  s.selection.filePath = `tdms-source/uploads/${s.env.requestId}_${s.binding.bindingId}`;
  s.f.objects.clear();
  s.f.objects.set(s.selection.filePath, {
    bytes,
    metadata: {
      bucketID: s.selection.bucketId,
      filePath: s.selection.filePath,
      id: s.selection.expectedProviderObjectId,
      name: s.binding.filename,
      createdBy: { userID: actor().canonicalSubject.id },
      metadata: { mimeType: 'application/pdf', contentLength: bytes.length },
    },
  });
  return { ...s, bytes, sha256, proof, prepared };
}

type Minimum = ReturnType<typeof minimumServices>;
function stage(s: Minimum) {
  return s.receiver.stage(s.request, s.env.requestId, s.binding.bindingId, {
    package: s.env.package,
    selection: s.selection,
  });
}

describe('single SELF/PRIMARY minimum: actual Host receiver/service, synthetic ports only', () => {
  it('accepts one SL owner, zero relations and one PRIMARY without FULL; preserves A.1 / 00 / null', () => {
    const s = minimumServices();
    const prepared = prepareTdmsDailySourceImport(s.env);
    expect(prepared.envelope).toEqual(s.env);
    expect(s.env.package.records).toHaveLength(1);
    expect(s.env.package.edges).toEqual([]);
    expect(s.env.package.artifactBindings).toHaveLength(1);
    expect(s.proof).toMatchObject({
      scopeId: 'SL',
      requestedCriteria: { collectionStage: 'OWNER_PRIMARY' },
    });
    expect(
      s.proof.reads.every((read) =>
        read.tabs.some((tab) => tab.state === 'NOT_READ'),
      ),
    ).toBe(true);
    expect(s.env.package.records[0]).toMatchObject({
      kind: 'MANUFACTURER_FILE',
      sourceVersion: {
        rawRevision: 'A',
        rawIteration: '1',
        confirmation: 'SOURCE_DECLARED',
      },
      businessVersion: {
        rawRevision: '00',
        rawIteration: null,
        confirmation: 'SOURCE_DECLARED',
      },
      coverage: { status: 'PARTIAL', readback: 'NON_ATOMIC' },
    });
    expect(s.prepared.memberClaims.artifacts[0]).toMatchObject({
      sourceAttachmentVersion: null,
      owners: [{ sourceRecordId: s.env.package.records[0].sourceRecordId }],
    });
    expect(s.prepared.memberClaims.artifacts[0]).not.toHaveProperty(
      'metadataOnly',
    );
    expect(s.f.actions.READ_RELATIONS.allowed).toBe(false);
    expect(s.binding.blobSha256).toBe(
      createHash('sha256').update(s.bytes).digest('hex'),
    );
    expect(s.binding.byteLength).toBe(s.bytes.length);
    expect(s.prepared.output.nativePackage.records[0]).toMatchObject({
      formalDocumentArtifactMemberId: null,
      relatedDocumentVersionIds: [],
    });
  });

  it('completes binding/preflight/stage/import/replay/GET/all three SourceRefs but diagnoses no formal DVI', async () => {
    const s = minimumServices();
    const raw = JSON.stringify(s.env);
    const acquisition = jest.spyOn(s.f.catalog, 'recordAcquisition');
    expect(Object.keys(await s.receiver.binding(s.request))).toHaveLength(11);
    expect(
      await s.receiver.preflight(
        s.request,
        s.env.requestId,
        s.binding.bindingId,
        { package: s.env.package },
      ),
    ).toMatchObject({
      status: 'AUTHORIZED_UPLOAD',
      requestId: s.env.requestId,
      bindingId: s.binding.bindingId,
    });
    expect(s.f.activity).toMatchObject({
      downloads: 0,
      uploads: 0,
      acquisitions: 0,
    });
    const staged = await stage(s);
    expect(staged).toMatchObject({
      status: 'STAGED_CANDIDATE',
      readbackVerified: true,
      documentVersionId: null,
      sha256: s.sha256,
      byteLength: s.bytes.length,
      ownerSnapshotId: s.env.package.records[0].snapshotId,
    });
    expect(
      await s.receiver.read(s.request, s.env.requestId, s.binding.bindingId),
    ).toEqual(staged);
    expect(acquisition).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceArtifact: expect.objectContaining({
          sha256: s.sha256,
          byteLength: s.bytes.length,
        }),
        acquisition: expect.objectContaining({
          sourceChannel: 'wiselink_tdms_candidate',
          sourceDescriptor: expect.objectContaining({
            packageId: s.env.requestId,
            sourceAttachmentId: s.binding.sourceAttachmentId,
            sourceAttachmentVersion: null,
            candidateOnly: true,
          }),
        }),
      }),
    );
    const receipt = await s.service.importDailyMetadata(actor(), s.env);
    expect(Object.keys(receipt)).toHaveLength(10);
    expect(receipt).toMatchObject({
      status: 'IMPORTED',
      objectCount: 1,
      relationCount: 0,
      artifactCount: 1,
    });
    expect(receipt.documentVersionMappings).toEqual([
      {
        requestId: s.env.requestId,
        bindingId: s.binding.bindingId,
        sourceRef: 'TDMS:ARTIFACT:' + s.binding.bindingId,
        status: 'REVIEW_REQUIRED',
        documentVersionId: null,
        preflightId: null,
        sha256: s.sha256,
        byteLength: s.bytes.length,
        readbackVerified: false,
        mappedAt: expect.any(String),
      },
    ]);
    const activity = { ...s.f.activity };
    expect(await s.service.importDailyMetadata(actor(), s.env)).toEqual(
      receipt,
    );
    expect(s.f.activity).toEqual(activity);
    const readback = await s.service.readDailyMetadataImport(
      actor(),
      s.env.requestId,
    );
    expect(readback).toEqual({ receipt, package: s.env.package });
    expect(receipt.sourceRefs).toEqual(
      expect.arrayContaining([
        'TDMS:SNAPSHOT:' + s.env.package.records[0].snapshotId,
        'TDMS:FIELD:' + s.env.package.records[0].snapshotId + ':0',
        'TDMS:ARTIFACT:' + s.binding.bindingId,
      ]),
    );
    expect(receipt.sourceRefs).toHaveLength(3);
    for (const sourceRef of receipt.sourceRefs) {
      const result = await s.service.readDailySourceRef(actor(), sourceRef);
      expect(result.snapshot).toEqual(s.env.package.records[0]);
      expect(result.documentVersionMappings).toEqual(
        receipt.documentVersionMappings,
      );
    }
    expect(s.repository.state.captures).toHaveLength(1);
    expect(s.repository.state.revisions).toHaveLength(1);
    expect(s.repository.state.assertions).toEqual([]);
    expect(s.documents.assertRead).not.toHaveBeenCalled();
    expect(JSON.stringify(s.env)).toBe(raw);
  });

  it('rejects changed payload under the original stable request rather than replaying a different package', async () => {
    const s = minimumServices();
    await stage(s);
    await s.service.importDailyMetadata(actor(), s.env);
    const changed = copyComplete(s.env);
    changed.package.packageId += '-different';
    const activity = { ...s.f.activity };
    await expect(
      s.service.importDailyMetadata(actor(), changed),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(s.f.activity).toEqual(activity);
    expect(s.repository.state.captures).toHaveLength(1);
  });

  it.each(['revision', 'grantRevision'] as const)(
    'rejects changed current %s after staging',
    async (field) => {
      const s = minimumServices();
      await stage(s);
      s.f.row[field]++;
      const activity = { ...s.f.activity };
      for (const operation of [
        () => s.receiver.read(s.request, s.env.requestId, s.binding.bindingId),
        () => s.service.importDailyMetadata(actor(), s.env),
      ])
        await expect(operation()).rejects.toMatchObject({
          code: 'TDMS_SOURCE_PERMISSION_CHANGED',
          statusCode: 409,
        });
      expect(s.f.activity).toEqual(activity);
      expect(s.repository.state.captures).toEqual([]);
    },
  );

  it('rejects current Source identity drift against the original 11-field binding before I/O', async () => {
    const s = minimumServices();
    const binding = await s.receiver.binding(s.request);
    const request = {
      headers: {
        [TDMS_EXPECTED_RECEIVER_HEADER]: Buffer.from(
          JSON.stringify(binding),
        ).toString('base64url'),
      },
    } as unknown as Request;
    s.f.row.sourceInstanceId += '-changed';
    await expect(
      s.receiver.preflight(request, s.env.requestId, s.binding.bindingId, {
        package: s.env.package,
      }),
    ).rejects.toMatchObject({
      code: 'TDMS_RECEIVER_IDENTITY_CHANGED',
      statusCode: 409,
    });
    expect(s.f.activity).toMatchObject({
      downloads: 0,
      uploads: 0,
      acquisitions: 0,
    });
    expect(s.repository.state.captures).toEqual([]);
  });

  it('does not commit an association if Source permission changes during verified byte I/O', async () => {
    const s = minimumServices();
    s.f.activity.onDownload = async () => {
      s.f.row.permissionRevision = 'synthetic-revoked-during-I/O';
    };
    await expect(stage(s)).rejects.toMatchObject({
      code: 'TDMS_SOURCE_PERMISSION_CHANGED',
      statusCode: 409,
    });
    expect(s.f.activity.downloads).toBeGreaterThan(0);
    await expect(
      s.receiver.read(s.request, s.env.requestId, s.binding.bindingId),
    ).rejects.toMatchObject({
      code: 'TDMS_UPLOAD_SELECTION_UNAVAILABLE',
      statusCode: 404,
    });
    expect(s.repository.state.captures).toEqual([]);
  });

  it('rejects a catalog response pretending this candidate has a formal DVI', async () => {
    const s = minimumServices();
    const record = s.f.catalog.recordAcquisition;
    jest
      .spyOn(s.f.catalog, 'recordAcquisition')
      .mockImplementation(async (...args: Parameters<typeof record>) => ({
        ...(await record(...args)),
        documentVersionId: 'synthetic-forbidden-formal-dvi',
      }));
    await expect(stage(s)).rejects.toMatchObject({
      code: 'TDMS_CANDIDATE_PROMOTION_FORBIDDEN',
      statusCode: 409,
    });
    await expect(
      s.receiver.read(s.request, s.env.requestId, s.binding.bindingId),
    ).rejects.toMatchObject({
      code: 'TDMS_UPLOAD_SELECTION_UNAVAILABLE',
      statusCode: 404,
    });
    expect(s.repository.state.captures).toEqual([]);
  });

  it('actual unconfigured authorization rejects the GET controller path with 503 before capture or FileService', async () => {
    const s = minimumServices();
    const repository = jest.spyOn(s.repository, 'transaction');
    const bucket = jest.spyOn(s.f.files, 'getDefaultBucket');
    const files = jest.spyOn(s.f.files, 'from');
    const store = new MiaodaTdmsArtifactStore(
      s.f.files as unknown as ConstructorParameters<
        typeof MiaodaTdmsArtifactStore
      >[0],
      s.f.catalog as unknown as ConstructorParameters<
        typeof MiaodaTdmsArtifactStore
      >[1],
    );
    const authorization = new UnconfiguredTdmsSourceAuthorization();
    const catalogue = jest.spyOn(authorization, 'catalogue');
    const service = new TdmsSourceService(
      s.repository,
      authorization,
      store,
      s.documents,
    );
    const controller = new TdmsDailyMetadataController(service);
    const request = {
      headers: {},
      userContext: {
        userId: actor().canonicalSubject.id,
        tenantId: actor().tenantId,
        appId: actor().applicationScopeId,
        env: 'preview',
        isSystemAccount: false,
      },
    } as unknown as Request;
    await expect(
      controller.read(request, s.env.requestId, {}),
    ).rejects.toMatchObject({
      code: 'TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED',
      statusCode: 503,
    });
    expect(catalogue).not.toHaveBeenCalled();
    expect(repository).not.toHaveBeenCalled();
    expect(bucket).not.toHaveBeenCalled();
    expect(files).not.toHaveBeenCalled();
    expect(s.f.activity).toMatchObject({
      downloads: 0,
      uploads: 0,
      acquisitions: 0,
    });
  });
});
