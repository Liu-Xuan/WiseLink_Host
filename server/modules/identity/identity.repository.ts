import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, gt, isNull } from 'drizzle-orm';

import {
  identityOauthState,
  identitySession,
  identitySubjectMapping,
} from '../../database/schema';

export interface PersistedSubjectMapping {
  id: string;
  feishuOpenId: string;
  feishuTenantKey: string;
  feishuUserId: string | null;
  miaodaUserId: string;
  miaodaTenantId: string;
  expectedClientId: string;
  revision: number;
}

export interface PersistedSession {
  sessionId: string;
  sessionRevision: number;
  expiresAt: Date;
  feishuUserId: string | null;
  mapping: PersistedSubjectMapping;
}

@Injectable()
export class IdentityRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async issueOauthState(input: {
    stateHash: string;
    codeVerifier: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.db.insert(identityOauthState).values({
      stateHash: input.stateHash,
      codeVerifier: input.codeVerifier,
      expiresAt: input.expiresAt,
    });
  }

  async consumeOauthState(
    stateHash: string,
    now: Date,
  ): Promise<{ codeVerifier: string } | null> {
    const [consumed] = await this.db
      .update(identityOauthState)
      .set({ consumedAt: now, updatedAt: now })
      .where(
        and(
          eq(identityOauthState.stateHash, stateHash),
          isNull(identityOauthState.consumedAt),
          gt(identityOauthState.expiresAt, now),
        ),
      )
      .returning({ codeVerifier: identityOauthState.codeVerifier });
    return consumed ?? null;
  }

  async resolveSubjectMapping(input: {
    feishuOpenId: string;
    feishuTenantKey: string;
    expectedClientId: string;
  }): Promise<PersistedSubjectMapping | null> {
    const [mapping] = await this.db
      .select({
        id: identitySubjectMapping.id,
        feishuOpenId: identitySubjectMapping.feishuOpenId,
        feishuTenantKey: identitySubjectMapping.feishuTenantKey,
        feishuUserId: identitySubjectMapping.feishuUserId,
        miaodaUserId: identitySubjectMapping.miaodaUserId,
        miaodaTenantId: identitySubjectMapping.miaodaTenantId,
        expectedClientId: identitySubjectMapping.expectedClientId,
        revision: identitySubjectMapping.revision,
      })
      .from(identitySubjectMapping)
      .where(
        and(
          eq(identitySubjectMapping.feishuOpenId, input.feishuOpenId),
          eq(identitySubjectMapping.feishuTenantKey, input.feishuTenantKey),
          eq(identitySubjectMapping.expectedClientId, input.expectedClientId),
          eq(identitySubjectMapping.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    return mapping ?? null;
  }

  async createSession(input: {
    tokenHash: string;
    subjectMappingId: string;
    feishuUserId: string | null;
    expiresAt: Date;
    now: Date;
  }): Promise<{ sessionId: string; revision: number }> {
    const [created] = await this.db
      .insert(identitySession)
      .values({
        sessionTokenHash: input.tokenHash,
        subjectMappingId: input.subjectMappingId,
        feishuUserId: input.feishuUserId,
        revision: 1,
        expiresAt: input.expiresAt,
        lastSeenAt: input.now,
        updatedAt: input.now,
      })
      .returning({
        sessionId: identitySession.id,
        revision: identitySession.revision,
      });
    if (!created) throw new Error('IDENTITY_SESSION_CREATE_READBACK_FAILED');
    return created;
  }

  async validateSession(
    tokenHash: string,
    now: Date,
  ): Promise<PersistedSession | null> {
    const [row] = await this.db
      .select({
        sessionId: identitySession.id,
        sessionRevision: identitySession.revision,
        expiresAt: identitySession.expiresAt,
        feishuUserId: identitySession.feishuUserId,
        mappingId: identitySubjectMapping.id,
        feishuOpenId: identitySubjectMapping.feishuOpenId,
        feishuTenantKey: identitySubjectMapping.feishuTenantKey,
        mappingFeishuUserId: identitySubjectMapping.feishuUserId,
        miaodaUserId: identitySubjectMapping.miaodaUserId,
        miaodaTenantId: identitySubjectMapping.miaodaTenantId,
        expectedClientId: identitySubjectMapping.expectedClientId,
        mappingRevision: identitySubjectMapping.revision,
      })
      .from(identitySession)
      .innerJoin(
        identitySubjectMapping,
        eq(identitySession.subjectMappingId, identitySubjectMapping.id),
      )
      .where(
        and(
          eq(identitySession.sessionTokenHash, tokenHash),
          isNull(identitySession.revokedAt),
          gt(identitySession.expiresAt, now),
          eq(identitySubjectMapping.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    if (!row) return null;
    await this.db
      .update(identitySession)
      .set({ lastSeenAt: now, updatedAt: now })
      .where(eq(identitySession.id, row.sessionId));
    return {
      sessionId: row.sessionId,
      sessionRevision: row.sessionRevision,
      expiresAt: row.expiresAt,
      feishuUserId: row.feishuUserId ?? row.mappingFeishuUserId,
      mapping: {
        id: row.mappingId,
        feishuOpenId: row.feishuOpenId,
        feishuTenantKey: row.feishuTenantKey,
        feishuUserId: row.mappingFeishuUserId,
        miaodaUserId: row.miaodaUserId,
        miaodaTenantId: row.miaodaTenantId,
        expectedClientId: row.expectedClientId,
        revision: row.mappingRevision,
      },
    };
  }

  async revokeSession(tokenHash: string, now: Date): Promise<boolean> {
    const revoked = await this.db
      .update(identitySession)
      .set({ revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(identitySession.sessionTokenHash, tokenHash),
          isNull(identitySession.revokedAt),
        ),
      )
      .returning({ id: identitySession.id });
    return revoked.length === 1;
  }
}
