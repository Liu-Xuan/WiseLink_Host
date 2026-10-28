import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import type { Request } from 'express';
import { DocumentManagementHostedController } from '../../../server/modules/document-management/src/hosted/nest/document-management-hosted.controller';
import { miaodaHostedFinalUserActor } from '../../../server/modules/work-item/production-miaoda-browser-ingress';
import {
  assertDocumentUploadAuthorityCurrent,
  assertDocumentUploadSourceIdentity,
  mintTdmsDocumentUploadAuthority,
  type TdmsDocumentUploadBinding,
} from '../../../server/modules/document-management/src/hosted/nest/document-upload-authority';
import {
  object,
  canonical,
  hash,
} from '../../../server/modules/tdms-source/tdms-source.validation';
import { actor } from './tdms-fixtures';
import {
  committedAt,
  copy,
  fixture,
} from './tdms-single-primary-formal-registration.fixture';

/** Preserve the original bytes/filename assertions through the actual ordinary Controller response. */
async function readOriginalThroughController(s: ReturnType<typeof fixture>, documentVersionId: string) {
  const response = await new DocumentManagementHostedController(s.documents, s.readSessions)
    .readDocumentOriginal(documentVersionId, s.request);
  const chunks: Buffer[] = [];
  for await (const chunk of response.getStream()) chunks.push(Buffer.from(chunk));
  const disposition = response.getHeaders().disposition;
  const filename = typeof disposition === 'string' ? /^inline; filename\*=UTF-8''(.+)$/u.exec(disposition) : null;
  if (!filename) throw new Error('ACTUAL_ORIGINAL_CONTROLLER_FILENAME_MISSING');
  return { bytes: Buffer.concat(chunks), filename: decodeURIComponent(filename[1]) };
}

