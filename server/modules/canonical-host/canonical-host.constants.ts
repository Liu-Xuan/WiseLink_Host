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
export const SCOPED_PROFESSIONAL_ARTIFACT_CORRELATION = Symbol(
  'SCOPED_PROFESSIONAL_ARTIFACT_CORRELATION',
);
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
export const CANONICAL_BASE_RULE_RESULT_PROVIDER = Symbol(
  'CANONICAL_BASE_RULE_RESULT_PROVIDER',
);
export const CANONICAL_OPENCLAW_OVERALL_PROVIDER = Symbol(
  'CANONICAL_OPENCLAW_OVERALL_PROVIDER',
);
export const CANONICAL_TRANSLATION_OWNER_OBSERVATION = Symbol(
  'CANONICAL_TRANSLATION_OWNER_OBSERVATION',
);

export const CANONICAL_MIAODA_APP_ID = 'app_17bzc551rsg';

/**
 * Entrance/provenance only. This is the single Aily agent currently allowed
 * to reach the Host read-only MCP transport. It is never an Actor or ACL
 * input: the final-user Actor may derive only from a future official native
 * platform handoff; no custom identity header is accepted.
 * `user_id` + `tenant_id` after the official AuthNPaasService
 * Feishu user_id -> Miaoda userId mapping. No agent -> spring app mapping is
 * asserted or relied on. The earlier `agent_4krmu8apqgdky` entrance is
 * abandoned and must stay absent from active assumptions.
 */
export const CANONICAL_AILY_AGENT_ID = 'agent_4km47c77ujwqphg';

// Verified with platform role-list/role-get for app_17bzc551rsg.
// This role is limited to controlled development WorkItem creation/S1 flows;
// it is never an object-read bypass.
export const CANONICAL_DEVELOPMENT_ROLE_ID = 'wiselink_development';
