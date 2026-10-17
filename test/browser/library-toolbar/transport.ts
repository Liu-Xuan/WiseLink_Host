// Test-only local HTTP transport; no credentials, hosted connection or model call.
export async function axiosForBackend(input: {
  url: string; method?: string; signal?: AbortSignal; params?: Record<string, unknown>;
}) {
  const url = new URL(input.url, location.origin);
  for (const [key, value] of Object.entries(input.params ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { method: input.method ?? 'GET', signal: input.signal });
  return { status: response.status, data: await response.json() };
}

export const authClient = { session: {
  getUserInfo: async () => ({ status: 200, data: { user_info: {
    user_id: 'local-fixture-reader', name: '本地组件测试',
  } } }),
  redirectToLogin: () => ({ error: null }),
  navigateToUserProfile: () => ({ error: null }),
  signOut: async () => ({ error: null }),
} };
