#!/usr/bin/env node
/** Real Codex calls through the migrated consumer drivers, with synthetic Host
 * data and in-memory persistence. This never connects to the business Host. */
import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { invokeHostedProgramAssessment } from '../skills/wiselink-research-and-synthesize/scripts/run-program-assessment.mjs';
import { invokeHostedTranslationBlock } from '../skills/wiselink-research-and-synthesize/scripts/invoke-hosted-translation-block.mjs';
import { invokeHostedDocumentReadingModel } from '../skills/wiselink-research-and-synthesize/scripts/invoke-hosted-document-reading-model.mjs';
import { validateJobAidProblemInput } from '../skills/wiselink-research-and-synthesize/scripts/run-jobaid-problem-assessment.mjs';
import { prepareProgramAssessmentMaterials } from '../skills/wiselink-research-and-synthesize/scripts/program-assessment-materials.mjs';
import { buildTranslationModelView } from '../skills/wiselink-research-and-synthesize/scripts/translation-model-view.mjs';
import { readingModelMessages } from '../skills/wiselink-research-and-synthesize/scripts/invoke-hosted-document-reading-model.mjs';

const arg = (args, key) => {
  const i = args.indexOf(key);
  return i === -1 ? undefined : args[i + 1];
};
const clone = value => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function checkpoint() {
  const values = new Map();
  return {
    readOptional: async key => values.get(key) ?? null,
    write: async (key, value) => { values.set(key, clone(value)); },
    writeOnce: async (key, value) => {
      if (values.has(key)) throw new Error(`FIXTURE_CHECKPOINT_REPLAY:${key}`);
      values.set(key, clone(value));
    },
    writeOnceOrEqual: async (key, value) => {
      if (values.has(key) && !same(values.get(key), value)) throw new Error(`FIXTURE_CHECKPOINT_CHANGED:${key}`);
      values.set(key, clone(value));
    },
  };
}

function programFixture() {
  const id = randomUUID().slice(0, 8);
  const documentVersionId = `fixture-dv-${id}`, parseRunId = `fixture-parse-${id}`;
  const sourceRefId = `fixture-ref-${id}`;
  const evidenceRef = `DOCUMENT_ORIGINAL:${documentVersionId}:${parseRunId}:${sourceRefId}`;
  const sourceText = '虚构测试台泵 P-7 的防护罩打开时有接触旋转件的风险。测试规程要求先断电、确认停转，再打开防护罩。建议温度报警，但未提供其已安装或有效的记录；人员暴露量和正式风险等级也未给出。';
  const originalBinding = { documentVersionId, parseRunId, parseRevision: 1 };
  const modelInput = {
    schemaVersion: 'wiselink.jobaid-problem-task.v2', purpose: 'INITIAL_PROBLEM_ASSESSMENT',
    executionMode: 'PROGRAM_CONTROLLED_V1', expectedWorkRevision: 0,
    methodBinding: { packRef: 'fixture-method-v1' },
    documentOverview: { title: '虚构测试台泵安全记录', original: { binding: originalBinding } },
    programOriginal: { binding: originalBinding,
      units: [{ unitId: `fixture-unit-${id}`, kind: 'paragraph', payload: { text: sourceText },
        sourceRefIds: [sourceRefId] }],
      sourceLocators: [{ sourceRefId, page: 1 }], coverage: { status: 'COMPLETE' }, findings: [] },
    availableSources: [{ ref: evidenceRef, kind: 'DOCUMENT_PASSAGE', documentVersionId,
      versionLabel: parseRunId, sourceRefId, title: '虚构测试材料' }],
    deliveredEvidence: [{ evidenceRef, kind: 'DOCUMENT_PASSAGE', documentVersionId,
      versionLabel: parseRunId, sourceRefId, excerpt: sourceText }],
  };
  const store = checkpoint(), actions = [];
  let saved = null;
  const options = {
    assessmentCheckpoint: store, assessmentBinding: { documentVersionId },
    sessionDiscriminator: `fixture-${id}`, taskDeadline: new Date(Date.now() + 30 * 60_000).toISOString(),
    heartbeat: async () => ({ status: 'RUNNING' }),
    readAssessmentSources: async () => { throw new Error('FIXTURE_UNREGISTERED_SOURCE_READ'); },
    readAssessmentWork: async ({ requestId }) => {
      actions.push({ action: 'READ_WORK', requestId });
      return { revision: saved?.requestId === requestId ? clone(saved) : null };
    },
    saveAssessmentWork: async request => {
      if (saved) throw new Error('FIXTURE_DUPLICATE_SAVE');
      const work = JSON.parse(request.workJson);
      if (!work.issues?.length || !work.issues.some(issue => issue.body?.includes(`[[${evidenceRef}]]`)))
        throw new Error('FIXTURE_SOURCE_CITATION_REQUIRED');
      saved = { requestId: request.requestId, workRevisionRef: `fixture-work-${id}-1`,
        workRevision: 1, content: { ...work, understanding: work.overview, overviewStatus: 'CURRENT' } };
      actions.push({ action: 'SAVE_WORK', workRevisionRef: saved.workRevisionRef });
      return { workRevisionRef: saved.workRevisionRef, workRevision: 1 };
    },
    recordAssessmentProgramProgress: async ({ phase }) => {
      actions.push({ action: 'PROGRAM_PROGRESS', phase });
      return { phase };
    },
  };
  return { modelInput, options, actions, saved: () => clone(saved), evidenceRef };
}

