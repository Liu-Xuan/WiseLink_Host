import type { DocumentParsingSettingsSnapshot } from './document-parsing-settings.interface';

/** Host-issued control data. Never include this lease in a model prompt. */
export interface LocalMineruWorkerLease {
  leaseOwner: string;
  leaseToken: string;
  leaseGeneration: number;
}
export interface LocalMineruWorkerIdentity {
  parseRunId: string;
  documentVersionId: string;
  lease: LocalMineruWorkerLease;
}
export interface LocalMineruWorkerClaim extends LocalMineruWorkerIdentity {
  status: 'CLAIMED';
  sourceSha256: string;
  sourceByteLength: number;
  settings: DocumentParsingSettingsSnapshot;
  deadlineAt: string;
}
export type LocalMineruWorkerClaimResult = { status: 'IDLE' } | LocalMineruWorkerClaim;
export interface LocalMineruWorkerRenewResult {
  status: 'RENEWED';
  deadlineAt: string;
}
/** Source normally returns PDF bytes; this JSON reply recovers an already received candidate. */
export interface LocalMineruWorkerSourceReady {
  status: 'CANDIDATE_READY';
  parseRunId: string;
}
export interface LocalMineruWorkerResult {
  status: 'ACCEPTED' | 'PUBLISHED';
  parseRunId: string;
  candidateSha256: string;
}
