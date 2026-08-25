import 'reflect-metadata';

import { OauthStateStore } from '../../server/modules/identity/oauth-state.store';

function repository() {
  const rows = new Map<string, { codeVerifier: string; expiresAt: Date; consumed: boolean }>();
  return {
    rows,
    issueOauthState: jest.fn(async (input: { stateHash: string; codeVerifier: string; expiresAt: Date }) => {
      rows.set(input.stateHash, { codeVerifier: input.codeVerifier, expiresAt: input.expiresAt, consumed: false });
    }),
    consumeOauthState: jest.fn(async (hash: string, now: Date) => {
      const row = rows.get(hash);
      if (!row || row.consumed || row.expiresAt <= now) return null;
      row.consumed = true;
      return { codeVerifier: row.codeVerifier };
    }),
  };
}

describe('OauthStateStore persistent one-time contract', () => {
  it('stores a SHA-256 state digest rather than the raw browser state', async () => {
    const repo = repository();
    const state = await new OauthStateStore(repo as never).issue('verifier-1');
    const persisted = repo.issueOauthState.mock.calls[0][0];
    expect(persisted.stateHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(persisted.stateHash).not.toBe(state);
  });

  it('returns the exact server-side PKCE verifier on consume', async () => {
    const repo = repository();
    const store = new OauthStateStore(repo as never);
    const state = await store.issue('verifier-exact');
    await expect(store.consume(state)).resolves.toEqual({ codeVerifier: 'verifier-exact' });
  });

  it('rejects replay through the repository atomic consume', async () => {
    const repo = repository();
    const store = new OauthStateStore(repo as never);
    const state = await store.issue('verifier');
    await expect(store.consume(state)).resolves.not.toBeNull();
    await expect(store.consume(state)).resolves.toBeNull();
  });

  it('rejects a never-issued state', async () => {
    await expect(new OauthStateStore(repository() as never).consume('never-issued')).resolves.toBeNull();
  });

  it('rejects an empty state without a database call', async () => {
    const repo = repository();
    await expect(new OauthStateStore(repo as never).consume('')).resolves.toBeNull();
    expect(repo.consumeOauthState).not.toHaveBeenCalled();
  });

  it('issues independent random browser state values', async () => {
    const store = new OauthStateStore(repository() as never);
    const states = await Promise.all([store.issue('v1'), store.issue('v2'), store.issue('v3')]);
    expect(new Set(states).size).toBe(3);
  });

  it('binds each state to its own verifier', async () => {
    const store = new OauthStateStore(repository() as never);
    const first = await store.issue('v-A');
    const second = await store.issue('v-B');
    await expect(store.consume(first)).resolves.toEqual({ codeVerifier: 'v-A' });
    await expect(store.consume(second)).resolves.toEqual({ codeVerifier: 'v-B' });
  });

  it('rejects an expired row even when the browser presents the correct state', async () => {
    const repo = repository();
    const store = new OauthStateStore(repo as never);
    const state = await store.issue('expired');
    for (const row of repo.rows.values()) row.expiresAt = new Date(0);
    await expect(store.consume(state)).resolves.toBeNull();
  });

  it('does not silently downgrade a database write failure', async () => {
    const repo = repository();
    repo.issueOauthState.mockRejectedValueOnce(new Error('DB_UNAVAILABLE') as never);
    await expect(new OauthStateStore(repo as never).issue('verifier')).rejects.toThrow('DB_UNAVAILABLE');
  });
});
