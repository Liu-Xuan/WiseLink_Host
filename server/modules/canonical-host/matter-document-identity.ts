import { and, eq, inArray, sql } from 'drizzle-orm';
import { dmCurrentnessDecision, dmDocumentVersion, dmPublicationFamily } from '../../database/schema';
import { tenantFamilyIdentityPrefix } from '../document-management/src/hosted/nest/miaoda-hosted-document-catalog';
import type { EngineeringMatterWorkingDatabaseExecutor } from './engineering-matter-working.repository';

/** Supplement an already-authorized exact source read; catalog selection is not publisher currentness. */
export async function readMatterDocumentIdentities(
  database: EngineeringMatterWorkingDatabaseExecutor, tenantId: string, documentVersionIds: string[],
) {
  const ids = [...new Set(documentVersionIds)];
  if (!ids.length) return [];
  const prefix = tenantFamilyIdentityPrefix(tenantId);
  const rows = await database.select({
    documentVersionId: dmDocumentVersion.documentVersionId,
    familyId: dmDocumentVersion.familyId,
    documentNumber: dmPublicationFamily.canonicalDocumentNumber,
    issuer: dmPublicationFamily.issuerAuthority,
    businessRevision: dmDocumentVersion.businessRevision,
    revisionDate: dmDocumentVersion.revisionDate,
    sourceGeneratedDate: dmDocumentVersion.sourceGeneratedDate,
    canonicalRevisionIdentity: dmDocumentVersion.canonicalRevisionIdentity,
    lifecycleStatus: dmDocumentVersion.lifecycleStatus,
    catalogCurrentVersionId: dmPublicationFamily.currentDocumentVersionId,
    catalogGeneration: dmPublicationFamily.currentGeneration,
    decisionReason: dmCurrentnessDecision.reason,
    decidedAt: dmCurrentnessDecision.decidedAt,
  }).from(dmDocumentVersion)
    .innerJoin(dmPublicationFamily, eq(dmPublicationFamily.familyId, dmDocumentVersion.familyId))
    .leftJoin(dmCurrentnessDecision, and(
      eq(dmCurrentnessDecision.familyId, dmPublicationFamily.familyId),
      eq(dmCurrentnessDecision.nextGeneration, dmPublicationFamily.currentGeneration),
      eq(dmCurrentnessDecision.nextDocumentVersionId, dmPublicationFamily.currentDocumentVersionId),
    )).where(and(inArray(dmDocumentVersion.documentVersionId, ids),
      sql`starts_with(${dmPublicationFamily.canonicalIdentityKey}, ${prefix})`));
  const scoped = new Map(rows.map(row => [row.documentVersionId, row]));
  return ids.map(documentVersionId => {
    const row = scoped.get(documentVersionId);
    const limitation = '仅说明目录已登记版本与当前选择；未核实发布方最新有效状态。源生成日期、解析修订和工作版本不能替代厂家正式修订标签。';
    if (!row) return { documentVersionId, catalogStatus: 'NOT_AVAILABLE' as const, limitation };
    return { ...row, catalogStatus: 'REGISTERED' as const,
      businessRevision: row.businessRevision || null, revisionDate: row.revisionDate || null,
      sourceGeneratedDate: row.sourceGeneratedDate || null,
      decidedAt: row.decidedAt ? new Date(row.decidedAt).toISOString() : null, limitation };
  });
}
