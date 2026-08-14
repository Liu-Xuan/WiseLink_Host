export type RegistrarBaseTableRole =
  | 'workItems'
  | 'decisions'
  | 'executionLogs';

export type RegistrarBaseFields = Record<string, unknown>;

export interface RegistrarBaseRecord {
  recordId: string;
  fields: RegistrarBaseFields;
}

export interface RegistrarBaseFilterCondition {
  field_name: string;
  operator: string;
  value: string[];
}

export interface RegistrarBaseSearchInput {
  table: RegistrarBaseTableRole;
  fieldNames?: string[];
  filter?: {
    conjunction: 'and' | 'or';
    conditions: RegistrarBaseFilterCondition[];
  };
  sort?: Array<{ field_name: string; desc?: boolean }>;
  pageSize?: number;
  pageToken?: string;
}

export interface RegistrarBaseSearchResult {
  records: RegistrarBaseRecord[];
  hasMore: boolean;
  pageToken: string | null;
  total: number | null;
}

export interface RegistrarBaseCreateInput {
  table: RegistrarBaseTableRole;
  fields: RegistrarBaseFields;
  clientToken?: string;
}

export interface RegistrarBaseUpdateInput {
  table: RegistrarBaseTableRole;
  recordId: string;
  fields: RegistrarBaseFields;
  clientToken?: string;
}

export interface DedicatedRegistrarBasePort {
  searchRecords(
    input: RegistrarBaseSearchInput,
  ): Promise<RegistrarBaseSearchResult>;
  createRecord(input: RegistrarBaseCreateInput): Promise<RegistrarBaseRecord>;
  updateRecord(input: RegistrarBaseUpdateInput): Promise<RegistrarBaseRecord>;
}

export interface DedicatedRegistrarBaseConfiguration {
  appId: string;
  appSecret: string;
  tokenEndpoint: string;
  openApiBaseUrl: string;
  baseToken: string;
  tableIds: Record<RegistrarBaseTableRole, string>;
}

export interface DedicatedRegistrarHttpRequest {
  method: 'POST' | 'PUT';
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface DedicatedRegistrarHttpResponse {
  status: number;
  body: unknown;
}

export interface DedicatedRegistrarHttpPort {
  send(
    request: DedicatedRegistrarHttpRequest,
  ): Promise<DedicatedRegistrarHttpResponse>;
}

export interface DedicatedRegistrarBasePreparation {
  status: 'CONFIGURED' | 'BLOCKED';
  blockerCodes: string[];
  adapter: DedicatedRegistrarBasePort | null;
}

export interface DedicatedRegistrarBaseAdapterOptions {
  configuration: DedicatedRegistrarBaseConfiguration;
  http?: DedicatedRegistrarHttpPort;
  now?: () => number;
}

export const DEDICATED_REGISTRAR_BASE_ENV = {
  appId: 'WL_REGISTRAR_OPEN_PLATFORM_APP_ID',
  appSecret: 'WL_REGISTRAR_OPEN_PLATFORM_APP_SECRET',
  tokenEndpoint: 'WL_REGISTRAR_OPEN_PLATFORM_TOKEN_ENDPOINT',
  openApiBaseUrl: 'WL_REGISTRAR_OPEN_PLATFORM_API_BASE_URL',
  baseToken: 'WL_REGISTRAR_BASE_TOKEN',
  workItemsTableId: 'WL_REGISTRAR_WORK_ITEMS_TABLE_ID',
  decisionsTableId: 'WL_REGISTRAR_DECISIONS_TABLE_ID',
  executionLogsTableId: 'WL_REGISTRAR_EXECUTION_LOGS_TABLE_ID',
} as const;

const TOKEN_REFRESH_MAX_SKEW_SECONDS = 300;
const MAX_PAGE_SIZE = 500;

export class DedicatedRegistrarBaseError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number | null = null,
  ) {
    super(code);
    this.name = 'DedicatedRegistrarBaseError';
  }
}

/**
 * Server-only Open Platform adapter. The Base call identity is always the
 * dedicated application's tenant_access_token; authenticated business actors
 * remain opaque record fields produced by the existing Registrar layer.
 */
export class TenantAccessTokenRegistrarBaseAdapter implements DedicatedRegistrarBasePort {
  private readonly configuration: DedicatedRegistrarBaseConfiguration;
  private readonly http: DedicatedRegistrarHttpPort;
  private readonly now: () => number;
  private cachedToken: { value: string; validUntil: number } | null = null;
  private tokenRequest: Promise<string> | null = null;

