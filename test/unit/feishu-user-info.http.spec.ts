import 'reflect-metadata';

import {
  HttpFeishuUserInfoAdapter,
  UnavailableFeishuUserInfoHttpAdapter,
  type FeishuUserInfoFetch,
  type FeishuUserInfoResponse,
} from '../../server/modules/identity/feishu-user-info.http';

// ─── Helpers ────────────────────────────────────────────────────────────────

const TOKEN = 'u-very_secret_access_token';

function makeResponse(
  ok: boolean,
  status: number,
  body: unknown,
): ReturnType<FeishuUserInfoFetch> extends Promise<infer R> ? R : never {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  };
}

/** Builds a mock fetch whose `json()` returns the Feishu envelope shape. */
function okResponse(
  data: Record<string, unknown> | null = {
    open_id: 'ou_test_user_001',
    tenant_key: 'tkey_test_tenant',
    user_id: 'emp_test_001',
    name: 'Test Engineer',
  },
  code = 0,
): ReturnType<FeishuUserInfoFetch> extends Promise<infer R> ? R : never {
  return makeResponse(true, 200, { code, msg: 'ok', data });
}

/** A fetch impl that records the last URL + init it received. */
function recordingFetch(
  response: ReturnType<FeishuUserInfoFetch> extends Promise<infer R> ? R : never,
): FeishuUserInfoFetch & {
  calls: { url: string; init: Record<string, unknown> }[];
} {
  const calls: { url: string; init: Record<string, unknown> }[] = [];
  const fn: FeishuUserInfoFetch = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(response);
  };
  return Object.assign(fn, { calls });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('HttpFeishuUserInfoAdapter', () => {
  // ── T1: success — all fields parsed ──
  it('returns full FeishuUserInfoResponse on a valid 200 body', async () => {
    const fetchImpl = recordingFetch(
      okResponse({
        open_id: 'ou_test_user_001',
        tenant_key: 'tkey_test_tenant',
        user_id: 'emp_test_001',
        name: 'Test Engineer',
      }),
    );
    const adapter = new HttpFeishuUserInfoAdapter(fetchImpl, 5000);

    const r = await adapter.fetchUserInfo({ accessToken: TOKEN });

    expect(r).toEqual<FeishuUserInfoResponse>({
      openId: 'ou_test_user_001',
      tenantKey: 'tkey_test_tenant',
      userId: 'emp_test_001',
      name: 'Test Engineer',
    });
  });

  // ── T2: success — only required fields (open_id + tenant_key) ──
  it('parses response when user_id and name are absent (null)', async () => {
    const fetchImpl = recordingFetch(
      okResponse({
        open_id: 'ou_minimal',
        tenant_key: 'tkey_min',
      }),
    );
    const adapter = new HttpFeishuUserInfoAdapter(fetchImpl);

    const r = await adapter.fetchUserInfo({ accessToken: TOKEN });

    expect(r).toEqual({
      openId: 'ou_minimal',
      tenantKey: 'tkey_min',
      userId: null,
      name: null,
    });
  });

  // ── T3: authentication header — Bearer + token ──
  it('sends GET with Authorization: Bearer <token> header', async () => {
    const fetchImpl = recordingFetch(okResponse());
    const adapter = new HttpFeishuUserInfoAdapter(fetchImpl, 5000);

    await adapter.fetchUserInfo({ accessToken: TOKEN });

    expect(fetchImpl.calls).toHaveLength(1);
    const { url, init } = fetchImpl.calls[0];
    expect(url).toBe(
      'https://open.feishu.cn/open-apis/authen/v1/user_info',
    );
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
    });
  });

  // ── T4: empty / whitespace token → null without networking ──
  it('returns null for empty accessToken without calling fetch', async () => {
    const fetchImpl = jest.fn() as unknown as FeishuUserInfoFetch;
    const adapter = new HttpFeishuUserInfoAdapter(fetchImpl);

    expect(await adapter.fetchUserInfo({ accessToken: '' })).toBeNull();
    expect(await adapter.fetchUserInfo({ accessToken: '   ' })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // ── T5: non-2xx HTTP status → null ──
  it.each([401, 403, 404, 500, 502, 503])(
    'returns null on HTTP %i',
    async (status) => {
      const fetchImpl = recordingFetch(
        makeResponse(status < 400, status, { code: 0, msg: '', data: {} }),
      );
      const adapter = new HttpFeishuUserInfoAdapter(fetchImpl);

      const r = await adapter.fetchUserInfo({ accessToken: TOKEN });
      expect(r).toBeNull();
    },
  );

  // ── T6: API-level error (code !== 0) → null ──
  it('returns null when Feishu API code is non-zero (expired/revoked token)', async () => {
    const fetchImpl = recordingFetch(
      makeResponse(true, 200, {
        code: 99991668,
        msg: 'access token expired',
        data: null,
      }),
    );
    const adapter = new HttpFeishuUserInfoAdapter(fetchImpl);

    expect(await adapter.fetchUserInfo({ accessToken: TOKEN })).toBeNull();
  });

  // ── T7: malformed body shapes → null ──
  it.each([
    ['null body', null],
    ['non-object body (string)', 'not json'],
    ['array body', [1, 2, 3]],
    ['missing data field', { code: 0, msg: 'ok' }],
    ['data is null', { code: 0, msg: 'ok', data: null }],
    ['data is array', { code: 0, msg: 'ok', data: [1] }],
    ['data missing open_id', { code: 0, msg: 'ok', data: { tenant_key: 'tk' } }],
    ['data missing tenant_key', { code: 0, msg: 'ok', data: { open_id: 'ou' } }],
    ['open_id empty string', { code: 0, msg: 'ok', data: { open_id: '', tenant_key: 'tk' } }],
    ['tenant_key empty string', { code: 0, msg: 'ok', data: { open_id: 'ou', tenant_key: '' } }],
    ['open_id non-string', { code: 0, msg: 'ok', data: { open_id: 123, tenant_key: 'tk' } }],
    ['tenant_key non-string', { code: 0, msg: 'ok', data: { open_id: 'ou', tenant_key: 123 } }],
  ])('returns null for malformed body: %s', async (_label, body) => {
    const fetchImpl = recordingFetch(makeResponse(true, 200, body));
    const adapter = new HttpFeishuUserInfoAdapter(fetchImpl);

    expect(await adapter.fetchUserInfo({ accessToken: TOKEN })).toBeNull();
  });

  // ── T8: network error (fetch rejects) → null, never throws ──
  it('returns null when fetch rejects with a network error', async () => {
    const fetchImpl: FeishuUserInfoFetch = jest
      .fn()
      .mockRejectedValue(new TypeError('fetch failed: ENOTFOUND'));
    const adapter = new HttpFeishuUserInfoAdapter(fetchImpl);

    await expect(
      adapter.fetchUserInfo({ accessToken: TOKEN }),
    ).resolves.toBeNull();
  });

  // ── T9: timeout/abort → null, never throws ──
  it('returns null when the request is aborted by timeout', async () => {
    const fetchImpl: FeishuUserInfoFetch = jest
      .fn()
      .mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));
    const adapter = new HttpFeishuUserInfoAdapter(fetchImpl, 1);

    await expect(
      adapter.fetchUserInfo({ accessToken: TOKEN }),
    ).resolves.toBeNull();
  });

  // ── T10: json() rejects → null ──
  it('returns null when response.json() throws', async () => {
    const fetchImpl: FeishuUserInfoFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    });
    const adapter = new HttpFeishuUserInfoAdapter(fetchImpl);

    expect(await adapter.fetchUserInfo({ accessToken: TOKEN })).toBeNull();
  });

  // ── T11: token never leaks into thrown exceptions ──
  it('never leaks the access token into any thrown exception', async () => {
    const sensitive = TOKEN;
    const fetchImpl: FeishuUserInfoFetch = jest
      .fn()
      .mockRejectedValue(new Error(`something went wrong with ${sensitive}`));

    const adapter = new HttpFeishuUserInfoAdapter(fetchImpl, 1);

    const r = await adapter.fetchUserInfo({ accessToken: TOKEN });

    expect(r).toBeNull();
    // The adapter swallowed the error; no exception propagated at all.
  });

  // ── T12: token never appears in console output (fail-closed, silent) ──
  it('never writes the token to console.error or console.warn', async () => {
    const originalError = console.error;
    const originalWarn = console.warn;
    const errorSpy = jest.fn();
    const warnSpy = jest.fn();
    console.error = errorSpy;
    console.warn = warnSpy;

    const fetchImpl: FeishuUserInfoFetch = jest
      .fn()
      .mockRejectedValue(new Error('boom'));

    const adapter = new HttpFeishuUserInfoAdapter(fetchImpl, 1);

    try {
      await adapter.fetchUserInfo({ accessToken: TOKEN });
    } finally {
      console.error = originalError;
      console.warn = originalWarn;
    }

    const allOutput = [
      ...errorSpy.mock.calls.flat().map(String),
      ...warnSpy.mock.calls.flat().map(String),
    ].join(' ');

    expect(allOutput).not.toContain(TOKEN);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // ── T13: AbortController signal is passed to fetch ──
  it('passes an AbortSignal to fetch for timeout support', async () => {
    const fetchImpl = recordingFetch(okResponse());
    const adapter = new HttpFeishuUserInfoAdapter(fetchImpl, 5000);

    await adapter.fetchUserInfo({ accessToken: TOKEN });

    const init = fetchImpl.calls[0].init as {
      signal?: AbortSignal;
    };
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  // ── T14: does not network in default environment (Unavailable adapter) ──
  it('UnavailableFeishuUserInfoHttpAdapter always returns null without networking', async () => {
    const adapter = new UnavailableFeishuUserInfoHttpAdapter();

    expect(await adapter.fetchUserInfo({ accessToken: TOKEN })).toBeNull();
  });
});
