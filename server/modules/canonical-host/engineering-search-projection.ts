import type { JobAidProblemWorkContent } from '@shared/jobaid-problem-assessment.interface';
import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq } from 'drizzle-orm';
import { engineeringSearchProjection } from '../../database/engineering-search.schema';
import { buildEngineeringSearchText, type EngineeringSearchText } from './engineering-search-text';

export interface EngineeringSearchProjectionEntry {
  entryId: string;
  ownerKind: 'USER' | 'MATTER' | 'SOURCE';
  ownerId: string;
  exactRevisionRef: string;
  entryKind: 'WORK';
  locatorRef: string;
  parentContextRef: string | null;
  title: string;
  search: EngineeringSearchText;
}

/** Builds only derived rows; callers persist them after a successful work CAS. */
export function buildWorkSearchProjection(input: {
  ownerKind: 'USER' | 'MATTER'; ownerId: string; exactRevisionRef: string;
  content: JobAidProblemWorkContent;
}): EngineeringSearchProjectionEntry[] {
  return input.content.issues.map((issue, index) => {
    const title = issue.issueKey || `issue-${index + 1}`;
    const text = [issue.question, ...issue.statements.map(statement => statement.text ?? ''),
      ...(issue.riskScenarios ?? []).map(item => `${item.scenario}\n${item.conditions.join(' ')}`),
      ...(issue.measures ?? []).map(item => `${item.text}\n${item.addresses}`)].filter(Boolean).join('\n');
    return { entryId: `${input.exactRevisionRef}:issue:${issue.issueKey || index + 1}`,
      ownerKind: input.ownerKind, ownerId: input.ownerId, exactRevisionRef: input.exactRevisionRef,
      entryKind: 'WORK', locatorRef: `issues[${index}]`, parentContextRef: null, title,
      search: buildEngineeringSearchText(text, [issue.issueKey || title]) };
  });
}

@Injectable()
export class EngineeringSearchProjectionWriter {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async indexJobAidRevision(input: { tenantId: string; ownerId: string; revisionRef: string; content: JobAidProblemWorkContent }) {
    const rows = buildWorkSearchProjection({ ownerKind: 'USER', ownerId: input.ownerId, exactRevisionRef: input.revisionRef, content: input.content });
    await this.db.transaction(async tx => {
      await tx.delete(engineeringSearchProjection).where(and(eq(engineeringSearchProjection.tenantId, input.tenantId), eq(engineeringSearchProjection.exactRevisionRef, input.revisionRef)));
      if (rows.length === 0) return;
      await tx.insert(engineeringSearchProjection).values(rows.map(row => ({
        entryId: row.entryId, tenantId: input.tenantId, ownerKind: row.ownerKind, ownerId: row.ownerId,
        exactRevisionRef: row.exactRevisionRef, entryKind: row.entryKind, locatorRef: row.locatorRef,
        parentContextRef: row.parentContextRef, title: row.title, identifiers: row.search.identifiers,
        originalOrWorkText: row.search.originalText, tokenizedText: row.search.tokenizedText, indexedVersion: 1,
      })));
    });
  }

  async indexMatterRevision(input: { tenantId: string; ownerId: string; revisionRef: string; content: JobAidProblemWorkContent }) {
    return this.indexJobAidRevision(input);
  }
}
