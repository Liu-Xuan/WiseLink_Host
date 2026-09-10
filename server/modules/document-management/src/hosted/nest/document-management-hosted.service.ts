import type { DocumentMetadataReadRequest, DocumentMetadataReadResponse, DocumentMetadataReextractRequest, DocumentMetadataReextractResponse } from '@shared/api.interface';
import { mintDocumentUploadAuthority } from './document-upload-authority';
import type { DocumentLibraryUploadRequest, DocumentUploadResponse } from '@shared/api.interface';
import type { DocumentUploadAuthority } from './document-upload-authority';
import { createHash } from 'node:crypto';
import { PdfjsDistLayoutExtractor } from '../../../../professional-input/parser/pdfjs-dist-layout-extractor.adapter';
import { controlledPdfByteView, readActualPdfPageCount } from '../../migrated/ingress/pdfDocumentIdentityOwner.js';
import { extractActualPdfMetadata } from '../../migrated/ingress/pdfDocumentMetadata.js';
import { HttpException, Inject, Injectable, Optional } from '@nestjs/common';
import { EngineeringMatterService } from '../../../../canonical-host/engineering-matter.service';
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
    @Optional() private readonly matters?: EngineeringMatterService,
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
    return publicDmOperation(async () => {
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
    });
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
    if (response.status === 'COMMITTED' && response.documentVersionId) {
      try {
        if (!this.matters) throw new Error('MATTER_MATERIAL_RUNTIME_UNAVAILABLE');
        const organized = await this.matters.organizeDocumentIntake({
          tenantId: context.tenantId, actorUserId: context.actorUserId, documentVersionId: response.documentVersionId,
        });
        response.matterId = organized.matterId;
      } catch (cause: unknown) {
        throw new HttpException({ code: 'DOCUMENT_SAVED_MATTER_PENDING',
          message: '文件已保存，事项归集尚未完成。请用原上传请求重试。' }, 503, { cause });
      }
    }
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
    return publicDmOperation(async () => {
      assertProductionMiaodaBrowserIdentityAvailable(hostedIdentity(context));
      await this.authorizer.assertCanRead({ ...context, action: 'DOCUMENT_READ', documentVersionId });
      const row = await this.catalog.readMetadataSource(documentVersionId, context.tenantId);
      if (!row) throw Object.assign(new Error('Document metadata source is unavailable.'), { code: 'DOCUMENT_VERSION_NOT_FOUND', statusCode: 404 });
      if (row.metadata?.extractedMetadata) return { ...metadataReceipt(documentVersionId, row.metadata), disposition: 'ALREADY_PRESENT' as const };
      const selected = await this.readRegisteredOriginal(row);
      const extractedMetadata = this.extractRegisteredMetadata(row, selected);
      // Recheck visibility after the source read and before inserting the derived record.
      await this.authorizer.assertCanRead({ ...context, action: 'DOCUMENT_READ', documentVersionId });
      const result = await this.catalog.fillMissingExtractedMetadata({ documentVersionId, sourceSha256: selected.sha256,
        sourceByteLength: selected.byteLength, extractedMetadata });
      return { documentVersionId, ...result };
    });
  }

  async readDocumentMetadata(documentVersionId: string, request: unknown, context: HostedRequestContext): Promise<DocumentMetadataReadResponse> {
    return publicDmOperation(async () => {
      assertProductionMiaodaBrowserIdentityAvailable(hostedIdentity(context));
      await this.authorizer.assertCanRead({ ...context, action: 'DOCUMENT_READ', documentVersionId });
      const query = metadataReadQuery(request);
      const row = await this.catalog.readMetadataSource(documentVersionId, context.tenantId);
      if (!row) throw Object.assign(new Error('Document metadata source is unavailable.'), { code: 'DOCUMENT_VERSION_NOT_FOUND', statusCode: 404 });
      const metadata = query.revision !== undefined || query.requestId !== undefined
        ? await this.catalog.readExtractedMetadata({ documentVersionId, ...query }) : row.metadata;
      return metadataReceipt(documentVersionId, metadata);
    });
  }

  async reextractDocumentMetadata(documentVersionId: string, request: unknown, context: HostedRequestContext): Promise<DocumentMetadataReextractResponse> {
    return publicDmOperation(async () => {
      assertProductionMiaodaBrowserIdentityAvailable(hostedIdentity(context));
      await this.authorizer.assertCanRead({ ...context, action: 'DOCUMENT_READ', documentVersionId });
      const input = metadataReextractRequest(request);
      const row = await this.catalog.readMetadataSource(documentVersionId, context.tenantId);
      if (!row) throw Object.assign(new Error('Document metadata source is unavailable.'), { code: 'DOCUMENT_VERSION_NOT_FOUND', statusCode: 404 });
      const replay = await this.catalog.readExtractedMetadata({ documentVersionId, requestId: input.requestId });
      if (replay) {
        if (replay.metadataRevision - 1 !== input.expectedMetadataRevision) {
          throw Object.assign(new Error('Metadata request ID was already used with another expected revision.'), { code: 'DOCUMENT_METADATA_REQUEST_CONFLICT', statusCode: 409 });
        }
        return { documentVersionId, metadataId: replay.id, metadataRevision: replay.metadataRevision, requestId: input.requestId,
          extractedMetadata: replay.extractedMetadata, disposition: 'IDEMPOTENT_REPLAY' };
      }
      if (!row.metadata || row.metadata.metadataRevision !== input.expectedMetadataRevision) {
        throw Object.assign(new Error('Metadata revision changed; read the latest extraction before retrying.'), { code: 'DOCUMENT_METADATA_REVISION_CONFLICT', statusCode: 409 });
      }
      const selected = await this.readRegisteredOriginal(row);
      const extractedMetadata = this.extractRegisteredMetadata(row, selected);
      await this.authorizer.assertCanRead({ ...context, action: 'DOCUMENT_READ', documentVersionId });
      const result = await this.catalog.appendExtractedMetadata({ documentVersionId, ...input,
        sourceSha256: selected.sha256, sourceByteLength: selected.byteLength, extractedMetadata });
      return { documentVersionId, metadataId: result.metadata.id, metadataRevision: result.metadata.metadataRevision,
        requestId: input.requestId, extractedMetadata: result.metadata.extractedMetadata, disposition: result.disposition };
    });
  }

  private extractRegisteredMetadata(
    row: NonNullable<Awaited<ReturnType<MiaodaHostedDocumentCatalog['readMetadataSource']>>>,
    selected: Awaited<ReturnType<MiaodaFileServiceArtifactStore['readSelection']>>,
  ) {
    const view = controlledPdfByteView(selected.bytes);
    const layout = new PdfjsDistLayoutExtractor().extractLayoutWithDiagnostics(view.bytes);
    readActualPdfPageCount({ layout, actualSha256: selected.sha256, actualByteLength: selected.byteLength,
      inspectionSha256: createHash('sha256').update(view.bytes).digest('hex'), inspectionByteLength: view.bytes.byteLength });
    const extractedMetadata = extractActualPdfMetadata({ layout, actualSha256: selected.sha256, actualByteLength: selected.byteLength,
      identity: { documentFamily: row.family.documentFamily, issuer: row.family.issuerAuthority } });
    return extractedMetadata;
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
    return publicDmOperation(async () => {
      assertProductionMiaodaBrowserIdentityAvailable(hostedIdentity(context));
      await this.authorizer.assertCanRead({ ...context, action: 'DOCUMENT_READ', documentVersionId });
      const row = await this.catalog.readMetadataSource(documentVersionId, context.tenantId);
      if (!row) throw Object.assign(new Error('Document original is unavailable.'), { code: 'DOCUMENT_VERSION_NOT_FOUND', statusCode: 404 });
      const selected = await this.readRegisteredOriginal(row);
      await this.authorizer.assertCanRead({ ...context, action: 'DOCUMENT_READ', documentVersionId });
      return { bytes: selected.bytes, filename: row.version.originalFilename };
    });
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

const PUBLIC_DM_REJECTIONS: Readonly<Record<string, { status: number; message: string }>> = {
  CATALOG_EXACT_DOCUMENT_IDENTITY_CONFLICT: { status: 409, message: '文件与已有版本的出版身份记录不一致，请核对已有文档。' },
  SAME_REVISION_CONTENT_CONFLICT: { status: 409, message: '相同修订已存在不同文件内容，请核对原件。' },
  CURRENTNESS_CAS_CONFLICT: { status: 409, message: '文档当前版本已变化，请刷新后重试。' },
  FAMILY_CREATE_CONFLICT: { status: 409, message: '文档已被另一请求登记，请刷新资料库。' },
  FAMILY_IDENTITY_CONFLICT: { status: 409, message: '出版身份与已有文档不一致。' },
  HOSTED_INGEST_INPUT_INVALID: { status: 400, message: '上传请求缺少必要信息。' },
  DOCUMENT_UPLOAD_INPUT_INVALID: { status: 400, message: '上传请求格式不正确。' },
  IDENTITY_NOT_COMMITTABLE: { status: 422, message: '原文尚不足以确认可登记的出版身份与修订。' },
  INVALID_PDF_INPUT: { status: 422, message: '所选文件不是可读取的 PDF。' },
  DM_PDF_TEXT_IDENTITY_UNAVAILABLE: { status: 422, message: 'PDF 原文文本不足以识别出版身份。' },
  DM_PDF_FAMILY_UNRESOLVED: { status: 422, message: '暂不能从 PDF 原文识别文档类型。' },
  DM_PDF_FAMILY_IDENTITY_NOT_ACTIVATED: { status: 422, message: '当前尚未支持此文档类型的出版身份提取。' },
  DM_PDF_IDENTITY_UNRESOLVED: { status: 422, message: '暂不能从 PDF 原文确认出版身份。' },
  DM_PDF_FAMILY_IDENTITY_CONFLICT: { status: 409, message: 'PDF 原文中出现相互冲突的出版身份。' },
  SELECTION_ACTUAL_BYTE_MISMATCH: { status: 409, message: '所选文件内容与上传凭据不一致。' },
  DOCUMENT_METADATA_REQUEST_INVALID: { status: 400, message: '元数据修订号或请求标识无效。' },
  DOCUMENT_METADATA_REQUEST_CONFLICT: { status: 409, message: '该请求标识已用于不同的元数据修订，请核对已有回执。' },
  DOCUMENT_METADATA_REVISION_CONFLICT: { status: 409, message: '元数据修订已变化，请读取最新结果后重新发起。' },
  DOCUMENT_METADATA_SOURCE_MISMATCH: { status: 409, message: '原件与已登记文档版本不一致，本次未保存元数据。' },
  DOCUMENT_METADATA_FILL_CONFLICT: { status: 409, message: '元数据来源核对未通过，本次未保存。' },
  DOCUMENT_VERSION_NOT_FOUND: { status: 404, message: '文档版本不存在或当前用户无权访问。' },
  DOCUMENT_ACTION_FORBIDDEN: { status: 403, message: '当前用户无权执行此文档操作。' },
};

async function publicDmOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : '';
    const rejection = PUBLIC_DM_REJECTIONS[code];
    if (!rejection) throw error;
    // Only the bounded public code and message enter the HTTP response.
    throw Object.assign(new HttpException({ code, message: rejection.message }, rejection.status), { code });
  }
}