describe(
  'formal TDMS original: actual DM Core/PDF parser + services, explicit Memory catalog/FileService/identity ports',
  () => {
    it('GET with no formal lineage returns404 and writes nothing', async () => {
      const s = fixture();
      await s.stage();
      const writes = s.catalog.acquisitions.size;
      await expect(s.read()).rejects.toMatchObject({
        code: 'TDMS_FORMAL_REGISTRATION_UNAVAILABLE',
        statusCode: 404,
      });
      expect(s.catalog.acquisitions.size).toBe(writes);
      expect(s.catalog.commits).toBe(0);
    });
    it('registers the actual local original and projects stable COMMITTED through POST/GET/SourceRefs without mutating retained candidate', async () => {
      const s = fixture();
      const staged = await s.stage();
      const candidate = await s.dailyController.submit(s.request, s.env, {});
      expect(candidate.documentVersionMappings[0].documentVersionId).toBeNull();
      const capture = canonical(s.repository.state.captures);
      const registered = await s.register();
      expect(registered).toMatchObject({
        status: 'COMMITTED',
        readbackVerified: true,
        mappedAt: committedAt,
        sourceAttachmentVersion: null,
        sha256: s.observation.blobSha256,
        byteLength: s.bytes.length,
      });
      expect(registered.documentVersionId).toMatch(/^document_version_/u);
      expect(await s.read()).toEqual(registered);
      const replay = await s.dailyController.submit(s.request, s.env, {});
      const get = await s.dailyController.read(s.request, s.env.requestId, {});
      expect(canonical(replay)).toBe(canonical(get.receipt));
      expect(replay.documentVersionMappings[0]).toMatchObject({
        status: 'COMMITTED',
        documentVersionId: registered.documentVersionId,
        mappedAt: committedAt,
        readbackVerified: true,
      });
      for (const ref of replay.sourceRefs) {
        const response = await s.dailyController.sourceRef(s.request, { sourceRef: ref });
        expect(canonical(response.documentVersionMappings)).toBe(
          canonical(replay.documentVersionMappings),
        );
      }
      expect(canonical(s.repository.state.captures)).toBe(capture);
      expect(
        await s.receiver.read(
          s.request,
          s.env.requestId,
          s.observation.bindingId,
        ),
      ).toEqual(staged);
      expect(s.catalog.versions.size).toBe(1);
      const version = [...s.catalog.versions.values()][0];
      expect(version.businessRevision).toBe('ORIGINAL ISSUE');
      expect(s.env.package.records[0].sourceVersion).toMatchObject({
        rawRevision: 'A',
        rawIteration: '1',
      });
      expect(s.env.package.records[0].businessVersion).toMatchObject({
        rawRevision: 'ORIGINAL ISSUE',
        rawIteration: null,
      });
      const original = await readOriginalThroughController(s, registered.documentVersionId!);
      expect(createHash('sha256').update(original.bytes).digest('hex')).toBe(
        s.observation.blobSha256,
      );
      expect(original.bytes.length).toBe(s.bytes.length);
      expect(original.filename).toBe(s.observation.filename);
      const formalAcquisition = [...s.catalog.acquisitions.values()].find(
        (row) => row.sourceChannel === 'document_library_upload',
      )!;
      expect(
        object(formalAcquisition.sourceDescriptor).providerStorageFilename,
      ).toBe(`${s.env.requestId}_${s.observation.bindingId}`);
      expect(object(formalAcquisition.sourceDescriptor).originalFilename).toBe(
        s.observation.filename,
      );
      expect(await s.register()).toEqual(registered);
      expect(s.catalog.commits).toBe(1);
      if (process.env.TDMS_FORMAL_TEST_EVIDENCE)
        writeFileSync(
          process.env.TDMS_FORMAL_TEST_EVIDENCE,
          JSON.stringify(
            {
              verification:
                'OFFLINE_ACTUAL_DM_CORE_WITH_EXPLICIT_MEMORY_CATALOG_AND_FILE_SERVICE',
              documentVersionId: registered.documentVersionId,
              preflightId: registered.preflightId,
              requestId: s.env.requestId,
              bindingId: s.observation.bindingId,
              sourceRecordId: s.env.package.records[0].sourceRecordId,
              sourceNumber: s.env.package.records[0].number,
              sourceVersion: s.env.package.records[0].sourceVersion,
              sourceBusinessVersion: s.env.package.records[0].businessVersion,
              sourceAttachmentId: registered.sourceAttachmentId,
              sourceAttachmentVersion: registered.sourceAttachmentVersion,
              formalBusinessRevision: version.businessRevision,
              originalFilename: original.filename,
              providerStorageFilename: object(
                formalAcquisition.sourceDescriptor,
              ).providerStorageFilename,
              sha256: registered.sha256,
              byteLength: registered.byteLength,
              formalCommits: s.catalog.commits,
              versions: s.catalog.versions.size,
              candidateCaptureUnchanged:
                canonical(s.repository.state.captures) === capture,
              candidateDocumentVersionId: staged.documentVersionId,
              actualExternalActions: 0,
              actualPgOrRls: false,
              actualHostedIdentity: false,
            },
            null,
            2,
          ) + '\n',
        );
    });
    it.each([false, true])(
      'keeps READ_HISTORY distinct from formal READ_RECORD (registered=%s)',
      async (registered) => {
        const s = fixture();
        await s.stage();
        await s.dailyController.submit(s.request, s.env, {});
        if (registered) await s.register();
        s.f.actions.IMPORT.allowed = false;
        s.f.actions.READ_RECORD.allowed = false;
        if (registered) {
          const downloadsBefore = s.f.activity.downloads;
          const commitsBefore = s.catalog.commits;
          let returned: Awaited<ReturnType<typeof s.dailyController.read>> | undefined;
          const read = s.dailyController.read(s.request, s.env.requestId, {}).then((response) => {
            returned = response;
            return response;
          });
          await expect(read).rejects.toMatchObject({
            code: 'TDMS_SOURCE_NOT_FOUND',
            statusCode: 404,
          });
          expect(returned).toBeUndefined();
          expect(s.f.activity.downloads).toBe(downloadsBefore);
          expect(s.catalog.commits).toBe(commitsBefore);
        } else {
          const read = await s.dailyController.read(s.request, s.env.requestId, {});
          expect(read.receipt.documentVersionMappings[0].status).toBe('REVIEW_REQUIRED');
        }
        expect(s.catalog.commits).toBe(registered ? 1 : 0);
      },
    );
    it.each([false, true])(
      'retains SourceRef READ_RECORD without IMPORT or READ_HISTORY (registered=%s)',
      async (registered) => {
        const s = fixture();
        await s.stage();
        const saved = await s.dailyController.submit(s.request, s.env, {});
        if (registered) await s.register();
        s.f.actions.IMPORT.allowed = false;
        s.f.actions.READ_HISTORY.allowed = false;
        for (const ref of saved.sourceRefs) {
          const read = await s.dailyController.sourceRef(s.request, { sourceRef: ref });
          expect(read.documentVersionMappings[0].status).toBe(
            registered ? 'COMMITTED' : 'REVIEW_REQUIRED',
          );
        }
        expect(s.catalog.commits).toBe(registered ? 1 : 0);
      },
    );
    it('keeps independent reads after an IMPORT-only revocation advances grant/permission revisions, while registration retry fails', async () => {
      const s = fixture();
      await s.stage();
      const candidate = await s.dailyController.submit(s.request, s.env, {});
      await s.register();
      s.f.actions.IMPORT.allowed = false;
      s.f.row.grantRevision++;
      s.f.row.permissionRevision = 'synthetic-new-read-permission';
      const read = await s.dailyController.read(s.request, s.env.requestId, {});
      expect(read.receipt.documentVersionMappings[0].status).toBe('COMMITTED');
      for (const ref of candidate.sourceRefs) {
        expect(
          (await s.dailyController.sourceRef(s.request, { sourceRef: ref }))
            .documentVersionMappings[0].status,
        ).toBe('COMMITTED');
      }
      await expect(s.register()).rejects.toMatchObject({
        code: 'TDMS_SOURCE_NOT_FOUND',
        statusCode: 404,
      });
      // Restoring IMPORT under a new revision does not authorize the old stage.
      s.f.actions.IMPORT.allowed = true;
      await expect(s.register()).rejects.toMatchObject({
        code: 'TDMS_SOURCE_PERMISSION_CHANGED',
        statusCode: 409,
      });
      expect(s.catalog.commits).toBe(1);
    });
    it('does not require another authorized SourceRef reader to own the importer association', async () => {
      const s = fixture();
      await s.stage();
      const candidate = await s.dailyController.submit(s.request, s.env, {});
      await s.register();
      const reader = miaodaHostedFinalUserActor({
        userId: 'synthetic-reader',
        tenantId: actor().tenantId,
        appId: actor().applicationScopeId,
        env: 'preview',
        isSystemAccount: false,
      });
      s.f.row.actorSubjectId = reader.canonicalSubject.id;
      s.f.actions.IMPORT.allowed = false;
      // A distinct explicit HTTP caller/session record, never a raw actor -> Request fallback.
      const readerToken = 'synthetic-separately-granted-reader-token';
      s.readSessionRecords.set(readerToken, { ...s.readSession, actorUserId: reader.canonicalSubject.id,
        tenantId: reader.tenantId, sessionId: 'synthetic-separately-granted-reader-session' });
      const readerRequest = { ...s.request, headers: { cookie: `wl_session=${readerToken}` },
        userContext: { ...s.request.userContext!, userId: reader.canonicalSubject.id } } as Request;
      const lookup = jest.spyOn(s.catalog, 'findIngestionByIdempotency');
      for (const ref of candidate.sourceRefs) {
        const read = await s.dailyController.sourceRef(readerRequest, { sourceRef: ref });
        // No association in this actor's view preserves the candidate facts;
        // this is deliberately not a claim that no global DVI exists.
        expect(read.documentVersionMappings[0].status).toBe('REVIEW_REQUIRED');
      }
      expect(lookup).not.toHaveBeenCalled();
      expect(s.catalog.commits).toBe(1);
    });
    it('does not hide current read-member denial or Source receiver revision drift in a projection', async () => {
      const s = fixture();
      await s.stage();
      const candidate = await s.dailyController.submit(s.request, s.env, {});
      await s.register();
      const originalMembers = copy(s.f.actions.READ_RECORD.permittedMembers);
      s.f.actions.READ_RECORD.permittedMembers = {
        records: [],
        artifacts: [],
        relationIds: [],
        relatedDocumentVersionIds: [],
      };
      await expect(
        s.dailyController.sourceRef(s.request, { sourceRef: candidate.sourceRefs[0] }),
      ).rejects.toMatchObject({
        code: 'TDMS_SOURCE_PERMISSION_CHANGED',
        statusCode: 409,
      });
      s.f.actions.READ_RECORD.permittedMembers = originalMembers;
      s.f.row.revision++;
      await expect(
        s.dailyController.read(s.request, s.env.requestId, {}),
      ).rejects.toMatchObject({
        code: 'TDMS_SOURCE_PERMISSION_CHANGED',
        statusCode: 409,
      });
    });
    it('rejects a different hash on the same formal revision instead of projecting another original', async () => {
      const s = fixture();
      await s.stage();
      await s.register();
      const original = [...s.catalog.artifacts.values()][0];
      original.sha256 = 'f'.repeat(64);
      await expect(s.read()).rejects.toMatchObject({
        code: 'TDMS_FORMAL_REGISTRATION_LINEAGE_CONFLICT',
        statusCode: 409,
      });
      expect(s.catalog.versions.size).toBe(1);
      expect(s.catalog.commits).toBe(1);
    });
    it('does not turn a missing persisted committedAt into a new timestamp', async () => {
      const s = fixture();
      await s.stage();
      await s.register();
      s.catalog.missingCommittedAt = true;
      await expect(s.read()).rejects.toMatchObject({
        code: 'TDMS_FORMAL_REGISTRATION_LINEAGE_CONFLICT',
        statusCode: 409,
      });
    });
    it('does not disguise lookup/DB failures as absent registration or candidate mapping', async () => {
      const s = fixture();
      await s.stage();
      const failure = new Error('synthetic DB transport unavailable');
      s.catalog.lookupFailure = failure;
      await expect(s.read()).rejects.toBe(failure);
      expect(s.catalog.commits).toBe(0);
    });
    it('rejects Source revocation at the final Core commit checkpoint', async () => {
      const s = fixture();
      await s.stage();
      s.catalog.beforeCommit = () => {
        s.f.actions.IMPORT.allowed = false;
      };
      await expect(s.register()).rejects.toMatchObject({
        code: 'TDMS_SOURCE_NOT_FOUND',
        statusCode: 404,
      });
      expect(s.catalog.versions.size).toBe(0);
      expect(s.catalog.commits).toBe(0);
    });
    it('rejects lost Source rights on formal GET instead of returning cached COMMITTED', async () => {
      const s = fixture();
      await s.stage();
      await s.register();
      s.f.actions.READ_RECORD.allowed = false;
      await expect(s.read()).rejects.toMatchObject({
        code: 'TDMS_SOURCE_NOT_FOUND',
        statusCode: 404,
      });
    });
    it('refuses a changed Source revision and a changed retained observation', async () => {
      const s = fixture();
      await s.stage();
      s.f.row.grantRevision++;
      await expect(s.register()).rejects.toMatchObject({
        code: 'TDMS_SOURCE_PERMISSION_CHANGED',
        statusCode: 409,
      });
      expect(s.catalog.versions.size).toBe(0);
    });
    it.each(['non-PRIMARY', 'wrong-owner'] as const)(
      'rejects %s packages before formal writes',
      async (change) => {
        const s = fixture();
        await s.stage();
        const changed = copy(s.env.package);
        if (change === 'non-PRIMARY')
          changed.artifactBindings[0].role = 'SECONDARY';
        else
          changed.artifactBindings[0].ownerSnapshotId =
            'TDMSSNAP-' + 'f'.repeat(64);
        await expect(
          Promise.resolve().then(() =>
            s.formal.register(
              s.request,
              'TDMSIMPORT-' + hash(changed),
              changed.artifactBindings[0].bindingId,
              { package: changed },
            ),
          ),
        ).rejects.toMatchObject({
          code: 'TDMS_COMPLETE_ORIGINAL_PACKAGE_MARKER_INVALID',
          statusCode: 400,
        });
        expect(s.catalog.versions.size).toBe(0);
      },
    );
  },
);

