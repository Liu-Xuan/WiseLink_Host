import { mintDocumentUploadAuthority } from './document-upload-authority';
import type { DocumentLibraryUploadRequest, DocumentUploadResponse } from '@shared/api.interface';
import type { DocumentUploadAuthority } from './document-upload-authority';
import { createHash } from 'node:crypto';
import { PdfjsDistLayoutExtractor } from '../../../../professional-input/parser/pdfjs-dist-layout-extractor.adapter';
import { controlledPdfByteView, readActualPdfPageCount } from '../../migrated/ingress/pdfDocumentIdentityOwner.js';
import { extractActualPdfMetadata } from '../../migrated/ingress/pdfDocumentMetadata.js';
import { Inject, Injectable } from '@nestjs/common';
import { FileService } from '@lark-apaas/fullstack-nestjs-core';

import { DocumentManagementHostedCore } from '../documentManagementHostedCore.js';
import { MiaodaFileServiceArtifactStore } from '../miaodaFileServiceArtifactStore.js';
import { MiaodaHostedDocumentCatalog } from './miaoda-hosted-document-catalog';
import {
  CANONICAL_DEVELOPMENT_ROLE_ID,
  CANONICAL_MIAODA_APP_ID,
} from '../../../../canonical-host/canonical-host.constants';
import { assertProductionMiaodaBrowserIdentityAvailable } from '../../../../work-item/production-miaoda-browser-ingress';
import {
  DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER,
  type DocumentManagementIngestAuthorizer,
} from './document-management-hosted.tokens';

export interface HostedRequestContext {
  actorUserId: string;
  tenantId: string;
  roles: string[];
  appId: string;
  env: string;
  runtimeIngestAuthority?: {
    mode:
      | 'HOSTED_OAUTH_SESSION_DEVELOPMENT_RUN'
      | 'HOSTED_OAUTH_SESSION_REVIEW_ATTACHMENT';
    actorUserId: string;
    tenantId: string;
    appId: string;
    identityProvenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN';
    sessionProvenance: 'SERVER_OPAQUE_SESSION';
    workItemId?: string;
    expectedRevision?: number;
    authorizationFingerprint?: string;
  } | DocumentUploadAuthority;
}

export interface HostedCurrentReferenceTarget {
  familyId: string;
  documentVersionId: string;
  canonicalDocumentNumber: string;
  documentFamily: string;
  issuerAuthority: string;
}

