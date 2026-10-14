import type { TdmsRecordReadResponse } from './tdms-source.interface';

/** Host read projection, bound to the exact retained source revision. */
export interface TdmsSourceBodyReadPolicy {
  kind: 'METADATA_ONLY' | 'ESTIMATED_ASSESSMENT' | 'NON_OPINION_SOURCE';
  sourceRecordId: string;
  sourceRevisionRef: string;
}

/** Missing or mismatched policy is metadata-only. No raw body is inspected. */
export function canReadTdmsSourceBody(value: Pick<TdmsRecordReadResponse, 'record' | 'bodyReadPolicy'>): boolean {
  const policy: TdmsSourceBodyReadPolicy | undefined = value.bodyReadPolicy;
  if (!policy || policy.kind === 'METADATA_ONLY' || policy.sourceRecordId !== value.record.sourceRecordId ||
      policy.sourceRevisionRef !== value.record.sourceRevisionRef) return false;
  if (policy.kind === 'NON_OPINION_SOURCE') return true;
  return policy.kind === 'ESTIMATED_ASSESSMENT' && value.record.state?.rawName === 'Estimated' &&
    (value.record.state.rawCode === null || value.record.state.rawCode === 'Estimated');
}
