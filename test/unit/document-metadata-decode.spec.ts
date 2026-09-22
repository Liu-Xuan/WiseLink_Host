import type {
  DocumentExtractedMetadata,
  DocumentMetadataField,
} from '@shared/api.interface';
import {
  decodeExtractedMetadata,
  decodeExtractedMetadataTitle,
} from '../../server/modules/document-management/src/hosted/nest/document-metadata-decode';

function field(value: string): DocumentMetadataField {
  return {
    status: 'PENDING_REVIEW',
    observations: [
      {
        value,
        status: 'PENDING_REVIEW',
        evidence: [{ page: 1, text: value }],
      },
    ],
  };
}

function validMetadata(): DocumentExtractedMetadata {
  return {
    schemaVersion: 'wiselink.document_metadata.v1',
    source: 'ACTUAL_PDF_TEXT',
    sourceSha256: 'a'.repeat(64),
    sourceByteLength: 128,
    pageCount: 1,
    inspectedPages: [1],
    extractedAt: '2026-09-21T00:00:00.000Z',
    title: field('Wiring change'),
    documentType: field('SB'),
    issuer: field('BOEING'),
    ata: field('34'),
    mentionedAircraftModels: field('737'),
    aircraftModelSemantics: 'DOCUMENT_MENTION_ONLY',
    applicabilityAssessment: 'NOT_EVALUATED',
  };
}

function expectShapeRejected(operation: () => unknown): void {
  let thrown: unknown;
  try {
    operation();
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toMatchObject({
    code: 'DOCUMENT_METADATA_SHAPE_INVALID',
    statusCode: 500,
  });
}

describe('document metadata decode boundary', () => {
  it('returns the complete declared metadata shape only after every field is verified', () => {
    const metadata = validMetadata();
    expect(decodeExtractedMetadata(metadata)).toBe(metadata);
  });

  it('keeps NOT_FOUND with empty observations as a legal field state', () => {
    const metadata = {
      ...validMetadata(),
      ata: { status: 'NOT_FOUND' as const, observations: [] },
    };
    expect(decodeExtractedMetadata(metadata).ata).toEqual({
      status: 'NOT_FOUND',
      observations: [],
    });
  });

  it('validates only the consumed title field for status display', () => {
    const corruptOtherField: unknown = {
      ...validMetadata(),
      ata: { status: 'NOT_FOUND', observations: 'broken' },
    };
    expect(decodeExtractedMetadataTitle(corruptOtherField)).toEqual(
      field('Wiring change'),
    );
    expectShapeRejected(() => decodeExtractedMetadata(corruptOtherField));
  });

  const invalidCases: Array<[string, unknown]> = [
    ['null', null],
    ['array', []],
    [
      'wrong schema version',
      { ...validMetadata(), schemaVersion: 'wiselink.document_metadata.v0' },
    ],
    ['wrong source', { ...validMetadata(), source: 'MODEL_OUTPUT' }],
    ['source hash is not a string', { ...validMetadata(), sourceSha256: 1 }],
    [
      'source byte length is not numeric',
      { ...validMetadata(), sourceByteLength: '128' },
    ],
    ['page count is not numeric', { ...validMetadata(), pageCount: '1' }],
    [
      'inspected pages contain a non-number',
      { ...validMetadata(), inspectedPages: [1, '2'] },
    ],
    ['extracted timestamp is not a string', { ...validMetadata(), extractedAt: 1 }],
    ['title is not a field object', { ...validMetadata(), title: {} }],
    [
      'title observations are not an array',
      {
        ...validMetadata(),
        title: { status: 'PENDING_REVIEW', observations: 'broken' },
      },
    ],
    [
      'title observation value is not a string',
      {
        ...validMetadata(),
        title: {
          status: 'PENDING_REVIEW',
          observations: [
            {
              value: 1,
              status: 'PENDING_REVIEW',
              evidence: [{ page: 1, text: 'Wiring' }],
            },
          ],
        },
      },
    ],
    [
      'title evidence is not an array',
      {
        ...validMetadata(),
        title: {
          status: 'PENDING_REVIEW',
          observations: [
            { value: 'Wiring', status: 'PENDING_REVIEW', evidence: 'broken' },
          ],
        },
      },
    ],
    [
      'evidence text is not a string',
      {
        ...validMetadata(),
        issuer: {
          status: 'PENDING_REVIEW',
          observations: [
            {
              value: 'BOEING',
              status: 'PENDING_REVIEW',
              evidence: [{ page: 1, text: 1 }],
            },
          ],
        },
      },
    ],
    [
      'document type has an invalid status',
      {
        ...validMetadata(),
        documentType: { status: 'UNKNOWN', observations: [] },
      },
    ],
    ['issuer is null', { ...validMetadata(), issuer: null }],
    ['ata is missing', { ...validMetadata(), ata: undefined }],
    [
      'aircraft model semantics is not mention-only',
      { ...validMetadata(), aircraftModelSemantics: 'FLEET_CONCLUSION' },
    ],
    [
      'applicability assessment is not unevaluated',
      { ...validMetadata(), applicabilityAssessment: 'EVALUATED' },
    ],
  ];

  it.each(invalidCases)('rejects %s', (_label: string, value: unknown) => {
    expectShapeRejected(() => decodeExtractedMetadata(value));
  });
});
