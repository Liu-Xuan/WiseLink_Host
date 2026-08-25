import 'reflect-metadata';

import { FeishuOAuthVerificationAdapter } from '../../server/modules/identity/feishu-oauth-verification.adapter';
import type {
  FeishuUserInfoHttpPort,
  FeishuUserInfoResponse,
} from '../../server/modules/identity/feishu-user-info.http';
import type {
  SubjectTenantMapping,
  SubjectTenantMappingPort,
} from '../../server/modules/identity/subject-tenant-mapping.port';

function mockHttp(
  response: FeishuUserInfoResponse | null,
): FeishuUserInfoHttpPort & { fetchUserInfo: jest.Mock } {
  return {
    fetchUserInfo: jest.fn().mockResolvedValue(response),
  };
}

function mockMapping(
  mapping: SubjectTenantMapping | null,
): SubjectTenantMappingPort & { resolveMapping: jest.Mock } {
  return {
    resolveMapping: jest.fn().mockResolvedValue(mapping),
  };
}

const VALID_USER_INFO: FeishuUserInfoResponse = {
  openId: 'ou_valid_user_001',
  tenantKey: 'tkey_tenant_a',
  userId: 'emp_001',
  name: 'Test Engineer',
};

const VALID_MAPPING: SubjectTenantMapping = {
  mappingId: '11111111-1111-4111-8111-111111111111',
  miaodaUserId: 'miaoda_user_001',
  miaodaTenantId: '2001',
  feishuTenantKey: 'tkey_tenant_a',
  expectedClientId: 'cli_valid_app',
};

const VALID_INPUT = {
  accessToken: 'valid_access_token_xyz',
  clientId: 'cli_valid_app',
  contextTenantId: '2001',
};

