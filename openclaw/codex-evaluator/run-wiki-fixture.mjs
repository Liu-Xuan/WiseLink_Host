#!/usr/bin/env node
/** One real Codex/Miaoda Wiki-parent candidate over synthetic saved children.
 * Host reads are emulated in memory. No business MCP, Host SAVE or adoption. */
import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { invokeHostedDerivedSummaryModel, hierarchicalWikiParentModelMessages } from
  '../skills/wiselink-research-and-synthesize/scripts/invoke-hosted-derived-summary-model.mjs';
import { validateDerivedSummaryModelInput } from
  '../skills/wiselink-research-and-synthesize/scripts/derived-summary-shape.mjs';
import { validateSummaryCodexReceipt } from
  '../skills/wiselink-research-and-synthesize/scripts/derived-summary-codex-gateway.mjs';

const clone = value => structuredClone(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function checkpoint() {
  const values = new Map();
  return {
    readOptional: async key => values.get(key) ?? null,
    write: async (key, value) => { values.set(key, clone(value)); },
    writeOnce: async (key, value) => {
      if (values.has(key)) throw new Error('WIKI_FIXTURE_CHECKPOINT_REARM');
      values.set(key, clone(value));
    },
    hasEntries: async prefix => [...values.keys()].some(key => key.startsWith(prefix)),
    remoteStep: async ({ step, args, perform }) => {
      const previous = values.get(`${step}.result`);
      if (previous) {
        if (!same(previous.args, args)) throw new Error('WIKI_FIXTURE_STEP_BINDING_CHANGED');
        return clone(previous.result);
      }
      const result = await perform();
      values.set(`${step}.result`, { args: clone(args), result: clone(result) });
      return result;
    },
  };
}

function syntheticWiki() {
  const nonce = randomUUID().slice(0, 8);
  const documentVersionId = `fixture-dv-${nonce}`;
  const sourceRefId = `fixture-root-${nonce}`;
  const rootRef = `source:${documentVersionId}:${sourceRefId}`;
  const root = { evidenceRef: rootRef, kind: 'DOCUMENT_PASSAGE', documentVersionId,
    sourceRefId, workItemId: null, title: 'Synthetic guard procedure', versionLabel: 'fictional-v1',
    excerpt: 'For the fictional P-7 test pump, disconnect electrical power and confirm the rotor has stopped before opening the guard. A temperature alarm does not replace isolation. No installation or approval record is supplied.' };
  const child = (suffix, body, limitation) => ({
    member: { kind: 'DERIVED_SUMMARY', summaryId: `DS-fixture-${suffix}-${nonce}`,
      summaryRef: `fixture-child-${suffix}-${nonce}`, summaryRevision: 1 },
    evidenceRef: `child-${suffix}-${nonce}`, headline: `Synthetic ATA4 child ${suffix}`,
    body: `${body} [[${rootRef}]]`, issues: [], evidence: [root], rootRefs: [rootRef],
    limitations: [limitation], current: true, overviewStatus: 'CURRENT', leaves: [],
  });
  const members = [
    child('A', 'The saved child says power isolation and stopped-rotor confirmation precede opening the guard.',
      'The child does not establish that the procedure was performed on a particular unit.'),
    child('B', 'The saved child mentions a proposed temperature alarm; its role relative to isolation must be checked against the original procedure.',
      'No alarm installation, effectiveness, or formal approval is evidenced.'),
  ];
  const modelInput = {
    scope: { kind: 'ATA2', title: 'Synthetic ATA2 pump guard Wiki', fleetFamilyId: 'fixture-family',
      fleetModelIds: ['fixture-model'], ata2: '27', ata4: null,
      selectionReason: 'Two exact synthetic saved ATA4 child summaries are selected.' },
    wikiLevel: 'ATA2', classificationStatus: 'CANDIDATE',
    instruction: `Synthesize these two selected children only. First READ_SOURCES for ${rootRef} to check the decisive isolation-versus-alarm condition before SAVE_SUMMARY. Preserve the missing installation, execution, and approval records. This is a fictional software fixture.`,
    members, evidence: [root], limitations: [
      'This is synthetic test material, not an operational engineering decision.',
      'Installation, execution, effectiveness, and formal approval records are absent.' ],
  };
  return { modelInput, rootRef, childRefs: members.map(item => item.evidenceRef) };
}

export async function runWikiFixture({ codexBinary, configPath, runRoot, dryRun = false } = {}) {
  const { modelInput, rootRef, childRefs } = syntheticWiki();
  validateDerivedSummaryModelInput(modelInput);
  hierarchicalWikiParentModelMessages(modelInput);
  if (dryRun) return { status: 'WIKI_FIXTURE_VALID', realHostCalled: false,
    savedToHost: false, modelRequests: 0, selectedChildCount: childRefs.length, rootAvailable: true };
  if (![codexBinary, configPath, runRoot].every(value => typeof value === 'string' && isAbsolute(value)))
    throw new Error('WIKI_FIXTURE_ABSOLUTE_CODEX_OPTIONS_REQUIRED');

  const store = checkpoint(), readRequests = [];
  const registry = new Map(modelInput.members.map(item => [item.evidenceRef, item]));
  const roots = new Map(modelInput.evidence.map(item => [item.evidenceRef, item]));
  const budget = { timeoutMs: 180_000, maxCompletionTokens: 16_384,
    maxModelRequests: 4, reasoningEffort: 'low' };
  const candidate = await invokeHostedDerivedSummaryModel(modelInput, {
    modelExecutor: 'CODEX', codexOptions: { codexBinary, configPath, runRoot,
      reasoningEffort: 'low', maxOutputTokens: 16_384, timeoutSeconds: 180 },
    checkpoint: store, summaryId: `DS-fixture-parent-${randomUUID().slice(0, 8)}`,
    attemptRef: `AQ-fixture-${randomUUID().slice(0, 8)}`,
    sessionDiscriminator: `fixture-${randomUUID()}`,
    executionModel: { modelRef: 'miaoda/glm-5.3' },
    deadlineAt: new Date(Date.now() + budget.timeoutMs).toISOString(), runBudget: budget,
    heartbeat: async () => ({ status: 'RUNNING', synthetic: true }),
    readMembers: async intent => {
      readRequests.push({ action: intent.action, evidenceRefs: [...intent.evidenceRefs] });
      if (intent.evidenceRefs.some(ref => !registry.has(ref))) throw new Error('WIKI_FIXTURE_MEMBER_NOT_SELECTED');
      return { members: intent.evidenceRefs.map(ref => clone(registry.get(ref))) };
    },
    readSources: async intent => {
      readRequests.push({ action: intent.action, evidenceRefs: [...intent.evidenceRefs] });
      if (intent.evidenceRefs.some(ref => !roots.has(ref))) throw new Error('WIKI_FIXTURE_SOURCE_NOT_REGISTERED');
      return { evidence: intent.evidenceRefs.map(ref => clone(roots.get(ref))) };
    },
  });
  const binding = await store.readOptional('summary-codex.started');
  const receipt = validateSummaryCodexReceipt(await store.readOptional('summary-codex.receipt'), binding);
  if (!receipt.closed || !readRequests.some(item => item.action === 'READ_SOURCES' &&
      item.evidenceRefs.includes(rootRef))) throw new Error('WIKI_FIXTURE_READ_OR_PROCESS_UNVERIFIED');
  if (await store.readOptional('summary-gateway.started') || await store.readOptional('summary-gateway.receipt'))
    throw new Error('WIKI_FIXTURE_NATIVE_GATEWAY_UNEXPECTED');
  const citations = [...candidate.content.body.matchAll(/\[\[([^\]]+)\]\]/gu)].map(match => match[1]);
  if (!childRefs.every(ref => citations.includes(ref))) throw new Error('WIKI_FIXTURE_CHILD_CITATION_MISSING');
  return { status: 'WIKI_CANDIDATE_GENERATED', realHostCalled: false, savedToHost: false,
    candidateOnly: true, selectedChildCount: childRefs.length, readRequests,
    candidate: candidate.content, citations, actualModel: candidate.provenance.actualModel,
    codexReceipt: receipt, nativeGatewayReceipt: null };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const allowed = new Set(['--codex', '--config', '--run-root', '--dry-run']);
  if (args.some(value => value.startsWith('--') && !allowed.has(value)) ||
      ['--codex', '--config', '--run-root'].some(key => args.filter(value => value === key).length > 1))
    throw new Error('WIKI_FIXTURE_OPTIONS_INVALID');
  const option = key => { const index = args.indexOf(key); return index < 0 ? undefined : args[index + 1]; };
  runWikiFixture({ codexBinary: option('--codex'), configPath: option('--config'),
    runRoot: option('--run-root'), dryRun: args.includes('--dry-run') })
    .then(value => console.log(JSON.stringify(value, null, 2)))
    .catch(error => { console.error(JSON.stringify({ status: 'WIKI_FIXTURE_FAILED',
      errorCode: /^[A-Z0-9_]+$/u.test(error.message) ? error.message : 'WIKI_FIXTURE_RUN_FAILED' }));
      process.exitCode = 1; });
}
