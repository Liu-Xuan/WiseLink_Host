import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, asc, eq, sql } from 'drizzle-orm';

import type { EngineeringMatterWorkItemRole } from '@shared/api.interface';
import type {
  MatterMaterialLink,
  MatterMaterialsReadModel,
  ReviseMatterMaterialsRequest,
} from '@shared/matter-material.interface';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';
import { mergeMatterMaterials, parseMatterMaterial } from './matter-material';

import {
  engineeringMatter,
  engineeringMatterRevision,
  engineeringMatterRevisionWorkItem,
} from '../../database/schema';

export interface EngineeringMatterRevisionLinkSnapshot {
  workItemId: string;
  ordinal: number;
  relationRole: EngineeringMatterWorkItemRole;
  linkedAtWorkItemRevision: number;
}

export interface EngineeringMatterSnapshot {
  matterId: string;
  tenantId: string;
  title: string;
  status: 'ACTIVE';
  currentRevisionNo: number;
  currentMatterRevisionId: string;
  changeKind: 'CREATED' | 'WORK_ITEM_LINKED' | 'MATERIALS_REVISED';
  changeSummary: string;
  revisionCreatedAt: Date;
  links: EngineeringMatterRevisionLinkSnapshot[];
  materials?: MatterMaterialLink[];
}

export interface EngineeringMatterCreateResult {
  snapshot: EngineeringMatterSnapshot;
  created: boolean;
}

export interface EngineeringMatterLinkResult {
  snapshot: EngineeringMatterSnapshot;
  linked: boolean;
  replayed: boolean;
}

