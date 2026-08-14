import {
  DedicatedRegistrarBaseError,
  type DedicatedRegistrarHttpPort,
  type DedicatedRegistrarHttpRequest,
  type DedicatedRegistrarHttpResponse,
  prepareDedicatedRegistrarBaseAdapter,
  TenantAccessTokenRegistrarBaseAdapter,
} from '../../server/modules/assessment-registrar/dedicated-registrar-base.adapter';

const placeholderSecret = 'placeholder-secret-never-log';

describe('TenantAccessTokenRegistrarBaseAdapter', () => {
  it('stays zero-write and makes no HTTP request when the server secret is absent', () => {
    const http = queueHttp([]);
    const environment = completeEnvironment();
    delete environment.WL_REGISTRAR_OPEN_PLATFORM_APP_SECRET;

    const result = prepareDedicatedRegistrarBaseAdapter({ environment, http });

    expect(result).toEqual({
      status: 'BLOCKED',
      blockerCodes: ['DEDICATED_REGISTRAR_BASE_CONFIG_MISSING:appSecret'],
      adapter: null,
    });
    expect(http.requests).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(placeholderSecret);
  });

  it('uses one cached tenant token for three-table search/create/update and preserves the business actor verbatim', async () => {
    const actor = {
      actorType: 'FEISHU_USER',
      actorId: 'ou_authenticated_actor',
      displayName: 'Authenticated Engineer',
    };
    const http = queueHttp([
      tokenResponse('tenant-token-1'),
      okResponse({
        items: [
          {
            record_id: 'rec_work_item_1',
            fields: { work_item_id: 'WI-1' },
          },
        ],
        has_more: false,
        total: 1,
      }),
      okResponse({
        record: {
          record_id: 'rec_decision_1',
          fields: {
            decision_id: 'DEC-1',
            authenticated_actor: actor,
          },
        },
      }),
      okResponse({
        record: {
          record_id: 'rec_execution_1',
          fields: {
            execution_id: 'EXEC-1',
            authenticated_actor: actor,
          },
        },
      }),
    ]);
    const adapter = adapterWith(http);

    const search = await adapter.searchRecords({
      table: 'workItems',
      fieldNames: ['work_item_id'],
      filter: {
        conjunction: 'and',
        conditions: [
          {
            field_name: 'work_item_id',
            operator: 'is',
            value: ['WI-1'],
          },
        ],
      },
      pageSize: 20,
    });
    const created = await adapter.createRecord({
      table: 'decisions',
      fields: {
        decision_id: 'DEC-1',
        authenticated_actor: actor,
      },
      clientToken: 'create-decision-1',
    });
    const updated = await adapter.updateRecord({
      table: 'executionLogs',
      recordId: 'rec_execution_1',
      fields: {
        execution_id: 'EXEC-1',
        authenticated_actor: actor,
      },
      clientToken: 'update-execution-1',
    });

    expect(search).toEqual({
      records: [
        { recordId: 'rec_work_item_1', fields: { work_item_id: 'WI-1' } },
      ],
      hasMore: false,
      pageToken: null,
      total: 1,
    });
    expect(created.fields.authenticated_actor).toEqual(actor);
    expect(updated.fields.authenticated_actor).toEqual(actor);
    expect(http.requests).toHaveLength(4);
    expect(http.requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal/',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
    expect(
      http.requests
        .slice(1)
        .every(
          (request) =>
            request.headers.Authorization === 'Bearer tenant-token-1',
        ),
    ).toBe(true);
    expect(http.requests[1].url).toBe(
      'https://open.feishu.cn/open-apis/bitable/v1/apps/base-placeholder/tables/tbl-work-items/records/search?page_size=20',
    );
    expect(http.requests[2].url).toBe(
      'https://open.feishu.cn/open-apis/bitable/v1/apps/base-placeholder/tables/tbl-decisions/records?client_token=create-decision-1',
    );
    expect(http.requests[3].url).toBe(
      'https://open.feishu.cn/open-apis/bitable/v1/apps/base-placeholder/tables/tbl-execution-logs/records/rec_execution_1?client_token=update-execution-1',
    );
    expect(JSON.parse(http.requests[2].body)).toEqual({
      fields: {
        decision_id: 'DEC-1',
        authenticated_actor: actor,
      },
    });
    expect(JSON.parse(http.requests[3].body)).toEqual({
      fields: {
        execution_id: 'EXEC-1',
        authenticated_actor: actor,
      },
    });
  });

  it('refreshes an expired token with ordinary expiry-time caching', async () => {
    let now = 0;
    const http = queueHttp([
      tokenResponse('tenant-token-1', 100),
      emptySearchResponse(),
      emptySearchResponse(),
      tokenResponse('tenant-token-2', 100),
      emptySearchResponse(),
    ]);
    const adapter = adapterWith(http, () => now);

    await adapter.searchRecords({ table: 'workItems' });
    now = 89_000;
    await adapter.searchRecords({ table: 'workItems' });
    now = 90_000;
    await adapter.searchRecords({ table: 'workItems' });

    const tokenRequests = http.requests.filter((request) =>
      request.url.includes('/tenant_access_token/internal/'),
    );
    expect(tokenRequests).toHaveLength(2);
    expect(http.requests.at(-1)?.headers.Authorization).toBe(
      'Bearer tenant-token-2',
    );
  });

  it('refreshes one wrong tenant token and then fails closed without exposing the secret', async () => {
    const http = queueHttp([
      tokenResponse('wrong-token'),
      { status: 401, body: { code: 99991663, msg: 'token invalid' } },
      tokenResponse('still-wrong-token'),
      { status: 401, body: { code: 99991663, msg: 'token invalid' } },
    ]);
    const adapter = adapterWith(http);

    await expect(adapter.searchRecords({ table: 'workItems' })).rejects.toEqual(
      expect.objectContaining({
        code: 'REGISTRAR_BASE_AUTHENTICATION_FAILED',
        httpStatus: 401,
      }),
    );
    expect(http.requests).toHaveLength(4);
    const error = await captureError(
      adapterWith(
        queueHttp([
          {
            status: 200,
            body: { code: 99991663, msg: placeholderSecret },
          },
        ]),
      ).searchRecords({ table: 'workItems' }),
    );
    expect(error.message).toBe('REGISTRAR_TENANT_TOKEN_REJECTED');
    expect(JSON.stringify(error)).not.toContain(placeholderSecret);
  });

  it.each([
    [403, 'REGISTRAR_BASE_FORBIDDEN'],
    [429, 'REGISTRAR_BASE_RATE_LIMITED'],
    [503, 'REGISTRAR_BASE_UPSTREAM_UNAVAILABLE'],
  ])('maps Base HTTP %i to stable code %s', async (status, code) => {
    const http = queueHttp([
      tokenResponse('tenant-token-1'),
      { status, body: { code: status, msg: placeholderSecret } },
    ]);
    const error = await captureError(
      adapterWith(http).searchRecords({ table: 'workItems' }),
    );

    expect(error).toMatchObject({ code, httpStatus: status });
    expect(error.message).toBe(code);
    expect(JSON.stringify(error)).not.toContain(placeholderSecret);
  });

  it('maps transport failure to one secret-free stable code', async () => {
    const http: DedicatedRegistrarHttpPort = {
      send: jest.fn(async () => {
        throw new Error(placeholderSecret);
      }),
    };

    const error = await captureError(
      adapterWith(http).searchRecords({ table: 'workItems' }),
    );

    expect(error.message).toBe('REGISTRAR_BASE_NETWORK_FAILURE');
    expect(JSON.stringify(error)).not.toContain(placeholderSecret);
  });
});

function adapterWith(
  http: DedicatedRegistrarHttpPort,
  now?: () => number,
): TenantAccessTokenRegistrarBaseAdapter {
  return new TenantAccessTokenRegistrarBaseAdapter({
    configuration: {
      appId: 'cli_placeholder_app_id',
      appSecret: placeholderSecret,
      tokenEndpoint:
        'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal/',
      openApiBaseUrl: 'https://open.feishu.cn',
      baseToken: 'base-placeholder',
      tableIds: {
        workItems: 'tbl-work-items',
        decisions: 'tbl-decisions',
        executionLogs: 'tbl-execution-logs',
      },
    },
    http,
    now,
  });
}

function completeEnvironment(): Record<string, string> {
  return {
    WL_REGISTRAR_OPEN_PLATFORM_APP_ID: 'cli_placeholder_app_id',
    WL_REGISTRAR_OPEN_PLATFORM_APP_SECRET: placeholderSecret,
    WL_REGISTRAR_OPEN_PLATFORM_TOKEN_ENDPOINT:
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal/',
    WL_REGISTRAR_OPEN_PLATFORM_API_BASE_URL: 'https://open.feishu.cn',
    WL_REGISTRAR_BASE_TOKEN: 'base-placeholder',
    WL_REGISTRAR_WORK_ITEMS_TABLE_ID: 'tbl-work-items',
    WL_REGISTRAR_DECISIONS_TABLE_ID: 'tbl-decisions',
    WL_REGISTRAR_EXECUTION_LOGS_TABLE_ID: 'tbl-execution-logs',
  };
}

function tokenResponse(
  token: string,
  expire = 7_200,
): DedicatedRegistrarHttpResponse {
  return {
    status: 200,
    body: { code: 0, msg: 'ok', tenant_access_token: token, expire },
  };
}

function okResponse(data: unknown): DedicatedRegistrarHttpResponse {
  return { status: 200, body: { code: 0, msg: 'ok', data } };
}

function emptySearchResponse(): DedicatedRegistrarHttpResponse {
  return okResponse({ items: [], has_more: false, total: 0 });
}

function queueHttp(
  responses: DedicatedRegistrarHttpResponse[],
): DedicatedRegistrarHttpPort & { requests: DedicatedRegistrarHttpRequest[] } {
  const requests: DedicatedRegistrarHttpRequest[] = [];
  return {
    requests,
    send: jest.fn(async (request: DedicatedRegistrarHttpRequest) => {
      requests.push(request);
      const response = responses.shift();
      if (!response) throw new Error('UNEXPECTED_HTTP_REQUEST');
      return response;
    }),
  };
}

async function captureError(
  promise: Promise<unknown>,
): Promise<DedicatedRegistrarBaseError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DedicatedRegistrarBaseError) return error;
    throw error;
  }
  throw new Error('EXPECTED_DEDICATED_REGISTRAR_BASE_ERROR');
}
