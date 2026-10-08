import { canonicalJson, canonicalSha256, validateExecutionModelSelection } from './validate-payload.mjs';

export const DERIVED_SUMMARY_TASK_SCHEMA = 'wiselink.derived-summary-task.v1';
export const DERIVED_SUMMARY_TASK_TYPE = 'OPENCLAW_DERIVED_SUMMARY';
export const DERIVED_SUMMARY_OPERATIONS = [
  'CLAIM', 'STATUS', 'HEARTBEAT', 'CANCEL', 'READ_MEMBER_WORK',
  'READ_SOURCES', 'SAVE_SUMMARY', 'READ_SAVED_SUMMARY', 'FINISH', 'FAIL',
];

const fail = code => { throw new Error(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const texts = value => Array.isArray(value) && value.every(text);

export function assertSummaryExactKeys(value, required, code) {
  if (!object(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...required].sort())) fail(code);
}

export function validateDerivedSummaryMember(value) {
  const common = ['kind'];
  const fields = value?.kind === 'WORK_ITEM_WORK'
    ? ['workItemId', 'documentVersionId', 'workRef', 'workRevision', 'issueKeys']
    : value?.kind === 'MATTER_WORK' ? ['matterId', 'workRef', 'workRevision', 'issueKeys']
      : value?.kind === 'DERIVED_SUMMARY' ? ['summaryId', 'summaryRef', 'summaryRevision'] : null;
  if (!fields) fail('DERIVED_SUMMARY_MEMBER_KIND_INVALID');
  assertSummaryExactKeys(value, [...common, ...fields], 'DERIVED_SUMMARY_MEMBER_IDENTITY_INVALID');
  for (const field of fields) {
    if (field === 'issueKeys') {
      if (!texts(value[field]) || new Set(value[field]).size !== value[field].length)
        fail('DERIVED_SUMMARY_MEMBER_ISSUES_INVALID');
    } else if (field.endsWith('Revision')) {
      if (!integer(value[field]) || value[field] === 0) fail('DERIVED_SUMMARY_MEMBER_REVISION_INVALID');
    } else if (!text(value[field])) fail('DERIVED_SUMMARY_MEMBER_IDENTITY_INVALID');
  }
  return value;
}

export function validateDerivedSummaryModelInput(value) {
  assertSummaryExactKeys(value, ['scope', 'classificationStatus', 'instruction', 'members', 'evidence', 'limitations'],
    'DERIVED_SUMMARY_MODEL_INPUT_INVALID');
  const scope = value.scope;
  assertSummaryExactKeys(scope, ['kind', 'title', 'fleetFamilyId', 'fleetModelIds', 'ata2', 'ata4', 'selectionReason'],
    'DERIVED_SUMMARY_SCOPE_INVALID');
  if (!['ATA4', 'ATA2', 'FLEET'].includes(scope.kind) || !text(scope.title) || !text(scope.fleetFamilyId) ||
      !texts(scope.fleetModelIds) || !text(scope.selectionReason) ||
      ![scope.ata2, scope.ata4].every(item => item === null || text(item)) ||
      (scope.kind === 'ATA4' && (!text(scope.ata2) || !text(scope.ata4))) ||
      (scope.kind === 'ATA2' && !text(scope.ata2)) || value.classificationStatus !== 'CANDIDATE' ||
      typeof value.instruction !== 'string' || !texts(value.limitations) ||
      !Array.isArray(value.members) || !value.members.length || !Array.isArray(value.evidence))
    fail('DERIVED_SUMMARY_MODEL_INPUT_INVALID');
  const memberRefs = new Set();
  const identities = new Set();
  for (const reading of value.members) {
    validateDerivedSummaryReading(reading);
    const identity = canonicalJson(reading.member);
    if (memberRefs.has(reading.evidenceRef) || identities.has(identity)) fail('DERIVED_SUMMARY_MEMBER_DUPLICATE');
    memberRefs.add(reading.evidenceRef); identities.add(identity);
  }
  derivedSummaryRegistry(value);
  return value;
}

export function validateDerivedSummaryReading(reading) {
  assertSummaryExactKeys(reading, ['member', 'evidenceRef', 'headline', 'body', 'issues', 'evidence', 'rootRefs',
    'limitations', 'current', 'overviewStatus', 'leaves',
    ...(Object.hasOwn(reading ?? {}, 'understanding') ? ['understanding'] : [])], 'DERIVED_SUMMARY_MEMBER_READING_INVALID');
  validateDerivedSummaryMember(reading.member);
  if (!text(reading.evidenceRef) || typeof reading.headline !== 'string' || !text(reading.body) ||
      !Array.isArray(reading.issues) || !Array.isArray(reading.evidence) || !texts(reading.rootRefs) ||
      !texts(reading.limitations) || typeof reading.current !== 'boolean' ||
      !['CURRENT', 'STALE', 'NOT_AVAILABLE'].includes(reading.overviewStatus) || !Array.isArray(reading.leaves))
    fail('DERIVED_SUMMARY_MEMBER_READING_INVALID');
  if (Object.hasOwn(reading, 'understanding') &&
      (reading.member.kind === 'DERIVED_SUMMARY' || typeof reading.understanding !== 'string' ||
       reading.body !== completeDerivedSummaryWorkBody(reading.understanding, reading.issues)))
    fail('DERIVED_SUMMARY_MEMBER_READING_INVALID');
  reading.leaves.forEach(validateDerivedSummaryMember);
  return reading;
}

/** Host completeBody separators and issue order, with no parsing or inferred text. */
export function completeDerivedSummaryWorkBody(understanding, issues) {
  if (typeof understanding !== 'string' || !Array.isArray(issues) || issues.some(issue =>
      typeof issue?.issueKey !== 'string' || typeof issue.question !== 'string' || typeof issue.body !== 'string'))
    fail('DERIVED_SUMMARY_MEMBER_READING_INVALID');
  return `${understanding}\n\n${issues.map(issue => `问题 ${issue.issueKey}：${issue.question}\n${issue.body}`).join('\n\n')}`;
}

/** Mirrors shared DerivedSummaryTask; runtime controls never enter the model view. */
export function validateDerivedSummaryTask(task, target) {
  if (!object(task) || task.schemaVersion !== DERIVED_SUMMARY_TASK_SCHEMA || task.taskType !== DERIVED_SUMMARY_TASK_TYPE ||
      !integer(task.expectedSummaryRevision) || !text(task.requestId) ||
      task.subject?.kind !== 'DERIVED_SUMMARY' || task.subject.summaryId !== target.summaryId ||
      Object.keys(task.subject).length !== 2 || task.operationRef !== target.attemptRef ||
      !text(task.actionAttemptId) || !text(task.taskInputHash) || !Number.isFinite(Date.parse(task.deadlineAt)) ||
      Object.hasOwn(task, 'workItemId') || Object.hasOwn(task, 'matterId'))
    fail('DERIVED_SUMMARY_CLAIM_BINDING_MISMATCH');
  const { taskInputHash, ...taskBasis } = task;
  if (canonicalSha256(taskBasis) !== taskInputHash) fail('DERIVED_SUMMARY_CLAIM_BINDING_MISMATCH');
  validateExecutionModelSelection(task.executionModel);
  validateDerivedSummaryModelInput(task.modelInput);
  return task;
}

/** No constructed page handles or model-supplied bodies expand this registry. */
export function derivedSummaryRegistry(modelInput) {
  const members = new Map(modelInput.members.map(reading => [reading.evidenceRef, reading]));
  const evidence = new Map();
  for (const item of [...modelInput.evidence, ...modelInput.members.flatMap(reading => reading.evidence)]) {
    if (!object(item) || !text(item.evidenceRef)) fail('DERIVED_SUMMARY_EVIDENCE_INVALID');
    const previous = evidence.get(item.evidenceRef);
    if (previous && canonicalJson(previous) !== canonicalJson(item)) fail('DERIVED_SUMMARY_EVIDENCE_IDENTITY_DRIFT');
    evidence.set(item.evidenceRef, item);
  }
  if ([...members.keys()].some(ref => evidence.has(ref))) fail('DERIVED_SUMMARY_REF_KIND_COLLISION');
  return { members, evidence };
}

export function validateDerivedSummaryReadSelection(intent, registry, operation) {
  assertSummaryExactKeys(intent, ['action', 'evidenceRefs', 'purpose'], 'DERIVED_SUMMARY_READ_INTENT_INVALID');
  const allowed = operation === 'READ_MEMBER_WORK' ? registry.members : registry.evidence;
  if (intent.action !== operation || !texts(intent.evidenceRefs) || !intent.evidenceRefs.length ||
      new Set(intent.evidenceRefs).size !== intent.evidenceRefs.length || !text(intent.purpose) ||
      intent.evidenceRefs.some(ref => !allowed.has(ref))) fail('DERIVED_SUMMARY_SOURCE_NOT_REGISTERED');
  return intent;
}

export function validateDerivedSummaryContent(content, modelInput) {
  assertSummaryExactKeys(content, ['headline', 'listBrief', 'body', 'limitations'], 'DERIVED_SUMMARY_CONTENT_INVALID');
  if (![content.headline, content.listBrief, content.body].every(text) || !texts(content.limitations) ||
      content.headline.length > 240 || content.listBrief.length > 2000 || content.body.length > 1_000_000 ||
      content.limitations.some(item => item.length > 4000))
    fail('DERIVED_SUMMARY_CONTENT_INVALID');
  const registry = derivedSummaryRegistry(modelInput);
  const bodyRefs = [...content.body.matchAll(/\[\[([^\]]+)\]\]/gu)].map(match => match[1]);
  const refs = [...`${content.headline}\n${content.listBrief}\n${content.body}\n${content.limitations.join('\n')}`.matchAll(/\[\[([^\]]+)\]\]/gu)].map(match => match[1]);
  // Match Host save: the body needs registered support, not a forced member citation.
  // Direct member use remains a separate coverage fact in the saved revision.
  if (!bodyRefs.length || refs.some(ref => !registry.members.has(ref) && !registry.evidence.has(ref)))
    fail('DERIVED_SUMMARY_CITATION_NOT_REGISTERED');
  return content;
}