@Injectable()
// Registered by DocumentManagementHostedModule.register().
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentManagementHostedService {
  private readonly core: DocumentManagementHostedCore;
  private readonly artifactStore: MiaodaFileServiceArtifactStore;

  constructor(
    fileService: FileService,
    private readonly catalog: MiaodaHostedDocumentCatalog,
    @Inject(DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER)
    private readonly authorizer: DocumentManagementIngestAuthorizer,
  ) {
    this.artifactStore = new MiaodaFileServiceArtifactStore(fileService);
    this.core = new DocumentManagementHostedCore({
      artifactStore: this.artifactStore,
      catalog,
      authorizer,
    });
  }

  ingestFileServiceSelection(request: unknown, context: HostedRequestContext) {
    assertProductionMiaodaBrowserIdentityAvailable(hostedIdentity(context));
    assertDevelopmentIngestContext(context);
    return this.core.ingestFileServiceSelection(request, context);
  }

  async ingestDocumentLibraryUpload(request: unknown, context: HostedRequestContext): Promise<DocumentUploadResponse> {
    assertProductionMiaodaBrowserIdentityAvailable(hostedIdentity(context));
    const input = documentLibraryUploadInput(request);
    const receipt = await this.core.ingestFileServiceSelection({
      idempotencyKey: `document-upload:${context.actorUserId}:${input.requestId}`,
      selection: input.selection,
      sourceChannel: 'document_library_upload',
      sourceRef: `DOCUMENT_UPLOAD:${context.actorUserId}:${input.requestId}`,
      descriptor: {},
    }, { ...context, runtimeIngestAuthority: mintDocumentUploadAuthority(context) });
    return this.uploadResponseWithCurrent(receipt, context);
  }

  async confirmUploadedHistoricalImport(preflightId: string, request: unknown, context: HostedRequestContext) {
    assertProductionMiaodaBrowserIdentityAvailable(hostedIdentity(context));
    if (!request || typeof request !== 'object' || Array.isArray(request) ||
        Object.keys(request).some(key => !['confirmed', 'expectedCurrentGeneration', 'expectedCurrentDocumentVersionId'].includes(key))) {
      throw Object.assign(new Error('Historical confirmation contains unsupported input.'), { code: 'DOCUMENT_UPLOAD_INPUT_INVALID', statusCode: 400 });
    }
    const candidate = await this.catalog.readHistoricalImportCandidate({ preflightId, actorUserId: context.actorUserId, tenantId: context.tenantId });
    if (candidate.acquisition.sourceChannel !== 'document_library_upload') {
      throw Object.assign(new Error('Historical import is not from this upload entry.'), { code: 'DOCUMENT_UPLOAD_SOURCE_REQUIRED', statusCode: 403 });
    }
    const receipt = await this.core.confirmHistoricalImport(preflightId, request, {
      ...context, runtimeIngestAuthority: mintDocumentUploadAuthority(context),
    });
    return this.uploadResponseWithCurrent(receipt, context);
  }

  async refreshUploadedHistoricalImport(preflightId: string, context: HostedRequestContext): Promise<DocumentUploadResponse> {
    assertProductionMiaodaBrowserIdentityAvailable(hostedIdentity(context));
    const candidate = await this.catalog.readHistoricalImportCandidate({ preflightId, actorUserId: context.actorUserId, tenantId: context.tenantId });
    if (candidate.acquisition.sourceChannel !== 'document_library_upload') {
      throw Object.assign(new Error('Historical import is not from this upload entry.'), { code: 'DOCUMENT_UPLOAD_SOURCE_REQUIRED', statusCode: 403 });
    }
    const receipt = await this.core.refreshHistoricalImport(preflightId, { ...context, runtimeIngestAuthority: mintDocumentUploadAuthority(context) });
    return this.uploadResponseWithCurrent(receipt, context);
  }

  private async uploadResponseWithCurrent(receipt: Record<string, unknown>, context: HostedRequestContext): Promise<DocumentUploadResponse> {
    const response = documentUploadResponse(receipt);
    const currentId = response.historicalImport?.expectedCurrentDocumentVersionId;
    if (!currentId) return response;
    try {
      await this.authorizer.assertCanRead({ ...context, action: 'DOCUMENT_READ', documentVersionId: currentId });
    } catch (error: unknown) {
      if ((error as { code?: string }).code !== 'DOCUMENT_VERSION_NOT_FOUND') throw error;
      return { ...response, currentVersion: { documentVersionId: currentId, identity: null, access: 'NOT_AUTHORIZED' } };
    }
    const current = await this.catalog.readDocumentVersion(currentId);
    if (!current) throw Object.assign(new Error('Current version is unavailable.'), { code: 'DOCUMENT_VERSION_NOT_FOUND', statusCode: 404 });
    const family = await this.catalog.readFamily(current.familyId);
    return { ...response, currentVersion: { documentVersionId: currentId, access: 'READABLE', identity: {
      documentNumber: family?.canonicalDocumentNumber ?? '', documentFamily: family?.documentFamily ?? '',
      issuerAuthority: family?.issuerAuthority ?? null, businessRevision: current.businessRevision,
      revisionDate: current.revisionDate, sourceGeneratedDate: current.sourceGeneratedDate, pageCount: null,
    } } };
  }

  confirmHistoricalImport(preflightId: string, request: unknown, context: HostedRequestContext) {
    assertProductionMiaodaBrowserIdentityAvailable(hostedIdentity(context));
    assertDevelopmentIngestContext(context);
    return this.core.confirmHistoricalImport(preflightId, request, context);
  }

  ingestReviewAttachmentSelection(
    request: unknown,
    context: HostedRequestContext,
  ) {
    assertProductionMiaodaBrowserIdentityAvailable(hostedIdentity(context));
    assertReviewAttachmentIngestContext(context);
    return this.core.ingestFileServiceSelection(request, context);
  }

  assertCanIngest(
    context: HostedRequestContext,
    selection: { bucketId: string; filePath: string },
  ): Promise<void> {
    assertProductionMiaodaBrowserIdentityAvailable(hostedIdentity(context));
    assertDevelopmentIngestContext(context);
    return this.authorizer.assertCanIngest({
      actorUserId: context.actorUserId,
      tenantId: context.tenantId,
      roles: [...context.roles],
      action: 'DOCUMENT_INGEST',
      selection,
      ...(context.runtimeIngestAuthority
        ? {
            runtimeIngestAuthority: structuredClone(
              context.runtimeIngestAuthority,
            ),
          }
        : {}),
    });
  }

  async getDocumentVersion(
    documentVersionId: string,
    context: HostedRequestContext,
  ) {
    assertProductionMiaodaBrowserIdentityAvailable(hostedIdentity(context));
    await this.authorizer.assertCanRead({
      ...context,
      action: 'DOCUMENT_READ',
      documentVersionId,
    });
    const version = await this.catalog.readDocumentVersion(documentVersionId);
    if (!version) {
      throw Object.assign(
        new Error(`DocumentVersion not found: ${documentVersionId}`),
        {
          code: 'DOCUMENT_VERSION_NOT_FOUND',
          statusCode: 404,
        },
      );
    }
    const family = await this.catalog.readFamily(version.familyId);
    return { version, family };
  }

  async enrichDocumentMetadata(documentVersionId: string, context: HostedRequestContext) {
    assertProductionMiaodaBrowserIdentityAvailable(hostedIdentity(context));
    await this.authorizer.assertCanRead({ ...context, action: 'DOCUMENT_READ', documentVersionId });
    const row = await this.catalog.readMetadataSource(documentVersionId, context.tenantId);
    if (!row) throw Object.assign(new Error('Document metadata source is unavailable.'), { code: 'DOCUMENT_VERSION_NOT_FOUND', statusCode: 404 });
    if (row.metadata?.extractedMetadata) return { documentVersionId, disposition: 'ALREADY_PRESENT', extractedMetadata: row.metadata?.extractedMetadata };
    const selected = await this.readRegisteredOriginal(row);
    const view = controlledPdfByteView(selected.bytes);
    const layout = new PdfjsDistLayoutExtractor().extractLayoutWithDiagnostics(view.bytes);
    readActualPdfPageCount({ layout, actualSha256: selected.sha256, actualByteLength: selected.byteLength,
      inspectionSha256: createHash('sha256').update(view.bytes).digest('hex'), inspectionByteLength: view.bytes.byteLength });
    const extractedMetadata = extractActualPdfMetadata({ layout, actualSha256: selected.sha256, actualByteLength: selected.byteLength,
      identity: { documentFamily: row.family.documentFamily, issuer: row.family.issuerAuthority } });
    // Recheck visibility after the source read and before inserting the derived record.
    await this.authorizer.assertCanRead({ ...context, action: 'DOCUMENT_READ', documentVersionId });
    const result = await this.catalog.fillMissingExtractedMetadata({ documentVersionId, sourceSha256: selected.sha256,
      sourceByteLength: selected.byteLength, extractedMetadata });
    return { documentVersionId, disposition: result.disposition, extractedMetadata: result.extractedMetadata };
  }

  private async readRegisteredOriginal(row: NonNullable<Awaited<ReturnType<MiaodaHostedDocumentCatalog['readMetadataSource']>>>) {
    const selected = await this.artifactStore.readSelection({ bucketId: row.source.bucketId, filePath: row.source.filePath });
    if (selected.sha256 !== row.version.pdfSha256 || selected.byteLength !== row.version.byteLength ||
      selected.sha256 !== row.source.sha256 || selected.byteLength !== row.source.byteLength ||
      selected.providerObjectId !== row.source.providerObjectId || selected.providerVersionId !== row.source.providerVersionId) {
      throw Object.assign(new Error('Registered original PDF no longer matches its source identity.'), { code: 'DOCUMENT_METADATA_SOURCE_MISMATCH', statusCode: 409 });
    }
    return selected;
  }

  async readDocumentOriginal(documentVersionId: string, context: HostedRequestContext) {
    assertProductionMiaodaBrowserIdentityAvailable(hostedIdentity(context));
    await this.authorizer.assertCanRead({ ...context, action: 'DOCUMENT_READ', documentVersionId });
    const row = await this.catalog.readMetadataSource(documentVersionId, context.tenantId);
    if (!row) throw Object.assign(new Error('Document original is unavailable.'), { code: 'DOCUMENT_VERSION_NOT_FOUND', statusCode: 404 });
    const selected = await this.readRegisteredOriginal(row);
    await this.authorizer.assertCanRead({ ...context, action: 'DOCUMENT_READ', documentVersionId });
    return { bytes: selected.bytes, filename: row.version.originalFilename };
  }

  async listCurrentReferenceTargets(
    canonicalDocumentNumbers: readonly string[],
    context: HostedRequestContext,
  ): Promise<HostedCurrentReferenceTarget[]> {
    assertProductionMiaodaBrowserIdentityAvailable(hostedIdentity(context));
    const lookupKeys = new Set(
      canonicalDocumentNumbers.map(canonicalDocumentNumberLookupKey),
    );
    const documents = await this.catalog.listIngressDocuments({
      tenantId: context.tenantId,
    });
    return documents
      .filter(
        (document) =>
          document.versionStatus === 'CANONICAL_CURRENT' &&
          lookupKeys.has(
            canonicalDocumentNumberLookupKey(document.detail.documentCode),
          ),
      )
      .map((document) => ({
        familyId: document.familyId,
        documentVersionId: document.documentVersionId,
        canonicalDocumentNumber: document.detail.documentCode,
        documentFamily: document.detail.documentFamily,
        issuerAuthority: document.detail.issuerAuthority,
      }));
  }
}

