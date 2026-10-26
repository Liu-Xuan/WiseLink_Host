import { parseJobAidWorkJson, readJobAidSourceBatches } from '../skills/wiselink-research-and-synthesize/scripts/run-jobaid-problem-assessment.mjs';
import { jobAidWorkTypeErrors } from '../skills/wiselink-research-and-synthesize/scripts/jobaid-work-shape.mjs';
import { isDeepStrictEqual } from 'node:util';
import { normalizeProgramListBrief } from '../skills/wiselink-research-and-synthesize/scripts/program-assessment-materials.mjs';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finished = new Set(['COMPLETE', 'COMPLETE_WITH_OPEN_QUESTIONS']);
const error = code => ({ status: 'REJECTED', code });

export const programAgentTools = Object.freeze([
  { name: 'read_sources', description: 'Read exact selected Host source references, with purpose.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['sourceRefs', 'purpose'],
      properties: { sourceRefs: { type: 'array', minItems: 1, maxItems: 96, items: { type: 'string' } },
        purpose: { type: 'string', minLength: 1 } } } },
  { name: 'read_private_units', description: 'Read sealed original units. Uncitable IDs are not evidence references.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['unitIds'],
      properties: { unitIds: { type: 'array', minItems: 1, maxItems: 16, items: { type: 'string' } } } } },
  { name: 'read_previous_work', description: 'Read the exact saved previous work revision.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['workRevisionRef'],
      properties: { workRevisionRef: { type: 'string', minLength: 1 } } } },
  { name: 'validate_candidate', description: 'Return repairable candidate feedback without saving.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['workJson'],
      properties: { workJson: { type: 'string', minLength: 2 } } } },
]);

/** This check is repeated after the CLI closes. A model-visible VALID reply is
 * never proof that the final candidate is the same value. */
export function validateProgramAgentCandidate(workJson, deliveredRefs, previousIssues = []) {
  let work;
  try { work = parseJobAidWorkJson(workJson); }
  catch { return { status: 'REPAIR_REQUIRED', violations: ['WORK_JSON_INVALID'] }; }
  if (!record(work)) return { status: 'REPAIR_REQUIRED', violations: ['WORK_JSON_INVALID'] };
  const normalized = normalizeProgramListBrief(work.listBrief);
  if (normalized) work.listBrief = normalized.after;
  const violations = [];
  if (work.schemaVersion !== 'wiselink.jobaid-problem-work.v3' || !finished.has(work.roundCompletion) ||
      !Array.isArray(work.issues) ||
      ['headline', 'listBrief', 'overview', 'completionReason', 'changeSummary']
        .some(key => typeof work[key] !== 'string' || !work[key].trim()) ||
      ![work.issues, work.unchangedIssueKeys, work.retiredIssues].some(items => items?.length))
    violations.push('WORK_REQUIRED_FIELDS_INVALID');
  for (const problem of jobAidWorkTypeErrors(work).slice(0, 12))
    violations.push(`WORK_SHAPE_INVALID:${problem.path}`);
  const known = new Set(deliveredRefs);
  const cited = new Set();
  const visit = (value, key = '') => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/\[\[([^\]]+)\]\]/gu)) cited.add(match[1]);
      if (['evidenceRef', 'methodRef'].includes(key) && value.trim()) cited.add(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (['basisRefs', 'evidenceRefs', 'checkedEvidenceRefs'].includes(key) && typeof item === 'string') cited.add(item);
        else visit(item);
      }
    } else if (record(value)) {
      for (const [name, item] of Object.entries(value)) visit(item, name);
    }
  };
  visit(work);
  if ([...cited].some(ref => !known.has(ref))) violations.push('UNDELIVERED_EVIDENCE_REF');
  const covered = new Set([...(Array.isArray(work.issues) ? work.issues : []).map(item => item?.issueKey),
    ...(Array.isArray(work.unchangedIssueKeys) ? work.unchangedIssueKeys : []),
    ...(Array.isArray(work.retiredIssues) ? work.retiredIssues : []).map(item => item?.issueKey)]);
  if (previousIssues.some(issue => !covered.has(issue.issueKey))) violations.push('PREVIOUS_ISSUE_COVERAGE_REQUIRED');
  return violations.length ? { status: 'REPAIR_REQUIRED', violations: [...new Set(violations)] }
    : { status: 'VALID', violations: [] };
}

