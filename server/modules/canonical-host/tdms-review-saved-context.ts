import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type { JobAidWorkRevision } from '@shared/jobaid-problem-assessment.interface';
import { parseAssessmentTdmsEvidence } from '@shared/assessment-tdms-evidence';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';
import { assertTdmsRuntimeTaskContext, type TdmsRuntimeTaskContext } from '../tdms-source/tdms-runtime-reader.port';

/** Historical saved carriers only. This addon grants neither READ nor a lease. */
export interface TdmsReviewSavedContext {
  schemaVersion: 'wiselink.tdms-review-saved-context.v1';
  mode: 'SAVED_EVIDENCE_ONLY';
  reviewConversationRef: string;
  reviewTurnRef: string;
  requestId: string;
  inputRevision: number;
  workRevisionRef: string;
  workRevision: number;
  evidenceRefs: string[];
}

/** A frozen metadata directory, never a READ or a lease. Historical carriers
 * remain in previousWork; this context binds new reads to this real attempt. */
export interface TdmsReviewRuntimeContext {
  schemaVersion: 'wiselink.tdms-review-runtime-context.v1';
  mode: 'BOUNDED_NATIVE_READ';
  reviewConversationRef: string;
  reviewTurnRef: string;
  requestId: string;
  inputRevision: number;
  workRevisionRef: string;
  workRevision: number;
  savedEvidenceRefs: string[];
  runtimeContext: TdmsRuntimeTaskContext;
}
export type TdmsReviewContext = TdmsReviewSavedContext | TdmsReviewRuntimeContext;

export function assertTdmsReviewContext(value: unknown): TdmsReviewContext {
  return value && typeof value === 'object' && 'mode' in value && value.mode === 'BOUNDED_NATIVE_READ'
    ? assertTdmsReviewRuntimeContext(value) : assertTdmsReviewSavedContext(value);
}

export function assertTdmsReviewRuntimeContext(value: unknown): TdmsReviewRuntimeContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const record = value as Record<string, unknown>;
  const keys = ['schemaVersion','mode','reviewConversationRef','reviewTurnRef','requestId',
    'inputRevision','workRevisionRef','workRevision','savedEvidenceRefs','runtimeContext'];
  if (Object.keys(record).length !== keys.length || keys.some(key=>!Object.hasOwn(record,key)) ||
      record.schemaVersion !== 'wiselink.tdms-review-runtime-context.v1' || record.mode !== 'BOUNDED_NATIVE_READ' ||
      ['reviewConversationRef','reviewTurnRef','requestId','workRevisionRef'].some(
        key=>typeof record[key] !== 'string' || !String(record[key]).trim()) ||
      !Number.isSafeInteger(record.inputRevision) || Number(record.inputRevision)<0 ||
      !Number.isSafeInteger(record.workRevision) || Number(record.workRevision)<1 ||
      !Array.isArray(record.savedEvidenceRefs) || record.savedEvidenceRefs.length>4096 ||
      record.savedEvidenceRefs.some(ref=>typeof ref!=='string'||!ref.trim()) ||
      new Set(record.savedEvidenceRefs).size!==record.savedEvidenceRefs.length) invalid();
  assertTdmsRuntimeTaskContext(record.runtimeContext);
  return record as unknown as TdmsReviewRuntimeContext;
}

export function tdmsReviewSavedRefs(value: TdmsReviewContext): string[] {
  return value.mode === 'SAVED_EVIDENCE_ONLY' ? value.evidenceRefs : value.savedEvidenceRefs;
}

