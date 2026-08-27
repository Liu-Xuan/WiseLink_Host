import { assertNoDuplicateJsonKeys } from '../unified-reader/unified-reader.utils';

export interface ReviewAttachmentParsedArtifact {
  schemaVersion: 'wiselink.3_1.review_attachment_parse.v1.c7';
  attachmentRef: string;
  workItemId: string;
  reviewConversationId: string;
  documentVersionId: string;
  fileName: string;
  mediaType: 'application/pdf';
  byteLength: number;
  pageCount: number;
  pages: Array<{ page: number; text: string }>;
}

export function encodeReviewAttachmentParsedArtifact(
  value: ReviewAttachmentParsedArtifact,
): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

export function parseReviewAttachmentParsedArtifact(
  bytes: Uint8Array,
): ReviewAttachmentParsedArtifact {
  let raw: unknown;
  try {
    const text: string = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes,
    );
    assertNoDuplicateJsonKeys(text);
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error('REVIEW_ATTACHMENT_PARSE_ARTIFACT_INVALID');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('REVIEW_ATTACHMENT_PARSE_ARTIFACT_INVALID');
  }
  const value: Record<string, unknown> = raw as Record<string, unknown>;
  const expectedKeys: string[] = [
    'attachmentRef',
    'byteLength',
    'documentVersionId',
    'fileName',
    'mediaType',
    'pageCount',
    'pages',
    'reviewConversationId',
    'schemaVersion',
    'workItemId',
  ];
  if (
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify(expectedKeys.sort()) ||
    value.schemaVersion !== 'wiselink.3_1.review_attachment_parse.v1.c7' ||
    value.mediaType !== 'application/pdf' ||
    !requiredText(value.attachmentRef) ||
    !requiredText(value.workItemId) ||
    !requiredText(value.reviewConversationId) ||
    !requiredText(value.documentVersionId) ||
    !requiredText(value.fileName) ||
    !positiveInteger(value.byteLength) ||
    !positiveInteger(value.pageCount) ||
    !Array.isArray(value.pages) ||
    value.pages.length !== value.pageCount
  ) {
    throw new Error('REVIEW_ATTACHMENT_PARSE_ARTIFACT_INVALID');
  }
  for (let index: number = 0; index < value.pages.length; index += 1) {
    const page: unknown = value.pages[index];
    if (!page || typeof page !== 'object' || Array.isArray(page)) {
      throw new Error('REVIEW_ATTACHMENT_PARSE_ARTIFACT_INVALID');
    }
    const record: Record<string, unknown> = page as Record<string, unknown>;
    if (
      JSON.stringify(Object.keys(record).sort()) !==
        JSON.stringify(['page', 'text']) ||
      record.page !== index + 1 ||
      typeof record.text !== 'string'
    ) {
      throw new Error('REVIEW_ATTACHMENT_PARSE_ARTIFACT_INVALID');
    }
  }
  return structuredClone(value) as unknown as ReviewAttachmentParsedArtifact;
}

export function reviewAttachmentEvidenceStatement(
  value: ReviewAttachmentParsedArtifact,
): string {
  const statement: string = value.pages
    .map((page) => `[page ${page.page}] ${page.text.trim()}`)
    .filter((page) => !page.endsWith('] '))
    .join('\n');
  if (!statement) {
    throw new Error('REVIEW_ATTACHMENT_TEXT_REQUIRED');
  }
  return statement;
}

function requiredText(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}
