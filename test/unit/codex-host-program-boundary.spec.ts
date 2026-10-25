import 'reflect-metadata';
import { McpServer } from '@modelcontextprotocol/server';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CanonicalWorkItemProjection, UnifiedPackageArtifactDescriptor } from '@shared/api.interface';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import { JOBAID_PROBLEM_WORK_SCHEMA, type CanonicalJobAidProblemCandidateProjection, type JobAidWorkRevision } from '@shared/jobaid-problem-assessment.interface';
import { canonicalJson, parseTaskEnvelope, sealTaskEnvelope } from '../../server/modules/action-attempt/action-attempt-envelope';
import type { ActionAttemptRow, ReserveActionAttemptInput } from '../../server/modules/action-attempt/action-attempt.types';
import { assertPreparedInitialAnalysisInput, readInitialAnalysisRequestInput } from '../../server/modules/action-attempt/initial-analysis-request';
import { ConfiguredDevelopmentCanonicalServiceScopeAuthorization } from '../../server/modules/canonical-host/configured-development-service-scope.authorization';
import { CanonicalHostOpenClawMcpService } from '../../server/modules/canonical-host/canonical-host-openclaw-mcp.service';
import { CanonicalHostOpenClawDynamicEvaluationService } from '../../server/modules/canonical-host/canonical-host-openclaw-dynamic-evaluation.service';
import { CanonicalJobAidProblemService } from '../../server/modules/canonical-host/canonical-jobaid-problem.service';
import { projectCommonAssessmentContext } from '../../server/modules/canonical-host/canonical-host-common-context.service';
import { prepareDocumentOriginalEngineeringReader } from '../../server/modules/canonical-host/document-original-engineering-reading';
import { exactProgramWorkRead } from '../../server/modules/canonical-host/program-controlled-assessment';
import { buildJobAidOverallProjection } from '../../server/modules/canonical-host/jobaid-overall-projection';
import { jobAidReadingResult } from '../../server/modules/canonical-host/jobaid-problem-work';
import { assertJobAidWorkFence } from '../../server/modules/canonical-host/jobaid-work.repository';
import { JOBAID_METHOD_BINDING } from '../../server/modules/canonical-host/jobaid-method-pack';
import { taskModelSelection } from '../../server/modules/model-settings/canonical-model-catalog';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';

const REQUEST_1 = '00000000-0000-4000-8000-000000000101';
const REQUEST_2 = '00000000-0000-4000-8000-000000000102';
const TENANT = 'tenant-codex-synthetic';
const OWNER = 'owner-codex-synthetic';
const ENGLISH = `Synthetic source: Do not replace unless the indication persists after 5 seconds. ${'A normal inspection does not exclude intermittent failure. '.repeat(3)}Retain this final condition.`;
const scope = { tenantId: TENANT, workItemId: 'WI-CODEX-SYNTHETIC', principalId: 'service:codex-synthetic',
  appId: 'app_17bzc551rsg', authorizationFingerprint: 'synthetic-permission' };

interface ChildResult {
  ok: boolean;
  error?: string;
  execution?: {output: {workRevisionRef: string}; provenance: {toolVersions: Record<string, string>}};
  material?: {modelInput: {continuousOriginal: {content: string; spans: {evidenceRefs: string[]}[]}}};
  response?: {value: {raw: string}};
  saveRequest?: {requestId: string; workJson: string};
  modelStarted?: unknown;
}

