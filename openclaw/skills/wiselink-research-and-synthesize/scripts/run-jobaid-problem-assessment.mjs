import { assertTdmsNativeInput, assertTdmsNativeReadPacket } from './tdms-native-context.mjs';
import { jobAidWorkTypeErrors, JOBAID_STEP_SHAPE, decodeJobAidValue, jobAidFunctionSchema } from './jobaid-work-shape.mjs';
import { createJobAidEvidenceCache, cacheJobAidSourceRead, cacheJobAidKnowledgeReceipt, projectJobAidContinuationContext,
  projectJobAidTargetWork, mergeJobAidTargetWork, refreshJobAidPreparation } from './jobaid-continuation-context.mjs';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  actualModelVersion,
  assertHostedModelGatewayReady,
  executionModelHeaders,
  isFunctionResponseContentSupported,
  parseStrictJsonObject,
  summarizeHostedReviewModelOutputShape,
} from './run-hosted-review-turn.mjs';
import {
  WISELINK_HOST_MCP_NAME,
  validateSourceStatementRecord,
  validateSourceStatementContext,
  WISELINK_HOST_MCP_VERSION,
  WISELINK_PROFILE_REF,
  WISELINK_SKILL_VERSION,
} from './validate-payload.mjs';
import { classifyHostedAssessmentProtocol, classifyHostedGatewayFailure, hostedGatewayTransportFailureDiagnostic,
  requestHostedGateway } from './request-hosted-gateway.mjs';

export const JOBAID_PROBLEM_TASK_SCHEMA = 'wiselink.jobaid-problem-task.v2';
export const JOBAID_PROBLEM_SOURCE_STATEMENT_TASK_SCHEMA = 'wiselink.jobaid-problem-task.v3';
export const isJobAidProblemInputSchema = schema => [JOBAID_PROBLEM_TASK_SCHEMA, JOBAID_PROBLEM_SOURCE_STATEMENT_TASK_SCHEMA].includes(schema);
export const MATTER_JOBAID_TASK_SCHEMA = 'wiselink.matter-jobaid-task.v2';
const FUNCTION = 'return_wiselink_assessment_step';
const INITIAL_JOBAID_SOURCE_REFS_PER_READ = 4;
export const JOBAID_GENERATION_POLICY = Object.freeze({
  version: 'continuous-body-batches-v5', requestMaxCompletionTokens: 16000,
  payloadTargetTokens: [2000, 4000], maxScopeAdjustments: 0,
  basis: 'Application budget; 16000 is an observation on one Hosted M3 request, not a universal model limit.',
});
const M3_PROBE_WORK_ITEM_GENERATION_POLICY = Object.freeze({
  ...JOBAID_GENERATION_POLICY,
  version: 'continuous-body-batches-v6', probeRequestMaxCompletionTokens: 32768,
  basis: 'The M3 Probe WorkItem route ended four native generations ' +
    'at 16000 tokens with length; request 32768 below its registered 131072 model maximum. ' +
    'This does not prove the provider accepts 32768.',
});

// Drop only byte-equivalent repeated metadata within this exact native session.
// Persist the registry with the messages; a new task/session starts with full data.
export function projectJobAidReadReceipt(receipt, registry) {
  if (!Array.isArray(receipt.documents)) return receipt;
  return { ...receipt, documents: receipt.documents.map(document => {
    if (!document.binding?.parseRunId) return document;
    const metadata = { binding: document.binding, semanticMap: document.semanticMap,
      findings: document.findings, coverage: document.coverage };
    const prior = registry.findIndex(item => isDeepStrictEqual(item, metadata));
    if (prior < 0) {
      registry.push(metadata);
      return { ...document, metadataRef: `original-context-${registry.length}` };
    }
    const { semanticMap, findings, coverage, ...range } = document;
    return { ...range, metadataRef: `original-context-${prior + 1}`,
      metadataStatus: 'UNCHANGED_IN_THIS_SESSION',
      semanticBinding: semanticMap ? { semanticRevision: semanticMap.semanticRevision, profileRef: semanticMap.profileRef } : null };
  }) };
}

const { work: _workShape, ...stepProperties } = JOBAID_STEP_SHAPE.properties;
const transportStepShape = {
  ...JOBAID_STEP_SHAPE,
  properties: { ...stepProperties, workJson: { type: 'string', minLength: 2,
    description: 'One complete batch of new or changed issues encoded as JSON text, plus only necessary summary changes. Unchanged issues are retained by Host; supplied issues replace whole issues. Preserve arrays and nulls.' } },
};
const initialStepShape = {
  ...transportStepShape,
  properties: { ...transportStepShape.properties,
    action: { type: 'string', enum: [...transportStepShape.properties.action.enum, 'READ_WORK'] },
    workRevisionRef: { type: 'string', minLength: 1 },
    issueKeys: { type: 'array', items: { type: 'string', minLength: 1 } },
    includeOverview: { type: 'boolean' },
  },
};

export function parseJobAidWorkJson(value) {
  let work;
  try { work = parseStrictJsonObject(value); }
  catch { throw new Error('JOBAID_WORK_JSON_INVALID'); }
  // JSON.parse accepts duplicate keys by discarding earlier values. Reject
  // those before submitting any model-authored material to the Host.
  const tokens = value.match(/"(?:[^"\\]|\\.)*"|[{}\[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/gs);
  let index = 0;
  function visit() {
    const token = tokens[index++];
    if (token === '{') {
      const keys = new Set();
      while (tokens[index] !== '}') {
        const key = JSON.parse(tokens[index++]);
        if (keys.has(key)) throw new Error('JOBAID_WORK_JSON_DUPLICATE_KEY');
        keys.add(key);
        index++; // colon; syntax was already validated
        visit();
        if (tokens[index] === ',') index++;
      }
      index++;
    } else if (token === '[') {
      while (tokens[index] !== ']') {
        visit();
        if (tokens[index] === ',') index++;
      }
      index++;
    }
  }
  visit();
  return work;
}
import { JOBAID_PROBLEM_GUIDANCE as GUIDE, LEGACY_JOBAID_PROBLEM_GUIDANCE as LEGACY_GUIDE,
  SOURCE_CONTENT_SYNTHESIS_PROMPT_REVISION, JOBAID_SEMANTIC_GUIDANCE } from './jobaid-problem-guidance.mjs';

export function validateJobAidProblemInput(input) {
  if (
    !input ||
    ![JOBAID_PROBLEM_TASK_SCHEMA, JOBAID_PROBLEM_SOURCE_STATEMENT_TASK_SCHEMA, MATTER_JOBAID_TASK_SCHEMA].includes(input.schemaVersion) ||
    (input.schemaVersion === MATTER_JOBAID_TASK_SCHEMA
      ? input.subject?.kind !== 'ENGINEERING_MATTER' || !input.subject.matterId || !Array.isArray(input.availableDocuments)
      : !['INITIAL_PROBLEM_ASSESSMENT', 'OVERALL_CONSISTENCY'].includes(
      input.purpose,
    )) ||
    !input.methodBinding?.packRef ||
    !Array.isArray(input.availableSources) ||
    !Array.isArray(input.deliveredEvidence) ||
    !Number.isSafeInteger(input.expectedWorkRevision) ||
    input.expectedWorkRevision < 0
  )
    throw new Error('JOBAID_PROBLEM_INPUT_INVALID');
  if (input.contentValidationVersion !== undefined && input.contentValidationVersion !== 'jobaid-semantic.v1')
    throw new Error('JOBAID_CONTENT_VALIDATION_VERSION_INVALID');
  if(input.schemaVersion===JOBAID_PROBLEM_SOURCE_STATEMENT_TASK_SCHEMA && (input.evidenceProjectionVersion!=='SOURCE_CONTEXT_V2' ||
    !['AVAILABLE','NOT_SAVED','NOT_INDEXED'].includes(input.sourceStatementAvailability?.status) || !['LEGACY_PARTIAL','CAPTURED_FIELDS_ONLY'].includes(input.sourceStatementAvailability?.semanticFieldsAvailability) ||
    !Array.isArray(input.sourceStatementAvailability?.limitations))) throw new Error('JOBAID_SOURCE_STATEMENT_INPUT_INVALID');
  if(input.schemaVersion===JOBAID_PROBLEM_TASK_SCHEMA && (input.evidenceProjectionVersion==='SOURCE_CONTEXT_V2'||input.sourceStatementAvailability!==undefined||input.sourceStatements!==undefined||input.activityContexts!==undefined||input.availableSources.some(row=>row.sourceStatement!==undefined)||input.deliveredEvidence.some(row=>row.sourceStatement!==undefined))) throw new Error('JOBAID_SOURCE_STATEMENT_VERSION_INVALID');
  assertTdmsNativeInput(input);
  const refs = input.availableSources.map((source) => source.ref);
  if (
    new Set(refs).size !== refs.length ||
    refs.some((ref) => typeof ref !== 'string' || !ref) ||
    input.deliveredEvidence.some((item) => !refs.includes(item.evidenceRef))
  )
    throw new Error('JOBAID_PROBLEM_SOURCE_CATALOG_INVALID');
  if(input.schemaVersion===JOBAID_PROBLEM_SOURCE_STATEMENT_TASK_SCHEMA) {
    if(input.sourceStatements!==undefined||input.activityContexts!==undefined||input.deliveredEvidence.some(e=>e.sourceStatement||e.evidenceRef?.startsWith('DOCUMENT_ACTIVITY:'))) throw new Error('JOBAID_SOURCE_STATEMENT_DIRECTORY_ONLY_REQUIRED');
    for(const row of input.availableSources) {
      if(!row.sourceStatement) {if(row.ref.startsWith('DOCUMENT_ACTIVITY:'))throw new Error('JOBAID_SOURCE_STATEMENT_DIRECTORY_INVALID');continue;}
      const hint=row.sourceStatement; const reference=hint.reference;
      if(row.kind!=='PRIOR_RESULT'||!reference||!Number.isSafeInteger(reference.candidateRevision)||reference.candidateRevision<1||
        [reference.runRef,reference.statementId].some(v=>typeof v!=='string'||!v||v.includes(':'))||
        row.ref!==`DOCUMENT_ACTIVITY:${reference.runRef}:${reference.candidateRevision}:${reference.statementId}`||
        !((hint.sourceSchemaVersion===undefined&&hint.semanticFieldsAvailability==='LEGACY_PARTIAL'&&hint.scopeBasis==='LEGACY_RUN_SCOPE')||(hint.sourceSchemaVersion==='wiselink.document.activity-candidate.v2'&&hint.semanticFieldsAvailability==='V2_CAPTURED_FIELDS_ONLY'&&hint.scopeBasis==='ACTUAL_DELIVERED_RUN_SCOPE'))||
        (hint.label!==undefined&&(typeof hint.label!=='string'||!hint.label.trim())))throw new Error('JOBAID_SOURCE_STATEMENT_DIRECTORY_INVALID');
    }
  }
  return input;
}

