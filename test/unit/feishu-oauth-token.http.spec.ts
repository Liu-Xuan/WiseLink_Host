import 'reflect-metadata';

import {
  HttpFeishuOAuthTokenAdapter,
  UnavailableFeishuOAuthTokenHttpAdapter,
  type FeishuOAuthTokenFetch,
  type FeishuOAuthTokenResponse,
} from '../../server/modules/identity/feishu-oauth-token.http';

// ─── Helpers ────────────────────────────────────────────────────────────────

const CLIENT_ID = 'cli_test_app_001';
const CLIENT_SECRET = 'very_secret_app_secret_value';
const CODE = 'auth_code_xyz_abc_123';
const REDIRECT_URI = 'https://dev.example.com/oauth/callback';
const CODE_VERIFIER = 'dBjftJeZ4CVK-mJMgjYqsrkuerxyAL_m4kO-n1H1Lmw';

function makeResponse(
  ok: boolean,
  status: number,
  body: unknown,
): ReturnType<FeishuOAuthTokenFetch> extends Promise<infer R> ? R : never {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  };
}

/** Builds a mock fetch whose `json()` returns a successful token envelope. */
function okResponse(
  overrides: Partial<Record<string, unknown>> = {},
): ReturnType<FeishuOAuthTokenFetch> extends Promise<infer R> ? R : never {
  return makeResponse(true, 200, {
    access_token: 'u-access_token_001',
    token_type: 'Bearer',
    expires_in: 7200,
    refresh_token: 'ur-refresh_token_001',
    ...overrides,
  });
}

/** A fetch impl that records the last URL + init it received. */
function recordingFetch(
  response: ReturnType<FeishuOAuthTokenFetch> extends Promise<infer R> ? R : never,
): FeishuOAuthTokenFetch & {
  calls: { url: string; init: Record<string, unknown> }[];
} {
  const calls: { url: string; init: Record<string, unknown> }[] = [];
  const fn: FeishuOAuthTokenFetch = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(response);
  };
  return Object.assign(fn, { calls });
}