@Injectable()
export class EngineeringMatterRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /** Uses a real DocumentVersion and the existing owner management scope. */
  async ensureFamilyMatter(
    input: {
      tenantId: string;
      actorUserId: string;
      documentVersionId: string;
    },
    executor: PostgresJsDatabase = this.db,
  ): Promise<{ matterId: string; created: boolean }> {
    return executor.transaction(async (database) => {
      const [source] = await database.execute<{
        family_id: string;
        canonical_document_number: string;
        current_document_version_id: string | null;
      }>(sql`
        SELECT f.family_id, f.canonical_document_number, f.current_document_version_id
        FROM dm_document_version v JOIN dm_publication_family f ON f.family_id = v.family_id
        WHERE v.document_version_id = ${input.documentVersionId}
          AND engineering_matter_document_owned_by_actor(${input.tenantId}::varchar, v.document_version_id)
          AND current_setting('app.user_id', true) = ${input.actorUserId}
          AND v.lifecycle_status = 'COMMITTED_IMMUTABLE'
        FOR UPDATE OF f`);
      if (!source) throw matterNotFound();
      // Discover current explicit membership before creating a default. Related
      // scopes follow source changes too, but do not imply membership.
      const affected = await database.execute<{
        matter_id: string;
        is_member: boolean;
      }>(sql`
        SELECT m.matter_id,
          (m.default_family_id = ${source.family_id} OR EXISTS (
            SELECT 1 FROM engineering_matter_material_link l
            WHERE l.matter_revision_id = m.current_matter_revision_id
              AND l.family_id = ${source.family_id} AND l.kind = 'MEMBER'
              AND l.material_json::jsonb ->> 'disposition' = 'INCLUDED'
          )) IS TRUE AS is_member
        FROM engineering_matter m
        WHERE m.tenant_id = ${input.tenantId} AND m.created_by_user_id = ${input.actorUserId}
          AND (m.default_family_id = ${source.family_id} OR EXISTS (
            SELECT 1 FROM engineering_matter_material_link l
            WHERE l.matter_revision_id = m.current_matter_revision_id
              AND l.family_id = ${source.family_id}
              AND l.material_json::jsonb ->> 'disposition' = 'INCLUDED'
          ))
        ORDER BY m.matter_id
        FOR UPDATE OF m`);
      for (const existing of affected) {
        if (source.current_document_version_id !== input.documentVersionId)
          continue;
        const current = await this.readMaterials(
          { tenantId: input.tenantId, matterId: existing.matter_id },
          database,
        );
        const upserts = current.materials
          .filter(
            (material) =>
              material.kind !== 'EXPECTED' &&
              material.familyId === source.family_id &&
              material.documentVersionId !== input.documentVersionId &&
              material.disposition === 'INCLUDED',
          )
          .map(
            (material) =>
              ({
                ...material,
                documentVersionId: input.documentVersionId,
              }) as MatterMaterialLink,
          );
        if (upserts.length)
          await this.reviseMaterials(
            {
              ...input,
              matterId: existing.matter_id,
              command: {
                requestId: `source-${randomUUID()}`,
                expectedMatterRevision: current.matterRevision,
                changeSummary:
                  '同一文件 family 的当前版本已变化；后继分析尚待覆盖。',
                upserts,
              },
            },
            database,
          );
      }
      const existingMember = affected.find((matter) => matter.is_member);
      if (existingMember)
        return { matterId: existingMember.matter_id, created: false };
      const matterId = `MAT-${randomUUID()}`;
      const revisionId = `MREV-${randomUUID()}`;
      const requestId = `family:${source.family_id}`;
      const material: MatterMaterialLink = {
        materialId: `family:${source.family_id}`,
        kind: 'MEMBER',
        familyId: source.family_id,
        documentVersionId: input.documentVersionId,
        scope: '正式受理文件的工程问题范围，目标适用性仍需分析。',
        contribution: '默认主文件；后续按实际问题连续性调整材料关系。',
        basis: [],
        origin: 'DEFAULT_INTAKE',
        disposition: 'INCLUDED',
      };
      const command = canonicalJson({
        documentVersionId: input.documentVersionId,
        material,
      });
      await database.execute(sql`INSERT INTO engineering_matter
        (matter_id, tenant_id, title, status, current_revision_no, current_matter_revision_id,
         request_id, created_by_user_id, default_family_id)
        VALUES (${matterId}, ${input.tenantId}, ${source.canonical_document_number}, 'ACTIVE', 1,
          ${revisionId}, ${requestId}, ${input.actorUserId}, ${source.family_id})`);
      await database.execute(sql`INSERT INTO engineering_matter_revision
        (matter_revision_id, matter_id, tenant_id, revision_no, request_id, change_kind,
         change_summary, changed_work_item_id, created_by_user_id, material_command_json)
        VALUES (${revisionId}, ${matterId}, ${input.tenantId}, 1, ${requestId}, 'CREATED',
          '正式文件首次受理，按 family 建立工程事项。', NULL, ${input.actorUserId}, ${command})`);
      await insertMaterials(database, { ...input, matterId, revisionId }, [
        material,
      ]);
      return { matterId, created: true };
    });
  }

  async readMaterials(
    input: { tenantId: string; matterId: string },
    database = this.db,
  ): Promise<MatterMaterialsReadModel> {
    const [matter] = await database.execute<{
      current_matter_revision_id: string;
      current_revision_no: number;
    }>(sql`
      SELECT current_matter_revision_id, current_revision_no FROM engineering_matter
      WHERE tenant_id = ${input.tenantId} AND matter_id = ${input.matterId}`);
    if (!matter) throw matterNotFound();
    return {
      matterId: input.matterId,
      matterRevisionId: matter.current_matter_revision_id,
      matterRevision: matter.current_revision_no,
      materials: await loadMaterials(
        database,
        input.tenantId,
        input.matterId,
        matter.current_matter_revision_id,
      ),
    };
  }

  async reviseMaterials(
    input: {
      tenantId: string;
      actorUserId: string;
      matterId: string;
      command: ReviseMatterMaterialsRequest;
    },
    executor: PostgresJsDatabase = this.db,
  ): Promise<{ materials: MatterMaterialsReadModel; replayed: boolean }> {
    const command = input.command;
    if (
      !/^[A-Za-z0-9:_-]{1,96}$/u.test(command.requestId) ||
      !Number.isSafeInteger(command.expectedMatterRevision) ||
      command.expectedMatterRevision < 1 ||
      typeof command.changeSummary !== 'string' ||
      !command.changeSummary.trim() ||
      command.changeSummary.length > 1000 ||
      !Array.isArray(command.upserts) ||
      command.upserts.length < 1 ||
      command.upserts.length > 96
    ) {
      throw new Error('MATTER_MATERIAL_COMMAND_INVALID');
    }
    command.upserts.forEach(parseMatterMaterial);
    const commandJson = canonicalJson(command);
    return executor.transaction(async (database) => {
      const [matter] = await database.execute<{
        current_matter_revision_id: string;
        current_revision_no: number;
      }>(sql`
        SELECT current_matter_revision_id, current_revision_no FROM engineering_matter
        WHERE tenant_id = ${input.tenantId} AND matter_id = ${input.matterId}
          AND created_by_user_id = ${input.actorUserId}
          AND current_setting('app.user_id', true) = ${input.actorUserId}
        FOR UPDATE`);
      if (!matter) throw matterNotFound();
      const [replay] = await database.execute<{
        matter_revision_id: string;
        revision_no: number;
        material_command_json: string | null;
      }>(sql`
        SELECT matter_revision_id, revision_no, material_command_json FROM engineering_matter_revision
        WHERE tenant_id = ${input.tenantId} AND matter_id = ${input.matterId} AND request_id = ${command.requestId}`);
      if (replay) {
        if (replay.material_command_json !== commandJson)
          throw matterRequestReplayMismatch();
        return {
          replayed: true,
          materials: {
            matterId: input.matterId,
            matterRevisionId: replay.matter_revision_id,
            matterRevision: replay.revision_no,
            materials: await loadMaterials(
              database,
              input.tenantId,
              input.matterId,
              replay.matter_revision_id,
            ),
          },
        };
      }
      if (matter.current_revision_no !== command.expectedMatterRevision)
        throw matterCasConflict();
      const before = await loadMaterials(
        database,
        input.tenantId,
        input.matterId,
        matter.current_matter_revision_id,
      );
      const materials = mergeMatterMaterials(before, command.upserts);
      const revisionId = `MREV-${randomUUID()}`;
      const revisionNo = matter.current_revision_no + 1;
      await database.execute(sql`INSERT INTO engineering_matter_revision
        (matter_revision_id, matter_id, tenant_id, revision_no, request_id, change_kind, change_summary,
         changed_work_item_id, created_by_user_id, material_command_json)
        VALUES (${revisionId}, ${input.matterId}, ${input.tenantId}, ${revisionNo}, ${command.requestId},
          'MATERIALS_REVISED', ${command.changeSummary}, NULL, ${input.actorUserId}, ${commandJson})`);
      await database.execute(sql`INSERT INTO engineering_matter_revision_work_item
        (matter_revision_id, matter_id, tenant_id, work_item_id, ordinal, relation_role, linked_at_work_item_revision)
        SELECT ${revisionId}, matter_id, tenant_id, work_item_id, ordinal, relation_role, linked_at_work_item_revision
        FROM engineering_matter_revision_work_item WHERE tenant_id = ${input.tenantId}
          AND matter_id = ${input.matterId} AND matter_revision_id = ${matter.current_matter_revision_id}`);
      await insertMaterials(database, { ...input, revisionId }, materials);
      const updated = await database.execute(sql`UPDATE engineering_matter
        SET current_matter_revision_id = ${revisionId}, current_revision_no = ${revisionNo}, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${input.tenantId} AND matter_id = ${input.matterId}
          AND current_revision_no = ${command.expectedMatterRevision}
          AND current_matter_revision_id = ${matter.current_matter_revision_id} RETURNING matter_id`);
      if (updated.length !== 1) throw matterCasConflict();
      return {
        replayed: false,
        materials: {
          matterId: input.matterId,
          matterRevisionId: revisionId,
          matterRevision: revisionNo,
          materials: await loadMaterials(
            database,
            input.tenantId,
            input.matterId,
            revisionId,
          ),
        },
      };
    });
  }

  async create(input: {
    tenantId: string;
    actorUserId: string;
    requestId: string;
    title: string;
    primaryWorkItemId: string;
    primaryWorkItemRevision: number;
  }): Promise<EngineeringMatterCreateResult> {
    const existing: EngineeringMatterSnapshot | null =
      await this.loadByCreateRequest(input);
    if (existing) return { snapshot: existing, created: false };

    const matterId: string = `MAT-${randomUUID()}`;
    const matterRevisionId: string = `MREV-${randomUUID()}`;
    const now: Date = new Date();
    try {
      await this.db.transaction(async (transaction) => {
        await transaction.insert(engineeringMatter).values({
          matterId,
          tenantId: input.tenantId,
          title: input.title,
          status: 'ACTIVE',
          currentRevisionNo: 1,
          currentMatterRevisionId: matterRevisionId,
          requestId: input.requestId,
          createdByUserId: input.actorUserId,
          createdAt: now,
          updatedAt: now,
        });
        await transaction.insert(engineeringMatterRevision).values({
          matterRevisionId,
          matterId,
          tenantId: input.tenantId,
          revisionNo: 1,
          requestId: input.requestId,
          changeKind: 'CREATED',
          changeSummary: 'Created Engineering Matter.',
          changedWorkItemId: input.primaryWorkItemId,
          createdByUserId: input.actorUserId,
          createdAt: now,
        });
        await transaction.insert(engineeringMatterRevisionWorkItem).values({
          matterRevisionId,
          matterId,
          tenantId: input.tenantId,
          workItemId: input.primaryWorkItemId,
          ordinal: 1,
          relationRole: 'PRIMARY',
          linkedAtWorkItemRevision: input.primaryWorkItemRevision,
        });
      });
    } catch (error: unknown) {
      if (isUniqueConflict(error)) {
        const replayed: EngineeringMatterSnapshot | null =
          await this.loadByCreateRequest(input);
        if (replayed) return { snapshot: replayed, created: false };
      }
      throw error;
    }
    const snapshot: EngineeringMatterSnapshot | null = await this.loadCurrent({
      tenantId: input.tenantId,
      matterId,
    });
    if (!snapshot) throw matterPersistenceError();
    return { snapshot, created: true };
  }

  async linkWorkItem(input: {
    tenantId: string;
    actorUserId: string;
    matterId: string;
    requestId: string;
    expectedMatterRevision: number;
    workItemId: string;
    workItemRevision: number;
    changeSummary: string;
  }): Promise<EngineeringMatterLinkResult> {
    const current: EngineeringMatterSnapshot | null = await this.loadCurrent({
      tenantId: input.tenantId,
      matterId: input.matterId,
    });
    if (!current) throw matterNotFound();
    const replayedRequest: EngineeringMatterRevisionRequest | null =
      await this.revisionRequest({
        matterId: input.matterId,
        requestId: input.requestId,
      });
    if (replayedRequest !== null) {
      if (
        replayedRequest.changeKind !== 'WORK_ITEM_LINKED' ||
        replayedRequest.changedWorkItemId !== input.workItemId ||
        replayedRequest.changeSummary !== input.changeSummary
      ) {
        throw matterRequestReplayMismatch();
      }
      return { snapshot: current, linked: false, replayed: true };
    }
    if (
      current.links.some(
        (link: EngineeringMatterRevisionLinkSnapshot) =>
          link.workItemId === input.workItemId,
      )
    ) {
      throw matterWorkItemAlreadyLinked();
    }
    if (current.currentRevisionNo !== input.expectedMatterRevision) {
      throw matterCasConflict();
    }

    const nextRevisionNo: number = current.currentRevisionNo + 1;
    const nextMatterRevisionId: string = `MREV-${randomUUID()}`;
    const now: Date = new Date();
    try {
      await this.db.transaction(async (transaction) => {
        await transaction.insert(engineeringMatterRevision).values({
          matterRevisionId: nextMatterRevisionId,
          matterId: input.matterId,
          tenantId: input.tenantId,
          revisionNo: nextRevisionNo,
          requestId: input.requestId,
          changeKind: 'WORK_ITEM_LINKED',
          changeSummary: input.changeSummary,
          changedWorkItemId: input.workItemId,
          createdByUserId: input.actorUserId,
          createdAt: now,
        });
        const copiedLinks: Array<
          typeof engineeringMatterRevisionWorkItem.$inferInsert
        > = current.links.map(
          (link: EngineeringMatterRevisionLinkSnapshot) => ({
            matterRevisionId: nextMatterRevisionId,
            matterId: input.matterId,
            tenantId: input.tenantId,
            workItemId: link.workItemId,
            ordinal: link.ordinal,
            relationRole: link.relationRole,
            linkedAtWorkItemRevision: link.linkedAtWorkItemRevision,
          }),
        );
        copiedLinks.push({
          matterRevisionId: nextMatterRevisionId,
          matterId: input.matterId,
          tenantId: input.tenantId,
          workItemId: input.workItemId,
          ordinal: copiedLinks.length + 1,
          relationRole: 'RELATED',
          linkedAtWorkItemRevision: input.workItemRevision,
        });
        await transaction
          .insert(engineeringMatterRevisionWorkItem)
          .values(copiedLinks);
        await insertMaterials(
          transaction as PostgresJsDatabase,
          {
            tenantId: input.tenantId,
            actorUserId: input.actorUserId,
            matterId: input.matterId,
            revisionId: nextMatterRevisionId,
          },
          current.materials ?? [],
        );
        const updated: Array<{ matterId: string }> = await transaction
          .update(engineeringMatter)
          .set({
            currentRevisionNo: nextRevisionNo,
            currentMatterRevisionId: nextMatterRevisionId,
            updatedAt: now,
          })
          .where(
            and(
              eq(engineeringMatter.tenantId, input.tenantId),
              eq(engineeringMatter.matterId, input.matterId),
              eq(
                engineeringMatter.currentRevisionNo,
                input.expectedMatterRevision,
              ),
              eq(
                engineeringMatter.currentMatterRevisionId,
                current.currentMatterRevisionId,
              ),
            ),
          )
          .returning({ matterId: engineeringMatter.matterId });
        if (updated.length !== 1) throw matterCasConflict();
      });
    } catch (error: unknown) {
      if (isUniqueConflict(error)) {
        const replayedRequest: EngineeringMatterRevisionRequest | null =
          await this.revisionRequest({
            matterId: input.matterId,
            requestId: input.requestId,
          });
        if (replayedRequest === null) throw matterCasConflict();
        if (
          replayedRequest.changeKind !== 'WORK_ITEM_LINKED' ||
          replayedRequest.changedWorkItemId !== input.workItemId ||
          replayedRequest.changeSummary !== input.changeSummary
        ) {
          throw matterRequestReplayMismatch();
        }
        const replaySnapshot: EngineeringMatterSnapshot | null =
          await this.loadCurrent({
            tenantId: input.tenantId,
            matterId: input.matterId,
          });
        if (!replaySnapshot) throw matterNotFound();
        return {
          snapshot: replaySnapshot,
          linked: false,
          replayed: true,
        };
      }
      throw error;
    }

    const snapshot: EngineeringMatterSnapshot | null = await this.loadCurrent({
      tenantId: input.tenantId,
      matterId: input.matterId,
    });
    if (!snapshot) throw matterPersistenceError();
    return { snapshot, linked: true, replayed: false };
  }

  async loadCurrent(
    input: {
      tenantId: string;
      matterId: string;
    },
    executor: PostgresJsDatabase = this.db,
  ): Promise<EngineeringMatterSnapshot | null> {
    const [row] = await executor
      .select({
        matterId: engineeringMatter.matterId,
        tenantId: engineeringMatter.tenantId,
        title: engineeringMatter.title,
        status: engineeringMatter.status,
        currentRevisionNo: engineeringMatter.currentRevisionNo,
        currentMatterRevisionId: engineeringMatter.currentMatterRevisionId,
        revisionNo: engineeringMatterRevision.revisionNo,
        changeKind: engineeringMatterRevision.changeKind,
        changeSummary: engineeringMatterRevision.changeSummary,
        revisionCreatedAt: engineeringMatterRevision.createdAt,
      })
      .from(engineeringMatter)
      .innerJoin(
        engineeringMatterRevision,
        and(
          eq(
            engineeringMatterRevision.matterRevisionId,
            engineeringMatter.currentMatterRevisionId,
          ),
          eq(engineeringMatterRevision.matterId, engineeringMatter.matterId),
          eq(engineeringMatterRevision.tenantId, engineeringMatter.tenantId),
        ),
      )
      .where(
        and(
          eq(engineeringMatter.tenantId, input.tenantId),
          eq(engineeringMatter.matterId, input.matterId),
        ),
      )
      .limit(1);
    if (!row) return null;
    if (
      row.status !== 'ACTIVE' ||
      row.revisionNo !== row.currentRevisionNo ||
      !['CREATED', 'WORK_ITEM_LINKED', 'MATERIALS_REVISED'].includes(
        row.changeKind,
      )
    ) {
      throw matterPersistenceError();
    }
    const linkRows: Array<
      typeof engineeringMatterRevisionWorkItem.$inferSelect
    > = await executor
      .select()
      .from(engineeringMatterRevisionWorkItem)
      .where(
        and(
          eq(
            engineeringMatterRevisionWorkItem.matterRevisionId,
            row.currentMatterRevisionId,
          ),
          eq(engineeringMatterRevisionWorkItem.matterId, row.matterId),
          eq(engineeringMatterRevisionWorkItem.tenantId, row.tenantId),
        ),
      )
      .orderBy(asc(engineeringMatterRevisionWorkItem.ordinal));
    const materials = await loadMaterials(
      executor,
      row.tenantId,
      row.matterId,
      row.currentMatterRevisionId,
    );
    if (linkRows.length === 0 && materials.length === 0)
      throw matterPersistenceError();
    const links: EngineeringMatterRevisionLinkSnapshot[] = linkRows.map(
      (link: typeof engineeringMatterRevisionWorkItem.$inferSelect) => ({
        workItemId: link.workItemId,
        ordinal: link.ordinal,
        relationRole: requiredRole(link.relationRole),
        linkedAtWorkItemRevision: link.linkedAtWorkItemRevision,
      }),
    );
    return {
      matterId: row.matterId,
      tenantId: row.tenantId,
      title: row.title,
      status: row.status,
      currentRevisionNo: row.currentRevisionNo,
      currentMatterRevisionId: row.currentMatterRevisionId,
      changeKind: row.changeKind as EngineeringMatterSnapshot['changeKind'],
      changeSummary: row.changeSummary,
      revisionCreatedAt: row.revisionCreatedAt,
      links,
      ...(materials.length ? { materials } : {}),
    };
  }

  private async loadByCreateRequest(input: {
    tenantId: string;
    actorUserId: string;
    requestId: string;
  }): Promise<EngineeringMatterSnapshot | null> {
    const [matter] = await this.db
      .select({ matterId: engineeringMatter.matterId })
      .from(engineeringMatter)
      .where(
        and(
          eq(engineeringMatter.tenantId, input.tenantId),
          eq(engineeringMatter.createdByUserId, input.actorUserId),
          eq(engineeringMatter.requestId, input.requestId),
        ),
      )
      .limit(1);
    if (!matter) return null;
    return this.loadCurrent({
      tenantId: input.tenantId,
      matterId: matter.matterId,
    });
  }

  private async revisionRequest(input: {
    matterId: string;
    requestId: string;
  }): Promise<EngineeringMatterRevisionRequest | null> {
    const [row] = await this.db
      .select({
        changedWorkItemId: engineeringMatterRevision.changedWorkItemId,
        changeKind: engineeringMatterRevision.changeKind,
        changeSummary: engineeringMatterRevision.changeSummary,
      })
      .from(engineeringMatterRevision)
      .where(
        and(
          eq(engineeringMatterRevision.matterId, input.matterId),
          eq(engineeringMatterRevision.requestId, input.requestId),
        ),
      )
      .limit(1);
    if (!row) return null;
    if (row.changeKind !== 'CREATED' && row.changeKind !== 'WORK_ITEM_LINKED') {
      throw matterPersistenceError();
    }
    return {
      changedWorkItemId: row.changedWorkItemId,
      changeKind: row.changeKind,
      changeSummary: row.changeSummary,
    };
  }
}