export function derivedSummaryStepTool() {
  const contentText = maxLength => ({ type: 'string', minLength: 1, maxLength, pattern: '\\S' });
  const read = action => ({ type: 'object', additionalProperties: false, required: ['action', 'evidenceRefs', 'purpose'],
    properties: { action: { type: 'string', enum: [action] },
      evidenceRefs: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', minLength: 1 } },
      purpose: { type: 'string', minLength: 1 } } });
  return { type: 'function', function: { name: 'return_wiselink_summary_step',
    description: 'Serialize one exact source read or the complete candidate summary. The driver executes authorized reads and saves.',
    parameters: { type: 'object', additionalProperties: false, required: ['step'], properties: { step: { oneOf: [
      read('READ_MEMBER_WORK'), read('READ_SOURCES'),
      { type: 'object', additionalProperties: false, required: ['action', 'content'], properties: {
        action: { type: 'string', enum: ['SAVE_SUMMARY'] }, content: {
          type: 'object', additionalProperties: false, required: ['headline', 'listBrief', 'body', 'limitations'],
          description: 'The complete candidate. Use exact registered [[ref]] citations in body.',
          properties: { headline: contentText(240), listBrief: contentText(2000), body: contentText(1_000_000),
            limitations: { type: 'array', minItems: 0, items: contentText(4000) } },
        },
      } },
    ] } } } } };
}