// Every business operation below runs the actual Host service. Only identity,
// persistence and the model subprocess are constructed offline dependencies.
async function hostCycle(protocol: 'v2' | 'v3', count: number, useActualCodexScope = false) {
  const h = harness();
  const config = {WL_MODEL_EXECUTOR: 'CODEX', WL_CODEX_RUNTIME_APP_ID: 'app_syntheticcodex',
    WL_CODEX_SERVICE_SCOPE_ENABLED: '1', WL_CODEX_GATEWAY_AUTH_MODE: 'API_KEY', WL_CODEX_SERVICE_SCOPE_ENV: 'UAT',
    WL_CODEX_SERVICE_PRINCIPAL_ID: scope.principalId, WL_CODEX_SERVICE_TENANT_ID: TENANT,
    WL_CODEX_SERVICE_WORK_ITEM_ID: scope.workItemId, WL_CODEX_SERVICE_REQUEST_ID: h.current().requestId,
    WL_CODEX_SERVICE_AUTO_QUEUE_ENABLED: '1'};
  const savedEnvironment = Object.fromEntries(Object.keys(config).map((key: string) => [key, process.env[key]]));
  const authority = {authorizeActiveLease: jest.fn(async () => ({principalId: scope.principalId, tenantId: TENANT,
    workItemId: scope.workItemId, requestId: h.current().requestId, actorUserId: OWNER,
    documentId: h.current().source.documentId!, documentVersionId: h.current().source.documentVersionId,
    sourceArtifactId: h.current().source.sourceArtifactId!, sourceFileSha256: h.current().source.sourceFileSha256!,
    sourceByteLength: h.current().source.sourceByteLength!, leaseGeneration: 1, leaseExpiresAt: '2099-01-01T00:00:00Z'}))};
  const authorization = new ConfiguredDevelopmentCanonicalServiceScopeAuthorization(authority as never);
  const registered = new Map<string, {definition: {inputSchema: {parse(value: unknown): unknown}};
    handler: (value: unknown) => Promise<{content: {type: string; text: string}[]}>}>();
  const callMcp = async (name: string, input: unknown): Promise<unknown> => {
    await authorization.assertTransport({transport: 'CODEX_MCP'});
    const tool = registered.get(name);
    if (!tool) throw new Error('SYNTHETIC_MCP_TOOL_MISSING');
    const result = await tool.handler(tool.definition.inputSchema.parse(input));
    return JSON.parse(result.content[0].text) as unknown;
  };
  let dynamic: CanonicalHostOpenClawDynamicEvaluationService | null = null;
  if (useActualCodexScope) {
    Object.assign(process.env, config);
    Object.assign(h.service, {serviceScope: authorization});
    dynamic = new CanonicalHostOpenClawDynamicEvaluationService(h.registrar as never, h.artifactStore as never,
      {} as never, {} as never, {} as never, h.attempts as never, {} as never, authorization as never,
      {} as never, {} as never, h.service);
    const register = jest.spyOn(McpServer.prototype, 'registerTool').mockImplementation(function (
      name: string, definition: unknown, handler: unknown,
    ) {registered.set(name, {definition, handler} as never);
      return {remove: jest.fn(), enable: jest.fn(), disable: jest.fn(), update: jest.fn()} as never;});
    try {
      const mcp = new CanonicalHostOpenClawMcpService({} as never, dynamic, {} as never, {} as never,
        {} as never, {} as never, {} as never, {} as never, h.attempts as never, authorization, h.service);
      (mcp as unknown as {createServer(executor: 'CODEX'): McpServer}).createServer('CODEX');
    } finally {register.mockRestore();}
  }
  if (protocol === 'v3') Object.assign(h.service, {activityRuns: {}});
  const produced = await h.originalReader.readDocumentOriginal();
  const source = produced.original.source;
  const unit = source.units[0], locator = source.sourceLocators[0];
  source.units = Array.from({length: count}, (_, index) => ({...unit, unitId: `u-${index}`, order: index,
    sourceRefIds: [`PRUN:synthetic:source:${index}`], payload: {text: `Paragraph ${index}: ${ENGLISH}`}}));
  source.sourceLocators = source.units.map((entry, index) => ({...locator, sourceRefId: entry.sourceRefIds[0],
    pageStart: index, pageEnd: index}));
  produced.original.locations = source.units.map((entry, pageIndex) => ({...produced.original.locations[0],
    sourceRefId: entry.sourceRefIds[0], pageIndex}));
  produced.original.coverage = {knownPageCount: count,
    readPageIndexes: Array.from({length: count}, (_, index) => index), unresolvedRanges: []};
  const related = structuredClone(produced);
  related.original.binding.parseRunId = 'PR-RELATED-SYNTHETIC';
  related.run.parseRunId = 'PR-RELATED-SYNTHETIC';
  const reader = prepareDocumentOriginalEngineeringReader(related as unknown as Parameters<typeof prepareDocumentOriginalEngineeringReader>[0]);
  const relatedEvidence: AssessmentEvidence[] = [];
  for (let offset = 0; offset < count; offset += 20) relatedEvidence.push(...reader(offset, 20).evidence
    .map((entry: AssessmentEvidence) => ({...entry, workItemId: scope.workItemId})));
  h.originalReader.readDocumentOriginal.mockImplementation(async (...args: unknown[]) =>
    args[1] === 'PR-RELATED-SYNTHETIC' ? related : produced);
  Object.assign(h.service, {common: {buildForWorkItemWithEvidence: async () => ({
    common: projectCommonAssessmentContext(h.current(), {context: {status: 'UNAVAILABLE', reason: 'CONSTRUCTED_TEST'},
      documentReadingStatus: 'AVAILABLE', items: [], sections: [], resourceRefs: []}, []),
    availableReadingEvidence: relatedEvidence,
  })}});
  const history: JobAidWorkRevision[] = [], events: {method: string; input: unknown; output?: unknown}[] = [];
  Object.assign(h.work, {
    listForRuntime: jest.fn(async () => history),
    recordSourceRead: jest.fn(async (input: {row: ActionAttemptRow; sourceRefs: string[];
      fence: Parameters<typeof assertJobAidWorkFence>[1]}) => {
      assertJobAidWorkFence(input.row, input.fence);
      const records: unknown[] = JSON.parse(input.row.reviewActivityJson ?? '[]');
      records.push({kind: 'ASSESSMENT_SOURCES_READ', sourceRefs: input.sourceRefs});
      input.row.reviewActivityJson = canonicalJson(records);
    }),
    save: jest.fn(async (input: {row: ActionAttemptRow; requestId: string; expectedWorkRevision: number;
      content: JobAidWorkRevision['content']; fence: Parameters<typeof assertJobAidWorkFence>[1]}) => {
      assertJobAidWorkFence(input.row, input.fence);
      const replay = history.find((entry: JobAidWorkRevision) => entry.requestId === input.requestId);
      if (replay) return {revision: replay, replayed: true};
      if ((history[0]?.workRevision ?? 0) !== input.expectedWorkRevision) throw new Error('SYNTHETIC_CAS_CONFLICT');
      const revision: JobAidWorkRevision = {workRevisionRef: `JAWR-SYNTHETIC-${history.length + 1}`,
        workItemId: scope.workItemId, workRevision: input.expectedWorkRevision + 1,
        previousWorkRevisionRef: history[0]?.workRevisionRef ?? null, requestId: input.requestId,
        actionAttemptId: input.row.attemptId, basedOnWorkItemRevision: input.row.baseRevision,
        documentVersionId: input.row.documentVersionId!, createdAt: '2026-10-25T00:00:00Z', content: input.content};
      history.unshift(revision);
      return {revision, replayed: false};
    }),
  });
  const artifactBytes = new Map<string, Uint8Array>();
  h.artifactStore.persistAndReadback.mockImplementation(async (...args: unknown[]) => {
    const bytes = args[0] as Uint8Array;
    const artifact = {ref: `artifact://synthetic-materials-${artifactBytes.size + 1}`,
      sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.byteLength,
      mediaType: 'application/json', storeRole: 'UnifiedArtifactStoreCandidate'};
    artifactBytes.set(artifact.ref, bytes);
    return {artifact, bytes};
  });
  await h.service.enqueueContinuation(h.current(), TENANT, 'synthetic-permission', REQUEST_1,
    'INITIAL_PROBLEM_ASSESSMENT', undefined, undefined, undefined, {modelRef: 'miaoda/glm-5.3'});
  const started = useActualCodexScope
    ? await callMcp('begin_dynamic_evaluation', {workItemId: scope.workItemId, requestId: REQUEST_1}) as Awaited<ReturnType<typeof h.service.begin>>
    : await h.service.begin(h.current(), scope, 'INITIAL_PROBLEM_ASSESSMENT', REQUEST_1);
  const row = h.rows.get(started.attemptRef)!;
  Object.assign(row, {attemptId: started.task.actionAttemptId, tenantId: TENANT, workItemId: scope.workItemId,
    documentVersionId: started.task.documentVersionId, inputRevision: started.task.inputRevision,
    baseRevision: started.task.baseRevision, taskInputHash: started.task.inputHash,
    leaseOwner: scope.principalId, leaseToken: started.leaseToken, leaseGeneration: started.leaseGeneration,
    leaseExpiresAt: new Date('2099-01-01'), deadlineAt: new Date('2099-01-01'), cancelRequestedAt: null});
  const fence = {attemptRef: started.attemptRef, workItemId: scope.workItemId,
    leaseToken: started.leaseToken, leaseGeneration: started.leaseGeneration};
  let failSaveBeforeCommit = false, loseSaveAck = false;
  const invoke = async (call: {method: string; payload: Record<string, unknown>}) => {
    const event: {method: string; input: unknown; output?: unknown} = {method: call.method, input: call.payload};
    events.push(event);
    const input = {...fence, ...call.payload};
    if (useActualCodexScope) {
      const names: Record<string, string> = {sources: 'read_assessment_sources', progress: 'record_assessment_program_progress',
        save: 'save_assessment_work', work: 'read_assessment_work'};
      event.output = await callMcp(names[call.method], input);
      return event.output;
    }
    if (call.method === 'sources') event.output = await h.service.readSources(input as Parameters<typeof h.service.readSources>[0]);
    else if (call.method === 'progress') event.output = await h.service.recordProgramProgress(input as Parameters<typeof h.service.recordProgramProgress>[0]);
    else if (call.method === 'save') {
      if (failSaveBeforeCommit) {failSaveBeforeCommit = false; throw new Error('SYNTHETIC_SAVE_UNAVAILABLE');}
      event.output = await h.service.saveWork(input as Parameters<typeof h.service.saveWork>[0]);
      if (loseSaveAck) {loseSaveAck = false; throw new Error('SYNTHETIC_SAVE_ACK_LOST');}
    } else if (call.method === 'work') event.output = await h.service.readAttemptWork(fence.attemptRef,
      call.payload.requestId as string | undefined, fence.workItemId, fence,
      call.payload.workRevisionRef as string | undefined);
    else throw new Error('UNEXPECTED_SYNTHETIC_INTENT');
    return event.output;
  };
  const root = await mkdtemp(join(tmpdir(), 'codex-host-boundary-'));
  const ref = started.modelInput.availableSources.find((entry) => entry.kind === 'DOCUMENT_PASSAGE' && entry.parseRunId === 'PR-TEST-2')!.ref;
  const candidate = {schemaVersion: 'wiselink.jobaid-problem-work.v3', headline: '持续指示条件尚待核对',
    listBrief: '单次正常检查不能排除间歇故障，须先确认五秒条件。',
    overview: `本合成案例保留五秒条件及间歇故障限制；当前状态仍待核。[[${ref}]]`,
    roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS', completionReason: '合成原文分析已完成，实际构型尚未取得。',
    changeSummary: '完整保留条件和未知，形成合成工作。', issues: [{issueKey: 'condition', question: '何时可更换？',
      body: `原文规定，指示持续超过五秒才可更换；单次正常检查仍不能排除间歇故障。[[${ref}]]`,
      riskScenarios: [], measures: [], otherClassifications: [], requirementHandling: [], openQuestions: [
        {question: '当前指示是否持续超过五秒？', affects: '更换条件', nextEvidence: '合成运行记录', reason: '本轮未取得'}]}]};
  const candidatePath = join(root, 'candidate.json');
  await writeFile(candidatePath, JSON.stringify(candidate));
  const wrapper = join(root, 'offline-python');
  const fake = join(root, 'offline-runner.py');
  await writeFile(fake, `import json,pathlib,sys\nr=json.load(sys.stdin)\np=pathlib.Path(r['run_directory'])\np.mkdir(mode=0o700)\n(p/'request.synthetic.json').write_text(json.dumps(r))\nwork=json.loads(pathlib.Path(${JSON.stringify(candidatePath)}).read_text())\n(p/'contract-candidate.json').write_text(json.dumps({'tool_name':'return_wiselink_program_assessment','arguments':{'workJson':json.dumps(work,ensure_ascii=False)}}))\nprint(json.dumps({'transport_passed':True,'upstream_models':['glm-5.3'],'input_tokens':10,'output_tokens':5,'model_requests':1,'closure':'completed'}))\n`.replace(/\\n/gu, '\n'));
  await writeFile(wrapper, `#!/bin/sh\nexec python3 '${fake}'\n`.replace(/\\n/gu, '\n'), {mode: 0o700});
  const childSource = `
    import {pathToFileURL} from 'node:url';
    import {readFile,readdir} from 'node:fs/promises';
    const base=process.argv[1];
    const {invokeHostedInitialModel}=await import(pathToFileURL(base+'/openclaw/skills/wiselink-research-and-synthesize/scripts/invoke-hosted-initial-model.mjs'));
    const {createCheckpointStore}=await import(pathToFileURL(base+'/openclaw/skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs'));
    let raw='';for await(const chunk of process.stdin)raw+=chunk;
    const input=JSON.parse(raw), checkpoint=await createCheckpointStore(input.root+'/checkpoint');
    const pending=new Map();let nextId=0;
    process.on('message',message=>{const waiter=pending.get(message.id);if(!waiter)return;
      pending.delete(message.id);message.error?waiter.reject(new Error(message.error)):waiter.accept(message.value);});
    const rpc=(method,payload)=>new Promise((accept,reject)=>{const id=++nextId;pending.set(id,{accept,reject});process.send({id,method,payload});});
    const options={modelExecutor:'CODEX',codexOptions:{codexBinary:'/synthetic/no-model',configPath:'/synthetic/no-credentials',
      runRoot:input.root,pythonBinary:input.wrapper},executionModel:input.started.task.executionModel,
      registeredModelRefs:['miaoda/glm-5.3'],sessionDiscriminator:'synthetic-codex-program',taskDeadline:'2099-01-01T00:00:00Z',
      assessmentCheckpoint:checkpoint,assessmentBinding:{documentVersionId:input.started.task.documentVersionId},
      readAssessmentSources:request=>rpc('sources',request),readAssessmentWork:request=>rpc('work',request),
      saveAssessmentWork:request=>rpc('save',request),recordAssessmentProgramProgress:request=>rpc('progress',request),heartbeat:async()=>{}};
    if(input.scenario==='response-write-fail'){const write=checkpoint.writeOnce;checkpoint.writeOnce=async(key,value)=>{
      if(key==='assessment-round-1.result')throw new Error('SYNTHETIC_RESPONSE_DISK_UNAVAILABLE');return write(key,value);};}
    const result={};try{result.execution=await invokeHostedInitialModel({operation:'EVALUATE_JOBAID',modelInput:input.started.modelInput},options);result.ok=true;}
    catch(error){result.ok=false;result.error=error.message;}
    result.material=await checkpoint.readOptional('program-materials');result.response=await checkpoint.readOptional('assessment-round-1.result');
    result.saveRequest=await checkpoint.readOptional('program-save-request');result.modelStarted=await checkpoint.readOptional('assessment-round-1.started');
    process.stdout.write(JSON.stringify(result));process.disconnect();
  `;
  const run = async (scenario = 'normal'): Promise<ChildResult> => new Promise((accept, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', childSource, process.cwd()], {stdio: ['pipe', 'pipe', 'pipe', 'ipc']});
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {stdout += chunk;});
    child.stderr.on('data', (chunk: string) => {stderr += chunk;});
    child.on('message', async (message: {id: number; method: string; payload: Record<string, unknown>}) => {
      try {child.send({id: message.id, value: await invoke(message)});}
      catch (error) {child.send({id: message.id, error: error instanceof Error ? error.message : String(error)});}
    });
    child.once('error', reject);
    child.once('close', (code: number | null) => {
      if (code !== 0 || stderr) {reject(new Error(`SYNTHETIC_CHILD_FAILED:${code}:${stderr}`)); return;}
      try {accept(JSON.parse(stdout) as ChildResult);} catch (error) {reject(error);}
    });
    child.stdin.end(JSON.stringify({root, wrapper, started, scenario}));
  });
  return {...h, root, started, history, events, artifactBytes, candidate, run, authority, callMcp, fence,
    failNextSave: () => {failSaveBeforeCommit = true;}, loseNextSaveAck: () => {loseSaveAck = true;},
    breakRunner: () => writeFile(fake, 'raise SystemExit(17)\n'),
    close: async () => {
      if (useActualCodexScope) for (const [key, value] of Object.entries(savedEnvironment)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      await rm(root, {recursive: true, force: true});
    }};
}