function canonicalDocumentNumberLookupKey(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/gu, '');
}

function hostedIdentity(context: HostedRequestContext) {
  return {
    userId: context.actorUserId,
    tenantId: context.tenantId,
    appId: context.appId,
    env: context.env,
  };
}

function assertDevelopmentIngestContext(context: HostedRequestContext): void {
  // @lark-apaas/fullstack-nestjs-core derives env and roles from the hosted
  // gateway user context. Preview stays available for development. The real
  // online runtime additionally requires the server-only authority minted by
  // the OAuth-session development-run path after its dual-actor checks. The
  // authorizer then rechecks the owned default-bucket DEV path.
  if (
    context.env === 'preview' ||
    (context.env === 'runtime' &&
      context.appId === CANONICAL_MIAODA_APP_ID &&
      context.roles.includes(CANONICAL_DEVELOPMENT_ROLE_ID) &&
      hasOauthSessionDevelopmentRunAuthority(context))
  ) {
    return;
  }
  throw Object.assign(
    new Error('Document ingestion requires a hosted development context.'),
    {
      code: 'DOCUMENT_INGEST_PREVIEW_REQUIRED',
      statusCode: 403,
    },
  );
}

function assertReviewAttachmentIngestContext(
  context: HostedRequestContext,
): void {
  const authority = context.runtimeIngestAuthority;
  if (
    ['preview', 'runtime'].includes(context.env) &&
    context.appId === CANONICAL_MIAODA_APP_ID &&
    authority?.mode === 'HOSTED_OAUTH_SESSION_REVIEW_ATTACHMENT' &&
    authority.actorUserId === context.actorUserId &&
    authority.tenantId === context.tenantId &&
    authority.appId === context.appId &&
    authority.identityProvenance === 'FEISHU_OAUTH_USER_ACCESS_TOKEN' &&
    authority.sessionProvenance === 'SERVER_OPAQUE_SESSION' &&
    Boolean(authority.workItemId?.trim()) &&
    Number.isSafeInteger(authority.expectedRevision) &&
    Number(authority.expectedRevision) >= 0 &&
    Boolean(authority.authorizationFingerprint?.trim())
  ) {
    return;
  }
  throw Object.assign(
    new Error('Review attachment ingestion requires a verified OAuth session.'),
    {
      code: 'REVIEW_ATTACHMENT_INGEST_AUTHORITY_REQUIRED',
      statusCode: 403,
    },
  );
}

