import type {
  DocumentExtractedMetadata,
  DocumentMetadataField,
  DocumentMetadataObservation,
} from '@shared/api.interface';

function invalidMetadataShape(): never {
  throw Object.assign(
    new Error('Archived document metadata shape is invalid.'),
    {
      code: 'DOCUMENT_METADATA_SHAPE_INVALID',
      statusCode: 500,
    },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEvidence(
  value: unknown,
): value is DocumentMetadataObservation['evidence'][number] {
  return (
    isRecord(value) &&
    typeof value.page === 'number' &&
    Number.isFinite(value.page) &&
    typeof value.text === 'string'
  );
}

function isObservation(value: unknown): value is DocumentMetadataObservation {
  return (
    isRecord(value) &&
    typeof value.value === 'string' &&
    value.status === 'PENDING_REVIEW' &&
    Array.isArray(value.evidence) &&
    value.evidence.every((evidence: unknown) => isEvidence(evidence))
  );
}

function isMetadataField(value: unknown): value is DocumentMetadataField {
  return (
    isRecord(value) &&
    (value.status === 'PENDING_REVIEW' || value.status === 'NOT_FOUND') &&
    Array.isArray(value.observations) &&
    value.observations.every((observation: unknown) =>
      isObservation(observation),
    )
  );
}

function isNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item: unknown) =>
        typeof item === 'number' && Number.isFinite(item),
    )
  );
}

function isExtractedMetadata(
  value: unknown,
): value is DocumentExtractedMetadata {
  return (
    isRecord(value) &&
    value.schemaVersion === 'wiselink.document_metadata.v1' &&
    value.source === 'ACTUAL_PDF_TEXT' &&
    typeof value.sourceSha256 === 'string' &&
    typeof value.sourceByteLength === 'number' &&
    Number.isFinite(value.sourceByteLength) &&
    typeof value.pageCount === 'number' &&
    Number.isFinite(value.pageCount) &&
    isNumberArray(value.inspectedPages) &&
    typeof value.extractedAt === 'string' &&
    isMetadataField(value.title) &&
    isMetadataField(value.documentType) &&
    isMetadataField(value.issuer) &&
    isMetadataField(value.ata) &&
    isMetadataField(value.mentionedAircraftModels) &&
    value.aircraftModelSemantics === 'DOCUMENT_MENTION_ONLY' &&
    value.applicabilityAssessment === 'NOT_EVALUATED'
  );
}

export function decodeExtractedMetadata(
  value: unknown,
): DocumentExtractedMetadata {
  if (!isExtractedMetadata(value)) invalidMetadataShape();
  return value;
}

export function decodeExtractedMetadataTitle(
  value: unknown,
): DocumentMetadataField {
  if (!isRecord(value) || !isMetadataField(value.title)) {
    invalidMetadataShape();
  }
  return value.title;
}
