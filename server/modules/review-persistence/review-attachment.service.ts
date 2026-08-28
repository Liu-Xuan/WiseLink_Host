import { FileService } from '@lark-apaas/fullstack-nestjs-core';
import { Injectable, Optional } from '@nestjs/common';

import { DocumentManagementHostedService } from '../document-management/src/hosted/nest';
import { MiaodaFileServiceArtifactStore } from '../document-management/src/hosted/miaodaFileServiceArtifactStore.js';
import { PdfjsDistLayoutExtractor } from '../professional-input/parser/pdfjs-dist-layout-extractor.adapter';
import type { ParsedPdfTextRun } from '../professional-input/pure/professional-input-pure.types';
import { MiaodaOrdinaryArtifactStoreAdapter } from '../unified-reader/miaoda-ordinary-artifact-store.adapter';
import type { ResolvedSession } from '../identity/session-resolver.service';
import type { CanonicalObjectAccessGrant } from '../work-item/canonical-object-access.port';
import { MiaodaDocumentVersionSourceResolver } from '../work-item/miaoda-document-version-source.resolver';
import type { PersistedReviewConversation } from './review-conversation.repository';
import {
  encodeReviewAttachmentParsedArtifact,
  type ReviewAttachmentParsedArtifact,
} from './review-attachment-artifact';
import type { ReviewAttachmentBinding } from './review-attachment.types';

@Injectable()
export class ReviewAttachmentService {
  private readonly selectedFiles: MiaodaFileServiceArtifactStore;
  private readonly parsedArtifacts: MiaodaOrdinaryArtifactStoreAdapter;
  private readonly extractor: PdfjsDistLayoutExtractor;

  constructor(
    fileService: FileService,
    private readonly documentManagement: DocumentManagementHostedService,
    private readonly documentVersions: MiaodaDocumentVersionSourceResolver,
    @Optional() extractor?: PdfjsDistLayoutExtractor,
  ) {
    this.selectedFiles = new MiaodaFileServiceArtifactStore(fileService);
    this.parsedArtifacts = new MiaodaOrdinaryArtifactStoreAdapter(fileService);
    this.extractor = extractor ?? new PdfjsDistLayoutExtractor();
  }

  async ingest(input: {
    selection: { bucketId: string; filePath: string };
    requestId: string;
    conversation: PersistedReviewConversation;
    session: ResolvedSession;
    grant: CanonicalObjectAccessGrant;
  }): Promise<ReviewAttachmentBinding> {
    assertAttachmentAuthority(input);
    const attachmentRef: string = [
      'ATTACHMENT',
      input.conversation.reviewConversationId,
      input.requestId,
    ].join(':');
    const ingested: unknown =
      await this.documentManagement.ingestReviewAttachmentSelection(
        {
          selection: structuredClone(input.selection),
          sourceChannel: 'canonical_review_attachment_selection',
          sourceRef: attachmentRef,
          idempotencyKey: [
            'review-attachment',
            input.conversation.reviewConversationId,
            input.requestId,
          ].join(':'),
          descriptor: {
            documentFamily: 'OEM_REFERENCE',
            sourceKind: 'canonical_review_attachment_selection',
          },
        },
        {
          actorUserId: input.grant.actorUserId,
          tenantId: input.grant.tenantId,
          roles: [...input.session.actor.platformRoles],
          appId: input.session.actor.applicationScopeId,
          env: input.session.actor.env,
          runtimeIngestAuthority: {
            mode: 'HOSTED_OAUTH_SESSION_REVIEW_ATTACHMENT',
            actorUserId: input.grant.actorUserId,
            tenantId: input.grant.tenantId,
            appId: input.session.actor.applicationScopeId,
            identityProvenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
            sessionProvenance: 'SERVER_OPAQUE_SESSION',
            workItemId: input.grant.workItemId,
            expectedRevision: input.grant.workItemRevision,
            authorizationFingerprint: input.grant.authorizationFingerprint,
          },
        },
      );
    const documentVersionId: string = requiredResultText(
      ingested,
      'documentVersionId',
      'REVIEW_ATTACHMENT_DOCUMENT_VERSION_REQUIRED',
    );
    const source = await this.documentVersions.resolve(documentVersionId, {
      expectedCreatorUserId: input.grant.actorUserId,
    });
    const selected = await this.selectedFiles.readSelection({
      bucketId: source.artifact.bucketId,
      filePath: source.artifact.filePath,
    });
    if (
      selected.sha256 !== source.artifact.sha256 ||
      selected.byteLength !== Number(source.artifact.byteLength) ||
      selected.byteLength !== Number(source.version.byteLength)
    ) {
      throw new Error('REVIEW_ATTACHMENT_DM_ACTUAL_BYTES_MISMATCH');
    }
    const layout = this.extractor.extractLayout(selected.bytes);
    const parsed: ReviewAttachmentParsedArtifact = {
      schemaVersion: 'wiselink.3_1.review_attachment_parse.v1.c7',
      attachmentRef,
      workItemId: input.grant.workItemId,
      reviewConversationId: input.conversation.reviewConversationId,
      documentVersionId,
      fileName: source.version.originalFilename,
      mediaType: 'application/pdf',
      byteLength: selected.byteLength,
      pageCount: layout.pageCount,
      pages: parsedPages(layout.pageCount, [...layout.textRuns]),
    };
    const persisted = await this.parsedArtifacts.persistAndReadback(
      encodeReviewAttachmentParsedArtifact(parsed),
    );
    return {
      attachmentRef,
      documentVersionId,
      fileName: parsed.fileName,
      mediaType: 'application/pdf',
      byteLength: parsed.byteLength,
      selectionKey: `${input.selection.bucketId}\n${input.selection.filePath}`,
      parsedArtifact: persisted.artifact,
    };
  }
}

function assertAttachmentAuthority(input: {
  conversation: PersistedReviewConversation;
  session: ResolvedSession;
  grant: CanonicalObjectAccessGrant;
}): void {
  const actor = input.session.actor;
  if (
    input.grant.action !== 'INGEST_ATTACHMENT_SINGLE_REQUEST' ||
    input.grant.workItemId !== input.conversation.workItemId ||
    input.grant.tenantId !== input.conversation.tenantId ||
    input.grant.actorUserId !== input.conversation.actorId ||
    actor.canonicalSubject.id !== input.grant.actorUserId ||
    actor.tenantId !== input.grant.tenantId ||
    actor.identityProvenance !== 'FEISHU_OAUTH_USER_ACCESS_TOKEN' ||
    actor.sessionProvenance !== 'SERVER_OPAQUE_SESSION'
  ) {
    throw reviewAttachmentNotFound();
  }
}

function parsedPages(
  pageCount: number,
  textRuns: ParsedPdfTextRun[],
): Array<{ page: number; text: string }> {
  const texts: string[][] = Array.from(
    { length: pageCount },
    (): string[] => [],
  );
  for (const run of textRuns) {
    const text: string = run.text.trim();
    if (run.page >= 1 && run.page <= pageCount && text) {
      texts[run.page - 1]!.push(text);
    }
  }
  return texts.map((values: string[], index: number) => ({
    page: index + 1,
    text: values.join(' '),
  }));
}

function requiredResultText(value: unknown, key: string, code: string): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(code);
  }
  const selected: unknown = (value as Record<string, unknown>)[key];
  if (typeof selected !== 'string' || !selected.trim()) {
    throw new Error(code);
  }
  return selected;
}

function reviewAttachmentNotFound(): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error('Review attachment was not found.'), {
    code: 'REVIEW_ATTACHMENT_NOT_FOUND',
    statusCode: 404,
  });
}