interface EngineeringMatterRevisionRequest {
  changedWorkItemId: string;
  changeKind: 'CREATED' | 'WORK_ITEM_LINKED';
  changeSummary: string;
}

export async function loadMaterials(
  database: PostgresJsDatabase,
  tenantId: string,
  matterId: string,
  revisionId: string,
): Promise<MatterMaterialLink[]> {
  const rows = await database.execute<{ material_json: string }>(sql`
    SELECT material_json FROM engineering_matter_material_link
    WHERE tenant_id = ${tenantId} AND matter_id = ${matterId} AND matter_revision_id = ${revisionId}
    ORDER BY material_id`);
  return rows.map((row) => parseMatterMaterial(JSON.parse(row.material_json)));
}

async function insertMaterials(
  database: PostgresJsDatabase,
  scope: {
    tenantId: string;
    actorUserId: string;
    matterId: string;
    revisionId: string;
  },
  materials: MatterMaterialLink[],
): Promise<void> {
  for (const material of materials) {
    await database.execute(sql`INSERT INTO engineering_matter_material_link
      (tenant_id, matter_id, matter_revision_id, material_id, kind, family_id, document_version_id, material_json, created_by_user_id)
      VALUES (${scope.tenantId}, ${scope.matterId}, ${scope.revisionId}, ${material.materialId}, ${material.kind},
        ${material.familyId}, ${material.documentVersionId}, ${canonicalJson(material)}, ${scope.actorUserId})`);
  }
}

