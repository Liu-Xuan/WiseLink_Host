export type JobAidKnowledgeObservationStatus =
  | 'REQUESTED' | 'STARTING' | 'RUNNING' | 'COMPLETED'
  | 'FAILED' | 'UNKNOWN' | 'UNAVAILABLE';

/** A stopped caller reports an observation, never a provider terminal result. */
export interface JobAidConsumerStoppedReport {
  requestId: string | null;
  documentVersionId: string;
  inputRevision: number;
  modelRound: number;
  errorCode: string;
  upstreamOutcome: 'UNKNOWN';
}

export interface JobAidConsumerStoppedReceipt {
  status: 'RECORDED';
  attemptRef: string;
  observedAt: string;
  upstreamOutcome: 'UNKNOWN';
  replayed: boolean;
}

export function isJobAidConsumerStoppedReport(value: unknown): value is JobAidConsumerStoppedReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const report = value as Record<string, unknown>;
  return (report.requestId === null || typeof report.requestId === 'string' &&
      /^[A-Za-z0-9_-]{1,64}$/u.test(report.requestId)) &&
    typeof report.documentVersionId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/u.test(report.documentVersionId) &&
    Number.isSafeInteger(report.inputRevision) && Number(report.inputRevision) >= 0 &&
    Number.isSafeInteger(report.modelRound) && Number(report.modelRound) >= 1 &&
    Number(report.modelRound) <= 64 &&
    typeof report.errorCode === 'string' && /^[A-Z][A-Z0-9_:.-]{0,199}$/u.test(report.errorCode) &&
    report.upstreamOutcome === 'UNKNOWN';
}

/** Safe metadata from an authorized WorkItem attempt; never a model reasoning log. */
export interface JobAidActivityRead {
  attemptRef: string | null;
  candidateOnly: true;
  sourceReads: Array<{
    sequence: number;
    observedAt: string | null;
    sourceCount: number;
  }>;
  /** Absent on older Host responses; observations, not a query/process truth source. */
  knowledgeObservations?: Array<{
    sequence: number;
    observedAt: string | null;
    status: JobAidKnowledgeObservationStatus;
  }>;
  /** Bound to this selected attempt; its authoritative status is unchanged. */
  consumerStopped?: {
    sequence: number;
    observedAt: string;
    modelRound: number;
    errorCode: string;
    upstreamOutcome: 'UNKNOWN';
  };
  savedRevisions: Array<{
    workRevisionRef: string;
    workRevision: number;
    savedAt: string;
  }>;
  omittedEarlierRecordCount: number;
  unknownRecordCount: number;
  malformedRecordCount: number;
  hasEarlierSavedRevisions: boolean;
  error: 'ACTIVITY_RECORDS_INVALID' | null;
}