export function assertTdmsReviewSavedContext(value: unknown): TdmsReviewSavedContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const record = value as Record<string, unknown>;
  const keys = ['schemaVersion', 'mode', 'reviewConversationRef', 'reviewTurnRef', 'requestId',
    'inputRevision', 'workRevisionRef', 'workRevision', 'evidenceRefs'];
  if (Object.keys(record).length !== keys.length || keys.some((key: string) => !Object.hasOwn(record, key)) ||
      record.schemaVersion !== 'wiselink.tdms-review-saved-context.v1' || record.mode !== 'SAVED_EVIDENCE_ONLY' ||
      ['reviewConversationRef', 'reviewTurnRef', 'requestId', 'workRevisionRef'].some(
        (key: string) => typeof record[key] !== 'string' || !String(record[key]).trim()) ||
      !Number.isSafeInteger(record.inputRevision) || Number(record.inputRevision) < 0 ||
      !Number.isSafeInteger(record.workRevision) || Number(record.workRevision) < 1 ||
      !Array.isArray(record.evidenceRefs) || !record.evidenceRefs.length || record.evidenceRefs.length > 4096 ||
      record.evidenceRefs.some((ref: unknown) => typeof ref !== 'string' || !ref.trim()) ||
      new Set(record.evidenceRefs).size !== record.evidenceRefs.length) invalid();
  return record as unknown as TdmsReviewSavedContext;
}

export function assertTdmsReviewSavedBasis(input: {
  context: TdmsReviewSavedContext;
  purpose: string;
  previousWork: JobAidWorkRevision | null;
  sourceCatalog: AssessmentEvidence[];
  initiallyDeliveredRefs?: string[];
}): void {
  const context = assertTdmsReviewSavedContext(input.context);
  const previous = input.previousWork;
  if (input.purpose !== 'PROBLEM_REVIEW' || !previous ||
      context.workRevisionRef !== previous.workRevisionRef || context.workRevision !== previous.workRevision)
    invalid();
  const prior = previous.content.evidence.filter((item: AssessmentEvidence) => item.kind === 'TDMS_NATIVE_RECORD');
  const native = input.sourceCatalog.filter((item: AssessmentEvidence) => item.kind === 'TDMS_NATIVE_RECORD');
  if (canonicalJson([...context.evidenceRefs].sort()) !== canonicalJson(prior.map(
    (item: AssessmentEvidence) => item.evidenceRef).sort()) || native.length !== prior.length) invalid();
  for (const item of native) {
    parseAssessmentTdmsEvidence(item);
    const original = prior.find((saved: AssessmentEvidence) => saved.evidenceRef === item.evidenceRef);
    if (!original || canonicalJson(original) !== canonicalJson(item) ||
        (input.initiallyDeliveredRefs && !input.initiallyDeliveredRefs.includes(item.evidenceRef))) invalid();
  }
}

export function assertTdmsReviewBasis(input: {
  context: TdmsReviewContext;
  purpose: string;
  previousWork: JobAidWorkRevision | null;
  sourceCatalog: AssessmentEvidence[];
  initiallyDeliveredRefs?: string[];
}): void {
  const context=assertTdmsReviewContext(input.context);
  if (context.mode==='SAVED_EVIDENCE_ONLY') return assertTdmsReviewSavedBasis({...input,context});
  const previous=input.previousWork;
  if(input.purpose!=='PROBLEM_REVIEW'||!previous||context.workRevisionRef!==previous.workRevisionRef||
    context.workRevision!==previous.workRevision) invalid();
  const prior=previous.content.evidence.filter(item=>item.kind==='TDMS_NATIVE_RECORD');
  const native=input.sourceCatalog.filter(item=>item.kind==='TDMS_NATIVE_RECORD');
  if(canonicalJson([...context.savedEvidenceRefs].sort())!==canonicalJson(prior.map(item=>item.evidenceRef).sort())||
    native.length!==prior.length) invalid();
  for(const item of native) {
    parseAssessmentTdmsEvidence(item);
    const saved=prior.find(value=>value.evidenceRef===item.evidenceRef);
    if(!saved||canonicalJson(saved)!==canonicalJson(item)||
      (input.initiallyDeliveredRefs&&!input.initiallyDeliveredRefs.includes(item.evidenceRef))) invalid();
  }
}
function invalid(): never { throw new Error('JOBAID_TDMS_REVIEW_SAVED_CONTEXT_INVALID'); }