  constructor(options: DedicatedRegistrarBaseAdapterOptions) {
    this.configuration = validateConfiguration(options.configuration);
    this.http = options.http ?? new FetchDedicatedRegistrarHttpAdapter();
    this.now = options.now ?? Date.now;
  }

  async searchRecords(
    input: RegistrarBaseSearchInput,
  ): Promise<RegistrarBaseSearchResult> {
    const pageSize = input.pageSize ?? 100;
    if (
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > MAX_PAGE_SIZE
    ) {
      throw new DedicatedRegistrarBaseError('REGISTRAR_BASE_PAGE_SIZE_INVALID');
    }
    const query = new URLSearchParams({ page_size: String(pageSize) });
    if (input.pageToken) {
      query.set('page_token', requiredText(input.pageToken, 'pageToken'));
    }
    const data = await this.baseRequest(
      'POST',
      `${this.recordsPath(input.table)}/search?${query.toString()}`,
      compactObject({
        field_names: input.fieldNames,
        filter: input.filter,
        sort: input.sort,
      }),
    );
    const response = objectValue(data, 'REGISTRAR_BASE_SEARCH_DATA_INVALID');
    const rawItems = response.items;
    if (!Array.isArray(rawItems)) {
      throw new DedicatedRegistrarBaseError(
        'REGISTRAR_BASE_SEARCH_ITEMS_INVALID',
      );
    }
    return {
      records: rawItems.map((item) => parseRecord(item)),
      hasMore: response.has_more === true,
      pageToken:
        typeof response.page_token === 'string' && response.page_token.trim()
          ? response.page_token
          : null,
      total:
        typeof response.total === 'number' &&
        Number.isSafeInteger(response.total)
          ? response.total
          : null,
    };
  }

  async createRecord(
    input: RegistrarBaseCreateInput,
  ): Promise<RegistrarBaseRecord> {
    const query = clientTokenQuery(input.clientToken);
    const data = await this.baseRequest(
      'POST',
      `${this.recordsPath(input.table)}${query}`,
      { fields: objectValue(input.fields, 'REGISTRAR_BASE_FIELDS_INVALID') },
    );
    return parseRecord(
      objectValue(data, 'REGISTRAR_BASE_CREATE_DATA_INVALID').record,
    );
  }

  async updateRecord(
    input: RegistrarBaseUpdateInput,
  ): Promise<RegistrarBaseRecord> {
    const recordId = pathSegment(input.recordId, 'recordId');
    const query = clientTokenQuery(input.clientToken);
    const data = await this.baseRequest(
      'PUT',
      `${this.recordsPath(input.table)}/${recordId}${query}`,
      { fields: objectValue(input.fields, 'REGISTRAR_BASE_FIELDS_INVALID') },
    );
    return parseRecord(
      objectValue(data, 'REGISTRAR_BASE_UPDATE_DATA_INVALID').record,
    );
  }

  private recordsPath(table: RegistrarBaseTableRole): string {
    const tableId = this.configuration.tableIds[table];
    if (!tableId) {
      throw new DedicatedRegistrarBaseError(
        'REGISTRAR_BASE_TABLE_ROLE_INVALID',
      );
    }
    return (
      `/open-apis/bitable/v1/apps/${pathSegment(this.configuration.baseToken, 'baseToken')}` +
      `/tables/${pathSegment(tableId, 'tableId')}/records`
    );
  }

  private async baseRequest(
    method: 'POST' | 'PUT',
    pathAndQuery: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.baseRequestAttempt(method, pathAndQuery, body, true);
  }

  private async baseRequestAttempt(
    method: 'POST' | 'PUT',
    pathAndQuery: string,
    body: Record<string, unknown>,
    mayRefreshToken: boolean,
  ): Promise<unknown> {
    const token = await this.tenantAccessToken();
    const response = await this.send({
      method,
      url: `${this.configuration.openApiBaseUrl}${pathAndQuery}`,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
    });
    if (response.status === 401 && mayRefreshToken) {
      this.cachedToken = null;
      return this.baseRequestAttempt(method, pathAndQuery, body, false);
    }
    assertBaseHttpStatus(response.status);
    const envelope = objectValue(
      response.body,
      'REGISTRAR_BASE_RESPONSE_INVALID',
    );
    if (envelope.code !== 0) {
      throw new DedicatedRegistrarBaseError(
        'REGISTRAR_BASE_OPENAPI_REJECTED',
        response.status,
      );
    }
    return envelope.data;
  }

