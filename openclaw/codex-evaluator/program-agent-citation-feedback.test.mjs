import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgramAgentSession, validateProgramAgentCandidate } from './program-agent-session.mjs';
import { runProgramAgentGateway } from './program-agent-gateway.mjs';
import {
  prepareProgramAgentMaterials,
} from '../skills/wiselink-research-and-synthesize/scripts/program-assessment-materials.mjs';
import { programRecoveryData } from './program-recovery-fixture.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'program-agent-citation-feedback-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const data = programRecoveryData();
  const materials = await prepareProgramAgentMaterials(data.modelInput, {
    assessmentBinding: data.assessmentBinding,
    assessmentCheckpoint: { readOptional: async () => null, writeOnce: async () => {} },
  });
  const sourceReads = [];
  const readAssessmentSources = async ({ sourceRefs, context }) => {
    sourceReads.push([...sourceRefs]);
    return { status: 'AVAILABLE', scope: context, completeRequestedScope: true, sourceRefs,
      evidence: [structuredClone(data.modelInput.deliveredEvidence[0])] };
  };
  return { ...data, root, materials, sourceReads, readAssessmentSources };
}

test('generated program-agent prompt includes exact citation and Host-score guidance before schema and directory',
  async t => {
  const f = await fixture(t);
  let prompt;
  let providerCalls = 0;
  await assert.rejects(runProgramAgentGateway({
    requestId: 'synthetic-citation-prompt',
    binding: { assessmentBinding: f.assessmentBinding, fixture: true },
    materials: f.materials,
    policy: { schemaVersion: 'wiselink.native.program_agent_policy.proposal.v1',
      maxModelRequests: 1, maxOutputTokens: 131072, maxToolCalls: 4, timeoutSeconds: 30 },
    executionModel: { modelRef: 'miaoda/glm-5.3', displayName: 'Synthetic',
      providerKind: 'BUILT_IN', settingsRevision: 1, selectedAt: '2026-10-27T00:00:00Z' },
    codexOptions: { codexBinary: '/synthetic-not-invoked', runRoot: f.root },
    generationDeadlineAt: new Date(Date.now() + 30_000).toISOString(),
    readAssessmentSources: f.readAssessmentSources, readAssessmentWork: async () => null,
    onRunPrepared: async ({ runDirectory }) => {
      prompt = await readFile(join(runDirectory, 'codex-prompt.txt'), 'utf8');
      throw new Error('SYNTHETIC_PROMPT_CAPTURE_COMPLETE');
    },
    providerDispatch: async () => { providerCalls++; throw new Error('MUST_NOT_CALL_MODEL'); },
  }), /SYNTHETIC_PROMPT_CAPTURE_COMPLETE/u);
  assert.match(prompt, /Each issue\.body must contain an inline citation/u);
  assert.match(prompt, /exact complete evidenceRef inside \[\[double brackets\]\]/u);
  assert.match(prompt, /this session's successful read_sources result/u);
  assert.match(prompt, /bare refs and basisRefs\/checkedEvidenceRefs do not replace body citations/u);
  assert.match(prompt, /read_private_units supplies content and locators only; it does not grant citation authority/u);
  assert.match(prompt, /read that exact ref with read_sources/u);
  assert.match(prompt, /Do not substitute unitId\/sourceRefId values for an evidenceRef/u);
  assert.match(prompt, /use only the exact evidenceRef returned by successful read_sources/u);
  assert.match(prompt, /The Host computes numeric risk scores and risk grades/u);
  assert.match(prompt, /Do not write calculated scores or grades in candidate prose/u);
  assert.ok(prompt.indexOf('Each issue.body') < prompt.indexOf('Required work schema:'));
  assert.ok(prompt.includes(f.modelInput.availableSources[0].ref));
  assert.equal(prompt.includes('Allowed steps:'), false);
  assert.equal(providerCalls, 0);
  assert.deepEqual(f.sourceReads, []);
});

test('candidate repair feedback locates bare body and missing refs without granting citation authority', async t => {
  const f = await fixture(t);
  const persisted = [];
  const session = createProgramAgentSession({ materials: f.materials,
    readAssessmentSources: f.readAssessmentSources, readAssessmentWork: async () => null,
    maxToolCalls: 8, persistToolResult: async row => { persisted.push(structuredClone(row)); } });
  const ref = f.modelInput.availableSources[0].ref;
  await session.callTool('read_private_units', { unitIds: ['fixture-unit-1'] });
  const work = structuredClone(f.work);
  work.issues = [{ issueKey: 'citation-fixture', question: '合成问题',
    body: '仅有裸引用而没有正文引用：' + ref,
    measures: [{ text: '合成措施', addresses: '处理合成问题', limitations: [],
      status: 'PROPOSED', basisRefs: [ref] }] }];
  work.inputDispositions = [{ inputId: 'synthetic-input', contribution: 'READ_ONLY',
    checkedEvidenceRefs: [ref, 'outside:directory'], checkedScope: '合成范围', reason: '合成核对' }];
  const before = JSON.stringify(work);
  const feedback = await session.callTool('validate_candidate', { workJson: before });
  assert.equal(feedback.status, 'REPAIR_REQUIRED');
  assert.deepEqual(feedback.violations, ['ISSUE_BODY_REFERENCE_REQUIRED', 'UNDELIVERED_EVIDENCE_REF']);
  assert.deepEqual(persisted.at(-1).observation, feedback);
  assert.equal(JSON.stringify(work), before);
  const bodyHint = feedback.repairHints.find(item => item.code === 'ISSUE_BODY_REFERENCE_REQUIRED');
  assert.deepEqual(bodyHint.fieldPaths, ['work.issues[0].body']);
  assert.match(bodyHint.message, /\[\[exact delivered evidenceRef\]\]/u);
  const refsHint = feedback.repairHints.find(item => item.code === 'UNDELIVERED_EVIDENCE_REF');
  const unread = refsHint.missingReferences.find(item => item.ref === ref);
  assert.equal(unread.availableInDirectory, true);
  assert.deepEqual(unread.fieldPaths, ['work.issues[0].measures[0].basisRefs[0]',
    'work.inputDispositions[0].checkedEvidenceRefs[0]']);
  const foreign = refsHint.missingReferences.find(item => item.ref === 'outside:directory');
  assert.equal(foreign.availableInDirectory, false);
  assert.deepEqual(foreign.fieldPaths, ['work.inputDispositions[0].checkedEvidenceRefs[1]']);
  assert.match(refsHint.message, /read_sources before citing/u);
  assert.deepEqual(session.deliveredRefs(), []);
  assert.deepEqual(f.sourceReads, []);

  work.issues[0].body = '引用格式已修复但尚未取得引用资格。[[' + ref + ']]';
  work.inputDispositions[0].checkedEvidenceRefs = [ref];
  const stillUnread = session.validateFinal(JSON.stringify(work));
  assert.deepEqual(stillUnread.violations, ['UNDELIVERED_EVIDENCE_REF']);
  assert.ok(stillUnread.repairHints[0].missingReferences[0].fieldPaths.includes('work.issues[0].body'));
  assert.deepEqual(session.deliveredRefs(), []);
  await session.callTool('read_sources', { sourceRefs: [ref], purpose: '核对准确合成原文引用' });
  assert.deepEqual(session.deliveredRefs(), [ref]);
  assert.deepEqual(session.validateFinal(JSON.stringify(work)), { status: 'VALID', violations: [] });
  assert.deepEqual(f.sourceReads, [[ref]]);
});

test('candidate repair feedback stays bounded while omitted unread references remain rejected', () => {
  const { work } = programRecoveryData();
  const candidate = structuredClone(work);
  const refs = ['oversized:' + 'x'.repeat(600),
    ...Array.from({ length: 23 }, (_, index) => 'unread:' + index)];
  candidate.issues = Array.from({ length: 12 }, (_, index) => ({
    issueKey: 'citation-' + index, question: '合成问题', body: '没有正文双括号引用',
    measures: [{ text: '合成措施', addresses: '处理合成问题', limitations: [],
      status: 'PROPOSED', basisRefs: index === 0 ? refs : [] }],
  }));
  const feedback = validateProgramAgentCandidate(JSON.stringify(candidate), [], [], ['unread:0']);
  assert.equal(feedback.status, 'REPAIR_REQUIRED');
  assert.deepEqual(feedback.violations, ['ISSUE_BODY_REFERENCE_REQUIRED', 'UNDELIVERED_EVIDENCE_REF']);
  const bodyHint = feedback.repairHints.find(item => item.code === 'ISSUE_BODY_REFERENCE_REQUIRED');
  assert.equal(bodyHint.fieldPaths.length, 8);
  assert.equal(bodyHint.omittedPathCount, 4);
  const refsHint = feedback.repairHints.find(item => item.code === 'UNDELIVERED_EVIDENCE_REF');
  assert.equal(refsHint.missingReferences.length, 8);
  assert.equal(refsHint.omittedReferenceCount, 16);
  assert.equal(refsHint.missingReferences[0].availableInDirectory, true);
  assert.ok(refsHint.missingReferences.every(item => item.ref.length <= 512 && item.fieldPaths.length <= 4));
  assert.equal(JSON.stringify(feedback).includes('x'.repeat(600)), false);
  assert.ok(Buffer.byteLength(JSON.stringify(feedback)) < 10_000);
});

test('candidate repair feedback preserves existing invalid JSON malformed reference and prior-issue checks', () => {
  const { work, modelInput } = programRecoveryData();
  const refs = modelInput.deliveredEvidence.map(item => item.evidenceRef);
  assert.deepEqual(validateProgramAgentCandidate('{', refs), {
    status: 'REPAIR_REQUIRED', violations: ['WORK_JSON_INVALID'] });
  const malformed = structuredClone(work);
  malformed.issues[0].body += ' [[unfinished';
  assert.deepEqual(validateProgramAgentCandidate(JSON.stringify(malformed), refs), {
    status: 'REPAIR_REQUIRED', violations: ['ISSUE_BODY_REFERENCE_MALFORMED'] });
  assert.deepEqual(validateProgramAgentCandidate(JSON.stringify(work), refs, [{ issueKey: 'uncovered' }]), {
    status: 'REPAIR_REQUIRED', violations: ['PREVIOUS_ISSUE_COVERAGE_REQUIRED'] });
});
