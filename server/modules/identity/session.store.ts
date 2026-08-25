import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';

import { IdentityRepository } from './identity.repository';
import type { VerifiedIdentity } from './identity.types';

export interface ValidatedSession {
  sessionId: string;
  revision: number;
  expiresAt: Date;
  identity: VerifiedIdentity;
}

@Injectable()
export class SessionStore {
  private static readonly TTL_MS = 30 * 60 * 1000;

  constructor(private readonly repository: IdentityRepository) {}

  async create(identity: VerifiedIdentity): Promise<{
    token: string;
    sessionId: string;
    revision: number;
    expiresAt: Date;
  }> {
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SessionStore.TTL_MS);
    const persisted = await this.repository.createSession({
      tokenHash: digest(token),
      subjectMappingId: identity.subjectMappingId,
      feishuUserId: identity.feishuUserId,
      expiresAt,
      now,
    });
    return { token, expiresAt, ...persisted };
  }

  async validate(token: string): Promise<ValidatedSession | null> {
    if (!token || token.trim().length === 0) return null;
    const persisted = await this.repository.validateSession(
      digest(token),
      new Date(),
    );
    if (!persisted) return null;
    return {
      sessionId: persisted.sessionId,
      revision: persisted.sessionRevision,
      expiresAt: persisted.expiresAt,
      identity: {
        subjectMappingId: persisted.mapping.id,
        provenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
        miaodaUserId: persisted.mapping.miaodaUserId,
        tenantId: persisted.mapping.miaodaTenantId,
        feishuUserId: persisted.feishuUserId,
        feishuOpenId: persisted.mapping.feishuOpenId,
        namespacedSubject: {
          namespace: 'FEISHU_OPEN_ID',
          subject: persisted.mapping.feishuOpenId,
          tenantKey: persisted.mapping.feishuTenantKey,
        },
        verifiedAt: new Date().toISOString(),
      },
    };
  }

  async revoke(token: string): Promise<boolean> {
    if (!token || token.trim().length === 0) return false;
    return this.repository.revokeSession(digest(token), new Date());
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
