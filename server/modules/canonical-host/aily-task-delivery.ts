import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type { JobAidProblemModelInput, JobAidProblemTaskInput } from './jobaid-problem-task';
import type { AilyAssessmentAttachment, AilyReferenceAttachment } from './aily-task-admission';
import type { JobAidChecklistBinding } from '@shared/jobaid-checklist.interface';
import type { JobAidPreparationView } from './jobaid-preparation-view';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';
import { JOBAID_CORE_METHOD_REFS } from './jobaid-method-pack';

export const AILY_REGISTERED_PRIMARY_SOURCE_READ = 'REGISTERED_PRIMARY_SOURCE_READ_V1';
export const AILY_REGISTERED_ASSESSMENT_ATTACHMENT = 'REGISTERED_ASSESSMENT_ATTACHMENT_V1';

/** A launch is intentionally a separate type from the private complete model input. */
export interface AilyAssessmentLaunchInput {
  schemaVersion: 'wiselink.aily-assessment-launch.v1';
  purpose: 'INITIAL_PROBLEM_ASSESSMENT';
  workItemId: string;
  documentVersionId: string;
  inputRevision: number;
  expectedWorkRevision: 0;
  originalBinding: AilyAssessmentAttachment['materialBinding']['originalBinding'];
  goal: string;
  checklist: Omit<JobAidChecklistBinding, 'definition' | 'selection'> & {
    selection: Array<Pick<JobAidChecklistBinding['selection'][number], 'itemId' | 'mode'>>;
  };
  methodBinding: JobAidProblemModelInput['methodBinding'];
  deliveredEvidence: JobAidProblemModelInput['deliveredEvidence'];
  requiredMethodReadRefs: string[];
  material: Pick<AilyAssessmentAttachment, 'attachmentId' | 'documentUrl' | 'purpose'> &
    Pick<AilyAssessmentAttachment['materialBinding'], 'documentRevision' | 'materialFormat'>;
  currentContext: Pick<JobAidProblemModelInput,
    'discussion' | 'hostApplicability' | 'capabilities' | 'historyReview' | 'knowledgeAccess' | 'sourceStatementAvailability'> & {
    preparation: Pick<JobAidPreparationView, 'targetIssueKeys' | 'pendingEngineerInputs' | 'savedUpdates' |
      'humanConfirmedDecisions' | 'humanConfirmationStatus' | 'limitations'>;
  };
  readingContract: string;
  outputContract: string;
}

export function ailyInlineCoreMethodRefs(input: JobAidProblemTaskInput): string[] {
  const bound = new Set(input.sourceCatalog.filter(item => item.kind === 'METHOD_CLAUSE' &&
    item.packRef === input.modelInput.methodBinding.packRef).map(item => item.evidenceRef));
  if (JOBAID_CORE_METHOD_REFS.some(ref => !bound.has(ref)))
    throw new Error('JOBAID_AILY_ASSESSMENT_MATERIAL_BINDING_INVALID');
  return [...JOBAID_CORE_METHOD_REFS];
}

export function assertAilyAssessmentMaterialBinding(input: JobAidProblemTaskInput, attachment: AilyAssessmentAttachment): void {
  const binding = attachment.materialBinding;
  const checklist = input.checklistBinding;
  const original = input.modelInput.programOriginal?.binding;
  if (!binding || !checklist || !original || input.executionMode !== 'AILY_AGENT_V1' ||
      input.modelInput.purpose !== 'INITIAL_PROBLEM_ASSESSMENT' || input.previousWork !== null ||
      input.modelInput.previousWork !== null || input.modelInput.expectedWorkRevision !== 0 || binding.expectedWorkRevision !== 0 ||
      binding.workItemId !== checklist.goal.workItemId || binding.basedOnWorkItemRevision !== checklist.goal.basedOnWorkItemRevision ||
      attachment.purpose !== 'REFERENCE_SNAPSHOT' || attachment.expectedDocumentVersionId !== original.documentVersionId ||
      !attachment.attachmentId?.trim() || !attachment.documentUrl?.trim() || !attachment.registeredCallerAppId?.trim() ||
      !attachment.registrationSource?.trim() || !Number.isSafeInteger(binding.documentRevision) || binding.documentRevision < 1 ||
      binding.materialFormat !== 'HOST_TASK_SNAPSHOT_V1' || canonicalJson(binding.originalBinding) !== canonicalJson(original) ||
      canonicalJson(binding.checklistBinding) !== canonicalJson({definitionId: checklist.definitionId,
        definitionVersion: checklist.definitionVersion, definitionContentHash: checklist.definitionContentHash,
        contractVersion: checklist.contractVersion}) || canonicalJson(binding.methodBinding) !== canonicalJson(input.modelInput.methodBinding))
    throw new Error('JOBAID_AILY_ASSESSMENT_MATERIAL_BINDING_INVALID');
  const primary = registeredAilyPrimarySourceRefs(input);
  if (input.tdmsContext || input.tdmsReviewContext || input.sourceCatalog.some(item =>
    item.kind === 'METHOD_CLAUSE' ? item.packRef !== binding.methodBinding.packRef : !primary.has(item.evidenceRef)))
    throw new Error('JOBAID_AILY_ASSESSMENT_MATERIAL_SCOPE_INVALID');
}

