import type { AssessmentEvidence } from './assessment-reading.interface';
import type {
  EngineeringMatterWorkingInputBinding,
  EngineeringMatterWorkingRevisionReadModel,
} from './matter-working.interface';

/** Summary of an action attempt still occupying the matter; control content is never exposed. */
export interface MatterCurrentWorkActiveAttempt {
  attemptRef: string;
  status: 'QUEUED' | 'RUNNING' | 'RETRY_SCHEDULED' | 'COMMITTING';
}

/**
 * Read-only snapshot returned by the read_matter_current_work Host entry. It
 * carries the fresh compare-and-set identity, the complete current work read
 * model and the registered source catalog; it never creates or mutates an
 * attempt, work revision, event or read receipt.
 */
export interface MatterCurrentWorkReadModel {
  matterId: string;
  matterRevisionId: string;
  matterRevision: number;
  workRef: string | null;
  workingRevision: number;
  current: EngineeringMatterWorkingRevisionReadModel | null;
  currentInputs: EngineeringMatterWorkingInputBinding[];
  sourceCatalog: AssessmentEvidence[];
  eligibleEvidenceRefs: string[];
  activeAttempts: MatterCurrentWorkActiveAttempt[];
}
