import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type { JobAidProblemModelInput, JobAidProblemTaskInput } from './jobaid-problem-task';

export const AILY_REGISTERED_PRIMARY_SOURCE_READ = 'REGISTERED_PRIMARY_SOURCE_READ_V1';

/** Exact current-original entries; other documents and parses keep their delivery status. */
export function registeredAilyPrimarySourceRefs(input: JobAidProblemTaskInput): Set<string> {
  const binding = input.modelInput.programOriginal?.binding;
  if (!binding) throw new Error('JOBAID_AILY_INPUT_DELIVERY_BINDING_INVALID');
  const directory = input.modelInput.availableSources.filter(item => item.kind === 'DOCUMENT_PASSAGE' &&
    item.documentVersionId === binding.documentVersionId && item.parseRunId === binding.parseRunId);
  const byRef = new Map(directory.map(item => [item.ref, item]));
  const primary = input.sourceCatalog.filter((item): item is Extract<AssessmentEvidence, {kind: 'DOCUMENT_PASSAGE'}> =>
    item.kind === 'DOCUMENT_PASSAGE' && item.documentVersionId === binding.documentVersionId &&
    item.evidenceRef === `DOCUMENT_ORIGINAL:${binding.documentVersionId}:${binding.parseRunId}:${item.sourceRefId}`);
  if (!primary.length || primary.length !== byRef.size || primary.some(item => {
    const entry = byRef.get(item.evidenceRef);
    return !entry || item.versionLabel !== binding.parseRunId || entry.sourceRefId !== item.sourceRefId ||
      entry.carrierRangeRef !== item.evidenceRef;
  }))
    throw new Error('JOBAID_AILY_INPUT_DELIVERY_BINDING_INVALID');
  return new Set(byRef.keys());
}

/** The trusted task keeps original bodies. Only its new CREATE view omits them. */
export function ailyTaskDeliveryModelInput(input: JobAidProblemTaskInput): JobAidProblemModelInput {
  if (input.ailyInputDelivery === undefined) return structuredClone(input.modelInput);
  if (input.ailyInputDelivery !== AILY_REGISTERED_PRIMARY_SOURCE_READ)
    throw new Error('JOBAID_AILY_INPUT_DELIVERY_BINDING_INVALID');
  const primaryRefs = registeredAilyPrimarySourceRefs(input);
  const {programOriginal, ...critical} = input.modelInput;
  const modelInput: JobAidProblemModelInput = structuredClone(critical);
  const binding = programOriginal!.binding;
  modelInput.deliveredEvidence = modelInput.deliveredEvidence.filter(item => !primaryRefs.has(item.evidenceRef));
  modelInput.primarySourceReading = {
    status: 'NOT_DELIVERED',
    documentVersionId: binding.documentVersionId,
    parseRunId: binding.parseRunId,
    instruction: '主原文尚未交付。请按 availableSources 中的准确引用调用 read_assessment_sources 读取正文；目录和语义导航不算已读。',
  };
  return modelInput;
}