describe('actual Host producer to CODEX program boundary (offline synthetic model)', () => {
  const originalFlag = process.env.WL_JOBAID_PROBLEM_V2_ENABLED;
  const configKeys = ['WL_MODEL_EXECUTOR', 'WL_CODEX_RUNTIME_APP_ID', 'WL_CODEX_SERVICE_SCOPE_ENABLED',
    'WL_CODEX_GATEWAY_AUTH_MODE', 'WL_CODEX_SERVICE_SCOPE_ENV', 'WL_CODEX_SERVICE_PRINCIPAL_ID',
    'WL_CODEX_SERVICE_TENANT_ID', 'WL_CODEX_SERVICE_WORK_ITEM_ID', 'WL_CODEX_SERVICE_REQUEST_ID',
    'WL_CODEX_SERVICE_AUTO_QUEUE_ENABLED'];
  let boundaryEnvironment: Record<string, string | undefined>;
  beforeEach(() => {
    boundaryEnvironment = Object.fromEntries(configKeys.map((key: string) => [key, process.env[key]]));
    process.env.WL_JOBAID_PROBLEM_V2_ENABLED = '1';
  });
  afterEach(() => {
    if (originalFlag === undefined) delete process.env.WL_JOBAID_PROBLEM_V2_ENABLED;
    else process.env.WL_JOBAID_PROBLEM_V2_ENABLED = originalFlag;
    for (const [key, value] of Object.entries(boundaryEnvironment)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  it.each([{protocol: 'v2' as const, count: 100}, {protocol: 'v3' as const, count: 100}, {protocol: 'v3' as const, count: 1}])(
    'uses actual $protocol begin/read_sources projections, normal SAVE and independent READ for $count refs', async ({protocol, count}) => {
      const h = await hostCycle(protocol, count);
      try {
        const before = structuredClone(h.started.modelInput);
        const originalEvidence = h.started.modelInput.deliveredEvidence.filter((entry) => entry.kind === 'DOCUMENT_PASSAGE');
        expect(originalEvidence.every((entry) => !Object.hasOwn(entry, 'documentVersionId') && !Object.hasOwn(entry, 'sourceRefId'))).toBe(true);
        const result = await h.run();
        expect(result.error).toBeUndefined();
        expect(result).toMatchObject({ok: true, execution: {output: {workRevisionRef: 'JAWR-SYNTHETIC-1'},
          provenance: {toolVersions: {'model-executor': 'CODEX', 'program-controlled-assessment': '1'}}}});
        expect(h.started.modelInput).toEqual(before);
        expect(h.events.filter((event) => event.method === 'sources').map((event) =>
          (event.input as {sourceRefs: string[]}).sourceRefs.length)).toEqual(count === 100 ? [96, 4] : [1]);
        expect(result.material!.modelInput.continuousOriginal.spans).toHaveLength(count);
        expect(result.material!.modelInput.continuousOriginal.content).toContain(`Paragraph ${count - 1}:`);
        expect(result.material!.modelInput.continuousOriginal.spans.every((span) => span.evidenceRefs.length === 1)).toBe(true);
        expect(h.events.filter((event) => event.method === 'save')).toHaveLength(1);
        const reads = h.events.filter((event) => event.method === 'work');
        expect(reads).toHaveLength(2);
        expect(reads.map((event) => (event.input as {requestId: string}).requestId)).toEqual([result.saveRequest!.requestId, result.saveRequest!.requestId]);
        expect(h.history[0].content.understanding).toBe(h.candidate.overview);
        expect(h.work.recordWorkRead).toHaveBeenCalledTimes(1);
        expect(h.artifactBytes.size).toBe(1);
        expect(result.response!.value.raw).toContain('codex-structured-final-to-function-contract-v1');
        const generations = (await readdir(h.root)).filter((entry) => entry.startsWith('generation-'));
        expect(generations).toHaveLength(1);
        await h.run();
        expect((await readdir(h.root)).filter((entry) => entry.startsWith('generation-'))).toHaveLength(1);
        expect(h.events.filter((event) => event.method === 'save')).toHaveLength(1);
        const saved = h.history[0];
        const readObservation = exactProgramWorkRead(h.rows.get(h.started.attemptRef)!, saved);
        const readingResult = jobAidReadingResult(saved);
        const bytes = new TextEncoder().encode(canonicalJson(saved));
        const artifact: UnifiedPackageArtifactDescriptor = {ref: 'artifact://synthetic-work-revision',
          sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.byteLength,
          mediaType: 'application/json', storeRole: 'UnifiedArtifactStoreCandidate'};
        // The base descriptor is constructed input to these pure functions;
        // this does not invoke commit/CAS or claim terminal completion.
        if (saved.content.roundCompletion === 'IN_PROGRESS') throw new Error('SYNTHETIC_WORK_NOT_COMPLETE');
        const baseRules: CanonicalJobAidProblemCandidateProjection = {
          schemaVersion: 'wiselink.jobaid-problem-result.v2', status: 'CANDIDATE_ONLY', revision: 1,
          sourceResultId: 'synthetic-pure-base', workRevisionRef: saved.workRevisionRef,
          workRevision: saved.workRevision, issueCount: saved.content.issues.length,
          openQuestionCount: saved.content.issues.reduce((sum, issue) => sum + issue.openQuestions.length, 0), roundCompletion: saved.content.roundCompletion,
          methodBinding: saved.content.methodBinding, headline: saved.content.headline,
          listBrief: saved.content.listBrief, artifact, actionAttemptId: saved.actionAttemptId, readingResult};
        const overall = buildJobAidOverallProjection({workItem: {...h.current(), integratedAssessment: {
          status: 'BASE_RULE_CANDIDATE_READY', baseRules, engineerReviews: null,
          overallSynthesis: null, overallForAeoConfirmation: null}}, revision: saved, artifact,
          actionAttemptId: saved.actionAttemptId, sourceResultId: 'synthetic-pure-overall',
          applicabilityStatus: 'UNKNOWN', deterministicAssessmentSource: readObservation});
        expect(overall).toMatchObject({executionKind: 'DETERMINISTIC_PROJECTION', modelRequests: 0,
          authorityLevel: 'candidate_only', basedOnJobAidWorkRevisionRef: saved.workRevisionRef,
          overallCandidate: saved.content.understanding, sourceAssessment: readObservation});
        if (process.env.CODEX_HOST_SYNTHETIC_OUTPUT && protocol === 'v3' && count === 1) {
          const {root: _root, ...candidateResult} = result as ChildResult & {root?: string};
          await writeFile(process.env.CODEX_HOST_SYNTHETIC_OUTPUT, JSON.stringify({synthetic: true, realHostCalled: false,
            actualServiceMethods: ['begin', 'readSources', 'recordProgramProgress', 'saveWork', 'readAttemptWork'],
            modelExecution: 'OFFLINE_SUBPROCESS_STUB', started: h.started, events: h.events, history: h.history,
            result: candidateResult, overall: {status: 'NOT_EXERCISED'}, attemptCompletion: {status: 'NOT_EXERCISED'}}, null, 2));
          await writeFile(join(dirname(process.env.CODEX_HOST_SYNTHETIC_OUTPUT), 'deterministic-projection.synthetic.json'),
            JSON.stringify({synthetic: true, realHostCalled: false, execution: 'PURE_FUNCTIONS_ONLY',
              methods: ['exactProgramWorkRead', 'jobAidReadingResult', 'buildJobAidOverallProjection'],
              baseFixture: baseRules, savedRevision: saved, independentReadObservation: readObservation,
              readingResult, overall, commitCasAndFinish: 'NOT_EXERCISED'}, null, 2));
        }
      } finally {await h.close();}
    }, 30_000);

  it('routes actual CODEX MCP tool handlers through exact configured scope and rechecks the live intake lease', async () => {
    const h = await hostCycle('v3', 1, true);
    try {
      const result = await h.run();
      expect(result.error).toBeUndefined();
      expect(result.ok).toBe(true);
      expect(h.started.task.modelInput.automaticWorkItemLease).toMatchObject({requestId: 'REQUEST-WORK-ITEM', leaseGeneration: 1});
      expect(h.authority.authorizeActiveLease.mock.calls.length).toBeGreaterThan(3);
      expect(h.history).toHaveLength(1);
      const lease = await h.authority.authorizeActiveLease();
      h.authority.authorizeActiveLease.mockResolvedValue({...lease, requestId: 'REQ-unrelated-intake'});
      await expect(h.callMcp('read_assessment_work', {...h.fence, requestId: result.saveRequest!.requestId}))
        .rejects.toThrow('CANONICAL_CODEX_REQUEST_SCOPE_MISMATCH');
      expect((await readdir(h.root)).filter((entry) => entry.startsWith('generation-'))).toHaveLength(1);
    } finally {await h.close();}
  }, 30_000);

  it.each(['lost-save-ack', 'save-unavailable', 'unknown-model', 'response-write-fail'])(
    'resumes only exact saved work/complete response and fences unknown generation: %s', async (scenario) => {
      const h = await hostCycle('v3', 1);
      try {
        if (scenario === 'lost-save-ack') h.loseNextSaveAck();
        if (scenario === 'save-unavailable') h.failNextSave();
        if (scenario === 'unknown-model') await h.breakRunner();
        const first = await h.run(scenario);
        if (scenario === 'lost-save-ack') expect(first.ok).toBe(true);
        else expect(first.ok).toBe(false);
        const next = await h.run();
        if (scenario === 'unknown-model' || scenario === 'response-write-fail') {
          expect(next.error).toBe('PROGRAM_ASSESSMENT_MODEL_OUTCOME_UNKNOWN');
          expect(h.events.filter((event) => event.method === 'save')).toHaveLength(0);
          expect(h.history).toHaveLength(0);
        } else {
          expect(next.ok).toBe(true);
          expect(h.history).toHaveLength(1);
          expect(first.response).toEqual(next.response);
          expect(first.saveRequest).toEqual(next.saveRequest);
          expect(h.events.filter((event) => event.method === 'save')).toHaveLength(scenario === 'save-unavailable' ? 2 : 1);
        }
        expect((await readdir(h.root)).filter((entry) => entry.startsWith('generation-'))).toHaveLength(scenario === 'unknown-model' ? 0 : 1);
      } finally {await h.close();}
    }, 30_000);
});

function harness() {
  let current = projection();
  const rows = new Map<string, ActionAttemptRow>();
  const task = (attemptRef: string) =>
    parseTaskEnvelope(rows.get(attemptRef)!.taskEnvelopeJson!);
  const registrar = {
    getTenantScopedByWorkItemId: jest.fn(async () => current),
    compareAndSet: jest.fn(
      async (input: {
        expectedRevision: number;
        next: Omit<CanonicalWorkItemProjection, 'revision'>;
      }) => {
        if (input.expectedRevision !== current.revision)
          throw new Error('TEST_CAS_CONFLICT');
        current = { ...input.next, revision: input.expectedRevision + 1 };
        return structuredClone(current);
      },
    ),
  };
  const artifactStore = {
    persistAndReadback: jest.fn(async () => ({artifact:{ref:'NEW',sha256:'b'.repeat(64),byteLength:100,mediaType:'application/json',storeRole:'U0_PARSED_PACKAGE'}})),
    readActualBytes: jest.fn(async () =>
      new TextEncoder().encode(
        JSON.stringify({
          sourceRefs: [
            { sourceRefId: 'SR-1', pageStart: 1, pageEnd: 1, quote: ENGLISH },
          ],
        }),
      ),
    ),
  };
  const workItems = {
    loadTenantScopedProjection: jest.fn(async () => ({
      row: {
        requestedByUserId: OWNER,
        documentVersionId: current.source.documentVersionId,
      },
      projection: current,
    })),
    loadAuthorizationBinding: jest.fn(async () => ({
      documentVersionId: current.source.documentVersionId,
    })),
  };
  const actorExecutor = { kind: 'host-owner-transaction' };
  const work = {
    recordProgramProgress: jest.fn(async (input: unknown) => {
      const record = input as {row: ActionAttemptRow; fence: Parameters<typeof assertJobAidWorkFence>[1];
        phase: string; checkpointRef: string; materialsArtifact?: unknown};
      assertJobAidWorkFence(record.row, record.fence);
      const persisted = rows.get(record.row.operationRef!)!;
      const observations: unknown[] = JSON.parse(persisted.reviewActivityJson ?? '[]');
      observations.push({kind: 'ASSESSMENT_PROGRAM_PROGRESS', phase: record.phase,
        checkpointRef: record.checkpointRef, materialsArtifact: record.materialsArtifact});
      persisted.reviewActivityJson = canonicalJson(observations);
    }),
    recordWorkRead: jest.fn(async (input: {row: ActionAttemptRow; revision: JobAidWorkRevision}) => {
      const persisted = rows.get(input.row.operationRef!)!;
      const observations: unknown[] = JSON.parse(persisted.reviewActivityJson ?? '[]');
      observations.push({kind: 'ASSESSMENT_WORK_READ', workRevisionRef: input.revision.workRevisionRef,
        workRevision: input.revision.workRevision, saveRequestId: input.revision.requestId,
        observedAt: '2026-10-25T01:00:00.000Z'});
      persisted.reviewActivityJson = canonicalJson(observations);
    }),
    publishedOriginalBinding: jest.fn(async () => ({parseRunId:'PR-TEST-2'})),
    publishedOriginalBindingForRequest: jest.fn(async () => ({parseRunId:'PR-TEST-2'})),
    withActorScope: jest.fn(async (_actor: string, operation: () => Promise<unknown>) => operation()),
    listForRuntime: jest.fn(async (): Promise<JobAidWorkRevision[]> => []),
    listHeadersForRuntime: jest.fn(async (input: unknown) =>
      (await work.listForRuntime(input as never)).map(
        ({ workRevisionRef, workRevision }) => ({
          workRevisionRef,
          workRevision,
        }),
      ),
    ),
    readByRefForRuntime: jest.fn(
      async (): Promise<JobAidWorkRevision | null> => savedWork(),
    ),
    withActorTransaction: jest.fn(
      async (
        _actorUserId: string,
        operation: (database: typeof actorExecutor) => Promise<unknown>,
      ) => operation(actorExecutor),
    ),
    loadOwnedSourceBinding: jest.fn(async () => ({
      kind:'SOURCE_FILE',
      workItemId: current.workItemId,
      documentVersionId: current.source.documentVersionId,
      artifactRef: current.source.sourceArtifactId,
      artifactSha256: current.source.sourceFileSha256,
    })),
  };
  const conversations = {
    loadOpenClawTurnByIdBinding: jest.fn(),
    hasActiveOfficialActorMapping: jest.fn(async () => true),
  };
  const attempts = {
    prepareCommit: jest.fn(),
    finishProjectionSuccess: jest.fn(),
    finishProjectionConflict: jest.fn(),
    finishResultGateFailure: jest.fn(),
    readScoped: jest.fn(async (input: {attemptRef:string}) => {
      const row = rows.get(input.attemptRef)!;
      const envelope = task(input.attemptRef);
      return { ...row, attemptId: envelope.actionAttemptId,
        tenantId: envelope.tenantId, workItemId: envelope.workItemId,
        actionType: envelope.taskType };
    }),
    readScopedById: jest.fn(async (input: {attemptId:string}) => {
      const row = [...rows.values()].find((item) =>
        parseTaskEnvelope(item.taskEnvelopeJson!).actionAttemptId === input.attemptId);
      if (!row) return null;
      const envelope = parseTaskEnvelope(row.taskEnvelopeJson!);
      return { ...row, tenantId: envelope.tenantId, workItemId: envelope.workItemId,
        actionType: envelope.taskType, documentVersionId: envelope.documentVersionId,
        baseRevision: envelope.baseRevision };
    }),
    readRequest: jest.fn(
      async (input: { idempotencyKey: string }) =>
        [...rows.values()].find(
          (row) =>
            task(row.operationRef!).idempotencyKey === input.idempotencyKey,
        ) ?? null,
    ),
    readRequestIdentity:jest.fn(async(input:{idempotencyKey:string})=>{
      const row=[...rows.values()].find(value=>task(value.operationRef!).idempotencyKey===input.idempotencyKey);
      return row?{operationRef:row.operationRef,status:row.status}:null;
    }),
    reserve: jest.fn(async (input: ReserveActionAttemptInput) => {
      const operationRef = `AQ-CONTINUATION-${rows.size + 1}`;
      const actionAttemptId = `ATT-CONTINUATION-${rows.size + 1}`;
      const envelope = sealTaskEnvelope({
        schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
        actionAttemptId,
        operationRef,
        taskType: input.taskType,
        priority: 100,
        tenantId: input.tenantId,
        workItemId: input.workItemId,
        inputRevision: input.inputRevision,
        baseRevision: input.baseRevision,
        documentVersionId: input.documentVersionId,
        sourceRefs: input.sourceRefs!,
        allowedConnectors: input.allowedConnectors ?? [],
        hostResolvedMissingInputs: [],
        ...(input.programControlled ? {executionModel: taskModelSelection(input.programControlled.modelRef)} : {}),
        modelInput: await input.buildModelInput({
          attemptId: actionAttemptId,
          operationRef,
          triggerRequestId: 'TRIGGER-CONTINUATION',
          attemptNo: rows.size + 1,
          createdAt: new Date('2026-09-09T00:00:00.000Z'),
        }),
        deadline: '2099-01-01T00:00:00.000Z',
        idempotencyKey: input.idempotencyKey,
      });
      const row = {
        operationRef,
        status: 'QUEUED', claimCount: 0, leaseGeneration: 0, leaseOwner: null,
        taskEnvelopeJson: canonicalJson(envelope),
      } as ActionAttemptRow;
      rows.set(operationRef, row);
      return { row, task: envelope, created: true };
    }),
    reserveAndClaim: jest.fn(async (input: ReserveActionAttemptInput) => {
      const existing = await attempts.readRequest(input);
      const reserved = existing
        ? { row: existing, task: task(existing.operationRef!) }
        : await attempts.reserve(input);
      const pendingRequest = readInitialAnalysisRequestInput(reserved.task);
      if (pendingRequest) {
        const { inputHash: _oldHash, ...pending } = reserved.task;
        reserved.task = sealTaskEnvelope({
          ...pending,
          modelInput: await input.buildModelInput({
            attemptId: pending.actionAttemptId,
            operationRef: pending.operationRef,
            triggerRequestId: 'TRIGGER-CONTINUATION',
            attemptNo: 1,
            createdAt: new Date('2026-09-09T00:00:00.000Z'),
          }),
        });
        assertPreparedInitialAnalysisInput(pendingRequest, reserved.task.modelInput);
        reserved.row.taskEnvelopeJson = canonicalJson(reserved.task);
      }
      reserved.row.status = 'RUNNING';
      return {
        attemptRef: reserved.task.operationRef,
        status: 'RUNNING',
        leaseToken: REQUEST_2,
        leaseGeneration: 1,
        leaseExpiresAt: '2099-01-01T00:00:00.000Z',
        task: reserved.task,
      };
    }),
  };
  const originalReader = { readDocumentOriginal: jest.fn(async () => {
      const original = originalFixture(); original.binding.documentVersionId=current.source.documentVersionId;
      original.source.units = [original.source.units[0]];
      original.source.units[0].payload = {text:ENGLISH};
      return {original,structuredSource:original.source,run:{...original.binding,
        manifestArtifact:{relativePath:'original/manifest.json',readback:'VERIFIED',sha256:'b'.repeat(64),byteLength:100}}};
    }) };
  const service = new CanonicalJobAidProblemService(
    registrar as never,
    artifactStore as never,
    { authorizeOpenClawAttempt: jest.fn(async () => scope) } as never,
    {} as never,
    {} as never,
    attempts as never,
    workItems as never,
    conversations as never,
    {
      buildForWorkItemWithEvidence: jest.fn(async () => ({
        common: projectCommonAssessmentContext(
          current,
          {
            context: { status: 'UNAVAILABLE', reason: 'SYNTHETIC_TEST' },
            documentReadingStatus: 'AVAILABLE',
            items: [],
            sections: [],
            resourceRefs: [],
          },
          [],
        ),
        availableReadingEvidence: [],
      })),
    } as never,
    work as never,
    undefined,
    originalReader as never,
    { read: jest.fn().mockResolvedValue(null) } as never,
  );
  return {
    service,
    originalReader,
    rows,
    task,
    registrar,
    artifactStore,
    attempts,
    work,
    conversations,
    actorExecutor,
    current: () => current,
    advanceRevision: () => {
      current = { ...current, revision: current.revision + 1 };
    },
    enqueue: (
      requestId: string,
      purpose:
        | 'INITIAL_PROBLEM_ASSESSMENT'
        | 'OVERALL_CONSISTENCY' = 'INITIAL_PROBLEM_ASSESSMENT',
    ) =>
      service.enqueueContinuation(
        current,
        TENANT,
        'permission-browser',
        requestId,
        purpose,
      ),
  };
}

function projection(): CanonicalWorkItemProjection {
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: scope.workItemId,
    requestId: 'REQUEST-WORK-ITEM',
    revision: 5,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    permissionSnapshotVersion: 'permission-browser',
    parseAuthorization: {
      action: 'PARSE_PDF',
      actorFingerprint: 'actor',
      decisionId: 'decision',
      decisionHash: 'hash',
      permissionSnapshotVersion: 'permission-browser',
    },
    source: { documentId: 'DOC-JOBAID', documentVersionId: 'DV-SYNTHETIC',sourceArtifactId:'ART-TEST',sourceFileSha256:'a'.repeat(64),sourceByteLength:1234 },
    classification: { status: 'CONFIRMED', normalizedFamily: 'SB' },
    package: {
      packageId: 'PKG-JOBAID',
      title: 'Synthetic English source',
      artifact: {
        ref: 'artifact://english-package',
        sha256: 'a'.repeat(64),
        byteLength: 100,
        storeRole: 'U0_PARSED_PACKAGE',
        mediaType: 'application/json',
      },
    },
    integratedAssessment: null,
    failure: null,
    recordingFailure: null,
  } as unknown as CanonicalWorkItemProjection;
}

function savedWork(): JobAidWorkRevision {
  return {
    workRevisionRef: 'JAWR-PERSISTED-3',
    workItemId: scope.workItemId,
    workRevision: 3,
    previousWorkRevisionRef: 'JAWR-PERSISTED-2',
    requestId: 'SAVE-3',
    actionAttemptId: 'ATT-PRIOR',
    basedOnWorkItemRevision: 5,
    documentVersionId: 'DV-SYNTHETIC',
    createdAt: '2026-09-08T00:00:00.000Z',
    content: {
      schemaVersion: JOBAID_PROBLEM_WORK_SCHEMA,
      overviewStatus: 'CURRENT',
      headline: '单次正常检查不能排除间歇故障',
      listBrief: '继续核查持续状态。',
      understanding: `已保存的完整认识及条件：${ENGLISH}`,
      decisiveIssueKeys: [],
      issues: [],
      roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS',
      completionReason: '本轮已完成，保持现有未知。',
      changeSummary: '保留此前工作。',
      unchangedExplanation: '未修改内容完整继承。',
      methodBinding: structuredClone(JOBAID_METHOD_BINDING),
      evidence: [],
      readSourceRefs: [],
      capabilities: [],
      historyReview: {
        required: false,
        priorAssessmentRefs: [],
        engineeringDocumentRefs: [],
        coverage: 'NOT_REQUIRED',
        limitation: null,
      },
    },
  };
}
