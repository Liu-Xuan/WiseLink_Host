import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';

import type {
  ExternalDiscoveryPageResponse,
  ExternalDiscoverySelectionResponse,
} from '@shared/api.interface';

export async function listSearchRuns(): Promise<ExternalDiscoveryPageResponse> {
  const response = await axiosForBackend<ExternalDiscoveryPageResponse>({
    method: 'GET',
    url: '/api/external-discovery/search-runs',
  });
  return response.data;
}

export async function selectCandidate(
  searchRunRef: string,
  candidateRef: string,
): Promise<ExternalDiscoverySelectionResponse> {
  return review(searchRunRef, candidateRef, 'select');
}

export async function rejectCandidate(
  searchRunRef: string,
  candidateRef: string,
): Promise<ExternalDiscoverySelectionResponse> {
  return review(searchRunRef, candidateRef, 'reject');
}

async function review(
  searchRunRef: string,
  candidateRef: string,
  action: 'select' | 'reject',
): Promise<ExternalDiscoverySelectionResponse> {
  const response = await axiosForBackend<ExternalDiscoverySelectionResponse>({
    method: 'POST',
    url:
      `/api/external-discovery/search-runs/${encodeURIComponent(searchRunRef)}`
      + `/candidates/${encodeURIComponent(candidateRef)}/${action}`,
    data: {},
  });
  return response.data;
}