// Keep provenance next to its readable source instead of sending each long
// evidence reference twice. The Host input and its bindings remain untouched.
export function projectJobAidModelInput(input) {
  if (!Array.isArray(input.contextPackage?.sourceOrigins)) return input;
  const sources = new Set(input.availableSources.map((source) => source.ref));
  const origins = new Map();
  const unmatched = [];
  for (const entry of input.contextPackage.sourceOrigins) {
    const { evidenceRef, ...origin } = entry;
    if (!sources.has(evidenceRef)) {
      unmatched.push(entry);
      continue;
    }
    const items = origins.get(evidenceRef) ?? [];
    items.push(origin);
    origins.set(evidenceRef, items);
  }
  const { sourceOrigins: _sourceOrigins, ...contextPackage } = input.contextPackage;
  return {
    ...input,
    availableSources: input.availableSources.map((source) => ({
      ...source,
      ...(origins.has(source.ref) ? { sourceOrigins: origins.get(source.ref) } : {}),
    })),
    contextPackage: {
      ...contextPackage,
      ...(unmatched.length ? { sourceOrigins: unmatched } : {}),
    },
  };
}

/** Keep the Host's full revision; carry short saved issue bodies into each bounded continuation. */
export function projectBoundedInitialJobAidInput(input) {
  const projected = projectJobAidModelInput(input);
  const previous = projected.previousWork;
  if (!previous?.content || !Array.isArray(previous.content.issues)) return projected;
  return {
    ...projected,
    previousWork: {
      ...previous,
      projectionKind: 'HOST_SAVED_ISSUE_INDEX',
      omittedIssueBodiesRetainedByHost: true,
      content: {
        schemaVersion: previous.content.schemaVersion,
        headline: previous.content.headline,
        listBrief: previous.content.listBrief,
        roundCompletion: previous.content.roundCompletion,
        completionReason: previous.content.completionReason,
        readSourceRefs: previous.content.readSourceRefs ?? [],
        issues: previous.content.issues.map(issue => ({
          issueKey: issue.issueKey,
          question: issue.question,
          ...(typeof issue.body === 'string' && issue.body.length <= 4000
            ? { body: issue.body } : {}),
          ...(input.contentValidationVersion === 'jobaid-semantic.v1' ? {
            riskScenarios: structuredClone(issue.riskScenarios ?? []),
            measures: structuredClone(issue.measures ?? []),
            requirementHandling: structuredClone(issue.requirementHandling ?? []),
            otherClassifications: structuredClone(issue.otherClassifications ?? []),
            sourceDependencies: structuredClone(issue.sourceDependencies ?? []),
            premiseRefs: structuredClone(issue.premiseRefs ?? []),
            openQuestions: structuredClone(issue.openQuestions ?? []),
          } : {openQuestions: (issue.openQuestions ?? []).map(item => ({
            question: item.question, nextEvidence: item.nextEvidence,
          }))}),
        })),
      },
    },
  };
}

/** Repair only two observed citation spellings when the Host catalog has one exact match. */
export function canonicalizeKnownJobAidSourceAliases(work, availableSources) {
  const aliases = new Map();
  const register = (alias, exact) => {
    if (!alias || alias === exact) return;
    if (aliases.has(alias) && aliases.get(alias) !== exact) aliases.set(alias, null);
    else if (!aliases.has(alias)) aliases.set(alias, exact);
  };
  for (const { ref } of availableSources) {
    register(`evidenceRef:${ref}`, ref);
    const original = /^(DOCUMENT_ORIGINAL:[^:]+):(PRUN-[A-Za-z0-9-]+):\2:(u\d+:p\d+)$/u.exec(ref);
    if (original) {
      const short = `${original[1]}:${original[2]}:${original[3]}`;
      register(short, ref);
      register(`evidenceRef:${short}`, ref);
    }
  }
  const repaired = new Map();
  const exact = (ref) => {
    const replacement = aliases.get(ref);
    if (!replacement) return ref;
    repaired.set(ref, replacement);
    return replacement;
  };
  const visit = (value, key = '') => {
    if (typeof value === 'string') {
      const withCitations = value.replace(/\[\[([^\[\]\r\n]+)\]\]/gu,
        (whole, ref) => `[[${exact(ref)}]]`);
      return ['basisRefs', 'checkedEvidenceRefs'].includes(key)
        ? exact(withCitations) : withCitations;
    }
    if (Array.isArray(value)) return value.map(item => visit(item, key));
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([field, item]) => [field, visit(item, field)]));
    return value;
  };
  return { work: visit(work), repairs: [...repaired].map(([from, to]) => ({ from, to })) };
}

function projectSavedJobAidWorkContent(content) {
  if (content?.schemaVersion !== 'wiselink.jobaid-problem-work.v3' ||
      !Array.isArray(content.issues))
    throw new Error('JOBAID_WORK_SAVE_READBACK_INVALID');
  return {
    schemaVersion: content.schemaVersion,
    headline: content.headline,
    listBrief: content.listBrief,
    overview: content.understanding ?? content.overview,
    roundCompletion: content.roundCompletion,
    completionReason: content.completionReason,
    changeSummary: content.changeSummary,
    unchangedExplanation: content.unchangedExplanation,
    readSourceRefs: content.readSourceRefs,
    issues: content.issues.map(issue => {
      const { issueRef: _issueRef, sourceDependencies: _sourceDependencies,
        premiseRefs: _premiseRefs, legacyCriterionRefs: _legacyCriterionRefs,
        ...modelIssue } = issue;
      return {
        ...modelIssue,
        riskScenarios: (issue.riskScenarios ?? []).map(({ gradeMeaning: _gradeMeaning, ...risk }) => risk),
      };
    }),
  };
}

function continuationModelInput(input, revision) {
  return {
    ...input,
    expectedWorkRevision: revision.workRevision,
    previousWork: {
      workRevisionRef: revision.workRevisionRef,
      workRevision: revision.workRevision,
      ...(revision.content.overviewStatus ? { overviewStatus: revision.content.overviewStatus } : {}),
      content: projectSavedJobAidWorkContent(revision.content),
    },
  };
}

function sourceBatchPolicyFeedback(code, requestedCount) {
  if (code === 'JOBAID_SOURCE_BATCH_TOO_LARGE') return {
    sourceReadPolicy: {
      maxSourceRefsPerRead: INITIAL_JOBAID_SOURCE_REFS_PER_READ,
      requestedSourceRefCount: requestedCount,
      hostReadExecuted: false,
    },
    instruction: `本次来源请求超过单批上限 ${INITIAL_JOBAID_SOURCE_REFS_PER_READ} 个，Host 未执行任何读取。只选择最相关且能支持一组完整判断的至多 ${INITIAL_JOBAID_SOURCE_REFS_PER_READ} 个引用；不得声称其余来源已核验。`,
  };
  return {};
}

function stepMatchesShape(value, schema) {
  if (value === undefined) return true;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (schema.required ?? []).every(key => Object.hasOwn(value, key)) &&
    Object.keys(value).every(key => Object.hasOwn(schema.properties, key) && stepMatchesShape(value[key], schema.properties[key]));
  if (schema.type === 'array') return Array.isArray(value) && value.every(item => stepMatchesShape(item, schema.items));
  return typeof value === schema.type && (schema.minLength === undefined || value.length >= schema.minLength);
}

function sourceSelectionFeedback(requested, availableSources) {
  const catalog = new Set(availableSources.map(source => source.ref));
  const unregisteredRefs = requested.filter(ref => !catalog.has(ref));
  if (!unregisteredRefs.length) return null;
  const suggestedCatalogRefs = unregisteredRefs.flatMap(ref => {
    const base = ref.replace(/:p\d+$/u, ':p');
    const matches = availableSources.map(source => source.ref)
      .filter(candidate => candidate.startsWith(base) && /:p\d+$/u.test(candidate));
    return matches.length === 1 ? [{ rejectedRef: ref, exactCatalogRef: matches[0] }] : [];
  });
  return { unregisteredRefs, suggestedCatalogRefs };
}

// A model may request more sources than one Host MCP call accepts. Preserve
// the entire intent, while each batch retains the Host's scope and lease checks.
export async function readJobAidSourceBatches(intent, read) {
  const batchSize = 96;
  if (intent.sourceRefs.length <= batchSize) {
    const result=await read(intent);
    assertTdmsNativeReadPacket(result);
    if(result?.schemaVersion==='wiselink.jobaid-source-read.v3') {
      if(result.status!=='AVAILABLE'||result.scope!==intent.context||!Array.isArray(result.sourceRefs)||intent.sourceRefs.some(ref=>!result.sourceRefs.includes(ref)))throw new Error('JOBAID_SOURCE_READ_FAILED:INCOMPLETE_BATCH');
      assertSourceStatementReadPacket(result);
    }
    return result;
  }
  if (new Set(intent.sourceRefs).size !== intent.sourceRefs.length)
    throw new Error('JOBAID_SOURCE_SELECTION_INVALID');
  let first;
  const sourceRefs = new Set();
  const evidence = new Map();
  const statements=new Map(); const activityContexts=new Map(); const nativeReadReceipts=[];
  for (let offset = 0; offset < intent.sourceRefs.length; offset += batchSize) {
    const requested = intent.sourceRefs.slice(offset, offset + batchSize);
    const result = await read({ ...intent, sourceRefs: requested });
    assertTdmsNativeReadPacket(result);
    nativeReadReceipts.push(...(result.nativeReadReceipts ?? []));
    if (result?.status !== 'AVAILABLE' || result.scope !== intent.context ||
      result.completeRequestedScope !== true || !Array.isArray(result.sourceRefs) ||
      !Array.isArray(result.evidence) || requested.some(ref => !result.sourceRefs.includes(ref)))
      throw new Error('JOBAID_SOURCE_READ_FAILED:INCOMPLETE_BATCH');
    if(first && (first.schemaVersion==='wiselink.jobaid-source-read.v3'||result.schemaVersion==='wiselink.jobaid-source-read.v3') && first.schemaVersion!==result.schemaVersion)
      throw new Error('JOBAID_SOURCE_READ_FAILED:INCONSISTENT_VERSION');
    first ??= result;
    if(result.schemaVersion==='wiselink.jobaid-source-read.v3') {
      assertSourceStatementReadPacket(result);
      for(const record of result.sourceStatements) {
        const prior=statements.get(record.ref);
        if(prior&&!isDeepStrictEqual(prior,record)) throw new Error('JOBAID_SOURCE_READ_FAILED:INCONSISTENT_STATEMENT');
        statements.set(record.ref,record);
      }
      for(const context of result.activityContexts) {
        const key=JSON.stringify([context.runRef,context.candidateRevision]); const prior=activityContexts.get(key);
        if(prior&&!isDeepStrictEqual(prior,context)) throw new Error('JOBAID_SOURCE_READ_FAILED:INCONSISTENT_ACTIVITY_CONTEXT');
        activityContexts.set(key,context);
      }
    }
    for (const item of result.evidence) {
      if (!item || typeof item.evidenceRef !== 'string' ||
        (evidence.has(item.evidenceRef) && !isDeepStrictEqual(evidence.get(item.evidenceRef), item)))
        throw new Error('JOBAID_SOURCE_READ_FAILED:INCONSISTENT_EVIDENCE');
      evidence.set(item.evidenceRef, item);
    }
    for (const ref of result.sourceRefs) sourceRefs.add(ref);
  }
  return { ...first, sourceRefs: [...sourceRefs], evidence: [...evidence.values()],
    ...(nativeReadReceipts.length ? {nativeReadReceipts} : {}),
    ...(first.schemaVersion==='wiselink.jobaid-source-read.v3'?{sourceStatements:[...statements.values()],activityContexts:[...activityContexts.values()]}:{}) };
}

