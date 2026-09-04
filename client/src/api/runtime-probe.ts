import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';

export interface ReadOnlyProbeResult {
  path: string;
  status: number;
  body: unknown;
}

export interface HostedRuntimeFingerprintResponse {
  schemaVersion: 'wiselink.3_1.hosted_runtime_probe.v1';
  status: 'PASS' | 'BLOCKED';
  deployedCommit: string;
  releaseId: string;
  apiContractVersion: string;
}

export function runtimeFingerprintFrom(
  results: ReadOnlyProbeResult[],
): HostedRuntimeFingerprintResponse | null {
  const body = results.find(
    (result) => result.path === '/api/runtime-probe',
  )?.body;
  if (!body || typeof body !== 'object') return null;
  const value = body as Partial<HostedRuntimeFingerprintResponse>;
  return value.schemaVersion === 'wiselink.3_1.hosted_runtime_probe.v1' &&
    typeof value.deployedCommit === 'string' &&
    typeof value.releaseId === 'string' &&
    typeof value.apiContractVersion === 'string'
    ? (value as HostedRuntimeFingerprintResponse)
    : null;
}

export async function getHostedRuntimeFingerprint(): Promise<HostedRuntimeFingerprintResponse> {
  const response = await axiosForBackend<unknown>({
    url: '/api/runtime-probe',
    method: 'GET',
  });
  const fingerprint = runtimeFingerprintFrom([
    {
      path: '/api/runtime-probe',
      status: response.status,
      body: response.data,
    },
  ]);
  if (response.status < 200 || response.status >= 300 || fingerprint === null) {
    throw new Error('HOSTED_RUNTIME_FINGERPRINT_UNAVAILABLE');
  }
  return fingerprint;
}

export async function getReadOnlyRuntimeProbe(): Promise<
  ReadOnlyProbeResult[]
> {
  const paths = ['/api/runtime-probe', '/api/unified-reader/readiness'];

  const results: ReadOnlyProbeResult[] = [];
  for (const path of paths) {
    const response = await axiosForBackend<unknown>({
      url: path,
      method: 'GET',
    });
    results.push({ path, status: response.status, body: response.data });
  }
  return results;
}
