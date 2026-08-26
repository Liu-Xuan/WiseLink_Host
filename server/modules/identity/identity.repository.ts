import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';

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

  /**
   * One-time isolated DEV bootstrap. The Feishu subject fields are supplied
   * only by the server-side official user_info adapter. The canonical user is
   * derived from the Hosted transaction's app.user_id, never from a request or
   * environment variable. RLS and the active actor/client unique index are the
   * final enforcement boundary.
   */
  async bootstrapSubjectMapping(input: {
    feishuOpenId: string;
    feishuTenantKey: string;
    feishuUserId: string | null;
    expectedClientId: string;
    miaodaTenantId: string;
  }): Promise<PersistedSubjectMapping | null> {
    const actorRows = await this.db.execute<{ miaodaUserId: string | null }>(
      sql`SELECT NULLIF(current_setting('app.user_id', TRUE), '') AS "miaodaUserId"`,
    );
    const miaodaUserId = actorRows[0]?.miaodaUserId;
    if (!miaodaUserId) return null;

    const [activeForActor] = await this.db
      .select({ id: identitySubjectMapping.id })
      .from(identitySubjectMapping)
      .where(
        and(
          eq(identitySubjectMapping.miaodaUserId, miaodaUserId),
          eq(identitySubjectMapping.expectedClientId, input.expectedClientId),
          eq(identitySubjectMapping.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    if (activeForActor) return null;

    const [created] = await this.db
      .insert(identitySubjectMapping)
      .values({
        feishuOpenId: input.feishuOpenId,
        feishuTenantKey: input.feishuTenantKey,
        feishuUserId: input.feishuUserId,
        miaodaUserId,
        miaodaTenantId: input.miaodaTenantId,
        expectedClientId: input.expectedClientId,
        status: 'ACTIVE',
        revision: 1,
      })
      .onConflictDoNothing()
      .returning({
        id: identitySubjectMapping.id,
        feishuOpenId: identitySubjectMapping.feishuOpenId,
        feishuTenantKey: identitySubjectMapping.feishuTenantKey,
        feishuUserId: identitySubjectMapping.feishuUserId,
        miaodaUserId: identitySubjectMapping.miaodaUserId,
        miaodaTenantId: identitySubjectMapping.miaodaTenantId,
        expectedClientId: identitySubjectMapping.expectedClientId,
        revision: identitySubjectMapping.revision,
      });

    if (
      !created ||
      created.miaodaUserId !== miaodaUserId ||
      created.miaodaTenantId !== input.miaodaTenantId ||
      created.expectedClientId !== input.expectedClientId
    ) {
      return null;
    }
    return created;
  }

  async createSession(input: {
    tokenHash: string;
    subjectMappingId: string;
    feishuUserId: string | null;
    absoluteTtlMs: number;
  }): Promise<{ sessionId: string; revision: number; expiresAt: Date }> {
    const issuedAt = sql`CURRENT_TIMESTAMP`;
    const expiresAt = sql`CURRENT_TIMESTAMP + (${input.absoluteTtlMs}::bigint * interval '1 millisecond')`;
    const [created] = await this.db
      .insert(identitySession)
      .values({
        sessionTokenHash: input.tokenHash,
        subjectMappingId: input.subjectMappingId,
        feishuUserId: input.feishuUserId,
        revision: 1,
        expiresAt,
        lastSeenAt: issuedAt,
        updatedAt: issuedAt,
      })
      .returning({
        sessionId: identitySession.id,
        revision: identitySession.revision,
        expiresAt: identitySession.expiresAt,
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