const VALID_INPUT = {
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  code: CODE,
  redirectUri: REDIRECT_URI,
  codeVerifier: CODE_VERIFIER,
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('HttpFeishuOAuthTokenAdapter', () => {
  // ── T1: success — all fields parsed (with refresh_token) ──
  it('returns full FeishuOAuthTokenResponse on a valid 200 body', async () => {
    const fetchImpl = recordingFetch(
      okResponse({
        access_token: 'u-access_token_001',
        token_type: 'Bearer',
        expires_in: 7200,
        refresh_token: 'ur-refresh_token_001',
      }),
    );
    const adapter = new HttpFeishuOAuthTokenAdapter(fetchImpl, 5000);

    const r = await adapter.fetchToken(VALID_INPUT);

    expect(r).toEqual<FeishuOAuthTokenResponse>({
      accessToken: 'u-access_token_001',
      tokenType: 'Bearer',
      expiresIn: 7200,
      refreshToken: 'ur-refresh_token_001',
    });
  });

  // ── T2: success — refresh_token optional (null when absent) ──
  it('parses response when refresh_token is absent (null)', async () => {
    const fetchNoRefresh = recordingFetch(
      makeResponse(true, 200, {
        access_token: 'u-access_token_002',
        token_type: 'bearer',
        expires_in: 3600,
      }),
    );
    const adapter = new HttpFeishuOAuthTokenAdapter(fetchNoRefresh);

    const r = await adapter.fetchToken(VALID_INPUT);

    expect(r).toEqual({
      accessToken: 'u-access_token_002',
      tokenType: 'bearer',
      expiresIn: 3600,
      refreshToken: null,
    });
  });

  // ── T3: request body encoding — x-www-form-urlencoded with all fields including code_verifier ──
  it('sends POST with application/x-www-form-urlencoded body containing grant_type, client_id, client_secret, code, redirect_uri, code_verifier', async () => {
    const fetchImpl = recordingFetch(okResponse());
    const adapter = new HttpFeishuOAuthTokenAdapter(fetchImpl, 5000);

    await adapter.fetchToken(VALID_INPUT);

    expect(fetchImpl.calls).toHaveLength(1);
    const { url, init } = fetchImpl.calls[0];
    expect(url).toBe('https://accounts.feishu.cn/oauth/v3/token');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/x-www-form-urlencoded',
    });

    const body = init.body as string;
    const params = new URLSearchParams(body);
    expect(params.get('grant_type')).toBe('authorization_code');
    expect(params.get('client_id')).toBe(CLIENT_ID);
    expect(params.get('client_secret')).toBe(CLIENT_SECRET);
    expect(params.get('code')).toBe(CODE);
    expect(params.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(params.get('code_verifier')).toBe(CODE_VERIFIER);
  });

  // ── T4: no secret leakage — client_secret/code/token never in thrown exceptions ──
  it('never leaks client_secret, code, or token into any thrown exception', async () => {
    const fetchImpl: FeishuOAuthTokenFetch = jest
      .fn()
      .mockRejectedValue(
        new Error(`boom ${CLIENT_SECRET} ${CODE} u-access_token_001`),
      );

    const adapter = new HttpFeishuOAuthTokenAdapter(fetchImpl, 1);

    const r = await adapter.fetchToken(VALID_INPUT);

    expect(r).toBeNull();
    // The adapter swallowed the error; no exception propagated at all.
  });

  // ── T5: no secret leakage — never writes secret/code/token to console ──
  it('never writes client_secret, code, or token to console.error or console.warn', async () => {
    const originalError = console.error;
    const originalWarn = console.warn;
    const errorSpy = jest.fn();
    const warnSpy = jest.fn();
    console.error = errorSpy;
    console.warn = warnSpy;

    const fetchImpl: FeishuOAuthTokenFetch = jest
      .fn()
      .mockRejectedValue(new Error('boom'));

    const adapter = new HttpFeishuOAuthTokenAdapter(fetchImpl, 1);

    try {
      await adapter.fetchToken(VALID_INPUT);
    } finally {
      console.error = originalError;
      console.warn = originalWarn;
    }

    const allOutput = [
      ...errorSpy.mock.calls.flat().map(String),
      ...warnSpy.mock.calls.flat().map(String),
    ].join(' ');

    expect(allOutput).not.toContain(CLIENT_SECRET);
    expect(allOutput).not.toContain(CODE);
    expect(allOutput).not.toContain('u-access_token_001');
    expect(allOutput).not.toContain(CODE_VERIFIER);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // ── T6: empty / whitespace inputs → null without networking ──
  it.each([
    ['empty clientId', { clientId: '' }],
    ['whitespace clientId', { clientId: '   ' }],
    ['empty clientSecret', { clientSecret: '' }],
    ['whitespace clientSecret', { clientSecret: '   ' }],
    ['empty code', { code: '' }],
    ['whitespace code', { code: '   ' }],
    ['empty redirectUri', { redirectUri: '' }],
    ['whitespace redirectUri', { redirectUri: '   ' }],
    ['empty codeVerifier', { codeVerifier: '' }],
    ['whitespace codeVerifier', { codeVerifier: '   ' }],
  ])('returns null for %s without calling fetch', async (_label, overrides) => {
    const fetchImpl = jest.fn() as unknown as FeishuOAuthTokenFetch;
    const adapter = new HttpFeishuOAuthTokenAdapter(fetchImpl);

    const r = await adapter.fetchToken({ ...VALID_INPUT, ...overrides });

    expect(r).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // ── T7: non-2xx HTTP status → null ──
  it.each([400, 401, 403, 404, 500, 502, 503])(
    'returns null on HTTP %i',
    async (status) => {
      const fetchImpl = recordingFetch(
        makeResponse(status < 400, status, {
          code: 0,
          msg: '',
          access_token: 'x',
          token_type: 'Bearer',
          expires_in: 7200,
        }),
      );
      const adapter = new HttpFeishuOAuthTokenAdapter(fetchImpl);

      const r = await adapter.fetchToken(VALID_INPUT);
      expect(r).toBeNull();
    },
  );

  // ── T8: API-level error (code !== 0) → null ──
  it('returns null when Feishu API code is non-zero', async () => {
    const fetchImpl = recordingFetch(
      makeResponse(true, 200, {
        code: 99991663,
        msg: 'invalid grant code',
      }),
    );
    const adapter = new HttpFeishuOAuthTokenAdapter(fetchImpl);

    expect(await adapter.fetchToken(VALID_INPUT)).toBeNull();
  });

  // ── T9: success response with code: 0 is accepted ──
  it('accepts a success response that includes code: 0', async () => {
    const fetchImpl = recordingFetch(
      makeResponse(true, 200, {
        code: 0,
        msg: 'ok',
        access_token: 'u-access_token_003',
        token_type: 'Bearer',
        expires_in: 7200,
      }),
    );
    const adapter = new HttpFeishuOAuthTokenAdapter(fetchImpl);

    const r = await adapter.fetchToken(VALID_INPUT);

    expect(r).toEqual({
      accessToken: 'u-access_token_003',
      tokenType: 'Bearer',
      expiresIn: 7200,
      refreshToken: null,
    });
  });

  // ── T10: malformed body shapes → null ──
  it.each([
    ['null body', null],
    ['non-object body (string)', 'not json'],
    ['array body', [1, 2, 3]],
    ['missing access_token', { token_type: 'Bearer', expires_in: 7200 }],
    ['access_token is null', { access_token: null, token_type: 'Bearer', expires_in: 7200 }],
    ['access_token empty string', { access_token: '', token_type: 'Bearer', expires_in: 7200 }],
    ['access_token non-string', { access_token: 123, token_type: 'Bearer', expires_in: 7200 }],
    ['missing token_type', { access_token: 'tok', expires_in: 7200 }],
    ['token_type empty string', { access_token: 'tok', token_type: '', expires_in: 7200 }],
    ['token_type non-string', { access_token: 'tok', token_type: 123, expires_in: 7200 }],
    ['missing expires_in', { access_token: 'tok', token_type: 'Bearer' }],
    ['expires_in non-number', { access_token: 'tok', token_type: 'Bearer', expires_in: '7200' }],
    ['expires_in NaN', { access_token: 'tok', token_type: 'Bearer', expires_in: NaN }],
    ['expires_in Infinity', { access_token: 'tok', token_type: 'Bearer', expires_in: Infinity }],
  ])('returns null for malformed body: %s', async (_label, body) => {
    const fetchImpl = recordingFetch(makeResponse(true, 200, body));
    const adapter = new HttpFeishuOAuthTokenAdapter(fetchImpl);

    expect(await adapter.fetchToken(VALID_INPUT)).toBeNull();
  });

  // ── T11: refresh_token non-string → coerced to null (not propagated) ──
  it('coerces a non-string refresh_token to null (response still valid)', async () => {
    const fetchImpl = recordingFetch(
      makeResponse(true, 200, {
        access_token: 'tok',
        token_type: 'Bearer',
        expires_in: 7200,
        refresh_token: 12345,
      }),
    );
    const adapter = new HttpFeishuOAuthTokenAdapter(fetchImpl);

    const r = await adapter.fetchToken(VALID_INPUT);

    expect(r).not.toBeNull();
    expect(r).toEqual({
      accessToken: 'tok',
      tokenType: 'Bearer',
      expiresIn: 7200,
      refreshToken: null,
    });
  });

  // ── T12: network error (fetch rejects) → null, never throws ──
  it('returns null when fetch rejects with a network error', async () => {
    const fetchImpl: FeishuOAuthTokenFetch = jest
      .fn()
      .mockRejectedValue(new TypeError('fetch failed: ENOTFOUND'));
    const adapter = new HttpFeishuOAuthTokenAdapter(fetchImpl);

    await expect(adapter.fetchToken(VALID_INPUT)).resolves.toBeNull();
  });

  // ── T13: timeout/abort → null, never throws ──
  it('returns null when the request is aborted by timeout', async () => {
    const fetchImpl: FeishuOAuthTokenFetch = jest
      .fn()
      .mockRejectedValue(
        new DOMException('The operation was aborted', 'AbortError'),
      );
    const adapter = new HttpFeishuOAuthTokenAdapter(fetchImpl, 1);

    await expect(adapter.fetchToken(VALID_INPUT)).resolves.toBeNull();
  });

  // ── T14: json() rejects → null ──
  it('returns null when response.json() throws', async () => {
    const fetchImpl: FeishuOAuthTokenFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    });
    const adapter = new HttpFeishuOAuthTokenAdapter(fetchImpl);

    expect(await adapter.fetchToken(VALID_INPUT)).toBeNull();
  });

  // ── T15: AbortController signal is passed to fetch ──
  it('passes an AbortSignal to fetch for timeout support', async () => {
    const fetchImpl = recordingFetch(okResponse());
    const adapter = new HttpFeishuOAuthTokenAdapter(fetchImpl, 5000);

    await adapter.fetchToken(VALID_INPUT);

    const init = fetchImpl.calls[0].init as {
      signal?: AbortSignal;
    };
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  // ── T16: does not network in default environment (Unavailable adapter) ──
  it('UnavailableFeishuOAuthTokenHttpAdapter always returns null without networking', async () => {
    const adapter = new UnavailableFeishuOAuthTokenHttpAdapter();

    expect(await adapter.fetchToken(VALID_INPUT)).toBeNull();
  });

  // ── T17: code_verifier is always sent in the POST body ──
  it('always includes code_verifier in the token request body', async () => {
    const fetchImpl = recordingFetch(okResponse());
    const adapter = new HttpFeishuOAuthTokenAdapter(fetchImpl, 5000);

    await adapter.fetchToken({
      ...VALID_INPUT,
      codeVerifier: 'a-different-verifier-value-1234567890',
    });

    const body = fetchImpl.calls[0].init.body as string;
    const params = new URLSearchParams(body);
    expect(params.get('code_verifier')).toBe(
      'a-different-verifier-value-1234567890',
    );
  });
});
