import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';

export interface ReadOnlyProbeResult {
  path: string;
  status: number;
  body: unknown;
}

export async function getReadOnlyRuntimeProbe(): Promise<ReadOnlyProbeResult[]> {
  const paths = [
    '/api/runtime-probe',
    '/api/unified-reader/readiness',
    '/api/sb-job-aid/registrar-activation/readiness',
  ];

  const results: ReadOnlyProbeResult[] = [];
  for (const path of paths) {
    const response = await axiosForBackend.get<unknown>(path);
    results.push({ path, status: response.status, body: response.data });
  }
  return results;
}
