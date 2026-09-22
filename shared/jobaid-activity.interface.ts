/** Safe metadata from an authorized WorkItem attempt; never a model reasoning log. */
export interface JobAidActivityRead {
  attemptRef: string | null;
  candidateOnly: true;
  sourceReads: Array<{
    sequence: number;
    observedAt: string | null;
    sourceCount: number;
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
