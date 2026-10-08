import type { AssessmentEvidence } from '@shared/assessment-reading.interface';

/** Saved source identity is the only basis for historical pins; current directory rows cannot create them. */
export function savedTdmsSourceRefs(evidence: readonly AssessmentEvidence[]): string[] {
  return [...new Set(evidence.flatMap(item => item.kind === 'TDMS_NATIVE_RECORD' &&
    item.nativeSource.sourceRevisionRef === item.nativeReadReceipt.sourceRevisionRef &&
    item.nativeReadReceipt.readPerformed === true
    ? [item.nativeSource.sourceRevisionRef] : []))];
}
