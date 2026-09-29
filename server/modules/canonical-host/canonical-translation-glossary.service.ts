import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import { z } from 'zod/v4';
import type {
  TranslationGlossaryEntry,
  TranslationGlossarySnapshot,
  UpdateTranslationGlossaryRequest,
} from '@shared/api.interface';
import { CANONICAL_TRANSLATION_RULE_SET_V1 } from './canonical-translation-rule-set-v1.private';

const entrySchema = z.strictObject({
  entryId: z.string().regex(/^[A-Za-z0-9._-]{1,96}$/u),
  kind: z.enum(['TERM', 'NO_TRANSLATE']),
  sourceText: z.string().trim().min(1).max(160),
  targetRenderings: z.array(z.string().trim().min(1).max(160)).max(5),
  note: z.string().max(500).nullable(),
}).superRefine((entry, context) => {
  if (entry.kind === 'TERM' && entry.targetRenderings.length === 0)
    context.addIssue({ code: 'custom', message: 'TERM_RENDERING_REQUIRED' });
  if (entry.kind === 'NO_TRANSLATE' && entry.targetRenderings.length !== 0)
    context.addIssue({ code: 'custom', message: 'NO_TRANSLATE_RENDERING_FORBIDDEN' });
  if (new Set(entry.targetRenderings.map(value => value.toLocaleLowerCase())).size !==
      entry.targetRenderings.length)
    context.addIssue({ code: 'custom', message: 'DUPLICATE_RENDERING' });
}).transform(entry => ({ ...entry, note: entry.note ?? null }));

export const translationGlossaryEntriesSchema = z.array(entrySchema).max(200)
  .superRefine((entries, context) => {
    const ids = new Set<string>();
    const terms = new Set<string>();
    for (const entry of entries) {
      const key = `${entry.kind}:${entry.sourceText.toLocaleLowerCase()}`;
      if (ids.has(entry.entryId) || terms.has(key))
        context.addIssue({ code: 'custom', message: 'DUPLICATE_GLOSSARY_ENTRY' });
      ids.add(entry.entryId);
      terms.add(key);
    }
  });
const updateSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  entries: translationGlossaryEntriesSchema,
});

export const DEFAULT_TRANSLATION_GLOSSARY: TranslationGlossarySnapshot = {
  revision: 1,
  entries: [
    ...CANONICAL_TRANSLATION_RULE_SET_V1.terms.map((term): TranslationGlossaryEntry => ({
      entryId: term.ruleId, kind: 'TERM', sourceText: term.sourceTerm,
      targetRenderings: [...term.targetRenderings], note: term.note ?? null,
    })),
    ...CANONICAL_TRANSLATION_RULE_SET_V1.noTranslate.map((rule): TranslationGlossaryEntry => ({
      entryId: rule.ruleId, kind: 'NO_TRANSLATE', sourceText: rule.token,
      targetRenderings: [], note: rule.note ?? null,
    })),
  ],
};

interface GlossaryRow extends Record<string, unknown> { revision: number; entries: unknown }
type GlossaryDb = Pick<PostgresJsDatabase, 'execute'>;

export async function readTranslationGlossary(
  db: GlossaryDb,
  tenantId: string,
): Promise<TranslationGlossarySnapshot> {
  const rows = await db.execute<GlossaryRow>(sql`
    SELECT revision, entries_json AS entries
    FROM translation_glossary WHERE tenant_id = ${tenantId} LIMIT 1`);
  if (!rows[0]) return structuredClone(DEFAULT_TRANSLATION_GLOSSARY);
  return {
    revision: rows[0].revision,
    entries: translationGlossaryEntriesSchema.parse(rows[0].entries),
  };
}

@Injectable()
export class CanonicalTranslationGlossaryService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  read(tenantId: string): Promise<TranslationGlossarySnapshot> {
    return readTranslationGlossary(this.db, tenantId);
  }

  async update(
    tenantId: string,
    actorUserId: string,
    raw: unknown,
  ): Promise<TranslationGlossarySnapshot> {
    const parsed = updateSchema.safeParse(raw);
    if (!parsed.success)
      throw new BadRequestException('TRANSLATION_GLOSSARY_INVALID');
    const command: UpdateTranslationGlossaryRequest = parsed.data;
    const entriesJson = JSON.stringify(command.entries);
    return this.db.transaction(async transaction => {
      await transaction.execute(sql`
        INSERT INTO translation_glossary
          (tenant_id, revision, entries_json, updated_by)
        VALUES (${tenantId}, 1, ${JSON.stringify(DEFAULT_TRANSLATION_GLOSSARY.entries)}::jsonb,
          ${actorUserId})
        ON CONFLICT (tenant_id) DO NOTHING`);
      const changed = await transaction.execute<{ revision: number }>(sql`
        UPDATE translation_glossary
        SET revision = revision + 1, entries_json = ${entriesJson}::jsonb,
          updated_by = ${actorUserId}, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${tenantId} AND revision = ${command.expectedRevision}
        RETURNING revision`);
      if (!changed[0])
        throw new ConflictException('TRANSLATION_GLOSSARY_REVISION_CONFLICT');
      return { revision: changed[0].revision, entries: command.entries };
    });
  }
}