function translationFixture() {
  const sourceText = 'Disconnect electrical power and confirm the P-7 pump has stopped before opening the guard. A temperature alarm does not replace this step.';
  const block = { blockId: 'fixture-block-1', kind: 'paragraph', order: 0,
    anchorIds: ['fixture-anchor-1'], sourceStructure: [{ sourceUnitId: 'fixture-unit-1',
      kind: 'paragraph', payload: { text: sourceText } }] };
  const anchor = { anchorId: 'fixture-anchor-1', sourceUnitId: 'fixture-unit-1',
    payloadPath: '/payload/text', sourceText, sourceRefIds: ['fixture-source-1'] };
  return { schemaVersion: 'wiselink.3_1.translation_semantic_batch.v2', purpose: 'GENERATE',
    workspaceId: 'fixture-workspace', generationRequestRef: `fixture-generate-${randomUUID().slice(0, 8)}`,
    sourceLocale: 'en', targetLocale: 'zh-CN', blocks: [block], anchors: [anchor],
    sourcePlanBlockCount: 1, sourcePlanAnchorCount: 1,
    documentContext: { title: 'Synthetic safety note', blocks: [], anchors: [] },
    terminology: [], dependencies: {} };
}

function readingFixture() {
  const text = 'No approval is required except for installation.';
  return { sourceBinding: { documentVersionId: 'fixture-reading-dv' },
    sourceCoverage: { unresolvedRanges: [] },
    units: [{ unitId: 'fixture-reading-unit', text, sourceRefIds: ['fixture-reading-source'] }],
    deliveredRanges: [{ offset: 0, unitIds: ['fixture-reading-unit'], nextOffset: null }],
    anchors: [{ anchorId: 'fixture-reading-anchor', sourceUnitId: 'fixture-reading-unit',
      payloadPath: '/text', sourceText: text, sourceRefIds: ['fixture-reading-source'],
      sourceLocators: [{ sourceRefId: 'fixture-reading-source', page: 1 }] }],
  };
}

