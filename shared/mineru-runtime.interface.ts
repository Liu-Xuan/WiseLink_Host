export interface MineruRuntimeReadiness {
  state: 'NOT_CONFIGURED' | 'PREPARING' | 'READY' | 'FAILED';
  stage: 'FILES' | 'DEPENDENCIES' | null;
  verifiedFiles: number;
  totalFiles: number;
  errorCode: string | null;
}
