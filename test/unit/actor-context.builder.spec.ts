import 'reflect-metadata';

import { buildActorContextFromVerifiedIdentity } from '../../server/modules/identity/actor-context.builder';
import type { VerifiedIdentity } from '../../server/modules/identity/identity.types';

const IDENTITY: VerifiedIdentity = {
  subjectMappingId: '11111111-1111-4111-8111-111111111111',
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
  verifiedAt: '2026-08-23T10:00:00.000Z',
};

const SESSION = { sessionId: 'session-token-abc', sessionRevision: 42 };
const APP_SCOPE = 'app_17bzc551rsg';
const ENV = 'development';

describe('buildActorContextFromVerifiedIdentity', () => {
  it('produces a FINAL_USER actor context', () => {
    const actor = buildActorContextFromVerifiedIdentity(
      IDENTITY,
      SESSION,
      APP_SCOPE,
      ENV,
    );
    expect(actor.principalKind).toBe('FINAL_USER');
  });

  it('uses MIAODA_USER_ID as canonicalSubject namespace (from Host mapping, not caller)', () => {
    const actor = buildActorContextFromVerifiedIdentity(
      IDENTITY,
      SESSION,
      APP_SCOPE,
      ENV,
    );
    expect(actor.canonicalSubject.namespace).toBe('MIAODA_USER_ID');
    expect(actor.canonicalSubject.id).toBe('miaoda_user_001');
  });

  it('sets identityProvenance to FEISHU_OAUTH_USER_ACCESS_TOKEN', () => {
    const actor = buildActorContextFromVerifiedIdentity(
      IDENTITY,
      SESSION,
      APP_SCOPE,
      ENV,
    );
    expect(actor.identityProvenance).toBe('FEISHU_OAUTH_USER_ACCESS_TOKEN');
  });

  it('sets feishuOpenId and feishuUserId from the verified identity', () => {
    const actor = buildActorContextFromVerifiedIdentity(
      IDENTITY,
      SESSION,
      APP_SCOPE,
      ENV,
    );
    expect(actor.feishuOpenId).toBe('ou_valid_001');
    expect(actor.feishuUserId).toBe('emp_001');
    expect(actor.feishuIdentityProvenance).toBe('FEISHU_OAUTH_USER_ACCESS_TOKEN');
  });

  it('sets session provenance to SERVER_OPAQUE_SESSION with token and revision', () => {
    const actor = buildActorContextFromVerifiedIdentity(
      IDENTITY,
      SESSION,
      APP_SCOPE,
      ENV,
    );
    expect(actor.sessionProvenance).toBe('SERVER_OPAQUE_SESSION');
    expect(actor.sessionId).toBe('session-token-abc');
    expect(actor.sessionRevision).toBe(42);
  });

  it('uses the verifiedAt timestamp for subjectDecision.decidedAt', () => {
    const actor = buildActorContextFromVerifiedIdentity(
      IDENTITY,
      SESSION,
      APP_SCOPE,
      ENV,
    );
    expect(actor.subjectDecision.decidedAt).toBe('2026-08-23T10:00:00.000Z');
  });

  it('uses the mapping tenantId, not a caller-asserted value', () => {
    const actor = buildActorContextFromVerifiedIdentity(
      IDENTITY,
      SESSION,
      APP_SCOPE,
      ENV,
    );
    expect(actor.tenantId).toBe('2001');
    expect(actor.subjectDecision.tenantId).toBe('2001');
  });

  it('sets the feishu-oauth-verified version string', () => {
    const actor = buildActorContextFromVerifiedIdentity(
      IDENTITY,
      SESSION,
      APP_SCOPE,
      ENV,
    );
    expect(actor.subjectDecision.version).toBe('feishu-oauth-verified.v1');
    expect(actor.subjectDecision.source).toBe('FEISHU_OAUTH_USER_ACCESS_TOKEN');
  });

  // ── Anti-forgery invariants ──
  it('never produces a FEISHU_OPEN_ID canonicalSubject (Host mapping is authoritative)', () => {
    const actor = buildActorContextFromVerifiedIdentity(
      IDENTITY,
      SESSION,
      APP_SCOPE,
      ENV,
    );
    expect(actor.canonicalSubject.namespace).not.toBe('FEISHU_OPEN_ID');
  });

  it('never produces MIAODA_GATEWAY_USER_CONTEXT provenance', () => {
    const actor = buildActorContextFromVerifiedIdentity(
      IDENTITY,
      SESSION,
      APP_SCOPE,
      ENV,
    );
    expect(actor.identityProvenance).not.toBe('MIAODA_GATEWAY_USER_CONTEXT');
    expect(actor.subjectDecision.source).not.toBe('MIAODA_GATEWAY_USER_CONTEXT');
  });

  it('never produces UNAVAILABLE session provenance', () => {
    const actor = buildActorContextFromVerifiedIdentity(
      IDENTITY,
      SESSION,
      APP_SCOPE,
      ENV,
    );
    expect(actor.sessionProvenance).not.toBe('UNAVAILABLE');
    expect(actor.sessionId).not.toBeNull();
    expect(actor.sessionRevision).not.toBeNull();
  });
});