describe('server-only upload Source identity checkpoints', () => {
  it('a copied capability cannot authorize no-extension TDMS selections or run a checkpoint', async () => {
    await expect(
      assertDocumentUploadAuthorityCurrent(
        { mode: 'HOSTED_MIAODA_DOCUMENT_UPLOAD' },
        { actorUserId: 'x', tenantId: 't' },
      ),
    ).rejects.toMatchObject({
      code: 'DOCUMENT_ACTION_FORBIDDEN',
      statusCode: 403,
    });
  });
  it('keeps COMAC base family/R00, Source business00 and technical A.1 separate', () => {
    const a = actor();
    const context = {
      actorUserId: a.canonicalSubject.id,
      tenantId: a.tenantId,
      appId: a.applicationScopeId,
      env: a.env,
    };
    const binding: TdmsDocumentUploadBinding = {
      schemaVersion: 'wiselink.tdms-formal-document-binding.v1',
      requestId: 'synthetic-request',
      bindingId: 'synthetic-binding',
      payloadDigest: 'a'.repeat(64),
      scope: {
        tenantId: a.tenantId,
        sourceKey: 'TDMS',
        sourceInstanceId: 'synthetic',
        scopeId: 'SL',
      },
      receiverId: 'synthetic',
      receiverRevision: 1,
      grantRevision: 1,
      permissionRevision: 'synthetic',
      applicationScopeId: a.applicationScopeId,
      actorSubjectId: a.canonicalSubject.id,
      ownerSnapshotId: 'synthetic',
      sourceRecordId: 'synthetic',
      number: 'SL-73-9999-R00',
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
      sourceAttachmentId: 'synthetic-primary',
      sourceAttachmentVersion: null,
      filename: 'synthetic.pdf',
      mediaType: 'application/pdf',
      sha256: 'a'.repeat(64),
      byteLength: 1,
      selection: {
        bucketId: 'synthetic',
        filePath: 'tdms-source/uploads/synthetic',
        expectedProviderObjectId: 'synthetic',
      },
    };
    const capability = mintTdmsDocumentUploadAuthority(
      context,
      binding,
      async () => undefined,
    );
    const identity = {
      documentCode: 'SL-73-9999',
      documentFamily: 'SL',
      issuer: 'COMAC',
      businessRevision: 'R00',
    };
    expect(() =>
      assertDocumentUploadSourceIdentity(capability, context, identity),
    ).not.toThrow();
    for (const change of [
      { businessRevision: 'R01' },
      { businessRevision: 'A.1' },
      { documentCode: 'SL-73-9998' },
      { documentFamily: 'GENERIC' },
      { issuer: 'UNKNOWN' },
    ])
      expect(() =>
        assertDocumentUploadSourceIdentity(capability, context, {
          ...identity,
          ...change,
        }),
      ).toThrow('Actual PDF identity');
  });
});