describe('FeishuOAuthVerificationAdapter fail-closed contract', () => {
  // ── T1: no access token → fail closed ──
  it('returns UNAVAILABLE / FEISHU_OAUTH_NO_ACCESS_TOKEN when accessToken is empty', async () => {
    const http = mockHttp(VALID_USER_INFO);
    const mapping = mockMapping(VALID_MAPPING);
    const adapter = new FeishuOAuthVerificationAdapter(http, mapping);

    const r = await adapter.verify({
      ...VALID_INPUT,
      accessToken: '',
    });

    expect(r).toEqual({
      kind: 'UNAVAILABLE',
      reason: 'FEISHU_OAUTH_NO_ACCESS_TOKEN',
    });
    expect(http.fetchUserInfo).not.toHaveBeenCalled();
    expect(mapping.resolveMapping).not.toHaveBeenCalled();
  });

  // ── T2: whitespace-only token → fail closed ──
  it('returns UNAVAILABLE / FEISHU_OAUTH_NO_ACCESS_TOKEN for whitespace-only token', async () => {
    const http = mockHttp(VALID_USER_INFO);
    const mapping = mockMapping(VALID_MAPPING);
    const adapter = new FeishuOAuthVerificationAdapter(http, mapping);

    const r = await adapter.verify({
      ...VALID_INPUT,
      accessToken: '   ',
    });

    expect(r).toEqual({
      kind: 'UNAVAILABLE',
      reason: 'FEISHU_OAUTH_NO_ACCESS_TOKEN',
    });
    expect(http.fetchUserInfo).not.toHaveBeenCalled();
  });

  // ── T3: HTTP failure (expired/revoked/invalid token) → fail closed ──
  it('returns UNAVAILABLE / FEISHU_OAUTH_USER_INFO_FAILED when HTTP port returns null', async () => {
    const http = mockHttp(null);
    const mapping = mockMapping(VALID_MAPPING);
    const adapter = new FeishuOAuthVerificationAdapter(http, mapping);

    const r = await adapter.verify(VALID_INPUT);

    expect(r).toEqual({
      kind: 'UNAVAILABLE',
      reason: 'FEISHU_OAUTH_USER_INFO_FAILED',
    });
    expect(http.fetchUserInfo).toHaveBeenCalledWith({
      accessToken: 'valid_access_token_xyz',
    });
    expect(mapping.resolveMapping).not.toHaveBeenCalled();
  });

  // ── T4: mapping missing → fail closed ──
  it('returns UNAVAILABLE / FEISHU_SUBJECT_MAPPING_MISSING when no mapping exists', async () => {
    const http = mockHttp(VALID_USER_INFO);
    const mapping = mockMapping(null);
    const adapter = new FeishuOAuthVerificationAdapter(http, mapping);

    const r = await adapter.verify(VALID_INPUT);

    expect(r).toEqual({
      kind: 'UNAVAILABLE',
      reason: 'FEISHU_SUBJECT_MAPPING_MISSING',
    });
    expect(mapping.resolveMapping).toHaveBeenCalledWith({
      feishuOpenId: 'ou_valid_user_001',
      feishuTenantKey: 'tkey_tenant_a',
      feishuUserId: 'emp_001',
      expectedClientId: 'cli_valid_app',
    });
  });

  // ── T5: client id mismatch → fail closed ──
  it('returns UNAVAILABLE / FEISHU_CLIENT_MISMATCH when clientId differs from mapping', async () => {
    const http = mockHttp(VALID_USER_INFO);
    const mapping = mockMapping(VALID_MAPPING);
    const adapter = new FeishuOAuthVerificationAdapter(http, mapping);

    const r = await adapter.verify({
      ...VALID_INPUT,
      clientId: 'cli_wrong_app',
    });

    expect(r).toEqual({
      kind: 'UNAVAILABLE',
      reason: 'FEISHU_CLIENT_MISMATCH',
    });
  });

  // ── T6: tenant mismatch → fail closed ──
  it('returns UNAVAILABLE / FEISHU_TENANT_MISMATCH when tenantId differs from mapping', async () => {
    const http = mockHttp(VALID_USER_INFO);
    const mapping = mockMapping(VALID_MAPPING);
    const adapter = new FeishuOAuthVerificationAdapter(http, mapping);

    const r = await adapter.verify({
      ...VALID_INPUT,
      contextTenantId: '9999',
    });

    expect(r).toEqual({
      kind: 'UNAVAILABLE',
      reason: 'FEISHU_TENANT_MISMATCH',
    });
  });

  // ── T7: valid mapped identity → VERIFIED ──
  it('returns VERIFIED with correct fields when all checks pass', async () => {
    const http = mockHttp(VALID_USER_INFO);
    const mapping = mockMapping(VALID_MAPPING);
    const adapter = new FeishuOAuthVerificationAdapter(http, mapping);

    const r = await adapter.verify(VALID_INPUT);

    expect(r.kind).toBe('VERIFIED');
    if (r.kind === 'VERIFIED') {
      expect(r.identity.provenance).toBe('FEISHU_OAUTH_USER_ACCESS_TOKEN');
      expect(r.identity.subjectMappingId).toBe(
        '11111111-1111-4111-8111-111111111111',
      );
      expect(r.identity.miaodaUserId).toBe('miaoda_user_001');
      expect(r.identity.tenantId).toBe('2001');
      expect(r.identity.feishuUserId).toBe('emp_001');
      expect(r.identity.feishuOpenId).toBe('ou_valid_user_001');
      expect(r.identity.verifiedAt).toBeTruthy();
      // namespacedSubject must be FEISHU_OPEN_ID with tenantKey
      expect(r.identity.namespacedSubject.namespace).toBe('FEISHU_OPEN_ID');
      expect(r.identity.namespacedSubject.subject).toBe('ou_valid_user_001');
      expect(r.identity.namespacedSubject.tenantKey).toBe('tkey_tenant_a');
    }
  });

  // ── T8: object I/O = 0 — exactly one fetchUserInfo + one resolveMapping ──
  it('makes exactly one fetchUserInfo and one resolveMapping call on the valid path', async () => {
    const http = mockHttp(VALID_USER_INFO);
    const mapping = mockMapping(VALID_MAPPING);
    const adapter = new FeishuOAuthVerificationAdapter(http, mapping);

    await adapter.verify(VALID_INPUT);

    expect(http.fetchUserInfo).toHaveBeenCalledTimes(1);
    expect(mapping.resolveMapping).toHaveBeenCalledTimes(1);
  });

  // ── T9: does not read body/localStorage — only uses explicitly passed input ──
  it('never accesses request body or external storage for identity fields', async () => {
    const http = mockHttp(VALID_USER_INFO);
    const mapping = mockMapping(VALID_MAPPING);
    const adapter = new FeishuOAuthVerificationAdapter(http, mapping);

    // The adapter only receives { accessToken, clientId, contextTenantId }.
    // No request object, body, or cookie is passed or accessed.
    const input = {
      accessToken: 'tok',
      clientId: 'cli_valid_app',
      contextTenantId: '2001',
    };

    await adapter.verify(input);

    expect(http.fetchUserInfo).toHaveBeenCalledTimes(1);
    expect(mapping.resolveMapping).toHaveBeenCalledTimes(1);
  });

  // ── T10: never throws on null response paths ──
  it('never throws when underlying ports return null', async () => {
    const httpNull = mockHttp(null);
    const mappingNull = mockMapping(null);
    const adapter = new FeishuOAuthVerificationAdapter(httpNull, mappingNull);

    await expect(adapter.verify(VALID_INPUT)).resolves.toMatchObject({
      kind: 'UNAVAILABLE',
    });
  });

  // ── T11: default providers are unavailable — does not change browser 503 ──
  it('uses UnavailableFeishuUserInfoHttpAdapter and UnavailableSubjectTenantMappingAdapter by default (both return null)', async () => {
    const {
      UnavailableFeishuUserInfoHttpAdapter,
    } = await import('../../server/modules/identity/feishu-user-info.http');
    const {
      UnavailableSubjectTenantMappingAdapter,
    } = await import('../../server/modules/identity/subject-tenant-mapping.port');

    const http = new UnavailableFeishuUserInfoHttpAdapter();
    const mapping = new UnavailableSubjectTenantMappingAdapter();
    const adapter = new FeishuOAuthVerificationAdapter(http, mapping);

    const r = await adapter.verify(VALID_INPUT);

    // Default providers always return null → USER_INFO_FAILED
    expect(r).toEqual({
      kind: 'UNAVAILABLE',
      reason: 'FEISHU_OAUTH_USER_INFO_FAILED',
    });
  });
});
