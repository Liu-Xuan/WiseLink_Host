/** One server-owned execution route. Caller headers and app IDs never select it. */
export type CanonicalHostExecutor = 'HOSTED' | 'CODEX';

export function canonicalHostExecutor(): CanonicalHostExecutor {
  const executor = process.env.WL_MODEL_EXECUTOR ?? 'HOSTED';
  if (executor !== 'HOSTED' && executor !== 'CODEX')
    throw executorError('CANONICAL_EXECUTOR_CONFIG_INVALID', 503);
  return executor;
}

export function assertCanonicalHostExecutor(expected: CanonicalHostExecutor): void {
  if (canonicalHostExecutor() !== expected)
    throw executorError('CANONICAL_EXECUTOR_ENDPOINT_INACTIVE', 503);
}

/** Existing exact scopes keep their shape; CODEX never inherits legacy grants. */
export function canonicalExecutorSetting(suffix: string): string | undefined {
  const prefix = canonicalHostExecutor() === 'CODEX' ? 'WL_CODEX_' : 'WL_OPENCLAW_';
  return process.env[`${prefix}${suffix}`];
}

export function canonicalExecutorRuntime(executor = canonicalHostExecutor()): {
  runtime: 'FEISHU_HOSTED_OPENCLAW' | 'CODEX'; runtimeAppId: string;
} {
  if (executor === 'HOSTED')
    return { runtime: 'FEISHU_HOSTED_OPENCLAW', runtimeAppId: 'app_17c3zn24kv2' };
  const runtimeAppId = process.env.WL_CODEX_RUNTIME_APP_ID;
  if (!runtimeAppId || !/^app_[a-z0-9]+$/u.test(runtimeAppId))
    throw executorError('CANONICAL_CODEX_RUNTIME_CONFIG_REQUIRED', 503);
  return { runtime: 'CODEX', runtimeAppId };
}

/** The first CODEX rollout is one explicitly bound intake, never a tenant sweep. */
export function canonicalCodexWorkItemScope(): { workItemId: string; requestId: string } | null {
  if (canonicalHostExecutor() !== 'CODEX') return null;
  const workItemId = process.env.WL_CODEX_SERVICE_WORK_ITEM_ID;
  const requestId = process.env.WL_CODEX_SERVICE_REQUEST_ID;
  const principalId = process.env.WL_CODEX_SERVICE_PRINCIPAL_ID;
  if (!workItemId || !/^WI-[A-Za-z0-9_-]{1,93}$/u.test(workItemId) ||
      !requestId?.trim() || requestId.trim() !== requestId ||
      !principalId?.startsWith('service:') || principalId === 'service:openclaw-main' ||
      principalId === process.env.WL_OPENCLAW_SERVICE_PRINCIPAL_ID ||
      process.env.WL_CODEX_SERVICE_AUTO_QUEUE_ENABLED !== '1')
    throw executorError('CANONICAL_CODEX_EXACT_SCOPE_REQUIRED', 503);
  return { workItemId, requestId };
}

export function assertCanonicalCodexWorkItem(workItemId: string, requestId?: string): void {
  const scope = canonicalCodexWorkItemScope();
  if (scope && (scope.workItemId !== workItemId ||
      (requestId !== undefined && scope.requestId !== requestId)))
    throw executorError('CANONICAL_CODEX_REQUEST_SCOPE_MISMATCH', 403);
}

export function canonicalExecutorMcpIdentity(executor: CanonicalHostExecutor): {
  name: string; version: string;
} {
  return {
    name: executor === 'CODEX'
      ? 'wiselink-codex-engineering-assessment' : 'wiselink-openclaw-engineering-assessment',
    version: '1.2.0',
  };
}

function executorError(code: string, statusCode: number): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode });
}
