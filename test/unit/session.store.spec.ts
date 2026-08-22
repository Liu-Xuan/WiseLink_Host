import 'reflect-metadata';

import { SessionStore } from '../../server/modules/identity/session.store';
import type { VerifiedIdentity } from '../../server/modules/identity/identity.types';

const VALID_IDENTITY: VerifiedIdentity = {
  provenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
  miaodaUserId: 'miaoda_user_001',
  tenantId: '2001',
  feishuUserId: 'emp_001',
  feishuOpenId: 'ou_valid_001',
  namespacedSubject: {
    namespace: 'FEISHU_OPEN_ID',
    subject: 'ou_valid_001',
    tenantKey: 'tkey_a',
  },
  verifiedAt: '2026-08-23T00:00:00.000Z',
};

describe('SessionStore', () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore();
  });

  // ── Create + validate ──
  it('creates a session that can be validated', () => {
    const { token } = store.create(VALID_IDENTITY);
    const result = store.validate(token);
    expect(result).not.toBeNull();
    expect(result?.identity.miaodaUserId).toBe('miaoda_user_001');
  });

  it('returns the correct identity on validation', () => {
    const { token } = store.create(VALID_IDENTITY);
    const result = store.validate(token);
    expect(result?.identity).toEqual(VALID_IDENTITY);
  });

  it('returns a session revision on validation', () => {
    const { token } = store.create(VALID_IDENTITY);
    const result = store.validate(token);
    expect(result?.revision).toBeGreaterThan(0);
  });

  // ── Multi-use (sessions are NOT one-time) ──
  it('allows the same session to be validated multiple times', () => {
    const { token } = store.create(VALID_IDENTITY);
    const r1 = store.validate(token);
    const r2 = store.validate(token);
    const r3 = store.validate(token);
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r3).not.toBeNull();
    // Same identity and revision each time
    expect(r1?.identity).toEqual(r2?.identity);
    expect(r2?.revision).toBe(r3?.revision);
  });

  // ── Fail-closed ──
  it('returns null for a never-issued token', () => {
    expect(store.validate('never-issued')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(store.validate('')).toBeNull();
  });

  it('produces different tokens on each create (random)', () => {
    const t1 = store.create(VALID_IDENTITY).token;
    const t2 = store.create(VALID_IDENTITY).token;
    const t3 = store.create(VALID_IDENTITY).token;
    expect(t1).not.toBe(t2);
    expect(t2).not.toBe(t3);
  });

  // ── Revoke ──
  it('revokes a session so it can no longer be validated', () => {
    const { token } = store.create(VALID_IDENTITY);
    expect(store.validate(token)).not.toBeNull();
    expect(store.revoke(token)).toBe(true);
    expect(store.validate(token)).toBeNull();
  });

  it('revoking an already-revoked session returns false', () => {
    const { token } = store.create(VALID_IDENTITY);
    store.revoke(token);
    expect(store.revoke(token)).toBe(false);
  });

  it('revoking an unknown token returns false', () => {
    expect(store.revoke('never-issued')).toBe(false);
  });

  // ── Revision increments ──
  it('assigns monotonically increasing revisions to new sessions', () => {
    const r1 = store.create(VALID_IDENTITY);
    const r2 = store.create(VALID_IDENTITY);
    const v1 = store.validate(r1.token);
    const v2 = store.validate(r2.token);
    expect(v2?.revision).toBeGreaterThan(v1?.revision ?? 0);
  });

  // ── Opaque token ──
  it('token is a base64url string with sufficient entropy', () => {
    const { token } = store.create(VALID_IDENTITY);
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(/^[A-Za-z0-9_-]+$/.test(token)).toBe(true);
  });

  // ── No identity leakage ──
  it('token does not contain miaodaUserId, openId, or tenantId', () => {
    const { token } = store.create(VALID_IDENTITY);
    expect(token).not.toContain('miaoda_user_001');
    expect(token).not.toContain('ou_valid_001');
    expect(token).not.toContain('2001');
  });
});