/** Producer fields are captured by the driver, never emitted by the model. */
export function validateDerivedSummaryProvenance(value, executionModel) {
  assertSummaryExactKeys(value, ['configuredModelRef', 'actualModel', 'promptVersion', 'skillVersion', 'toolVersions'],
    'DERIVED_SUMMARY_PROVENANCE_INVALID');
  if (value.configuredModelRef !== executionModel.modelRef ||
      !(value.actualModel === null || text(value.actualModel)) || !text(value.promptVersion) ||
      !text(value.skillVersion) || !object(value.toolVersions) || !Object.keys(value.toolVersions).length ||
      Object.values(value.toolVersions).some(item => !text(item))) fail('DERIVED_SUMMARY_PROVENANCE_INVALID');
  return value;
}

/** Match Host parseSummaryContent followed by the task-limitations union. */
export function normalizeDerivedSummaryContent(content, modelInput) {
  validateDerivedSummaryContent(content, modelInput);
  return { headline: content.headline.trim(), listBrief: content.listBrief.trim(), body: content.body.trim(),
    limitations: [...new Set([...modelInput.limitations, ...content.limitations.map(item => item.trim())])] };
}

export function materializeDerivedSummaryContent(content, modelInput) {
  validateDerivedSummaryContent(content, modelInput);
  // Assemble the original complete candidate, then apply Host's save order.
  // This is also stable when an inherited task limitation needs text trimming.
  return normalizeDerivedSummaryContent({ ...content,
    limitations: [...new Set([...modelInput.limitations, ...content.limitations])] }, modelInput);
}

