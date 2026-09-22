export type JobAidKnowledgeObservationStatus =
  | 'REQUESTED' | 'STARTING' | 'RUNNING' | 'COMPLETED'
  | 'FAILED' | 'UNKNOWN' | 'UNAVAILABLE';

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
