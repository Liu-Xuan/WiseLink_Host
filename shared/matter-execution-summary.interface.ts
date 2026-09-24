/** Current Matter automatic attempt only. All fields are bounded read projections. */
export interface MatterExecutionSummary {
  matterId: string;
  matterRevisionId: string;
  workingRevision: number;
  observedAt: string;
  state:
    | 'IDLE'
    | 'QUEUED'
    | 'RUNNING'
    | 'RETRY_SCHEDULED'
    | 'COMMITTING'
    | 'SUCCEEDED'
    | 'FAILED'
    | 'TIMED_OUT'
    | 'CANCELLED'
    | 'WAITING_INPUT'
    | 'CONFLICT'
    | 'OBSOLETE';
  attemptRef: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
  currentWorkSavedByAttempt: boolean;
  inputs: { workItems: number; documents: number; pending: number };
  tools: {
    registeredSourcesRead: boolean;
    sourcePagesRead: boolean;
    originalRead: boolean;
    candidateSaved: boolean;
  };
}