function hasOauthSessionDevelopmentRunAuthority(
  context: HostedRequestContext,
): boolean {
  const authority = context.runtimeIngestAuthority;
  return Boolean(
    authority &&
    authority.mode === 'HOSTED_OAUTH_SESSION_DEVELOPMENT_RUN' &&
    authority.actorUserId === context.actorUserId &&
    authority.tenantId === context.tenantId &&
    authority.appId === context.appId &&
    authority.identityProvenance === 'FEISHU_OAUTH_USER_ACCESS_TOKEN' &&
    authority.sessionProvenance === 'SERVER_OPAQUE_SESSION',
  );
}

function documentLibraryUploadInput(request: unknown): DocumentLibraryUploadRequest {
  const fail = (): never => { throw Object.assign(new Error('Document upload requires only requestId and an owned FileService selection.'), { code: 'DOCUMENT_UPLOAD_INPUT_INVALID', statusCode: 400 }); };
  if (!request || typeof request !== 'object' || Array.isArray(request)) return fail();
  const input = request as Record<string, unknown>;
  if (Object.keys(input).some(key => !['requestId','selection'].includes(key)) || typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,96}$/u.test(input.requestId)) return fail();
  if (!input.selection || typeof input.selection !== 'object' || Array.isArray(input.selection)) return fail();
  const selection = input.selection as Record<string, unknown>;
  if (Object.keys(selection).some(key => !['bucketId','filePath'].includes(key)) || typeof selection.bucketId !== 'string' || !selection.bucketId.trim() || typeof selection.filePath !== 'string' || !selection.filePath.trim()) return fail();
  return { requestId: input.requestId, selection: { bucketId: selection.bucketId, filePath: selection.filePath } };
}

