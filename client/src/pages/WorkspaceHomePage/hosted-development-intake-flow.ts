import type { CanonicalDevelopmentWorkItemRunRequest } from '@shared/api.interface';

export interface HostedUploadSelection {
  bucketId: string;
  filePath: string;
  developmentRunToken: string;
}

export type HostedIntakeSource<TFile = File> =
  | {
      kind: 'existing';
      selection: HostedUploadSelection;
    }
  | {
      kind: 'local';
      file: TFile;
      cachedUpload: HostedUploadSelection | null;
    };

export interface ResolvedHostedIntakeSelection<TFile = File> {
  selection: HostedUploadSelection;
  uploadedNow: boolean;
  localFile: TFile | null;
}

export async function resolveHostedIntakeSelection<TFile>(
  source: HostedIntakeSource<TFile>,
  dependencies: {
    createToken(): string;
    upload(
      file: TFile,
      token: string,
    ): Promise<{
      bucketId: string;
      filePath: string;
    }>;
  },
): Promise<ResolvedHostedIntakeSelection<TFile>> {
  if (source.kind === 'existing') {
    return {
      selection: source.selection,
      uploadedNow: false,
      localFile: null,
    };
  }

  if (source.cachedUpload) {
    return {
      selection: source.cachedUpload,
      uploadedNow: false,
      localFile: source.file,
    };
  }

  const uploadToken = dependencies.createToken();
  const uploaded = await dependencies.upload(source.file, uploadToken);
  return {
    selection: {
      ...uploaded,
      developmentRunToken: dependencies.createToken(),
    },
    uploadedNow: true,
    localFile: source.file,
  };
}

export function developmentWorkItemRequest(
  selection: HostedUploadSelection,
): CanonicalDevelopmentWorkItemRunRequest {
  return {
    selection: {
      bucketId: selection.bucketId,
      filePath: selection.filePath,
    },
    developmentRunToken: selection.developmentRunToken,
    query: 'applicability',
  };
}

export interface HostedIntakeSubmissionGate {
  current: boolean;
}

export function beginHostedIntakeSubmission(
  gate: HostedIntakeSubmissionGate,
): boolean {
  if (gate.current) return false;
  gate.current = true;
  return true;
}

export function endHostedIntakeSubmission(
  gate: HostedIntakeSubmissionGate,
): void {
  gate.current = false;
}
