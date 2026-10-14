import type { TdmsRecordReadResponse } from './tdms-source.interface';

/** Host read projection, bound to the exact retained source revision. */
export interface TdmsSourceBodyReadPolicy {
  kind: 'METADATA_ONLY' | 'ESTIMATED_ASSESSMENT' | 'NON_OPINION_SOURCE' | 'OWN_PROCESSING_FIELDS';
  sourceRecordId: string;
  sourceRevisionRef: string;
}

/** Missing or mismatched policy is metadata-only. No raw body is inspected. */
export function canReadTdmsSourceBody(value: Pick<TdmsRecordReadResponse, 'record' | 'bodyReadPolicy'>): boolean {
  const policy: TdmsSourceBodyReadPolicy | undefined = value.bodyReadPolicy;
  if (!policy || policy.kind === 'METADATA_ONLY' || policy.sourceRecordId !== value.record.sourceRecordId ||
      policy.sourceRevisionRef !== value.record.sourceRevisionRef) return false;
  if (policy.kind === 'NON_OPINION_SOURCE')
    return !['ENGINEER_ASSESSMENT', 'COMMENT', 'PROCESSING_SHEET'].includes(value.record.recordKind);
  if (policy.kind === 'OWN_PROCESSING_FIELDS') {
    const nativeTypes: (string | null | undefined)[] = [value.record.fileType?.rawName, value.record.fileType?.rawCode];
    return value.record.recordKind === 'PROCESSING_SHEET' &&
      nativeTypes.some((type) => type === 'SB处理单' || type === 'SL处理单') &&
      !nativeTypes.some((type) => ['SB评估单', 'SL评估单', '工程文件编写评估单', 'AD分处理单', 'AD处理条目'].includes(type ?? ''));
  }
  return policy.kind === 'ESTIMATED_ASSESSMENT' && value.record.state?.rawName === 'Estimated' &&
    (value.record.state.rawCode === null || value.record.state.rawCode === 'Estimated');
}