export function selectAilyAssessmentAttachment(input: JobAidProblemTaskInput,
  references: AilyReferenceAttachment[] = []): AilyAssessmentAttachment | undefined {
  const materials = references.filter(item => Object.hasOwn(item, 'materialBinding'));
  if (!materials.length) return undefined;
  const attachment = materials[0];
  if (materials.length !== 1 || !isAssessmentAttachment(attachment))
    throw new Error('JOBAID_AILY_ASSESSMENT_MATERIAL_BINDING_INVALID');
  assertAilyAssessmentMaterialBinding(input, attachment);
  return structuredClone(attachment);
}

function isAssessmentAttachment(input: AilyReferenceAttachment): input is AilyAssessmentAttachment {
  return input.materialBinding !== undefined && input.materialBinding !== null;
}

function assessmentLaunch(input: JobAidProblemTaskInput): AilyAssessmentLaunchInput {
  const attachment = input.ailyAssessmentAttachment;
  const checklist = input.checklistBinding;
  const preparation = input.modelInput.preparation;
  if (!attachment || !checklist || !preparation || preparation.taskPurpose !== 'INITIAL_PROBLEM_ASSESSMENT' ||
      preparation.taskInputRevision !== checklist.goal.basedOnWorkItemRevision || preparation.currentInputChanged)
    throw new Error('JOBAID_AILY_ASSESSMENT_MATERIAL_BINDING_INVALID');
  assertAilyAssessmentMaterialBinding(input, attachment);
  const {definition: _definition, selection, ...checklistMetadata} = checklist;
  return {
    schemaVersion: 'wiselink.aily-assessment-launch.v1', purpose: 'INITIAL_PROBLEM_ASSESSMENT',
    workItemId: checklist.goal.workItemId, documentVersionId: checklist.goal.documentVersionId,
    inputRevision: checklist.goal.basedOnWorkItemRevision, expectedWorkRevision: 0,
    originalBinding: structuredClone(attachment.materialBinding.originalBinding), goal: preparation.goal,
    checklist: {...structuredClone(checklistMetadata), selection: selection.map(({itemId, mode}) => ({itemId, mode}))},
    methodBinding: structuredClone(input.modelInput.methodBinding), deliveredEvidence: structuredClone(input.modelInput.deliveredEvidence),
    requiredMethodReadRefs: input.sourceCatalog.filter(item => item.kind === 'METHOD_CLAUSE' &&
      item.packRef === input.modelInput.methodBinding.packRef && !input.initiallyDeliveredRefs.includes(item.evidenceRef))
      .map(item => item.evidenceRef),
    material: {attachmentId: attachment.attachmentId, documentUrl: attachment.documentUrl, purpose: attachment.purpose,
      documentRevision: attachment.materialBinding.documentRevision, materialFormat: attachment.materialBinding.materialFormat},
    currentContext: {discussion: structuredClone(input.modelInput.discussion), hostApplicability: structuredClone(input.modelInput.hostApplicability),
      capabilities: structuredClone(input.modelInput.capabilities), historyReview: structuredClone(input.modelInput.historyReview),
      ...(input.modelInput.knowledgeAccess ? {knowledgeAccess: structuredClone(input.modelInput.knowledgeAccess)} : {}),
      ...(input.modelInput.sourceStatementAvailability ? {sourceStatementAvailability: structuredClone(input.modelInput.sourceStatementAvailability)} : {}),
      preparation: {targetIssueKeys: [...preparation.targetIssueKeys], pendingEngineerInputs: structuredClone(preparation.pendingEngineerInputs),
        savedUpdates: structuredClone(preparation.savedUpdates), humanConfirmedDecisions: structuredClone(preparation.humanConfirmedDecisions),
        humanConfirmationStatus: preparation.humanConfirmationStatus, limitations: [...preparation.limitations]}},
    readingContract: '先使用平台原生附件解析/读取能力取得材料中完整八项问题、commonPolicy、ruleCatalog、方法及成果标准、原文正文和目录，不能只看链接或摘要。'
      + '附件为历史材料快照；其中旧 taskContextRef、owner、期限、已读标记、阶段与保存状态无效，旧讨论和准备状态不能覆盖本次 Host 当前目标与绑定。'
      + '附件或目录不授予 Host 来源引用资格。先按 requiredMethodReadRefs 调用现有 read_assessment_sources 取得其余方法全文；'
      + '原文按材料目录中的准确 refs 调用该工具真实读取并记录，不猜写拒绝的 ref、不换版本或制造已读标记。'
      + '附件不可读、正文不全或材料身份不符时，明确报告失败及缺项，不得宣称已完整消费或完成分析。',
    outputContract: '按八项 selection/acceptance 形成 wiselink.jobaid-problem-work.v3 完整候选正文与 checklistResults、methodUsage、真实引用及未决项。'
      + '沿现有 validate_assessment_work、save_assessment_work、独立 read_assessment_work 取得真实正文、引用、三扩展、revision/ref 后才做同版 Overall；'
      + '合法阶段可继续，最终通过 finish_assessment_task 收尾。平台结束、附件读取或候选保存不等于正式采用、审批或放行。',
  };
}

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
export function ailyTaskDeliveryModelInput(input: JobAidProblemTaskInput): JobAidProblemModelInput | AilyAssessmentLaunchInput {
  if (input.ailyInputDelivery === AILY_REGISTERED_ASSESSMENT_ATTACHMENT) return assessmentLaunch(input);
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
