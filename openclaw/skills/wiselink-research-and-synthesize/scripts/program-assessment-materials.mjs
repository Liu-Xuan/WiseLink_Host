import { isDeepStrictEqual } from 'node:util';
import { readJobAidSourceBatches } from './run-jobaid-problem-assessment.mjs';

export const PROGRAM_ASSESSMENT_MODE = 'PROGRAM_CONTROLLED_V1';
const fail = code => { throw new Error(`PROGRAM_ASSESSMENT_MATERIALS_${code}`); };

/** Full source bodies remain in the existing private checkpoint. The model view
 * removes only duplicate original excerpts, keeping an exact unit/locator map. */
export async function prepareProgramAssessmentMaterials(input, options) {
  const original = input.programOriginal;
  if (input.executionMode !== PROGRAM_ASSESSMENT_MODE || !original?.binding ||
      !Array.isArray(original.units) || !original.units.length ||
      !Array.isArray(original.sourceLocators) || !original.coverage || !Array.isArray(original.findings)) fail('ORIGINAL_REQUIRED');
  const binding = original.binding;
  if (!binding.documentVersionId || !binding.parseRunId || !Number.isSafeInteger(binding.parseRevision) ||
      binding.parseRevision < 1 || binding.documentVersionId !== options.assessmentBinding?.documentVersionId ||
      !isDeepStrictEqual(binding, input.documentOverview?.original?.binding)) fail('BINDING_MISMATCH');
  const catalog = new Map(input.availableSources.map(item => [item.ref, item]));
  let previousWorkRead = null;
  if (input.previousWork) {
    const previous = input.previousWork;
    previousWorkRead = await options.assessmentCheckpoint.readOptional('program-previous-work-read');
    if (!previousWorkRead) {
      await options.heartbeat?.();
      previousWorkRead = await options.readAssessmentWork({ workRevisionRef: previous.workRevisionRef });
      const revision = previousWorkRead?.revision;
      if (revision?.workRevisionRef !== previous.workRevisionRef || revision.workRevision !== previous.workRevision ||
          !Array.isArray(revision.content?.issues) || typeof revision.content.understanding !== 'string') fail('PREVIOUS_WORK_READ_MISMATCH');
      await options.assessmentCheckpoint.writeOnce('program-previous-work-read', previousWorkRead);
    }
    if (previousWorkRead.revision?.workRevisionRef !== previous.workRevisionRef ||
        previousWorkRead.revision.workRevision !== previous.workRevision) fail('PREVIOUS_WORK_READ_MISMATCH');
  }
  const evidence = new Map();
  const add = item => {
    if (!catalog.has(item?.evidenceRef) || typeof item.excerpt !== 'string') fail('UNREGISTERED_EVIDENCE');
    const previous = evidence.get(item.evidenceRef);
    if (previous && !isDeepStrictEqual(previous, item)) fail('EVIDENCE_CHANGED');
    evidence.set(item.evidenceRef, structuredClone(item));
  };
  input.deliveredEvidence.forEach(add);
  // The Host-selected catalog contains this task's acquired related facts and
  // source versions. Only already delivered method clauses enter this round.
  const selected = input.availableSources.filter(item => item.kind !== 'METHOD_CLAUSE');
  const missing = selected.filter(item => !evidence.has(item.ref)).map(item => item.ref);
  const sourceReads = [];
  // Persist each successful bounded read before the next one. A crash resumes
  // the remaining exact reads, rather than treating a count as document size.
  for (let offset = 0; offset < missing.length; offset += 96) {
    const refs = missing.slice(offset, offset + 96);
    const key = `program-source-read-${offset / 96 + 1}`;
    let packet = await options.assessmentCheckpoint.readOptional(key);
    if (!packet) {
      await options.heartbeat?.();
      packet = await readJobAidSourceBatches({ sourceRefs: refs, context: 'EXACT',
        purpose: 'Prepare the complete Host-selected source scope for the program-controlled engineering assessment.' }, options.readAssessmentSources);
      await options.assessmentCheckpoint.writeOnce(key, packet);
    }
    if (packet.status !== 'AVAILABLE' || packet.scope !== 'EXACT' || packet.completeRequestedScope !== true ||
        !Array.isArray(packet.evidence) || !Array.isArray(packet.sourceRefs) ||
        refs.some(ref => !packet.sourceRefs.includes(ref) || !packet.evidence.some(item => item.evidenceRef === ref))) fail('READ_INCOMPLETE');
    packet.evidence.forEach(add);
    sourceReads.push(packet);
  }
  const allEvidence = [...evidence.values()];
  // The Host's model evidence projection deliberately omits top-level source
  // identities. Join the delivered body to the sealed identity directory;
  // never infer document membership from an excerpt or a model-created field.
  const primaryPrefix = `DOCUMENT_ORIGINAL:${binding.documentVersionId}:${binding.parseRunId}:`;
  const primary = input.availableSources.filter(item => item.kind === 'DOCUMENT_PASSAGE' &&
    (item.ref.startsWith(primaryPrefix) || (item.documentVersionId === binding.documentVersionId &&
      item.parseRunId === binding.parseRunId))).map(source => {
    const item = evidence.get(source.ref);
    let locator;
    try { locator = JSON.parse(source.locator); } catch { fail('ORIGINAL_EVIDENCE_MISMATCH'); }
    if (source.documentVersionId !== binding.documentVersionId || source.parseRunId !== binding.parseRunId ||
        typeof source.sourceRefId !== 'string' || !source.sourceRefId ||
        source.ref !== `${primaryPrefix}${source.sourceRefId}` || source.carrierRangeRef !== source.ref ||
        source.versionLabel !== binding.parseRunId || item?.kind !== 'DOCUMENT_PASSAGE' ||
        item.evidenceRef !== source.ref || item.versionLabel !== source.versionLabel || item.locator !== source.locator ||
        locator?.parseRunId !== binding.parseRunId || locator?.sourceRefId !== source.sourceRefId ||
        (Object.hasOwn(item, 'documentVersionId') && item.documentVersionId !== source.documentVersionId) ||
        (Object.hasOwn(item, 'sourceRefId') && item.sourceRefId !== source.sourceRefId)) fail('ORIGINAL_EVIDENCE_MISMATCH');
    return { ...item, documentVersionId: source.documentVersionId, sourceRefId: source.sourceRefId };
  });
  if (!primary.length) fail('ORIGINAL_EVIDENCE_MISMATCH');
  const primaryBySource = new Map(primary.map(item => [item.sourceRefId, item]));
  const primaryRefs = new Set(primary.map(item => item.evidenceRef));
  const locatorByRef = new Map();
  for (const locator of original.sourceLocators) {
    if (typeof locator?.sourceRefId !== 'string' || locatorByRef.has(locator.sourceRefId)) fail('LOCATOR_INVALID');
    locatorByRef.set(locator.sourceRefId, locator);
  }
  if (primary.some(item => !locatorByRef.has(item.sourceRefId))) fail('ORIGINAL_EVIDENCE_MISMATCH');
  const spans = [], contents = [], unitIds = new Set();
  let position = 0;
  for (const unit of original.units) {
    if (!unit?.unitId || unitIds.has(unit.unitId) || !unit.payload || !Array.isArray(unit.sourceRefIds)) fail('UNIT_INVALID');
    unitIds.add(unit.unitId);
    if (unit.sourceRefIds.some(ref => !locatorByRef.has(ref))) fail('LOCATOR_MISSING');
    // Unknown/table payload fields survive verbatim in structured JSON; prose
    // with a sole text field becomes uninterrupted readable source text.
    const plain = Object.keys(unit.payload).length === 1 && typeof unit.payload.text === 'string';
    const text = plain ? unit.payload.text : JSON.stringify(unit.payload);
    if (contents.length) position += 1;
    const start = position;
    contents.push(text);
    position += text.length;
    const { payload: _payload, ...metadata } = unit;
    spans.push({ ...metadata, start, end: position, encoding: plain ? 'TEXT' : 'STRUCTURED_JSON',
      evidenceRefs: unit.sourceRefIds.flatMap(ref => primaryBySource.has(ref) ? [primaryBySource.get(ref).evidenceRef] : []),
      uncitableSourceRefIds: unit.sourceRefIds.filter(ref => !primaryBySource.has(ref)) });
  }
  const { programOriginal: _original, deliveredEvidence: _delivered, availableSources: _catalog,
    previousWork, discussion, methodBinding, contextPackage, ...task } = input;
  const modelInput = {
    taskAndScope: { ...task, contextPackage: contextPackage ? {
      ...contextPackage, sourceOrigins: undefined,
    } : undefined },
    continuousOriginal: { binding, content: contents.join('\n'), spans,
      sourceLocators: original.sourceLocators, coverage: original.coverage, findings: original.findings,
      evidence: primary.map(({ excerpt: _excerpt, ...identity }) => identity) },
    objectAndCompanyFacts: { evidence: allEvidence.filter(item => !primaryRefs.has(item.evidenceRef) && item.kind !== 'METHOD_CLAUSE'),
      sourceOrigins: contextPackage?.sourceOrigins ?? [],
      readContext: sourceReads.map(({ evidence: _evidence, ...receipt }) => receipt) },
    relevantMethods: { methodBinding, evidence: allEvidence.filter(item => item.kind === 'METHOD_CLAUSE') },
    previousUnderstandingAndChanges: { previousWork: previousWorkRead?.revision ?? previousWork, discussion },
  };
  // This is the actual payload, not just a catalog or a reconstruction hash.
  return { version: 1, originalInput: structuredClone(input), sourceReads, previousWorkRead,
    modelInput, deliveredEvidenceRefs: [...evidence.keys()] };
}