export async function runConsumerFixture({ codexBinary, configPath, runRoot, dryRun = false,
  mode = 'all' }) {
  if (!['all', 'program', 'translation', 'reading'].includes(mode))
    throw new Error('FIXTURE_MODE_INVALID');
  const program = programFixture(), translation = translationFixture(), reading = readingFixture();
  validateJobAidProblemInput(program.modelInput);
  await prepareProgramAssessmentMaterials(program.modelInput, program.options);
  buildTranslationModelView(translation);
  readingModelMessages(reading);
  if (dryRun) return { status: 'FIXTURE_VALID', mode, realHostCalled: false, modelRequests: 0 };
  if (![codexBinary, configPath, runRoot].every(value => typeof value === 'string' && isAbsolute(value)))
    throw new Error('FIXTURE_ABSOLUTE_CODEX_OPTIONS_REQUIRED');
  const runs = [];
  const codexOptions = { codexBinary, configPath, runRoot, reasoningEffort: 'low', maxOutputTokens: 16384,
    onRunCompleted: record => runs.push({ transport: record.transport, runDirectory: record.runDirectory }) };
  const executionModel = { modelRef: 'miaoda/glm-5.3', displayName: 'GLM 5.3',
    providerKind: 'BUILT_IN', settingsRevision: 1, selectedAt: new Date().toISOString() };
  const common = { modelExecutor: 'CODEX', codexOptions, executionModel,
    configuredModelVersion: 'configured-route:miaoda/glm-5.3', registeredModelRefs: ['miaoda/glm-5.3'] };
  const result = { status: 'COMPLETED', mode, realHostCalled: false, stages: {}, runs };
  if (['all', 'program'].includes(mode)) {
    const execution = await invokeHostedProgramAssessment({ operation: 'EVALUATE_JOBAID',
      modelInput: program.modelInput }, { ...common, ...program.options });
    const saved = program.saved();
    if (!saved || execution.output.workRevisionRef !== saved.workRevisionRef ||
        !program.actions.some(item => item.action === 'SAVE_WORK') ||
        !program.actions.some(item => item.action === 'READ_WORK' && item.requestId === saved.requestId))
      throw new Error('FIXTURE_PROGRAM_SAVE_READBACK_MISSING');
    result.stages.program = { modelVersion: execution.provenance.modelVersion,
      workRevisionRef: saved.workRevisionRef, actions: program.actions,
      deterministicOverallInput: { basedOnJobAidWorkRevisionRef: saved.workRevisionRef,
        overviewStatus: saved.content.overviewStatus, issueCount: saved.content.issues.length } };
  }
  if (['all', 'translation'].includes(mode)) {
    const generated = await invokeHostedTranslationBlock(translation, common);
    const checkInput = { ...translation, purpose: 'CHECK',
      generationRequestRef: `fixture-check-${randomUUID().slice(0, 8)}`,
      previousCandidate: generated.output.blocks[0], previousBlockRevisionId: 'fixture-revision-1' };
    const checked = await invokeHostedTranslationBlock(checkInput, common);
    result.stages.translation = { generateModelVersion: generated.provenance.modelVersion,
      checkModelVersion: checked.provenance.modelVersion,
      generatedBlockCount: generated.output.blocks.length, checkIssueCount: checked.output.issues.length };
  }
  if (['all', 'reading'].includes(mode)) {
    const interpreted = await invokeHostedDocumentReadingModel(reading, common);
    if (interpreted.proposal.brief.quotes[0]?.text !== reading.anchors[0].sourceText)
      throw new Error('FIXTURE_READING_SOURCE_COPY_MISMATCH');
    result.stages.reading = { modelVersion: interpreted.modelVersion,
      exactQuoteCopied: true, explanationCount: interpreted.proposal.explanation.length };
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  runConsumerFixture({ codexBinary: arg(args, '--codex'), configPath: arg(args, '--config'),
    runRoot: arg(args, '--run-root'), mode: arg(args, '--mode') ?? 'all', dryRun: args.includes('--dry-run') })
    .then(value => console.log(JSON.stringify(value, null, 2)))
    .catch(error => { console.error(JSON.stringify({ status: 'FAILED', errorCode: error.message })); process.exitCode = 1; });
}
