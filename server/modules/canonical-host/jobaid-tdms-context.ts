import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import { parseAssessmentTdmsEvidence, type AssessmentTdmsNativeEvidence } from '@shared/assessment-tdms-evidence';
import type { TdmsRuntimeTaskContext } from '../tdms-source/tdms-runtime-reader.port';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';

/** No body or receipt is inferred from an approved locator. Historical evidence
 * keeps its exact old binding and must be freshly verified before a READ. */
export function tdmsJobAidDirectory(context: TdmsRuntimeTaskContext | undefined, evidence: AssessmentEvidence[]) {
  if (!context) return [];
  const entries = new Map(evidence.filter((item): item is AssessmentTdmsNativeEvidence => item.kind === 'TDMS_NATIVE_RECORD')
    .map(item => { const parsed = parseAssessmentTdmsEvidence(item); return [item.evidenceRef, {
      ref: item.evidenceRef, kind: 'TDMS_NATIVE_RECORD' as const, title: item.title,
      versionLabel: item.versionLabel, locator: parsed.nativeScope!.fieldSelectors.map(f => f.fieldPath).join(', '),
    }]; }));
  for (const item of context.projection.opinions) {
    if (!context.projection.selectedSetApprovedRefs.includes(item.evidenceRef) || entries.has(item.evidenceRef)) continue;
    entries.set(item.evidenceRef, {ref:item.evidenceRef,kind:'TDMS_NATIVE_RECORD',title:item.assessment.sourceRecordId,
      versionLabel:item.assessment.sourceVersion.rawRevision,locator:item.fieldPath});
  }
  return [...entries.values()];
}

/** Actual READ observations live in the existing fenced attempt journal. Keep
 * first-delivered bytes once and every separate fresh receipt, never upgrade a directory. */
export function resolvedTdmsReadEvidence(activityJson: string | null | undefined): AssessmentTdmsNativeEvidence[] {
  if (!activityJson) return [];
  const observations: unknown = JSON.parse(activityJson);
  if (!Array.isArray(observations)) throw new Error('JOBAID_SOURCE_ACTIVITY_INVALID');
  const evidence = new Map<string, AssessmentTdmsNativeEvidence>();
  for (const entry of observations) {
    if (!entry || typeof entry !== 'object' || entry.kind !== 'ASSESSMENT_SOURCES_READ' || entry.nativeEvidence === undefined) continue;
    if (!Array.isArray(entry.nativeEvidence)) throw new Error('JOBAID_TDMS_READ_OBSERVATION_INVALID');
    for (const raw of entry.nativeEvidence) {
      const item = parseAssessmentTdmsEvidence(raw);
      if (!Array.isArray(entry.sourceRefs) || !entry.sourceRefs.includes(item.evidenceRef))
        throw new Error('JOBAID_TDMS_READ_OBSERVATION_INVALID');
      const prior = evidence.get(item.evidenceRef);
      if (prior && !sameTdmsEvidenceBody(prior, item)) throw new Error('JOBAID_TDMS_BODY_CHANGED');
      evidence.set(item.evidenceRef, prior ?? item);
    }
  }
  return [...evidence.values()];
}
export function sameTdmsEvidenceBody(a: Extract<AssessmentEvidence, {kind:'TDMS_NATIVE_RECORD'}>, b: Extract<AssessmentEvidence, {kind:'TDMS_NATIVE_RECORD'}>): boolean {
  const {nativeReadReceipt: _a, ...left} = a;
  const {nativeReadReceipt: _b, ...right} = b;
  return canonicalJson(left) === canonicalJson(right);
}
export function mergeTdmsReadEvidence(catalog: AssessmentEvidence[], reads: AssessmentTdmsNativeEvidence[]): AssessmentEvidence[] {
  const map = new Map(catalog.map(item => [item.evidenceRef,item]));
  for (const item of reads) {
    const prior = map.get(item.evidenceRef);
    if (prior && (prior.kind !== 'TDMS_NATIVE_RECORD' || !sameTdmsEvidenceBody(prior,item)))
      throw new Error('JOBAID_TDMS_BODY_CHANGED');
    map.set(item.evidenceRef,prior ?? item);
  }
  return [...map.values()];
}

export function tdmsReadObservation(input: {nativeEvidence?: AssessmentTdmsNativeEvidence[]},
  stored: string | null | undefined, taskContextRef: string): {
    nativeEvidence?: AssessmentTdmsNativeEvidence[];
    nativeReadReceipts?: AssessmentTdmsNativeEvidence['nativeReadReceipt'][];
  } {
  if (!input.nativeEvidence?.length) return {};
  const prior = new Map(resolvedTdmsReadEvidence(stored).map(item => [item.evidenceRef,item]));
  const fresh = input.nativeEvidence.map(parseAssessmentTdmsEvidence);
  if (new Set(fresh.map(item=>item.evidenceRef)).size !== fresh.length ||
      new Set(fresh.map(item=>item.nativeReadReceipt.receiptRef)).size !== fresh.length ||
      fresh.some(item=>item.nativeReadReceipt.taskContextRef !== taskContextRef)) throw new Error('JOBAID_TDMS_READ_BINDING_INVALID');
  for (const item of fresh) {
    const old = prior.get(item.evidenceRef);
    if (old && !sameTdmsEvidenceBody(old,item)) throw new Error('JOBAID_TDMS_BODY_CHANGED');
  }
  return {nativeEvidence:fresh.filter(item=>!prior.has(item.evidenceRef)),nativeReadReceipts:fresh.map(item=>item.nativeReadReceipt)};
}