function documentUploadResponse(receipt: Record<string, unknown>): DocumentUploadResponse {
  const review = receipt.disposition === 'REVIEW_REQUIRED';
  if (typeof receipt.disposition !== 'string' || typeof receipt.decision !== 'string' || typeof receipt.preflightId !== 'string' ||
      (!review && typeof receipt.documentVersionId !== 'string')) {
    throw Object.assign(new Error('Document upload receipt is incomplete.'), { code: 'DOCUMENT_UPLOAD_RECEIPT_INVALID', statusCode: 502 });
  }
  let historicalImport: DocumentUploadResponse['historicalImport'] = null;
  if (review && receipt.decision === 'ASK_IMPORT_OLDER_REVISION') {
    const value = receipt.historicalImport as Record<string, unknown> | undefined;
    if (!value || typeof value.preflightId !== 'string' || !Number.isSafeInteger(value.expectedCurrentGeneration) ||
        Number(value.expectedCurrentGeneration) < 1 || typeof value.expectedCurrentDocumentVersionId !== 'string') {
      throw Object.assign(new Error('Historical import confirmation is unavailable.'), { code: 'DOCUMENT_UPLOAD_RECEIPT_INVALID', statusCode: 502 });
    }
    historicalImport = { preflightId: value.preflightId, expectedCurrentGeneration: Number(value.expectedCurrentGeneration), expectedCurrentDocumentVersionId: value.expectedCurrentDocumentVersionId };
  }
  return {
    identity: documentUploadIdentity(receipt.identityReadback), currentVersion: null,
    status: review ? 'REVIEW_REQUIRED' : 'COMMITTED', disposition: receipt.disposition, decision: receipt.decision,
    preflightId: receipt.preflightId, documentVersionId: typeof receipt.documentVersionId === 'string' ? receipt.documentVersionId : null,
    familyId: typeof receipt.familyId === 'string' ? receipt.familyId : null,
    newDocumentVersionCreated: receipt.newDocumentVersionCreated === true, currentnessChanged: receipt.currentnessChanged === true,
    reason: typeof receipt.reason === 'string' ? receipt.reason : null, historicalImport,
  };
}

function documentUploadIdentity(value: unknown): DocumentUploadResponse['identity'] {
  if (!value || typeof value !== 'object') return null;
  const identity = value as Record<string, unknown>;
  const text = (key: string): string => typeof identity[key] === 'string' ? identity[key] : '';
  return { documentNumber: text('documentNumber'), documentFamily: text('documentFamily'), issuerAuthority: text('issuerAuthority') || null,
    businessRevision: text('businessRevision'), revisionDate: text('revisionDate'), sourceGeneratedDate: text('sourceGeneratedDate'),
    pageCount: Number.isSafeInteger(identity.pageCount) ? Number(identity.pageCount) : null };
}
