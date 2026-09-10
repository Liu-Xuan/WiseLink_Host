import { join } from 'node:path';
import { canonicalSha256, validateRuntimeProvenance } from './validate-payload.mjs';
import { createCheckpointStore } from './run-hosted-review-turn.mjs';

/** Called by a subject-scoped native job; lifecycle and leases remain Host-owned. */
export async function consumeHostedMatter(options, dependencies) {
  const pending = await dependencies.callTool('next_matter_assessment', { matterId: options.matterId });
  if (pending?.matterId !== options.matterId) throw new Error('MATTER_PENDING_BINDING_MISMATCH');
  if (!pending.next) return { status: 'IDLE', matterId: options.matterId };
  const target = { matterId: options.matterId, attemptRef: pending.next.attemptRef };
  if (!['QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'].includes(pending.next.status))
    return { status: 'REQUIRES_ATTENTION', ...target, attemptStatus: pending.next.status };
  const claim = await dependencies.callTool('matter_action_attempt', { ...target, operation: 'CLAIM' });
  const task = claim.task;
  if (claim.attemptRef !== target.attemptRef || task?.schemaVersion !== 'wiselink.3_1.openclaw_task_envelope.v2' ||
    task.taskType !== 'OPENCLAW_MATTER_ASSESSMENT' || task.subject?.kind !== 'ENGINEERING_MATTER' ||
    task.subject.matterId !== target.matterId || task.operationRef !== target.attemptRef || !task.inputHash ||
    task.modelInput?.schemaVersion !== 'wiselink.matter-jobaid-task.v2') throw new Error('MATTER_CLAIM_BINDING_MISMATCH');
  const fence = { ...target, leaseToken: claim.leaseToken, leaseGeneration: claim.leaseGeneration };
  const call = (operation, input = {}) => dependencies.callTool('matter_action_attempt', { ...fence, operation, ...input });
  const checkpoint = await (dependencies.createCheckpoint ?? createCheckpointStore)(join(options.checkpointRoot, 'matter', encodeURIComponent(target.matterId), encodeURIComponent(target.attemptRef)));
  const binding = { ...target, inputHash: task.inputHash };
  const storedBinding = await checkpoint.readOptional('binding');
  if (storedBinding && canonicalSha256(storedBinding) !== canonicalSha256(binding)) throw new Error('MATTER_CHECKPOINT_BINDING_MISMATCH');
  if (!storedBinding) await checkpoint.writeOnce('binding', binding);
  let result = claim.recoveryResult ?? await checkpoint.readOptional('finish-result');
  const recoveredResult = Boolean(result);
  if (!result && claim.status === 'COMMITTING') throw new Error('MATTER_RECOVERY_RESULT_MISSING');
  if (!result) {
    const modelInput = structuredClone(task.modelInput.modelInput);
    if (claim.savedWork) {
      if (claim.savedWork.matterId !== target.matterId || claim.savedWork.source?.actionAttemptId !== task.actionAttemptId ||
        !claim.savedWork.state?.problemWork) throw new Error('MATTER_SAVED_WORK_BINDING_MISMATCH');
      modelInput.expectedWorkRevision = claim.savedWork.workingRevision;
      modelInput.previousWork = { workRevisionRef: claim.savedWork.matterWorkRevisionId, workRevision: claim.savedWork.workingRevision,
        content: modelWork(claim.savedWork.state.problemWork) };
    }
    const execution = await checkpoint.remoteStep({ step: 'model', args: { inputHash: task.inputHash }, ambiguousCommit: false,
      perform: () => withLeaseHeartbeat(() => dependencies.invokeMatterModel({ operation: 'ASSESS_MATTER', modelInput }, {
        executionModel: task.executionModel, sessionDiscriminator: `${target.attemptRef}:${claim.leaseGeneration}`,
        resumeSavedWork: Boolean(claim.savedWork),
        heartbeat: () => call('HEARTBEAT'),
        readAssessmentSources: (intent) => readMatterAssessmentSources(intent, {
          sourceCatalog: task.modelInput.sourceCatalog,
          availableDocuments: modelInput.availableDocuments,
        }, call),
        saveAssessmentWork: (input) => call('SAVE_WORK', input),
        readAssessmentWork: async ({ requestId }) => {
          const revision = await dependencies.callTool('matter_action_attempt', { ...target, operation: 'READ_SAVED_WORK', requestId });
          if (!revision) return { revision: null };
          if (revision.matterId !== target.matterId || revision.source?.actionAttemptId !== task.actionAttemptId || !revision.state?.problemWork)
            throw new Error('MATTER_SAVED_WORK_BINDING_MISMATCH');
          return { revision: { requestId, workRevisionRef: revision.matterWorkRevisionId, workRevision: revision.workingRevision,
            content: revision.state.problemWork } };
        },
      }), () => call('HEARTBEAT')) });
    validateRuntimeProvenance(execution.provenance);
    const envelope = { schemaVersion: 'wiselink.3_1.openclaw_result_envelope.v2', taskType: task.taskType,
      subject: task.subject, actionAttemptId: task.actionAttemptId, operationRef: task.operationRef, baseRevision: task.baseRevision,
      status: 'SUCCEEDED', businessOutcome: 'CANDIDATE_READY', candidateStatus: null, modelOutput: JSON.stringify(execution.output),
      outputArtifactRefs: [], sourceRefs: task.sourceRefs, factsConsidered: [], missingInputs: [], conflicts: [], warnings: [],
      ...execution.provenance, errorCode: null, errorDetail: null };
    result = { ...envelope, contentHash: canonicalSha256(envelope) };
    await checkpoint.writeOnce('finish-result', result);
  }
  // Replay only the exact saved result. A lost commit response never triggers another model run.
  const { contentHash, ...body } = result;
  if (result.operationRef !== target.attemptRef || result.subject?.matterId !== target.matterId ||
    result.actionAttemptId !== task.actionAttemptId || result.baseRevision !== task.baseRevision ||
    canonicalSha256(body) !== contentHash) throw new Error('MATTER_RESULT_BINDING_MISMATCH');
  if (recoveredResult) {
    const status = await dependencies.callTool('matter_action_attempt', { ...target, operation: 'STATUS' });
    if (status.attemptRef !== target.attemptRef ||
      (status.resultContentHash && status.resultContentHash !== result.contentHash)) throw new Error('MATTER_RESULT_BINDING_MISMATCH');
    if (status.status === 'SUCCEEDED' && status.resultContentHash === result.contentHash)
      return { status: 'MATTER_WORK_SAVED', ...target, workRevisionRef: JSON.parse(result.modelOutput).workRevisionRef, candidateOnly: true };
    if (!['RUNNING', 'COMMITTING'].includes(status.status)) throw new Error('MATTER_FINISH_RECOVERY_REQUIRES_ATTENTION');
  }
  const finished = await call('FINISH', { result });
  if (finished.status !== 'SUCCEEDED' || finished.attemptRef !== target.attemptRef ||
    finished.workRevisionRef !== JSON.parse(result.modelOutput).workRevisionRef) throw new Error('MATTER_FINISH_READBACK_MISMATCH');
  return { status: 'MATTER_WORK_SAVED', ...target, workRevisionRef: finished.workRevisionRef, candidateOnly: true };
}