/** Completeness is carrier delivery, never proof that source semantics are correct. */
function assertSourceStatementReadPacket(result) {
  const fail=code=>{throw new Error(`JOBAID_SOURCE_READ_FAILED:${code}`);};
  if(!Array.isArray(result.sourceStatements)||!Array.isArray(result.activityContexts)||!Array.isArray(result.sourceRefs)||!Array.isArray(result.evidence)||result.completeRequestedScope!==true)
    fail('INCOMPLETE_STATEMENT');
  const carriers=new Map(result.evidence.map(item=>[item.evidenceRef,item]));
  const records=new Map();const contexts=new Map();
  for(const context of result.activityContexts) {
    try{validateSourceStatementContext(context);}catch{fail('INCOMPLETE_ACTIVITY_CONTEXT');}
    const key=JSON.stringify([context.runRef,context.candidateRevision]);
    if(contexts.has(key))fail('INCONSISTENT_ACTIVITY_CONTEXT');contexts.set(key,context);
  }
  for(const record of result.sourceStatements) {
    try{validateSourceStatementRecord(record);}catch{fail('INCOMPLETE_STATEMENT');}
    const reference=record?.reference; const carrier=carriers.get(record?.ref);
    if(!reference||record.ref!==`DOCUMENT_ACTIVITY:${reference.runRef}:${reference.candidateRevision}:${reference.statementId}`||records.has(record.ref)||
      record.statement?.statementId!==reference.statementId||record.candidateOnly!==true||
      !carrier||carrier.kind!=='PRIOR_RESULT'||!isDeepStrictEqual(carrier.sourceStatement,{reference,sourceBinding:record.sourceBinding})||
      !['wiselink.document.activity-candidate.v1','wiselink.document.activity-candidate.v2'].includes(record.sourceSchemaVersion)||!Array.isArray(record.rootRefs)||!record.rootRefs.length||!Array.isArray(record.requiredContextRootRefs)||!record.requiredContextRootRefs.length||
      [...record.rootRefs,...record.requiredContextRootRefs].some(ref=>!ref.startsWith(`DOCUMENT_ORIGINAL:${record.sourceBinding?.original?.documentVersionId}:${record.sourceBinding?.original?.parseRunId}:`)||carriers.get(ref)?.kind!=='DOCUMENT_PASSAGE')||!contexts.has(JSON.stringify([reference.runRef,reference.candidateRevision]))||
      [record.ref,...record.rootRefs,...record.requiredContextRootRefs].some(ref=>!result.sourceRefs.includes(ref)||!carriers.has(ref)))fail('INCOMPLETE_STATEMENT');
    if(carrier.excerpt!==record.statement.label || typeof carrier.title!=='string'||!carrier.title.trim()||carrier.versionLabel!==record.sourceBinding.original.parseRunId||carrier.locator!==null||
      !isDeepStrictEqual(carrier.sourceContext,{resultRef:reference.runRef,resultRevision:reference.candidateRevision})||!Array.isArray(carrier.originalEvidenceRefs)||
      !isDeepStrictEqual([...carrier.originalEvidenceRefs].sort(),[...new Set([...record.rootRefs,...record.requiredContextRootRefs])].sort()))fail('INCOMPLETE_STATEMENT');
    if(record.sourceSchemaVersion==='wiselink.document.activity-candidate.v2') {
      const context=contexts.get(JSON.stringify([reference.runRef,reference.candidateRevision]))?.sourceContext;
      if(!context||!isDeepStrictEqual(context.sourceBinding,record.sourceBinding)||record.statement.scope.sectionIds.some(id=>!context.sections.some(s=>s.sectionId===id&&s.deliveredUnitIds.length)))fail('INCOMPLETE_SOURCE_CONTEXT');
      for(const condition of record.statement.scope.conditions)if(condition.appliesTo==='SECTION'){
        const unit=record.quoteLocators[condition.quoteIndex]?.sourceUnitId;
        if(condition.sectionIds.some(target=>!context.sections.some(s=>s.deliveredUnitIds.includes(unit)&&(s.sectionId===target||s.contextForSectionIds.includes(target)))))fail('INCOMPLETE_CONDITION_CONTEXT');
      }
    }
    records.set(record.ref,record);
  }
  for(const carrier of result.evidence) {
    if(carrier.kind==='PRIOR_RESULT'&&carrier.sourceStatement&&!records.has(carrier.evidenceRef))fail('INCOMPLETE_STATEMENT');
    if([...records.values()].some(record=>[...record.rootRefs,...record.requiredContextRootRefs].includes(carrier.evidenceRef)) &&
      (typeof carrier.excerpt!=='string'||!carrier.excerpt.trim()||typeof carrier.locator!=='string'||!carrier.locator.trim()))fail('INCOMPLETE_ROOT');
  }
}