/** Operation schemas are the actual Host discriminated union, rather than a
 * flattened permissive object. Validate mandatory fences and strict branches. */
export function validateDerivedSummaryToolMetadata(tool) {
  const failMetadata = () => fail('REVIEW_HOST_MCP_DERIVED_SUMMARY_SCHEMA_MISMATCH');
  const branches = tool?.inputSchema?.oneOf;
  if (!Array.isArray(branches) || branches.length !== DERIVED_SUMMARY_OPERATIONS.length ||
      tool.annotations?.readOnlyHint !== false || tool.annotations?.destructiveHint !== false ||
      tool.annotations?.idempotentHint !== true || tool.annotations?.openWorldHint !== false) failMetadata();
  const seen = new Set();
  for (const branch of branches) {
    const operation = branch.properties?.operation?.const;
    if (!DERIVED_SUMMARY_OPERATIONS.includes(operation) || seen.has(operation)) failMetadata();
    seen.add(operation);
    const fields = ['summaryId', 'attemptRef', 'operation'];
    if (['HEARTBEAT', 'FAIL', 'READ_MEMBER_WORK', 'READ_SOURCES', 'SAVE_SUMMARY', 'FINISH'].includes(operation))
      fields.push('leaseToken', 'leaseGeneration');
    if (operation === 'CANCEL') fields.push('reason');
    if (operation === 'FAIL') fields.push('code', 'message');
    if (['READ_MEMBER_WORK', 'READ_SOURCES'].includes(operation)) fields.push('evidenceRefs', 'purpose');
    if (['SAVE_SUMMARY', 'READ_SAVED_SUMMARY', 'FINISH'].includes(operation)) fields.push('requestId');
    if (operation === 'SAVE_SUMMARY') fields.push('expectedSummaryRevision', 'contentJson');
    const properties = operation === 'SAVE_SUMMARY' ? [...fields, 'provenanceJson'] : fields;
    if (branch.type !== 'object' || branch.additionalProperties !== false ||
        canonicalJson(Object.keys(branch.properties ?? {}).sort()) !== canonicalJson([...properties].sort()) ||
        canonicalJson([...(branch.required ?? [])].sort()) !== canonicalJson([...fields].sort()) ||
        branch.properties.operation.type !== 'string') failMetadata();
    for (const field of properties.filter(item => item !== 'operation')) {
      const property = branch.properties[field];
      if (field === 'leaseGeneration' || field === 'expectedSummaryRevision') {
        if (property.type !== 'integer' || (field === 'leaseGeneration' ? property.exclusiveMinimum !== 0 : property.minimum !== 0)) failMetadata();
      } else if (field === 'evidenceRefs') {
        if (property.type !== 'array' || property.minItems !== 1 || property.items?.type !== 'string' ||
            property.items.minLength !== 1 || property.items.maxLength !== 1024) failMetadata();
      } else {
        if (property.type !== 'string') failMetadata();
        if (field === 'summaryId' && (property.maxLength !== 96 || property.pattern !== '^DS-.*')) failMetadata();
        if (field === 'attemptRef' && (property.minLength !== 1 || property.maxLength !== 128)) failMetadata();
        if (field === 'leaseToken' && property.format !== 'uuid') failMetadata();
        if (field === 'requestId' && (property.minLength !== 1 || property.maxLength !== 96)) failMetadata();
        if (['purpose', 'reason', 'message'].includes(field) && (property.minLength !== 1 || property.maxLength !== 4000)) failMetadata();
        if (field === 'code' && (property.minLength !== 1 || property.maxLength !== 160)) failMetadata();
        if (field === 'contentJson' && (property.minLength !== 2 || property.maxLength !== 1000000)) failMetadata();
        if (field === 'provenanceJson' && (property.minLength !== 2 || property.maxLength !== 16000)) failMetadata();
      }
    }
  }
}