  private async tenantAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.validUntil > this.now()) {
      return this.cachedToken.value;
    }
    if (!this.tokenRequest) {
      this.tokenRequest = this.requestTenantAccessToken().finally(() => {
        this.tokenRequest = null;
      });
    }
    return this.tokenRequest;
  }

  private async requestTenantAccessToken(): Promise<string> {
    const response = await this.send({
      method: 'POST',
      url: this.configuration.tokenEndpoint,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        app_id: this.configuration.appId,
        app_secret: this.configuration.appSecret,
      }),
    });
    if (response.status < 200 || response.status >= 300) {
      throw new DedicatedRegistrarBaseError(
        'REGISTRAR_TENANT_TOKEN_REJECTED',
        response.status,
      );
    }
    const envelope = objectValue(
      response.body,
      'REGISTRAR_TENANT_TOKEN_RESPONSE_INVALID',
    );
    if (envelope.code !== 0) {
      throw new DedicatedRegistrarBaseError(
        'REGISTRAR_TENANT_TOKEN_REJECTED',
        response.status,
      );
    }
    const token = requiredText(
      envelope.tenant_access_token,
      'tenant_access_token',
    );
    const expireSeconds = envelope.expire;
    if (
      typeof expireSeconds !== 'number' ||
      !Number.isSafeInteger(expireSeconds) ||
      expireSeconds < 1
    ) {
      throw new DedicatedRegistrarBaseError(
        'REGISTRAR_TENANT_TOKEN_EXPIRY_INVALID',
      );
    }
    const skewSeconds = Math.min(
      TOKEN_REFRESH_MAX_SKEW_SECONDS,
      Math.max(1, Math.floor(expireSeconds / 10)),
    );
    this.cachedToken = {
      value: token,
      validUntil: this.now() + Math.max(1, expireSeconds - skewSeconds) * 1000,
    };
    return token;
  }

  private async send(
    request: DedicatedRegistrarHttpRequest,
  ): Promise<DedicatedRegistrarHttpResponse> {
    try {
      return await this.http.send(request);
    } catch (error) {
      if (error instanceof DedicatedRegistrarBaseError) throw error;
      throw new DedicatedRegistrarBaseError('REGISTRAR_BASE_NETWORK_FAILURE');
    }
  }
}

export function prepareDedicatedRegistrarBaseAdapter(
  input: {
    environment?: Readonly<Record<string, string | undefined>>;
    http?: DedicatedRegistrarHttpPort;
    now?: () => number;
  } = {},
): DedicatedRegistrarBasePreparation {
  const environment = input.environment ?? process.env;
  const values = {
    appId: envValue(environment, DEDICATED_REGISTRAR_BASE_ENV.appId),
    appSecret: envValue(environment, DEDICATED_REGISTRAR_BASE_ENV.appSecret),
    tokenEndpoint: envValue(
      environment,
      DEDICATED_REGISTRAR_BASE_ENV.tokenEndpoint,
    ),
    openApiBaseUrl: envValue(
      environment,
      DEDICATED_REGISTRAR_BASE_ENV.openApiBaseUrl,
    ),
    baseToken: envValue(environment, DEDICATED_REGISTRAR_BASE_ENV.baseToken),
    workItemsTableId: envValue(
      environment,
      DEDICATED_REGISTRAR_BASE_ENV.workItemsTableId,
    ),
    decisionsTableId: envValue(
      environment,
      DEDICATED_REGISTRAR_BASE_ENV.decisionsTableId,
    ),
    executionLogsTableId: envValue(
      environment,
      DEDICATED_REGISTRAR_BASE_ENV.executionLogsTableId,
    ),
  };
  const blockerCodes = Object.entries(values)
    .filter(([, value]) => !value)
    .map(([key]) => `DEDICATED_REGISTRAR_BASE_CONFIG_MISSING:${key}`);
  if (blockerCodes.length > 0) {
    return { status: 'BLOCKED', blockerCodes, adapter: null };
  }
  return {
    status: 'CONFIGURED',
    blockerCodes: [],
    adapter: new TenantAccessTokenRegistrarBaseAdapter({
      configuration: {
        appId: configuredValue(values.appId, 'appId'),
        appSecret: configuredValue(values.appSecret, 'appSecret'),
        tokenEndpoint: configuredValue(values.tokenEndpoint, 'tokenEndpoint'),
        openApiBaseUrl: configuredValue(
          values.openApiBaseUrl,
          'openApiBaseUrl',
        ),
        baseToken: configuredValue(values.baseToken, 'baseToken'),
        tableIds: {
          workItems: configuredValue(
            values.workItemsTableId,
            'workItemsTableId',
          ),
          decisions: configuredValue(
            values.decisionsTableId,
            'decisionsTableId',
          ),
          executionLogs: configuredValue(
            values.executionLogsTableId,
            'executionLogsTableId',
          ),
        },
      },
      http: input.http,
      now: input.now,
    }),
  };
}

