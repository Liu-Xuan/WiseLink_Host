export const CANONICAL_HOST = {
  requestSchemaVersion:
    'wiselink.3_1.canonical_pdf_vertical_request.v0.candidate',
  responseSchemaVersion:
    'wiselink.3_1.canonical_pdf_vertical_response.v0.candidate',
  workItemSchemaVersion:
    'wiselink.3_1.canonical_work_item_projection.v0.candidate',
  entrySchemaVersion: 'wiselink.3_1.canonical_entry_facade.v0.candidate',
  entryQuerySchemaVersion: 'wiselink.3_1.canonical_entry_query.v0.candidate',
  documentParsingPageSchemaVersion:
    'wiselink.3_1.document_parsing_page.v0.candidate',
} as const;

export const CANONICAL_WORK_ITEM_REGISTRAR = Symbol(
  'CANONICAL_WORK_ITEM_REGISTRAR',
);
export const CANONICAL_PDF_PRODUCER = Symbol('CANONICAL_PDF_PRODUCER');
export const CANONICAL_HOST_BINDING = Symbol('CANONICAL_HOST_BINDING');
export const CANONICAL_AUTHORIZATION = Symbol('CANONICAL_AUTHORIZATION');
export const CANONICAL_PERMISSION_SNAPSHOT = Symbol(
  'CANONICAL_PERMISSION_SNAPSHOT',
);
export const CANONICAL_MIAODA_APP_BINDING = Symbol(
  'CANONICAL_MIAODA_APP_BINDING',
);
export const CANONICAL_HOST_CLOCK = Symbol('CANONICAL_HOST_CLOCK');
export const CANONICAL_FAILURE_VALIDATION_WRITE_AUTHORIZATION = Symbol(
  'CANONICAL_FAILURE_VALIDATION_WRITE_AUTHORIZATION',
);