function modelWork(content) {
  const { evidence: _evidence, issues, ...rest } = structuredClone(content);
  return { ...rest, issues: issues.map(({ issueRef: _issueRef, statements, ...issue }) => ({ ...issue,
    statements: statements.map(({ claimId, ...claim }) => ({ ...claim, claimKey: claimId.slice(claimId.lastIndexOf(':claim:') + 7) })) })) };
}

async function withLeaseHeartbeat(invoke, heartbeat) {
  let pending = null; let failure;
  const timer = setInterval(() => {
    if (!pending && !failure) pending = heartbeat().catch(error => { failure = error; }).finally(() => { pending = null; });
  }, 10_000);
  try {
    const result = await invoke();
    if (pending) await pending;
    if (failure) throw failure;
    return result;
  } finally {
    clearInterval(timer);
    if (pending) await pending;
  }
}

/** Use the existing Host page-range reader; no extra scheduler or result store.
 * Independent reads overlap, but every started read settles before the model continues. */
export async function readMatterAssessmentSources(intent, context, call) {
  if (!Array.isArray(intent.sourceRefs) || !intent.sourceRefs.length || intent.sourceRefs.length > 96 ||
      new Set(intent.sourceRefs).size !== intent.sourceRefs.length ||
      intent.sourceRefs.some(ref => typeof ref !== 'string' || !ref)) throw new Error('JOBAID_SOURCE_SELECTION_INVALID');
  const registered = new Set(context.sourceCatalog.map(item => item.evidenceRef));
  const known = intent.sourceRefs.filter(ref => registered.has(ref));
  const pagesByDocument = new Map();
  // Validate the whole selection before starting any read, including the first registered batch.
  for (const ref of intent.sourceRefs.filter(ref => !registered.has(ref))) {
    const document = context.availableDocuments.find(item => ref.startsWith(`DOCUMENT_VERSION:${item.documentVersionId}:page:`));
    const number = document ? ref.slice(`DOCUMENT_VERSION:${document.documentVersionId}:page:`.length) : '';
    if (!/^[1-9]\d*$/.test(number) || !Number.isSafeInteger(Number(number))) throw new Error('JOBAID_SOURCE_NOT_REGISTERED');
    const pages = pagesByDocument.get(document.documentVersionId) ?? [];
    pages.push(Number(number));
    pagesByDocument.set(document.documentVersionId, pages);
  }
  const requests = known.length ? [{ operation: 'READ_REGISTERED', sourceRefs: known }] : [];
  for (const [documentVersionId, pages] of pagesByDocument) {
    pages.sort((a, b) => a - b);
    for (let index = 0; index < pages.length;) {
      const pageStart = pages[index++];
      let pageEnd = pageStart;
      while (index < pages.length && pages[index] === pageEnd + 1 && pageEnd - pageStart < 7) pageEnd = pages[index++];
      requests.push({ operation: 'READ_SOURCES', documentVersionId, pageStart, pageEnd });
    }
  }
  const evidence = []; const sourceRefs = []; const documents = [];
  for (let offset = 0; offset < requests.length; offset += 4) {
    const batch = requests.slice(offset, offset + 4);
    const results = await Promise.allSettled(batch.map(async ({ operation, ...input }) => {
      const read = await call(operation, { ...input, purpose: intent.purpose });
      if (operation === 'READ_REGISTERED') {
        if (!Array.isArray(read.sourceRefs) || !Array.isArray(read.evidence) ||
            read.sourceRefs.length !== input.sourceRefs.length || input.sourceRefs.some(ref => !read.sourceRefs.includes(ref)))
          throw new Error('MATTER_SOURCE_READ_BINDING_MISMATCH');
        return { evidence: read.evidence, sourceRefs: read.sourceRefs, documents: [] };
      }
      if (read.documentVersionId !== input.documentVersionId || !Array.isArray(read.pages) ||
          read.pages.length !== input.pageEnd - input.pageStart + 1 || read.pages.some((page, index) =>
            page.page !== input.pageStart + index || page.sourceRefId !== `DOCUMENT_VERSION:${input.documentVersionId}:page:${page.page}`))
        throw new Error('MATTER_SOURCE_READ_BINDING_MISMATCH');
      return {
        evidence: read.pages.flatMap(page => page.evidence ? [page.evidence] : []),
        sourceRefs: read.pages.map(page => page.sourceRefId),
        documents: read.pages.map(page => ({ documentVersionId: read.documentVersionId, pageCount: read.pageCount,
          extractionScope: read.extractionScope, page: page.page, textLayerStatus: page.textLayerStatus, visualContentVerified: false })),
      };
    }));
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    for (const result of results) {
      evidence.push(...result.value.evidence); sourceRefs.push(...result.value.sourceRefs); documents.push(...result.value.documents);
    }
  }
  return { status: 'AVAILABLE', evidence, sourceRefs, documents, scope: intent.context,
    completeRequestedScope: true, originalVisualContentVerified: false };
}