/** Read/save intents are executed by existing Host callbacks, never by the model. */
export async function invokeHostedJobAidProblemModel(
  { operation, modelInput },
  options,
  dependencies = {},
) {
  validateJobAidProblemInput(modelInput);
  options = { ...options, executionModel: options.executionModel === undefined
    ? undefined : structuredClone(options.executionModel),
    registeredModelRefs: options.registeredModelRefs ? [...options.registeredModelRefs] : undefined };
  executionModelHeaders(options);
  modelInput = refreshJobAidPreparation(modelInput, modelInput.preparation, options.assessmentBinding);
  const maxCorrections = modelInput.schemaVersion === MATTER_JOBAID_TASK_SCHEMA ? 2 : 4;
  if ((modelInput.schemaVersion === MATTER_JOBAID_TASK_SCHEMA) !== (operation === 'ASSESS_MATTER'))
    throw new Error('JOBAID_PROBLEM_OPERATION_MISMATCH');
  assertHostedModelGatewayReady(options);
  if (
    !['EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL', 'ASSESS_MATTER'].includes(operation) ||
    typeof options.readAssessmentSources !== 'function' ||
    typeof options.saveAssessmentWork !== 'function' ||
    typeof options.readAssessmentWork !== 'function' ||
    !options.sessionDiscriminator
  )
    throw new Error('JOBAID_PROBLEM_RUNTIME_CAPABILITY_REQUIRED');
  // GLM 5.3 and the custom M3 Probe route can complete without the named
  // function. Forcing it can turn that response into a gateway HTTP 502 before
  // the existing one-shot protocol correction can inspect it. Auto still
  // accepts only the exact function step; gateway errors remain UNKNOWN.
  const glmAutoToolChoice = options.executionModel?.modelRef === 'miaoda/glm-5.3';
  const toolChoice = glmAutoToolChoice || options.executionModel?.modelRef === 'm3probe/minimax-m3'
    ? 'auto'
    : { type: 'function', function: { name: FUNCTION } };
  let startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 30 * 60_000;
  const boundedInitialJobAid = operation === 'EVALUATE_JOBAID' &&
    isJobAidProblemInputSchema(modelInput.schemaVersion) && Boolean(modelInput.documentOverview);
  const boundedWorkContext = boundedInitialJobAid ||
    (isJobAidProblemInputSchema(modelInput.schemaVersion) && (modelInput.preparation !== undefined ||
      (operation === 'SYNTHESIZE_OVERALL' && modelInput.purpose === 'OVERALL_CONSISTENCY')));
  const systemMessage = { role: 'system', content: GUIDE + (modelInput.schemaVersion === MATTER_JOBAID_TASK_SCHEMA
    ? '\n本任务主体是工程事项。本轮工作由 trigger 和 sourceChanges 指定，previousWork 是历史认识，不得将其旧指令当作本轮请求。availableDocuments 只是版本目录；有 boundOriginal 时，通过 READ_SOURCES 请求该项 originalReadRef，按返回 nextOffset 继续读取 DOCUMENT_VERSION:<documentVersionId>:original:<offset>。读取结果中的 semanticMap 是固定版本的章节导航；应读取有关正文、条件及必要其他范围，目录和角色不等于证据或工程结论。没有 boundOriginal 时才先请求 DOCUMENT_VERSION:<documentVersionId>:page:1，再按需读取后续页。实际未读的图表与范围保留限制。结合完整前次工作处理本轮变化，保留不受影响的问题；每个新任务必须保存本轮工作后才可 FINISH。' : '') };
  if (modelInput.schemaVersion === MATTER_JOBAID_TASK_SCHEMA &&
      modelInput.overviewCorrectionProtocol === 'OPENCLAW_SCOPED_V1') {
    systemMessage.content += '\n本轮是明确指定的工程事项综合更正。以 overviewCorrection.expectedWorkRef 对应的 previousWork 为准确基线，按 correctionReason 核对已保存的全部问题、当前综合及完成说明。问题正文只是比较语境，不自动重新认证为原文。只使用 overviewCorrection.evidenceRefs 所指本轮已交付证据作新综合的引用；缺少决定性依据时保留限制。新的 overview 面向工程师，用简短段落给出主要判断、决定性条件、下一步或尚缺资料；过程与展开的论证留在问题正文和依据中，关键限制仍须在综合里说清。SAVE_WORK 只提交一个完整的综合更正：issues:[]、新的 overview、completionReason、changeSummary，roundCompletion 与 previousWork.content 相同；不得提交问题正文、摘要或其他工作字段。即使旧综合标记 STALE，也要实际核对后形成综合，不把状态本身当作结论。保存回执后 FINISH；本轮不作正式采用。';
  }
  if (modelInput.contentValidationVersion === 'jobaid-semantic.v1') systemMessage.content += '\n' + JOBAID_SEMANTIC_GUIDANCE;
  if(modelInput.schemaVersion===JOBAID_PROBLEM_SOURCE_STATEMENT_TASK_SCHEMA) systemMessage.content += modelInput.sourceStatementAvailability?.semanticFieldsAvailability==='CAPTURED_FIELDS_ONLY' ? '\nsourceStatement 目录只是已保存解释候选的提示，尚未交付完整声明。使用该精确 ref 前 READ_SOURCES；回执 sourceStatements 保留既有 v1 字段，sourceSchemaVersion 明确区分 v1 与 v2；LEGACY_PARTIAL 表示新版字段未记录，v2 null/空数组只表示本候选未捕获。完整 times[]、否定、技术编号和条件须与引文一并读取，不把 SOURCE_REPORTED_COMPLETED 当作我方实施或有效。必要根原文与 actual readCoverage 不保证全文已读。候选不能证明适用性、执行或效果核验。' : '\nsourceStatement 目录只是已保存解释候选的提示，尚未交付完整声明。使用该精确 ref 前 READ_SOURCES；回执 sourceStatements 保留既有 v1 字段，LEGACY_PARTIAL 表示新版语义未记录，必要根原文与 actual readCoverage 不保证全文已读。候选不能证明适用性、执行或效果核验。';
  if (boundedInitialJobAid) {
    systemMessage.content += `\n本次初始 JobAid 执行按可核验批次推进：每个 READ_SOURCES 动作最多 ${INITIAL_JOBAID_SOURCE_REFS_PER_READ} 个 sourceRefs；可以连续读取有助于当前判断的不同来源或范围，不按读取次数强迫保存。只有形成有意义的认识、修正或完成状态变化时 SAVE_WORK，不提交空的过程日志。READ_SOURCES 的每个 sourceRef 必须逐字复制 availableSources[].ref；不能从 sourceRefId、页码或解析单元编号自行拼接。首次保存工程问题前须取得原文；若当前 deliveredEvidence 已包含该精确原文，直接使用而不重复读取，否则先成功 READ_SOURCES。不能将来源读取失败写成工程结论。previousWork 展示 Host 已保存的问题目录和较短正文；省略的正文仍由 Host 完整保留。readSourceRefs 表示已保存的来源读取记录，不等于本会话已重新取得原文。优先继续未完成的问题和决定性未读来源，不因新会话重读已保存的同一批，也不重写未变问题。每批只提交有新原文支持的改动，保存后读回精确修订。headline 和 listBrief 必须写工程问题、措施、当前判断及关键限制，不能写“本批已读”“u10—u13”或工作修订号等过程日志；过程留在 changeSummary。保存有价值的完整增量时用 IN_PROGRESS 或 COMPLETE_WITH_OPEN_QUESTIONS，并说明尚未完成范围；不要声称未读来源已经核验。必要原文已覆盖、问题已保存时，检查概览与正文一致；如有过期表述，提交 issues:[] 的简短概览修订。方法资料只在影响当前判断时补读，不为凑齐目录而延长执行。完成必要原文覆盖与概览一致性检查后 FINISH；未连接的外部资料列为待确认，不阻止候选阶段结束。`;
    systemMessage.content += '\nREAD_WORK 是本运行器的准确旧工作读取意图：{action:"READ_WORK",workRevisionRef:<previousWork.workRevisionRef>,issueKeys:[准确旧问题键],includeOverview:true|false}。更正已有问题前取得其完整基线；更正或检查综合时读取适用的旧 overview。只选本次需要的目标，不重读全部正文。targetWork 是该准确修订的完整比较材料，previousWork 的省略索引不能作为整项替换基线。deliveredEvidence 与 deliveredSourceReads 保留同一 attempt 已由 Host 实际交付的完整原文与回执语境，当前上下文中每份正文只出现一次；可直接使用其中已交付材料，不因保存换段重新 READ_SOURCES。缓存和 READ_WORK 不证明新来源核验或正式采用。';
  }
  if (boundedWorkContext && !boundedInitialJobAid) systemMessage.content += '\npreparation 是 Host 派生的本轮目标、更正和已保存工作视图，不是新权限。previousWork 是紧凑目录；需要比较被省略的问题正文或综合时，通过 READ_WORK 取得该准确修订的目标完整基线。保留待处理工程师更正、已确认修正与未完成项；不以重读旧工作覆盖本轮更正。连续取得必要证据，不为读取次数提交空 SAVE。Overall 仍需完成一致性检查，只保存有意义的更正。';
  const projectForModel = boundedWorkContext
    ? projectBoundedInitialJobAidInput
    : projectJobAidModelInput;
  const stepShape = boundedWorkContext ? initialStepShape : transportStepShape;
  let evidenceCache = boundedWorkContext ? createJobAidEvidenceCache(modelInput) : null;
  let targetWork = null;
  const modelContext = input => boundedWorkContext
    ? projectJobAidContinuationContext(projectForModel(input), evidenceCache, targetWork)
    : projectForModel(input);
  let messages = [
    systemMessage,
    { role: 'user', content: JSON.stringify(modelContext(modelInput)) },
  ];
  if (options.recoveredSourceContext) systemMessage.content += '\n这是 Host 正常授权的后继任务：旧任务已结束但未交付完整工作载荷。当前 deliveredEvidence 包含 Host 重新授权并保留的已读原文，previousWork 是实际已保存工作。先使用这些完整证据形成本批有价值正文，仅在缺少必要语境时补读；不要为了恢复而重复获取已交付的相同范围。旧任务错误不是工程结论，也不是已保存正文。本次仍须正常 SAVE_WORK 后才能完成。';
  let initialContextMessage = messages[1];
  let sessionModelInput = modelInput;
  let expectedWorkRevision = modelInput.expectedWorkRevision;
  let sessionWorkRevision = modelInput.expectedWorkRevision;
  let savedReadSourceRefs = Array.isArray(modelInput.previousWork?.content?.readSourceRefs)
    ? [...modelInput.previousWork.content.readSourceRefs] : [];
  let nativeSessionSegment = 0;
  // Host accepts a prior attempt's completed work only for Overall consistency.
  // Ordinary reassessment must save under this attempt, even if unchanged.
  const canReusePreviousWork = (operation === 'SYNTHESIZE_OVERALL' && modelInput.purpose === 'OVERALL_CONSISTENCY') ||
    (modelInput.schemaVersion === MATTER_JOBAID_TASK_SCHEMA && options.resumeSavedWork);
  let saved = modelInput.previousWork?.content && canReusePreviousWork
    ? {
        workRevisionRef: modelInput.previousWork.workRevisionRef,
        workRevision: modelInput.previousWork.workRevision,
        roundCompletion: modelInput.previousWork.content.roundCompletion,
      }
    : null;
  let corrections = 0;
  let protocolRepairs = 0;
  let noProgressRepairs = 0;
  let lastObservation = null;
  let inputUnits = 0;
  let outputUnits = 0;
  const checkpoint = options.assessmentCheckpoint;
  const baseGenerationPolicy = isJobAidProblemInputSchema(modelInput.schemaVersion) &&
    options.executionModel?.modelRef === 'm3probe/minimax-m3'
    ? M3_PROBE_WORK_ITEM_GENERATION_POLICY : JOBAID_GENERATION_POLICY;
  const generationPolicy = { ...baseGenerationPolicy, loopPolicyVersion: glmAutoToolChoice
    ? 'stage-protocol-progress-glm53-auto-v2' : 'stage-protocol-progress-v1',
    ...(boundedWorkContext ? { contextProjectionVersion: 'shared-evidence-target-work-v2' } : {}) };
  let scopeAdjustments = 0;
  let sourceMetadata = [];
  let sourceSelectionError = null;
  const persistAssessmentState = (nextRound) => checkpoint?.write('assessment-state', {
    round: nextRound, messages, expectedWorkRevision, saved, corrections, inputUnits, outputUnits,
    scopeAdjustments, sourceMetadata, sessionModelInput, sessionWorkRevision,
    savedReadSourceRefs, nativeSessionSegment, protocolRepairs, noProgressRepairs, lastObservation,
    ...(boundedWorkContext ? { evidenceCache, targetWork } : {}),
  });
  if (checkpoint) {
    const binding = { operation, modelInput, sessionDiscriminator: options.sessionDiscriminator,
      executionModel: options.executionModel ?? null };
    const existing = await checkpoint.readOptional('assessment-enabled');
    if (existing && !isDeepStrictEqual(existing.binding, binding)) throw new Error('JOBAID_CHECKPOINT_BINDING_MISMATCH');
    if (existing) {
      startedAt = existing.startedAt;
      if (!isDeepStrictEqual(existing.generationPolicy, generationPolicy))
        throw new Error('JOBAID_CHECKPOINT_POLICY_CHANGED'); // use a normal successor; never reinterpret an old in-flight request
    } else await checkpoint.writeOnce('assessment-enabled', { version: 1, binding, startedAt, generationPolicy });
  }
  let round = 1;
  const restored = await checkpoint?.readOptional('assessment-state');
  if (restored) {
    const originalSystem = restored.messages?.[0];
    const legacySystem = LEGACY_GUIDE + systemMessage.content.slice(GUIDE.length);
    if (originalSystem?.role !== 'system' ||
        ![systemMessage.content, legacySystem].includes(originalSystem.content))
      throw new Error('JOBAID_CHECKPOINT_POLICY_CHANGED');
    // Continuation branches below reuse this object after READ/SAVE. Preserve
    // the accepted checkpoint's original instructions, not this release's text.
    systemMessage.content = originalSystem.content;
    ({ round, messages, expectedWorkRevision, saved, corrections, inputUnits, outputUnits } = restored);
    protocolRepairs = restored.protocolRepairs;
    noProgressRepairs = restored.noProgressRepairs;
    lastObservation = restored.lastObservation ?? null;
    if (![protocolRepairs, noProgressRepairs].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 1))
      throw new Error('JOBAID_CHECKPOINT_POLICY_CHANGED');
    sessionModelInput = restored.sessionModelInput ?? modelInput;
    sessionModelInput = refreshJobAidPreparation(sessionModelInput, sessionModelInput.preparation, options.assessmentBinding);
    if (boundedWorkContext) {
      if (!restored.evidenceCache) throw new Error('JOBAID_CHECKPOINT_POLICY_CHANGED');
      evidenceCache = restored.evidenceCache;
      targetWork = restored.targetWork ?? null;
    }
    initialContextMessage = { role: 'user', content: JSON.stringify(modelContext(sessionModelInput)) };
    sessionWorkRevision = restored.sessionWorkRevision ?? modelInput.expectedWorkRevision;
    savedReadSourceRefs = restored.savedReadSourceRefs ?? [];
    nativeSessionSegment = restored.nativeSessionSegment ?? 0;
    scopeAdjustments = restored.scopeAdjustments ?? 0;
    sourceMetadata = restored.sourceMetadata ?? [];
  } else await persistAssessmentState(round);
  const promptVersion = (modelInput.schemaVersion === JOBAID_PROBLEM_SOURCE_STATEMENT_TASK_SCHEMA
    ? 'wiselink-jobaid-problem@v3' : 'wiselink-jobaid-problem@v2') +
    (systemMessage.content.startsWith(GUIDE) ? SOURCE_CONTENT_SYNTHESIS_PROMPT_REVISION : '');
  const taskDeadlineMs = options.taskDeadline === undefined ? Infinity : Date.parse(options.taskDeadline);
  if (Number.isNaN(taskDeadlineMs)) throw new Error('JOBAID_TASK_DEADLINE_INVALID');
  // A checkpointed assessment with an absolute Host deadline measures
  // actual recorded execution, not maintenance downtime between completed rounds.
  const activeModelBudget = checkpoint && Number.isFinite(taskDeadlineMs);
  let modelExecutionMs = 0;
  const accountedRounds = new Set();
  const accountRound = async number => {
    if (!activeModelBudget || accountedRounds.has(number)) return;
    const result = await checkpoint.readOptional(`assessment-round-${number}.result`);
    if (!result) return;
    const start = await checkpoint.readOptional(`assessment-round-${number}.started`);
    const startMs = Date.parse(start?.startedAt);
    const endMs = Date.parse(result.finishedAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs)
      throw new Error('JOBAID_CHECKPOINT_EXECUTION_TIME_INVALID');
    modelExecutionMs += endMs - startMs;
    accountedRounds.add(number);
  };
  if (activeModelBudget) for (let number = 1; number <= round; number++) await accountRound(number);
  const remainingBudgetMs = () => Math.min(taskDeadlineMs - Date.now(),
    timeoutMs - (activeModelBudget ? modelExecutionMs : Date.now() - startedAt));
  const diagnosticBudget = remainingMs => ({
    protocolRepairs, maxProtocolRepairs: 1, noProgressRepairs,
    requestBudget: { maxRounds: 64, round, remainingMs,
      transportRetries: 0, protocolRepairBackoffMs: 1000 },
    metricUnits: { request: 'UTF8_BYTES', response: 'UTF8_BYTES', tokens: 'REPORTED_USAGE_OR_NULL' },
  });
  const requestKey = async (kind) => {
    const key = `assessment-${round}-${kind}`;
    let value = await checkpoint?.readOptional(key);
    if (!value) {
      value = { requestId: `JA-${kind}-${randomUUID()}` };
      await checkpoint?.writeOnce(key, value);
    }
    return value.requestId;
  };
  const exactSavedOverviewStatus = () => [targetWork, sessionModelInput.previousWork].find(work =>
    work && saved && work.workRevisionRef === saved.workRevisionRef &&
    work.workRevision === saved.workRevision)?.overviewStatus ?? null;
  const terminalFailure = (code, cause) => {
    const error = new Error(code, cause ? { cause } : undefined);
    error.terminalAssessmentFailure = { errorCode: code, provenance: {
      modelVersion: `configured-route:${options.executionModel?.modelRef ?? options.configuredModelVersion}`,
      promptVersion,
      skillVersion: WISELINK_SKILL_VERSION,
      toolVersions: { [WISELINK_HOST_MCP_NAME]: WISELINK_HOST_MCP_VERSION,
        'jobaid-problem-protocol': modelInput.schemaVersion === JOBAID_PROBLEM_SOURCE_STATEMENT_TASK_SCHEMA ? '3' : '2',
        ...(modelInput.tdmsContext ? { 'tdms-native-context': '1' } : {}) },
      runMetrics: { durationMs: Date.now() - startedAt, inputUnits, outputUnits },
    } };
    return error;
  };
  const repairProtocol = async (category, protocol) => {
    if (!protocol.knownTerminal) throw new Error(`JOBAID_PROTOCOL_${category}`);
    if (protocolRepairs >= 1) throw terminalFailure('JOBAID_PROTOCOL_REPAIR_EXHAUSTED');
    protocolRepairs++;
    messages = [...messages, { role: 'user', content: JSON.stringify({
      accepted: false, errorCode: `JOBAID_PROTOCOL_${category}`, expectedWorkRevision,
      instruction: `The completed response did not provide one valid ${FUNCTION} step. Correct only this protocol error using the declared function and exact step schema. Preserve the current task, evidence, correction target and saved work; do not restart investigation, claim a SAVE occurred, or return prose instead of the named tool. This is the only protocol repair for this stage.`,
      ...priorRejectedRatingCorrection(messages, sessionModelInput),
    }) }];
    await options.observeCandidateRejection?.({ modelRound: round, correctionNo: protocolRepairs,
      code: `JOBAID_PROTOCOL_${category}`, repairScope: 'STAGE_PROTOCOL', maxRepairs: 1, delayMs: 1000 });
    await persistAssessmentState(round + 1);
    if (round >= 64 || remainingBudgetMs() <= 1000) throw new Error('JOBAID_MODEL_BUDGET_EXHAUSTED');
    await options.heartbeat?.();
    await (dependencies.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(1000);
  };
  const save = async (work) => {
    const requestId = await requestKey('save');
    const args = {
      requestId,
      expectedWorkRevision,
      workJson: JSON.stringify(work),
    };
    let result;
    let saveReadback = null;
    try {
      saveReadback = checkpoint ? await options.readAssessmentWork({ requestId }) : null;
      if (saveReadback?.revision) {
        if (saveReadback.revision.requestId !== requestId) throw new Error('JOBAID_WORK_SAVE_READBACK_INVALID');
        result = { ...saveReadback.revision, roundCompletion: saveReadback.revision.content.roundCompletion };
      } else result = await options.saveAssessmentWork(args);
    } catch (error) {
      // Unknown save response: read the same request first. Never change its
      // request ID or regenerate an already-persisted analysis to recover it.
      saveReadback = await options.readAssessmentWork({ requestId });
      if (!saveReadback?.revision || saveReadback.revision.requestId !== requestId)
        throw error;
      result = {
        workRevisionRef: saveReadback.revision.workRevisionRef,
        workRevision: saveReadback.revision.workRevision,
        roundCompletion: saveReadback.revision.content.roundCompletion,
        replayed: true,
      };
    }
    if (
      !result?.workRevisionRef ||
      result.workRevision !== expectedWorkRevision + 1 ||
      !['IN_PROGRESS', 'COMPLETE', 'COMPLETE_WITH_OPEN_QUESTIONS'].includes(
        result.roundCompletion,
      )
    )
      throw new Error('JOBAID_WORK_SAVE_READBACK_INVALID');
    expectedWorkRevision = result.workRevision;
    saved = { requestId, workRevisionRef: result.workRevisionRef, workRevision: result.workRevision,
      roundCompletion: result.roundCompletion };
    if (boundedWorkContext) {
      if (!saveReadback?.revision)
        saveReadback = await options.readAssessmentWork({ requestId });
      const revision = saveReadback?.revision;
      if (revision?.requestId !== requestId ||
          revision.workRevisionRef !== result.workRevisionRef ||
          revision.workRevision !== result.workRevision ||
          !revision.content)
        throw new Error('JOBAID_WORK_SAVE_READBACK_INVALID');
      sessionModelInput = refreshJobAidPreparation(continuationModelInput(sessionModelInput, revision),
        saveReadback.preparation ?? result.preparation, options.assessmentBinding);
      targetWork = null;
      savedReadSourceRefs = Array.isArray(revision.content.readSourceRefs)
        ? [...revision.content.readSourceRefs] : [];
      initialContextMessage = {
        role: 'user',
        content: JSON.stringify(modelContext(sessionModelInput)),
      };
      sessionWorkRevision = revision.workRevision;
    }
    return saved;
  };
  for (; round <= 64; round += 1) {
    await options.heartbeat?.();
    const remainingMs = remainingBudgetMs();
    if (Date.now() >= taskDeadlineMs || (remainingMs <= 0 && !accountedRounds.has(round)))
      throw new Error('JOBAID_MODEL_BUDGET_EXHAUSTED');
    inputUnits += Buffer.byteLength(JSON.stringify(messages));
    const requestedModel = `openclaw/${WISELINK_PROFILE_REF}`;
    const nativeSessionDiscriminator = boundedWorkContext && nativeSessionSegment > 0
      ? `${options.sessionDiscriminator}:work:${sessionWorkRevision}:segment:${nativeSessionSegment}`
      : sessionWorkRevision === modelInput.expectedWorkRevision
        ? options.sessionDiscriminator
        : `${options.sessionDiscriminator}:work:${sessionWorkRevision}`;
    const focus = boundedWorkContext
      ? 'Continue useful investigation across relevant sources and ranges. Reuse exact delivered evidence; READ_WORK only for a needed complete target baseline. SAVE_WORK only when understanding, a correction or completion state changes meaningfully. Do not manufacture an empty save because a read finished, repeat unchanged work, or claim unread scope verified.'
      : 'Keep the shared engineering context and investigate relevant sections and sources. Save substantive changes promptly and preserve unchanged work. Before completion check cross-issue consistency and save only necessary synthesis or corrections.';
    const requestToolSchema = jobAidFunctionSchema(stepShape);
    const requestMaxCompletionTokens = options.executionModel?.modelRef === 'miaoda/minimax-m3'
      ? generationPolicy.requestMaxCompletionTokens
      : isJobAidProblemInputSchema(modelInput.schemaVersion) &&
        options.executionModel?.modelRef === 'm3probe/minimax-m3'
        ? generationPolicy.probeRequestMaxCompletionTokens : null;
    const requestPayload = {
      model: requestedModel,
      user: `initial:${nativeSessionDiscriminator}`,
      messages: messages.map(message => message.role !== 'system' ? message : ({ ...message, content: message.content + '\n' + JSON.stringify({
        generationPolicy, scopeAdjustment: scopeAdjustments, expectedWorkRevision, savedWork: saved,
        focus,
      }) })),
      tools: [
        {
          type: 'function',
          function: {
            name: FUNCTION,
            description: 'Return one source-read, exact-work-target-read, substantive-work-save, or finish intent. The deterministic Host caller executes and validates it.',
            parameters: {
              type: 'object',
              additionalProperties: false,
              required: ['step'],
              properties: { step: requestToolSchema },
            },
          },
        },
      ],
      tool_choice: toolChoice,
      parallel_tool_calls: false,
      n: 1,
      stream: false,
      ...(requestMaxCompletionTokens
        ? { max_completion_tokens: requestMaxCompletionTokens } : {}),
    };
    const requestBody = JSON.stringify(requestPayload);
    // A persisted assessment-round response skips performRequest on resume.
    // Recompute the same request metrics before replaying its observation.
    const requestMetrics = round === 1 && options.recoveredInitialResponse ? null : {
      requestBytes: Buffer.byteLength(requestBody),
      messagesBytes: Buffer.byteLength(JSON.stringify(requestPayload.messages)),
      systemBytes: Buffer.byteLength(requestPayload.messages[0].content),
      toolsBytes: Buffer.byteLength(JSON.stringify(requestPayload.tools)),
    };
    const requestModel = async () => {
      let response;
      try { response = await (
        dependencies.requestGateway ?? requestHostedGateway
      )(new URL('/v1/chat/completions', options.gatewayUrl), {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${options.gatewayToken}`,
          ...executionModelHeaders(options),
        },
        body: requestBody,
        signal: AbortSignal.timeout(Math.min(remainingMs, 15 * 60_000)),
      }); } catch (error) {
        await options.observeModelOutput?.({ operation, round,
          localTransportRequestOrdinal: round, upstreamDispatchCount: null,
          protocolCategory: 'TRANSPORT_OUTCOME_UNKNOWN', upstreamOutcome: 'UNKNOWN',
          transportFailure: hostedGatewayTransportFailureDiagnostic(error),
          responseShape: null, finishReason: null, inputTokens: null, outputTokens: null,
          ...diagnosticBudget(remainingMs), ...requestMetrics }, round);
        throw error;
      }
      const raw = await response.text();
      if (Buffer.byteLength(raw) > 4 * 1024 * 1024)
        throw new Error('JOBAID_MODEL_RESPONSE_TOO_LARGE');
      return { raw, status: response.status, ok: response.ok, localTransportRequestOrdinal: round,
        requestBudgetRemainingMs: remainingMs };
    };
    const performRequest = async () => {
      if (round === 1 && options.recoveredInitialResponse) return options.recoveredInitialResponse;
      return options.runModelRequest ? options.runModelRequest(requestModel) : requestModel();
    };
    // Persist a complete response before executing its read/save intent. A lost
    // response remains unknown; a failed Host read can reuse this exact result.
    const response = checkpoint ? await checkpoint.remoteStep({
      step: `assessment-round-${round}`, args: { operation, messages, executionModel: options.executionModel ?? null,
        sessionDiscriminator: nativeSessionDiscriminator, generationPolicy, scopeAdjustments,
        ...(boundedWorkContext ? { nativeSessionSegment, requestToolSchema } : {}) },
      ambiguousCommit: false, perform: performRequest,
    }) : await performRequest();
    await accountRound(round);
    const { raw } = response;
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      await options.observeModelOutput?.({ operation, round,
        localTransportRequestOrdinal: response.localTransportRequestOrdinal ?? null, upstreamDispatchCount: null,
        protocolCategory: 'GATEWAY_JSON_INVALID', upstreamOutcome: 'UNKNOWN',
        httpStatus: response.status, responseBytes: Buffer.byteLength(raw), responseShape: null,
        finishReason: null, inputTokens: null, outputTokens: null,
        ...diagnosticBudget(response.requestBudgetRemainingMs ?? null),
        ...(requestMetrics ?? {}) }, round);
      throw new Error(`JOBAID_GATEWAY_INVALID_JSON_HTTP_${response.status}`);
    }
    const shape = summarizeHostedReviewModelOutputShape({
      httpStatus: response.status,
      httpOk: response.ok,
      requestedModel,
      payload,
      expectedFunctionNames: [FUNCTION],
    });
    const gatewayFailure = response.ok ? null : classifyHostedGatewayFailure(payload);
    let protocol = classifyHostedAssessmentProtocol(payload, response);
    let step;
    let parsedWork;
    if (protocol.category === null) {
      try {
        const message = payload.choices[0].message;
        const call = message.tool_calls[0];
        if (shape.hasAnalysis || !isFunctionResponseContentSupported(message.content)) throw new Error();
        const args = parseStrictJsonObject(call.function.arguments);
        if (Object.keys(args).length !== 1 || !args.step || typeof args.step !== 'object' || Array.isArray(args.step))
          throw new Error();
        step = decodeJobAidValue(args.step, stepShape);
        if (!stepMatchesShape(step, stepShape)) throw new Error();
        if (step.workJson !== undefined) parsedWork = parseJobAidWorkJson(step.workJson);
      } catch { protocol = { ...protocol, category: 'TOOL_SCHEMA_INVALID', repairEligible: protocol.knownTerminal }; }
    }
    const reportedTokens = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
    await options.observeModelOutput?.(
      {
        operation,
        round,
        requestedToolChoice: toolChoice,
        requestMaxCompletionTokens,
        generationPolicyVersion: generationPolicy.version,
        scopeAdjustments,
        ...(requestMetrics ?? {}),
        functionArgumentsBytes: typeof payload?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments === 'string'
          ? Buffer.byteLength(payload.choices[0].message.tool_calls[0].function.arguments) : null,
        httpStatus: response.status,
        finishReason: payload?.choices?.[0]?.finish_reason ?? null,
        inputTokens: reportedTokens(payload?.usage?.prompt_tokens),
        outputTokens: reportedTokens(payload?.usage?.completion_tokens),
        responseBytes: Buffer.byteLength(raw),
        outputChannel: shape.outputChannel,
        responseShape: shape,
        protocolCategory: protocol.category,
        upstreamOutcome: protocol.upstreamOutcome,
        ...(protocol.httpFailure ? { gatewayHttpFailure: protocol.httpFailure } : {}),
        localTransportRequestOrdinal: response.localTransportRequestOrdinal ?? null,
        upstreamDispatchCount: null,
        ...diagnosticBudget(response.requestBudgetRemainingMs ?? null),
        ...(gatewayFailure ? { gatewayFailure } : {}),
      },
      round,
    );
    // Only a successful response without an explicit error can establish
    // output length. Error envelopes remain unknown even with choices metadata.
    if (protocol.category === 'OUTPUT_LENGTH') {
      if (scopeAdjustments >= generationPolicy.maxScopeAdjustments) {
        const error = new Error('JOBAID_MODEL_OUTPUT_LENGTH');
        error.terminalAssessmentFailure = {
          errorCode: 'JOBAID_MODEL_OUTPUT_LENGTH',
          provenance: {
            modelVersion: `configured-route:${options.executionModel?.modelRef ?? options.configuredModelVersion}`,
            promptVersion, skillVersion: WISELINK_SKILL_VERSION,
            toolVersions: { [WISELINK_HOST_MCP_NAME]: WISELINK_HOST_MCP_VERSION, 'jobaid-problem-protocol': modelInput.schemaVersion===JOBAID_PROBLEM_SOURCE_STATEMENT_TASK_SCHEMA?'3':'2', ...(modelInput.tdmsContext ? {'tdms-native-context':'1'} : {}) },
            runMetrics: { durationMs: Date.now() - startedAt, inputUnits, outputUnits },
          },
        };
        throw error;
      }
      scopeAdjustments += 1;
      // Retain the latest source/save receipt. The native session holds earlier
      // complete context; the incomplete output is never resubmitted as a tool.
      await options.observeCandidateRejection?.({ modelRound: round, correctionNo: scopeAdjustments, code: 'JOBAID_MODEL_OUTPUT_LENGTH' });
      await persistAssessmentState(round + 1);
      continue;
    }
    // The native profile can have tools. An outer candidate function does not
    // prove generation-only execution; an ambiguous 408/timeout is not retried.
    if (!response.ok) {
      const error = new Error(`JOBAID_GATEWAY_HTTP_${response.status}${gatewayFailure === 'UNCLASSIFIED' ? '' : ':' + gatewayFailure}`);
      // A gateway error/conversion report cannot prove provider termination.
      throw error;
    }
    const choice = payload.choices?.[0];
    const message = choice?.message;
    const call = message?.tool_calls?.[0];
    if (protocol.category) {
      await repairProtocol(protocol.category, protocol);
      continue;
    }
    outputUnits += Buffer.byteLength(call.function.arguments);
    let receipt;
    let submittedWork;
    let sessionResetKind = null;
    let requestedSourceRefCount = null;
    let observationResult;
    let progressFeedback = null;
    const progressBefore = structuredClone({ expectedWorkRevision, evidenceCache, targetWork,
      preparation: sessionModelInput.preparation });
    sourceSelectionError = null;
    try {
      if (step.action === 'READ_SOURCES') {
        if (
          !Array.isArray(step.sourceRefs) ||
          !step.sourceRefs.length ||
          typeof step.purpose !== 'string' ||
          !['EXACT', 'PAGE'].includes(step.context)
        )
          throw new Error('JOBAID_SOURCE_STEP_INVALID');
        requestedSourceRefCount = step.sourceRefs.length;
        if (boundedInitialJobAid && step.sourceRefs.length > INITIAL_JOBAID_SOURCE_REFS_PER_READ)
          throw new Error('JOBAID_SOURCE_BATCH_TOO_LARGE');
        sourceSelectionError = boundedInitialJobAid
          ? sourceSelectionFeedback(step.sourceRefs, sessionModelInput.availableSources)
          : null;
        if (sourceSelectionError) throw new Error('JOBAID_SOURCE_NOT_REGISTERED');
        receipt = await readJobAidSourceBatches({
          sourceRefs: step.sourceRefs,
          purpose: step.purpose,
          context: step.context,
        }, options.readAssessmentSources);
        if (receipt?.status !== 'AVAILABLE' || !Array.isArray(receipt.evidence))
          throw new Error('JOBAID_SOURCE_READ_FAILED');
        observationResult = structuredClone(receipt);
        if (boundedWorkContext) {
          const cached = cacheJobAidSourceRead(evidenceCache, receipt);
          evidenceCache = cached.cache;
          receipt = cached.receipt;
          observationResult = structuredClone(receipt);
          initialContextMessage = { role: 'user', content: JSON.stringify(modelContext(sessionModelInput)) };
          nativeSessionSegment++;
          sessionResetKind = 'SOURCE_READ';
        }
      } else if (step.action === 'READ_WORK' && boundedWorkContext) {
        const expected = sessionModelInput.previousWork;
        if (!expected || step.workRevisionRef !== expected.workRevisionRef ||
            !Array.isArray(step.issueKeys) || typeof step.includeOverview !== 'boolean')
          throw new Error('JOBAID_WORK_TARGET_INVALID');
        const requestId = saved?.workRevisionRef === expected.workRevisionRef ? saved.requestId : null;
        const readback = await options.readAssessmentWork(requestId ? { requestId } : {});
        const revision = readback?.revision;
        if (!revision?.content || !Array.isArray(revision.content.issues))
          throw new Error('JOBAID_WORK_READ_FAILED');
        if (revision.workRevisionRef !== expected.workRevisionRef ||
            revision.workRevision !== expected.workRevision || revision.workRevision !== expectedWorkRevision ||
            (requestId && revision.requestId !== requestId))
          throw new Error('JOBAID_WORK_REVISION_CONFLICT');
        sessionModelInput = refreshJobAidPreparation(sessionModelInput, readback.preparation, options.assessmentBinding);
        receipt = projectJobAidTargetWork(revision, step.issueKeys, step.includeOverview);
        observationResult = { status: receipt.status, workRevisionRef: receipt.workRevisionRef,
          workRevision: receipt.workRevision, issueKeys: step.issueKeys, includeOverview: step.includeOverview };
        targetWork = mergeJobAidTargetWork(targetWork, receipt);
        initialContextMessage = { role: 'user', content: JSON.stringify(modelContext(sessionModelInput)) };
        nativeSessionSegment++;
        sessionResetKind = 'WORK_READ';
      } else if (step.action === 'QUERY_KNOWLEDGE') {
        if (typeof step.query !== 'string' || !step.query.trim() || step.query.length > 4000)
          throw new Error('JOBAID_KNOWLEDGE_QUERY_INVALID');
        if (!modelInput.knowledgeAccess?.available || !options.queryAssessmentKnowledge) {
          receipt = { status: 'UNAVAILABLE', error: modelInput.knowledgeAccess?.reason ?? 'NOT_CONNECTED', evidence: [], candidateOnly: true, originalDocumentsVerified: false };
        } else {
          const queryRequestKey = await requestKey('query');
          try { receipt = await options.queryAssessmentKnowledge({ requestKey: queryRequestKey, query: step.query }); }
          catch {
            // A transport failure cannot authorize replaying the upstream query.
            receipt = await options.queryAssessmentKnowledge({ requestKey: queryRequestKey });
          }
          while (receipt?.status === 'RUNNING') {
            if (!receipt.queryRef) throw new Error('JOBAID_KNOWLEDGE_RECEIPT_INVALID');
            if (remainingBudgetMs() <= 0) throw new Error('JOBAID_MODEL_BUDGET_EXHAUSTED');
            await options.heartbeat?.();
            await (dependencies.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(3000);
            receipt = await options.queryAssessmentKnowledge({ queryRef: receipt.queryRef });
          }
          if (!['COMPLETED','FAILED','UNKNOWN','UNAVAILABLE'].includes(receipt?.status) || !Array.isArray(receipt.evidence))
            throw new Error('JOBAID_KNOWLEDGE_RECEIPT_INVALID');
        }
        if (boundedWorkContext) {
          evidenceCache = cacheJobAidKnowledgeReceipt(evidenceCache, receipt);
          initialContextMessage = { role: 'user', content: JSON.stringify(modelContext(sessionModelInput)) };
        }
        observationResult = boundedWorkContext ? { status: receipt.status, queryRef: receipt.queryRef ?? null,
          evidenceRefs: receipt.evidence.map(item => item.evidenceRef) } : structuredClone(receipt);
      } else if (step.action === 'SAVE_WORK' || step.action === 'FINISH') {
        if (step.workJson !== undefined) {
          if (boundedInitialJobAid && expectedWorkRevision === modelInput.expectedWorkRevision &&
              !sessionModelInput.previousWork &&
              !(evidenceCache?.evidence ?? sessionModelInput.deliveredEvidence).some(item => item.kind === 'DOCUMENT_PASSAGE'))
            throw new Error('JOBAID_PRIMARY_SOURCE_READ_REQUIRED');
          const priorWorkRevision = expectedWorkRevision;
          submittedWork = parsedWork;
          if (boundedWorkContext) {
            const priorKeys = new Set(sessionModelInput.previousWork?.content?.issues?.map(issue => issue.issueKey) ?? []);
            const completeKeys = new Set(targetWork && sessionModelInput.previousWork &&
              targetWork.workRevisionRef === sessionModelInput.previousWork.workRevisionRef
              ? targetWork.issues.map(issue => issue.issueKey) : []);
            const suppliedKeys = ['issues', 'retiredIssues'].flatMap(field => Array.isArray(submittedWork[field])
              ? submittedWork[field].map(issue => issue?.issueKey) : []);
            const missingKeys = [...new Set(suppliedKeys.filter(key => priorKeys.has(key) && !completeKeys.has(key)))];
            const needsOverview = Object.hasOwn(submittedWork, 'overview') && sessionModelInput.previousWork &&
              !(targetWork?.workRevisionRef === sessionModelInput.previousWork.workRevisionRef && Object.hasOwn(targetWork, 'overview'));
            if (missingKeys.length || needsOverview) {
              const error = new Error('JOBAID_WORK_BASELINE_READ_REQUIRED');
              error.workReadRequired = { workRevisionRef: sessionModelInput.previousWork.workRevisionRef,
                issueKeys: missingKeys, includeOverview: Boolean(needsOverview) };
              throw error;
            }
            const normalized = canonicalizeKnownJobAidSourceAliases(
              submittedWork,
              sessionModelInput.availableSources,
            );
            submittedWork = normalized.work;
            if (normalized.repairs.length)
              await checkpoint?.write(`assessment-${round}-source-ref-normalizations`,
                { repairs: normalized.repairs });
          }
          receipt = await save(submittedWork);
          if (boundedWorkContext && expectedWorkRevision > priorWorkRevision) {
            nativeSessionSegment++;
            sessionResetKind = 'SAVE';
          }
        }
        else if (step.action === 'SAVE_WORK')
          throw new Error('JOBAID_WORK_REQUIRED');
        if (step.action === 'FINISH') {
          if (!saved || (saved.roundCompletion === 'IN_PROGRESS' &&
              modelInput.overviewCorrectionProtocol !== 'OPENCLAW_SCOPED_V1'))
            throw new Error('JOBAID_COMPLETED_WORK_REQUIRED');
          if (modelInput.purpose === 'OVERALL_CONSISTENCY' && exactSavedOverviewStatus() !== 'CURRENT')
            throw new Error(`JOBAID_OVERALL_EXACT_WORK_REQUIRED:${saved.workRevisionRef}:OVERVIEW_${exactSavedOverviewStatus() ?? 'NOT_RECORDED'}`);
          if (
            modelInput.purpose === 'OVERALL_CONSISTENCY' &&
            (typeof step.consistencyCheck !== 'string' ||
              !step.consistencyCheck.trim())
          )
            throw new Error('JOBAID_OVERALL_CONSISTENCY_REQUIRED');
          return {
            output: {
              workRevisionRef: saved.workRevisionRef,
              ...(step.consistencyCheck
                ? { consistencyCheck: step.consistencyCheck }
                : {}),
            },
            provenance: {
              modelVersion: actualModelVersion(
                payload,
                choice,
                message,
                options.executionModel
                  ? `configured-route:${options.executionModel.modelRef}`
                  : options.configuredModelVersion,
              ),
              promptVersion,
              skillVersion: WISELINK_SKILL_VERSION,
              toolVersions: {
                [WISELINK_HOST_MCP_NAME]: WISELINK_HOST_MCP_VERSION,
                'jobaid-problem-protocol': modelInput.schemaVersion===JOBAID_PROBLEM_SOURCE_STATEMENT_TASK_SCHEMA?'3':'2', ...(modelInput.tdmsContext ? {'tdms-native-context':'1'} : {}),
              },
              runMetrics: {
                durationMs: Date.now() - startedAt,
                inputUnits,
                outputUnits,
              },
            },
          };
        }
      } else throw new Error('JOBAID_STEP_ACTION_INVALID');
      const parameters = step.action === 'READ_SOURCES'
        ? { sourceRefs: step.sourceRefs, purpose: step.purpose, context: step.context }
        : step.action === 'READ_WORK' ? { workRevisionRef: step.workRevisionRef, issueKeys: step.issueKeys, includeOverview: step.includeOverview }
          : step.action === 'QUERY_KNOWLEDGE' ? { query: step.query } : null;
      const observation = parameters ? { action: step.action, parameters, result: observationResult ?? receipt } : null;
      const progressed = !isDeepStrictEqual(progressBefore, { expectedWorkRevision, evidenceCache, targetWork,
        preparation: sessionModelInput.preparation });
      if (observation && !progressed && isDeepStrictEqual(lastObservation, observation)) {
        if (noProgressRepairs >= 1) throw terminalFailure('JOBAID_NO_PROGRESS');
        noProgressRepairs++;
        progressFeedback = { accepted: false, errorCode: 'JOBAID_NO_PROGRESS',
          instruction: 'The same operation, exact parameters and result produced no new evidence or saved understanding. Do not repeat it. Read a different necessary range, make a substantive supported work change, or FINISH only if the Host-saved round is complete. This is the only no-progress correction for this stage.' };
        await options.observeCandidateRejection?.({ modelRound: round, correctionNo: noProgressRepairs,
          code: 'JOBAID_NO_PROGRESS', repairScope: 'STAGE_PROGRESS', maxRepairs: 1 });
      }
      lastObservation = observation;
      corrections = 0;
    } catch (error) {
      if (error?.terminalAssessmentFailure) throw error;
      const code = error?.hostErrorCode ?? error?.message ?? '';
      const invalidWorkJson = code === 'JOBAID_WORK_JSON_INVALID' && !submittedWork;
      const sourcePolicyNotFollowed = boundedInitialJobAid && corrections >= maxCorrections &&
        code === 'JOBAID_SOURCE_BATCH_TOO_LARGE';
      if (corrections >= maxCorrections && (sourcePolicyNotFollowed || invalidWorkJson || (submittedWork && error?.hostErrorCode &&
          /^JOBAID_[A-Z_]+(?::[A-Za-z0-9:_-]+)?$/u.test(code) &&
          !/AUTHORIZATION|LEASE|REVISION_CONFLICT|VERSION_CHANGED|BUDGET|GATEWAY|READ_FAILED|ATTEMPT/.test(code)))) {
        // Invalid JSON never reaches SAVE. Together with explicit Host rejection,
        // this is a known exhausted failure, not an ambiguous write to replay.
        error.terminalAssessmentFailure = { errorCode: sourcePolicyNotFollowed
          ? 'JOBAID_SOURCE_BATCH_POLICY_NOT_FOLLOWED'
          : invalidWorkJson ? 'JOBAID_WORK_JSON_INVALID' : 'JOBAID_WORK_VALIDATION_FAILED', provenance: {
          modelVersion: `configured-route:${options.executionModel?.modelRef ?? options.configuredModelVersion}`,
          promptVersion, skillVersion: WISELINK_SKILL_VERSION,
          toolVersions: { [WISELINK_HOST_MCP_NAME]: WISELINK_HOST_MCP_VERSION, 'jobaid-problem-protocol': modelInput.schemaVersion===JOBAID_PROBLEM_SOURCE_STATEMENT_TASK_SCHEMA?'3':'2', ...(modelInput.tdmsContext ? {'tdms-native-context':'1'} : {}) },
          runMetrics: { durationMs: Date.now() - startedAt, inputUnits, outputUnits },
        } };
      }
      if (
        !/^JOBAID_[A-Z_]+(?::[A-Za-z0-9:_-]+)?$/u.test(code) ||
        /AUTHORIZATION|LEASE|REVISION_CONFLICT|VERSION_CHANGED|BUDGET|GATEWAY|READ_FAILED|ATTEMPT/.test(
          code,
        ) ||
        corrections >= maxCorrections
      )
        throw error;
      corrections += 1;
      const shapeCorrection = workShapeCorrection(code, submittedWork, modelInput);
      const sourcePolicy = sourceBatchPolicyFeedback(code, requestedSourceRefCount);
      receipt = {
        accepted: false,
        errorCode: code,
        expectedWorkRevision,
        instruction: sourcePolicy.instruction ??
          'Correct only the rejected step or substantive work using the original evidence. Existing saved work remains available; never invent sources or turn failure into completion.',
        ...sourcePolicy,
        ...shapeCorrection,
        ...(code.startsWith('JOBAID_OVERALL_EXACT_WORK_REQUIRED:') ? {
          workRevisionRef: saved?.workRevisionRef ?? null,
          workRevision: saved?.workRevision ?? null,
          overviewStatus: exactSavedOverviewStatus(),
          instruction: 'Only the exact Host-saved CURRENT overview can FINISH. Reading old work does not update its status. If status is not recorded here, READ_WORK for this exact revision with includeOverview:true. For STALE or NOT_AVAILABLE, revise the overview using the retained problem conclusions, source conditions and limitations, then SAVE a meaningful overview-only delta with issues:[]. FINISH only after the original save-key readback reports CURRENT. Do not mark the status yourself or submit an empty SAVE; unchanged CURRENT work needs no new SAVE.',
        } : {}),
        ...(error.workReadRequired ? {
          workReadRequired: error.workReadRequired,
          instruction: 'No SAVE occurred. READ_WORK using workReadRequired first; the short issue index is not a complete replacement baseline. Then revise the complete issue or overview deliberately, preserving all unchanged conditions and professional records. Do not guess missing fields.',
        } : {}),
        ...(sourceSelectionError ? {
          sourceSelection: { ...sourceSelectionError, hostReadExecuted: false },
          instruction: 'The source IDs below are not in this exact Host catalog; no read occurred. Copy exact availableSources[].ref values, including the final page marker. Use each unique suggested exact ref only after checking its title and locator. Retry READ_SOURCES; do not save a status-only issue or claim the primary document was read.',
        } : {}),
        ...(code === 'JOBAID_PRIMARY_SOURCE_READ_REQUIRED' ? {
          instruction: 'No primary-document passage has been delivered in this initial assessment. Select exact availableSources[].ref values and READ_SOURCES before saving engineering issue work. A failed read is not a document finding.',
        } : {}),
        ...(code === 'JOBAID_SOURCE_NOT_DELIVERED' && error.hostRejectedSourceRef ? {
          sourceRef: error.hostRejectedSourceRef,
          instruction: (error.hostRejectedSourceRef.startsWith('evidenceRef:') &&
            sessionModelInput.availableSources.some(source => source.ref === error.hostRejectedSourceRef.slice('evidenceRef:'.length))
            ? 'The candidate added the literal field label evidenceRef: to an exact catalog value. Remove that label from every inline citation and basisRefs value; use only the exact delivered evidenceRef value. The Host will still check that each value was actually delivered in this attempt or retained work. '
            : '') + 'The Host rejected this exact source reference from your candidate. Read it through READ_SOURCES if it belongs to the authorized catalog or document range. If unavailable, preserve the limitation and revise the unsupported assertion. Do not guess another identifier, silently drop supported analysis, or treat the failed save as completed.' +
            (shapeCorrection.instruction ? ` ${shapeCorrection.instruction}` : ''),
        } : {}),
      };
      await options.observeCandidateRejection?.({
        modelRound: round,
        correctionNo: corrections,
        code,
        ...(receipt.fieldErrors ? { fieldErrors: receipt.fieldErrors } : {}),
      });
    }
    // The configured Gateway resumes this native session's history. Keep one
    // copy of the context and earlier source bodies in that history.
    messages = sessionResetKind === 'SOURCE_READ' ? [
      systemMessage,
      initialContextMessage,
      { role: 'user', content: JSON.stringify({
        schemaVersion: 'wiselink.jobaid-source-read-continuation.v1',
        status: 'HOST_SOURCE_READ_CONFIRMED',
        expectedWorkRevision,
        sourceReadReceipt: projectJobAidReadReceipt(receipt, sourceMetadata),
        instruction: '这是一次成功且已由 Host 确认的来源读取。当前新会话的 deliveredEvidence 和 deliveredSourceReads 已保留完整原文与回执语境。可以继续取得当前判断所缺的其他来源或范围；已有目标缺少完整旧工作基线时按需 READ_WORK。形成有意义的完整变化时再 SAVE_WORK，不提交空的读取日志，不声称未读来源已核验。同一 attempt 的完整证据缓存继续保留。',
      }) },
    ] : sessionResetKind === 'WORK_READ' ? [
      systemMessage, initialContextMessage,
      { role: 'user', content: JSON.stringify({ status: 'HOST_WORK_READ_CONFIRMED',
        workRevisionRef: receipt.workRevisionRef, workRevision: receipt.workRevision,
        issueKeys: step.issueKeys, includeOverview: step.includeOverview,
        instruction: 'targetWork 包含该准确已保存修订的完整比较材料；preparation 保留本轮目标和更正。只修改实际受影响内容，不将旧认识当作新原文或覆盖待处理更正。',
      }) },
    ] : sessionResetKind === 'SAVE' ? [
      systemMessage,
      initialContextMessage,
      { role: 'user', content: JSON.stringify({
        schemaVersion: 'wiselink.jobaid-continuation-receipt.v1',
        status: 'HOST_SAVE_CONFIRMED',
        workRevisionRef: saved.workRevisionRef,
        workRevision: saved.workRevision,
        roundCompletion: saved.roundCompletion,
        instruction: `这是同一 Host attempt 在确认保存后的续段。previousWork 包含准确问题目录，readSourceRefs 只在其中列出一次；deliveredEvidence 与 deliveredSourceReads 保留本 attempt 的完整已交付证据。更正已有问题或概览前，用 READ_WORK 读取该准确修订的目标完整基线。只为缺少的决定性原文 READ_SOURCES，每次不超过 ${INITIAL_JOBAID_SOURCE_REFS_PER_READ} refs；有意义的认识变化后保存完整增量，不重写未变化的问题。headline/listBrief 只写工程认识，过程留在 changeSummary。不得重放先前 SAVE_WORK。`,
      }) },
    ] : [
      systemMessage,
      ...(round === 1 && options.recoveredInitialContext ? [initialContextMessage] : []),
      { role: 'assistant', content: null, tool_calls: [call] },
      {
        role: 'tool',
        tool_call_id: call.id,
        name: FUNCTION,
        content: JSON.stringify(projectJobAidReadReceipt(receipt, sourceMetadata)),
      },
    ];
    if (progressFeedback) messages.push({ role: 'user', content: JSON.stringify(progressFeedback) });
    await persistAssessmentState(round + 1);
  }
  throw new Error('JOBAID_MODEL_BUDGET_EXHAUSTED');
}

// Explain the existing Host rejection using types/positions only. The original
// work is still submitted unchanged and only the Host can accept a revision.
function priorRejectedRatingCorrection(messages, modelInput) {
  const receiptMessage = messages.findLast(message => message.role === 'tool');
  const priorCall = messages.findLast(message => message.role === 'assistant' && message.tool_calls?.length === 1)?.tool_calls[0];
  if (!receiptMessage || priorCall?.function?.name !== FUNCTION) return {};
  const receipt = parseStrictJsonObject(receiptMessage.content);
  if (receipt.accepted !== false || !/^JOBAID_(SEVERITY|LIKELIHOOD)_BUSINESS_EVIDENCE_REQUIRED$/.test(receipt.errorCode)) return {};
  const step = parseStrictJsonObject(priorCall.function.arguments).step;
  if (typeof step?.workJson !== 'string') return {};
  return { priorRejection: { errorCode: receipt.errorCode,
    ...workShapeCorrection(receipt.errorCode, parseJobAidWorkJson(step.workJson), modelInput) } };
}

function workShapeCorrection(code, work, modelInput) {
  if (!work) return {};
  if (code === 'JOBAID_BODY_CITATIONS_REQUIRED') {
    return { instruction: 'Every submitted issue body must contain at least one inline citation in the exact form [[ACTUAL_DELIVERED_REF_VALUE]]. A prose label such as u32 or a citation only in another field is insufficient. Copy the complete evidenceRef value from the Host source receipt or availableSources catalog, including both repeated parse-run segments when present. Cite only source text actually delivered in this attempt or retained from saved work; the Host will verify both the identifier and delivery.' };
  }
  if (['JOBAID_READING_SUMMARY_REQUIRED', 'JOBAID_READING_SUMMARY_PAIR_REQUIRED'].includes(code)) {
    return { instruction: 'The Host requires headline and listBrief together for the initial saved work or an explicit summary revision. Supply a concise engineering topic and a short explanation of the actual saved understanding, preserving decisive conditions and uncertainty. Do not copy the first issue question, invent a conclusion, or rerun source reading. Preserve the complete issue bodies and evidence. Later updates may omit both fields only to retain an existing saved summary.' };
  }
  const rating = /^JOBAID_(SEVERITY|LIKELIHOOD)_BUSINESS_EVIDENCE_REQUIRED$/.exec(code)?.[1]?.toLowerCase();
  if (rating) {
    const kinds = new Map((modelInput.availableSources ?? []).map(source => [source.ref, source.kind]));
    const fieldErrors = [];
    for (const [i, issue] of (work.issues ?? []).entries()) for (const [j, risk] of (issue.riskScenarios ?? []).entries()) {
      const proposal = risk[rating];
      if (proposal && Array.isArray(proposal.basisRefs) && proposal.basisRefs.every(ref =>
        kinds.has(ref) && !['DOCUMENT_PASSAGE', 'HOST_FACT'].includes(kinds.get(ref))))
        fieldErrors.push({ path: `work.issues[${i}].riskScenarios[${j}].${rating}`, expected: 'business evidence or null',
          received: 'rating supported only by non-business sources', basisRefs: proposal.basisRefs,
          sourceKinds: proposal.basisRefs.map(ref => kinds.get(ref)) });
    }
    return { fieldErrors, instruction: `The Host rejected a ${rating} rating without business evidence. Engineer statements, method rules and historical candidates alone cannot establish this rating. Use an actually supporting DOCUMENT_PASSAGE or HOST_FACT only if available; otherwise set the unsupported ${rating} to null and preserve the scenario, conditions, evidence, limitation and open question. Never guess a rating or attach an unrelated citation to pass validation. Preserve all other justified work. The Host will validate the revised work.` };
  }
  const fieldErrors = jobAidWorkTypeErrors(work);
  if (!fieldErrors.length) return {};
  return {
    fieldErrors,
    instruction:
      'Use the exact delivered evidenceRef value inside [[double brackets]] in body, without the literal label evidenceRef:. Use the same exact value in basisRefs. Do not generate redundant dependency fields. Correct the reported field types using the original evidence and the work-update shape. conditions, limitations and basisRefs are arrays of strings; addresses is one non-empty string describing the problem or risk addressed. Preserve justified analysis and unknowns; do not invent content or remove substantive work merely to pass validation. The Host will validate the revised work.' +
      (fieldErrors.some(error => error.received === 'undeclared field')
        ? ' The reported undeclared fields are not accepted at those paths; allowedFields lists the current contract. Preserve their substantive meaning in the relevant issue body or declared field. openQuestions belongs to an issue; explicit scheduling changes use reviewConditionDelta, not a full reviewConditions list. Work revision is assigned by Host, not authored in workJson.' : '') +
      (code === 'JOBAID_MEASURE_ADDRESSES_INVALID'
        ? ' The rejected field is addresses; changing status does not repair it.'
        : ''),
  };
}
