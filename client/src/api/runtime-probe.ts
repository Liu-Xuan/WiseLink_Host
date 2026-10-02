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
  releaseId?: string;
  apiContractVersion?: string;
}

export function runtimeFingerprintFrom(
  results: ReadOnlyProbeResult[],
): HostedRuntimeFingerprintResponse | null {
  const result = results.find(
    (result) => result.path === '/api/runtime-probe',
  );
  const body = result?.body;
  if (!result || result.status < 200 || result.status >= 300 ||
    !body || typeof body !== 'object' || Array.isArray(body)) return null;
  const value = body as Partial<HostedRuntimeFingerprintResponse>;
  if (value.schemaVersion !== 'wiselink.3_1.hosted_runtime_probe.v1' ||
    (value.status !== 'PASS' && value.status !== 'BLOCKED') ||
    typeof value.deployedCommit !== 'string' || !value.deployedCommit.trim()) return null;
  return {
    schemaVersion: value.schemaVersion,
    status: value.status,
    deployedCommit: value.deployedCommit,
    ...(typeof value.releaseId === 'string' && value.releaseId.trim()
      ? { releaseId: value.releaseId } : {}),
    ...(typeof value.apiContractVersion === 'string' && value.apiContractVersion.trim()
      ? { apiContractVersion: value.apiContractVersion } : {}),
  };
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