function requiredRole(value: string): EngineeringMatterWorkItemRole {
  if (value === 'PRIMARY' || value === 'RELATED') return value;
  throw matterPersistenceError();
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    String(error.code) === '23505'
  );
}

function matterNotFound(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('Engineering Matter is not available.'), {
    code: 'ENGINEERING_MATTER_NOT_FOUND',
    statusCode: 404,
  });
}

function matterCasConflict(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('Engineering Matter revision changed.'), {
    code: 'ENGINEERING_MATTER_CAS_CONFLICT',
    statusCode: 409,
  });
}

function matterWorkItemAlreadyLinked(): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(
    new Error('WorkItem is already linked to this Engineering Matter.'),
    {
      code: 'ENGINEERING_MATTER_WORK_ITEM_ALREADY_LINKED',
      statusCode: 409,
    },
  );
}

function matterRequestReplayMismatch(): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(
    new Error('Matter request id was reused with new input.'),
    {
      code: 'ENGINEERING_MATTER_REQUEST_REPLAY_MISMATCH',
      statusCode: 409,
    },
  );
}

function matterPersistenceError(): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(
    new Error('Engineering Matter persistence is invalid.'),
    {
      code: 'ENGINEERING_MATTER_PERSISTENCE_INVALID',
      statusCode: 500,
    },
  );
}