export class FetchDedicatedRegistrarHttpAdapter implements DedicatedRegistrarHttpPort {
  async send(
    request: DedicatedRegistrarHttpRequest,
  ): Promise<DedicatedRegistrarHttpResponse> {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
    let body: unknown;
    try {
      body = JSON.parse(await response.text()) as unknown;
    } catch {
      body = null;
    }
    return { status: response.status, body };
  }
}

function validateConfiguration(
  input: DedicatedRegistrarBaseConfiguration,
): DedicatedRegistrarBaseConfiguration {
  const tokenEndpoint = normalizedHttpsUrl(
    input.tokenEndpoint,
    'tokenEndpoint',
  );
  const openApiBaseUrl = normalizedHttpsUrl(
    input.openApiBaseUrl,
    'openApiBaseUrl',
  ).replace(/\/+$/u, '');
  return {
    appId: requiredText(input.appId, 'appId'),
    appSecret: requiredText(input.appSecret, 'appSecret'),
    tokenEndpoint,
    openApiBaseUrl,
    baseToken: requiredText(input.baseToken, 'baseToken'),
    tableIds: {
      workItems: requiredText(input.tableIds.workItems, 'workItemsTableId'),
      decisions: requiredText(input.tableIds.decisions, 'decisionsTableId'),
      executionLogs: requiredText(
        input.tableIds.executionLogs,
        'executionLogsTableId',
      ),
    },
  };
}

function normalizedHttpsUrl(value: string, fieldName: string): string {
  const text = requiredText(value, fieldName);
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new DedicatedRegistrarBaseError(
      `DEDICATED_REGISTRAR_BASE_CONFIG_INVALID:${fieldName}`,
    );
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new DedicatedRegistrarBaseError(
      `DEDICATED_REGISTRAR_BASE_CONFIG_INVALID:${fieldName}`,
    );
  }
  return parsed.toString();
}

function assertBaseHttpStatus(status: number): void {
  if (status >= 200 && status < 300) return;
  if (status === 401) {
    throw new DedicatedRegistrarBaseError(
      'REGISTRAR_BASE_AUTHENTICATION_FAILED',
      status,
    );
  }
  if (status === 403) {
    throw new DedicatedRegistrarBaseError('REGISTRAR_BASE_FORBIDDEN', status);
  }
  if (status === 429) {
    throw new DedicatedRegistrarBaseError(
      'REGISTRAR_BASE_RATE_LIMITED',
      status,
    );
  }
  if (status >= 500) {
    throw new DedicatedRegistrarBaseError(
      'REGISTRAR_BASE_UPSTREAM_UNAVAILABLE',
      status,
    );
  }
  throw new DedicatedRegistrarBaseError(
    'REGISTRAR_BASE_REQUEST_REJECTED',
    status,
  );
}

function parseRecord(value: unknown): RegistrarBaseRecord {
  const record = objectValue(value, 'REGISTRAR_BASE_RECORD_INVALID');
  return {
    recordId: requiredText(record.record_id, 'record_id'),
    fields: objectValue(record.fields, 'REGISTRAR_BASE_RECORD_FIELDS_INVALID'),
  };
}

function compactObject(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

function clientTokenQuery(value: string | undefined): string {
  if (!value) return '';
  const query = new URLSearchParams({
    client_token: requiredText(value, 'clientToken'),
  });
  return `?${query.toString()}`;
}

function objectValue(value: unknown, code: string): RegistrarBaseFields {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DedicatedRegistrarBaseError(code);
  }
  return Object.fromEntries(Object.entries(value));
}

function configuredValue(value: string | null, key: string): string {
  if (!value) {
    throw new DedicatedRegistrarBaseError(
      `DEDICATED_REGISTRAR_BASE_CONFIG_MISSING:${key}`,
    );
  }
  return value;
}

function envValue(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
): string | null {
  const value = environment[key]?.trim();
  return value || null;
}

function requiredText(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new DedicatedRegistrarBaseError(
      `REGISTRAR_BASE_VALUE_INVALID:${fieldName}`,
    );
  }
  return value.trim();
}

function pathSegment(value: string, fieldName: string): string {
  return encodeURIComponent(requiredText(value, fieldName));
}
