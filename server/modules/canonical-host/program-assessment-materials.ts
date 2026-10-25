import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import { overallModelEvidenceRegistry } from './overall-assessment-reading';
import type { JobAidProgramMaterialsRead } from '@shared/jobaid-problem-assessment.interface';
import type { UnifiedPackageArtifactDescriptor } from '@shared/api.interface';
import type { OpenClawTaskEnvelope } from '../action-attempt/action-attempt-envelope.types';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';
import type { JobAidProblemTaskInput } from './jobaid-problem-task';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('JOBAID_PROGRAM_MATERIALS_INVALID');
  return value as Record<string, unknown>;
}

export function parseProgramMaterialSnapshot(value: unknown, task: OpenClawTaskEnvelope,
  input: JobAidProblemTaskInput, evidence: AssessmentEvidence[] = input.sourceCatalog): JobAidProgramMaterialsRead['snapshot'] {
  const snapshot = object(value), materials = object(snapshot.materials), modelRequest = object(snapshot.modelRequest);
  if (Object.keys(snapshot).some(key => !['materials', 'modelRequest'].includes(key)) ||
      input.executionMode !== 'PROGRAM_CONTROLLED_V1' || !task.executionModel || materials.version !== 1 ||
      canonicalJson(materials.originalInput) !== canonicalJson(input.modelInput) ||
      modelRequest.version !== 1 || modelRequest.materialCheckpoint !== 'program-materials' ||
      canonicalJson(modelRequest.executionModel) !== canonicalJson(task.executionModel) ||
      typeof modelRequest.body !== 'string' || !Array.isArray(materials.sourceReads) ||
      !Array.isArray(materials.deliveredEvidenceRefs)) throw new Error('JOBAID_PROGRAM_MATERIALS_BINDING_INVALID');
  const expectedEvidence = new Map(overallModelEvidenceRegistry(evidence, input.modelInput.evidenceProjectionVersion)
    .map(item => [item.evidenceRef, item]));
  for (const raw of materials.sourceReads) {
    const packet = object(raw);
    if (packet.status !== 'AVAILABLE' || packet.completeRequestedScope !== true ||
        !Array.isArray(packet.evidence) || !Array.isArray(packet.sourceRefs))
      throw new Error('JOBAID_PROGRAM_MATERIALS_SOURCES_INVALID');
    const packetEvidence = packet.evidence;
    for (const entry of packetEvidence) {
      const item = object(entry), expected = expectedEvidence.get(String(item.evidenceRef));
      if (!expected || !packet.sourceRefs.includes(item.evidenceRef) || canonicalJson(item) !== canonicalJson(expected))
        throw new Error('JOBAID_PROGRAM_MATERIALS_SOURCE_MISMATCH');
    }
    if (packet.sourceRefs.some(ref => !packetEvidence.some((entry: unknown) => object(entry).evidenceRef === ref)))
      throw new Error('JOBAID_PROGRAM_MATERIALS_SOURCES_INVALID');
  }
  if (materials.deliveredEvidenceRefs.some(ref => !expectedEvidence.has(String(ref))))
    throw new Error('JOBAID_PROGRAM_MATERIALS_SOURCE_MISMATCH');
  const request = object(JSON.parse(modelRequest.body)), modelInput = object(materials.modelInput);
  if (!Array.isArray(request.messages) || request.messages.length !== 2 ||
      object(request.messages[1]).role !== 'user' ||
      object(request.messages[1]).content !== canonicalJson(modelInput))
    throw new Error('JOBAID_PROGRAM_MATERIALS_REQUEST_MISMATCH');
  const previous = materials.previousWorkRead === null ? null : object(object(materials.previousWorkRead).revision);
  if (canonicalJson(previous) !== canonicalJson(input.previousWork))
    throw new Error('JOBAID_PROGRAM_MATERIALS_PREVIOUS_WORK_MISMATCH');
  return {materials, modelRequest};
}

export function programMaterialsObservation(activityJson: string | null | undefined): {
  artifact: UnifiedPackageArtifactDescriptor; observedAt: string;
} | null {
  const records: unknown = JSON.parse(activityJson ?? '[]');
  if (!Array.isArray(records)) throw new Error('JOBAID_ACTIVITY_RECORDS_INVALID');
  const item = records.find(value => value?.kind === 'ASSESSMENT_PROGRAM_PROGRESS' &&
    value.phase === 'MATERIALS_READY' && value.materialsArtifact);
  if (!item) return null;
  const artifact = object(item.materialsArtifact);
  if (typeof artifact.ref !== 'string' || typeof artifact.sha256 !== 'string' ||
      !Number.isSafeInteger(artifact.byteLength) || typeof artifact.mediaType !== 'string' ||
      artifact.storeRole !== 'UnifiedArtifactStoreCandidate' || typeof item.observedAt !== 'string' || !Number.isFinite(Date.parse(item.observedAt)))
    throw new Error('JOBAID_PROGRAM_MATERIALS_RECORD_INVALID');
  return {artifact: artifact as unknown as UnifiedPackageArtifactDescriptor, observedAt: item.observedAt};
}

/** Completing a round accounts for every previous issue; retaining it implicitly is insufficient. */
export function assertProgramCompleteIssueCoverage(command: unknown, input: JobAidProblemTaskInput): void {
  if (input.executionMode !== 'PROGRAM_CONTROLLED_V1') return;
  const value = object(command);
  if (!['COMPLETE', 'COMPLETE_WITH_OPEN_QUESTIONS'].includes(String(value.roundCompletion))) return;
  const acknowledged = new Set([
    ...(Array.isArray(value.issues) ? value.issues.map(issue => object(issue).issueKey) : []),
    ...(Array.isArray(value.unchangedIssueKeys) ? value.unchangedIssueKeys : []),
    ...(Array.isArray(value.retiredIssues) ? value.retiredIssues.map(issue => object(issue).issueKey) : []),
  ]);
  if (input.previousWork?.content.issues.some(issue => !acknowledged.has(issue.issueKey)))
    throw new Error('JOBAID_PROGRAM_PREVIOUS_ISSUE_COVERAGE_REQUIRED');
}
