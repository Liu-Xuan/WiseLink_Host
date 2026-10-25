#!/usr/bin/env node
/** Real Miaoda/Codex execution with an explicit in-memory synthetic Host.
 * This does not call the canonical Host or prove its ACL/adoption/readers.
 */
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCodexAssessmentCallbacks } from './codex-assessment.mjs';

const clone = value => structuredClone(value);
// These are our own synchronous pre-write fixture checks, never transport errors.
const die = code => { throw Object.assign(new Error(code), { code, knownValidation: true }); };

export function createSyntheticHost() {
  const documentVersionId = `fixture-document-${randomUUID()}`;
  const workItemId = `fixture-work-${randomUUID()}`;
  const sourceRef = `DOCUMENT_ORIGINAL:${documentVersionId}:fixture:0`;
  const marker = `LAB-${randomUUID().slice(0, 8)}`;
  const text = `以下为完全虚构的软件验证材料，不用于真实工程决策。测试记录标记为 ${marker}。
测试台泵 P-7 在防护罩打开时存在接触旋转件的可能。测试规程要求先断电、确认停转，再打开防护罩。
制造商建议加装温度报警，但本记录没有报警已安装或有效的证据，也没有人员暴露量、事件频率或正式风险等级定义。
评估应说明断电与确认停转的作用、温度报警不能替代该措施，以及仍需确认的实施记录。`;
  const records = [], audit = [], requestRecords = new Map();
  let read = false, attempt = 0;
  const log = (action, extra = {}) => audit.push({ sequence: audit.length + 1, action, ...extra });
  const latest = () => records.at(-1);
  const input = (purpose = 'INITIAL_PROBLEM_ASSESSMENT') => ({
    schemaVersion: 'wiselink.jobaid-problem-task.v3', purpose,
    expectedWorkRevision: latest()?.workRevision ?? 0,
    availableSources: [{ ref: sourceRef, kind: 'DOCUMENT_ORIGINAL', title: '虚构测试台泵安全记录',
      documentVersionId, sourceAuthority: 'SYNTHETIC_TEST_DATA' }],
    knowledgeAccess: { available: false, reason: 'SYNTHETIC_FIXTURE_NO_EXTERNAL_RETRIEVAL' },
    documentOverview: { title: '虚构测试材料', scope: '仅验证软件循环，不用于真实工程决策' },
    ...(latest() ? { previousWork: clone(latest()) } : {}),
  });
  const hooks = () => {
    const actionAttemptId = `fixture-attempt-${++attempt}`;
    return {
      assessmentBinding: { documentVersionId, inputRevision: 1 },
      heartbeat: async () => ({ status: 'RUNNING', synthetic: true }),
      readAssessmentSources: async intent => {
        if (!Array.isArray(intent.sourceRefs) || intent.sourceRefs.some(ref => ref !== sourceRef)) die('FIXTURE_SOURCE_UNKNOWN');
        read = true; log('READ_SOURCES');
        return { status: 'AVAILABLE', scope: intent.context, sourceRefs: [sourceRef], completeRequestedScope: true,
          evidence: [{ evidenceRef: sourceRef, kind: 'DOCUMENT_ORIGINAL', text, documentVersionId }], synthetic: true };
      },
      queryAssessmentKnowledge: async () => ({ status: 'UNAVAILABLE', reason: 'SYNTHETIC_FIXTURE', evidence: [] }),
      saveAssessmentWork: async args => {
        const existing = requestRecords.get(args.requestId);
        if (existing) {
          if (existing.workJson !== args.workJson || existing.expectedWorkRevision !== args.expectedWorkRevision) die('FIXTURE_IDEMPOTENCY_CONFLICT');
          return { ...clone(existing.revision), roundCompletion: existing.revision.content.roundCompletion, replayed: true };
        }
        if (args.expectedWorkRevision !== (latest()?.workRevision ?? 0)) die('FIXTURE_CAS_CONFLICT');
        const update = JSON.parse(args.workJson);
        if (!read || update.schemaVersion !== 'wiselink.jobaid-problem-work.v3' || !Array.isArray(update.issues)) die('FIXTURE_WORK_INVALID');
        if (!latest() && (!update.headline || !update.listBrief || !update.issues.length)) die('FIXTURE_INITIAL_SUMMARY_REQUIRED');
        for (const issue of update.issues) {
          if (!issue.issueKey || !issue.question || !issue.body?.includes(`[[${sourceRef}]]`)) die('FIXTURE_CITATION_REQUIRED');
        }
        const old = latest()?.content ?? {};
        const issues = new Map((old.issues ?? []).map(issue => [issue.issueKey, issue]));
        for (const issue of update.issues) issues.set(issue.issueKey, clone(issue));
        for (const item of update.retiredIssues ?? []) issues.delete(item.issueKey);
        const overviewStatus = update.overview ? 'CURRENT' : update.issues.length ? 'STALE' : latest()?.overviewStatus ?? 'NOT_AVAILABLE';
        const content = { ...clone(old), ...clone(update), issues: [...issues.values()], readSourceRefs: [sourceRef], overviewStatus };
        const revision = { requestId: args.requestId, workRevisionRef: `fixture-work-revision-${records.length + 1}-${randomUUID()}`,
          workRevision: records.length + 1, actionAttemptId, workItemId, documentVersionId,
          basedOnWorkItemRevision: 1, overviewStatus,
          content };
        records.push(revision); requestRecords.set(args.requestId, { ...args, revision });
        log('SAVE_WORK', { requestId: args.requestId, workRevision: revision.workRevision, workRevisionRef: revision.workRevisionRef });
        return { workRevisionRef: revision.workRevisionRef, workRevision: revision.workRevision,
          roundCompletion: content.roundCompletion, synthetic: true };
      },
      readAssessmentWork: async ({ requestId } = {}) => {
        const revision = requestId ? requestRecords.get(requestId)?.revision : latest();
        log('READ_WORK', { requestId: requestId ?? null, workRevisionRef: revision?.workRevisionRef ?? null });
        return { schemaVersion: 'wiselink.jobaid-work-read.v2', attemptId: actionAttemptId,
          executionStatus: 'RUNNING', revision: revision ? clone(revision) : null, synthetic: true };
      },
    };
  };
  return { input, hooks, audit, latest: () => clone(latest()), marker, sourceRef,
    commitOverall: output => {
      if (output.workRevisionRef !== latest()?.workRevisionRef || !output.consistencyCheck || latest().overviewStatus !== 'CURRENT')
        die('FIXTURE_OVERALL_EXACT_WORK_REQUIRED');
      log('COMMIT_OVERALL', { workRevisionRef: output.workRevisionRef });
      return { synthetic: true, status: 'OVERALL_CANDIDATE_READY', basedOnJobAidWorkRevisionRef: output.workRevisionRef };
    },
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const option = (name, fallback) => { const i = argv.indexOf(name); return i < 0 ? fallback : argv[i + 1]; };
  const codexBinary = option('--codex', undefined);
  if (!codexBinary) throw new Error('Usage: node run-fixture.mjs --codex /absolute/path/to/codex [--run-root /path]');
  const runRoot = resolve(option('--run-root', './runs'));
  await mkdir(runRoot, { recursive: true, mode: 0o700 });
  const syntheticHost = createSyntheticHost();
  const runs = [];
  const callbacks = createCodexAssessmentCallbacks({ codexBinary, runRoot,
    // The fixture measures control/transport behavior, not engineering quality.
    // Vendor-documented lightweight reasoning fits this bounded synthetic case.
    reasoningEffort: 'low', maxOutputTokens: 16384,
    configPath: option('--config', '/home/gem/workspace/agent/openclaw.json'), hostMode: 'synthetic-fixture',
    onRunCompleted: async result => { runs.push(result); console.log(JSON.stringify({ stage: runs.length, finished: result.finished,
      model_requests: result.transport.model_requests, runDirectory: result.runDirectory })); },
  });
  const summary = { mode: 'REAL_MIAODA_MODEL_SYNTHETIC_HOST', realHostCalled: false, passed: false, runs: [], error: null };
  try {
    const initial = await callbacks.evaluateDynamicRules(syntheticHost.input(), syntheticHost.hooks());
    const initialRef = initial.output.workRevisionRef;
    if (initialRef !== syntheticHost.latest().workRevisionRef) die('FIXTURE_INITIAL_REF_MISMATCH');
    // Overall is a separate normal lifecycle callback over the exact saved work.
    // It may save a meaningful overview correction, or retain CURRENT work.
    const overall = await callbacks.synthesizeOverall(syntheticHost.input('OVERALL_CONSISTENCY'), syntheticHost.hooks());
    const commit = syntheticHost.commitOverall(overall.output);
    summary.initialWorkRevisionRef = initialRef;
    summary.finalWorkRevisionRef = overall.output.workRevisionRef;
    summary.overallCommit = commit;
    summary.savedRevisions = syntheticHost.audit.filter(item => item.action === 'SAVE_WORK').length;
    summary.independentReadbacks = syntheticHost.audit.filter(item => item.action === 'READ_WORK' && item.requestId).length;
    summary.passed = summary.savedRevisions > 0 && summary.independentReadbacks >= summary.savedRevisions && runs.every(item => item.finished && item.transport.transport_passed);
    // Synthetic only: never publish real-business contents through this evidence path.
    await writeFile(resolve(runRoot, 'fixture-work.json'), JSON.stringify(syntheticHost.latest(), null, 2) + '\n', { mode: 0o600 });
  } catch (error) {
    summary.error = /^[A-Z0-9_:]+$/.test(error.message) ? error.message : 'FIXTURE_RUN_FAILED';
  }
  summary.runs = runs.map(item => ({ ...item.transport, finished: item.finished }));
  summary.actions = syntheticHost.audit;
  await writeFile(resolve(runRoot, 'fixture-summary.json'), JSON.stringify(summary, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.passed ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('FIXTURE_RUN_FAILED'); process.exitCode = 1; });
}