function metadataReceipt(documentVersionId: string, metadata: Awaited<ReturnType<MiaodaHostedDocumentCatalog['readExtractedMetadata']>>): DocumentMetadataReadResponse {
  return { documentVersionId, metadataId: metadata?.id ?? null, metadataRevision: metadata?.metadataRevision ?? null,
    requestId: metadata?.requestId ?? null, extractedMetadata: metadata?.extractedMetadata ?? null };
}

function invalidMetadataRequest(): never {
  throw Object.assign(new Error('Metadata revision or request ID is invalid.'), { code: 'DOCUMENT_METADATA_REQUEST_INVALID', statusCode: 400 });
}

function validMetadataRequestId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) invalidMetadataRequest();
  return value;
}

function metadataReextractRequest(value: unknown): DocumentMetadataReextractRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidMetadataRequest();
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['expectedMetadataRevision', 'requestId'].includes(key))) invalidMetadataRequest();
  if (typeof input.expectedMetadataRevision !== 'number' || !Number.isSafeInteger(input.expectedMetadataRevision) || input.expectedMetadataRevision < 1 || input.expectedMetadataRevision >= 2147483647) invalidMetadataRequest();
  return { expectedMetadataRevision: input.expectedMetadataRevision, requestId: validMetadataRequestId(input.requestId) };
}

function metadataReadQuery(value: unknown): DocumentMetadataReadRequest {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidMetadataRequest();
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['revision', 'requestId'].includes(key))) invalidMetadataRequest();
  if (input.revision !== undefined && input.requestId !== undefined) invalidMetadataRequest();
  if (input.requestId !== undefined) return { requestId: validMetadataRequestId(input.requestId) };
  if (input.revision === undefined) return {};
  if (typeof input.revision !== 'number' && (typeof input.revision !== 'string' || !/^[1-9][0-9]*$/u.test(input.revision))) invalidMetadataRequest();
  const revision = Number(input.revision);
  if (!Number.isSafeInteger(revision) || revision < 1 || revision > 2147483647) invalidMetadataRequest();
  return { revision };
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