export function createProgramAgentSession({ materials, readAssessmentSources, readAssessmentWork,
  maxToolCalls, canContinue = () => true }) {
  const input = materials.originalInput;
  const sources = new Map(input.availableSources.map(item => [item.ref, item]));
  const units = new Map(input.programOriginal.units.map(item => [item.unitId, item]));
  const locators = new Map(input.programOriginal.sourceLocators.map(item => [item.sourceRefId, item]));
  // Host's private input may already contain evidence, but the agent has only
  // seen a directory. A ref becomes citable here only after an actual tool read.
  const delivered = new Set();
  const previous = materials.previousWorkRead?.revision ?? input.previousWork ?? null;
  let calls = 0;
  let busy = false;
  const audit = [];
  const unique = values => Array.isArray(values) && new Set(values).size === values.length;
  const exactArgs = (args, keys) => Object.keys(args).length === keys.length &&
    keys.every(key => Object.hasOwn(args, key));
  async function callTool(name, args) {
    if (!canContinue()) return error('GENERATION_DEADLINE_OR_HEARTBEAT');
    if (busy || calls >= maxToolCalls) return error(busy ? 'TOOL_BUSY' : 'TOOL_CALL_LIMIT');
    if (!programAgentTools.some(tool => tool.name === name) || !record(args)) return error('TOOL_NOT_ALLOWED');
    busy = true; calls++;
    try {
      if (name === 'read_sources') {
        if (!exactArgs(args, ['sourceRefs', 'purpose']) || !unique(args.sourceRefs) ||
            args.sourceRefs.length < 1 || args.sourceRefs.length > 96 ||
            args.sourceRefs.some(ref => !sources.has(ref)) ||
            typeof args.purpose !== 'string' || !args.purpose.trim()) return error('SOURCE_SELECTION_INVALID');
        const packet = await readJobAidSourceBatches({ sourceRefs: args.sourceRefs,
          purpose: args.purpose, context: 'EXACT' }, readAssessmentSources);
        // Statement v3 may have authorized root-context closure beyond the
        // requested refs. This first candidate does not yet model that closure.
        if (packet?.schemaVersion === 'wiselink.jobaid-source-read.v3')
          return error('SOURCE_STATEMENT_SCOPE_UNSUPPORTED');
        const requested = new Set(args.sourceRefs);
        if (packet?.status !== 'AVAILABLE' || packet.scope !== 'EXACT' ||
            packet.completeRequestedScope !== true || !unique(packet.sourceRefs) ||
            !Array.isArray(packet.evidence) || packet.sourceRefs.length !== requested.size ||
            packet.sourceRefs.some(ref => !requested.has(ref)) ||
            packet.evidence.length !== requested.size ||
            new Set(packet.evidence.map(item => item?.evidenceRef)).size !== requested.size ||
            packet.evidence.some(item => {
              const source = sources.get(item?.evidenceRef);
              return !source || !requested.has(item.evidenceRef) || typeof item.excerpt !== 'string' ||
                item.kind !== source.kind ||
                (source.versionLabel !== undefined && item.versionLabel !== source.versionLabel) ||
                (source.locator !== undefined && item.locator !== source.locator);
            }))
          return error('SOURCE_READ_INCOMPLETE');
        for (const ref of args.sourceRefs) delivered.add(ref);
        audit.push({ name, status: 'AVAILABLE', refs: [...args.sourceRefs] });
        return packet;
      }
      if (name === 'read_private_units') {
        if (!exactArgs(args, ['unitIds']) || !unique(args.unitIds) ||
            args.unitIds.length < 1 || args.unitIds.length > 16 ||
            args.unitIds.some(id => !units.has(id))) return error('UNIT_SELECTION_INVALID');
        const selected = args.unitIds.map(id => {
          const unit = structuredClone(units.get(id));
          const uncitableSourceRefIds = unit.sourceRefIds.filter(ref =>
            ![...sources.values()].some(source => source.kind === 'DOCUMENT_PASSAGE' &&
              source.documentVersionId === input.programOriginal.binding.documentVersionId &&
              source.parseRunId === input.programOriginal.binding.parseRunId && source.sourceRefId === ref));
          return { ...unit, locators: unit.sourceRefIds.map(ref => structuredClone(locators.get(ref))),
            uncitableSourceRefIds };
        });
        audit.push({ name, status: 'AVAILABLE', unitCount: selected.length });
        return { status: 'AVAILABLE', originalBinding: structuredClone(input.programOriginal.binding), units: selected,
          coverage: structuredClone(input.programOriginal.coverage),
          findings: structuredClone(input.programOriginal.findings),
          taskContext: { methodBinding: structuredClone(input.methodBinding),
            documentOverview: structuredClone(input.documentOverview),
            discussion: structuredClone(input.discussion ?? null),
            contextPackage: structuredClone(input.contextPackage ?? null) },
          instruction: 'Unit IDs and uncitable sourceRefIds are not citation references. Read exact source refs for citable evidence.' };
      }
      if (name === 'read_previous_work') {
        if (!exactArgs(args, ['workRevisionRef']) || !previous ||
            args.workRevisionRef !== previous.workRevisionRef) return error('WORK_SELECTION_INVALID');
        const packet = await readAssessmentWork({ workRevisionRef: previous.workRevisionRef });
        if (packet?.revision?.workRevisionRef !== previous.workRevisionRef ||
            packet.revision.workRevision !== previous.workRevision ||
            !Array.isArray(packet.revision.content?.issues) ||
            (materials.previousWorkRead && !isDeepStrictEqual(packet.revision, materials.previousWorkRead.revision)))
          return error('WORK_READ_MISMATCH');
        audit.push({ name, status: 'AVAILABLE', workRevisionRef: previous.workRevisionRef });
        return packet;
      }
      if (!exactArgs(args, ['workJson']) || typeof args.workJson !== 'string')
        return error('CANDIDATE_ARGUMENTS_INVALID');
      const result = validateProgramAgentCandidate(args.workJson, delivered, previous?.content?.issues ?? []);
      audit.push({ name, status: result.status });
      return result;
    } catch { return error('BOUND_READ_UNAVAILABLE'); }
    finally { busy = false; }
  }
  return { tools: programAgentTools, callTool, deliveredRefs: () => [...delivered], audit: () => structuredClone(audit),
    validateFinal: workJson => validateProgramAgentCandidate(workJson, delivered, previous?.content?.issues ?? []) };
}
