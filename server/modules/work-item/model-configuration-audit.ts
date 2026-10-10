import { sql, type SQL } from 'drizzle-orm';
import { workItem } from '../../database/schema';
/** Control audit survives an engineering writer prepared before a model application. */
export function preserveWorkItemModelConfigurationAudit(next: unknown): SQL {
  return sql`(${JSON.stringify(next)}::jsonb || CASE WHEN ${workItem.projectionJson}::jsonb ? 'modelConfigurationApplications' THEN jsonb_build_object('modelConfigurationApplications', ${workItem.projectionJson}::jsonb->'modelConfigurationApplications') ELSE '{}'::jsonb END)::text`;
}
