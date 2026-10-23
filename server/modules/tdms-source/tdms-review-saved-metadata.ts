import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';

/** A finite carrier/header lookup. Body/narrative never leaves SQL at admission. */
export async function tdmsReviewSavedMetadata(database:PostgresJsDatabase,input:{
  tenantId:string;workItemId:string;documentVersionId:string;actorUserId:string;workRevisionRef?:string;
}) {
  const [row]=await database.execute<{workRevisionRef:string;workRevision:number;nativeMetadata:unknown;roundCompletion:string}>(sql`SELECT assessment_work_revision_id AS "workRevisionRef",work_revision AS "workRevision",content_json::jsonb->>'roundCompletion' AS "roundCompletion",
      (SELECT coalesce(jsonb_agg(jsonb_build_object('kind','TDMS_NATIVE_RECORD',
        'evidenceRef',item->'evidenceRef','nativeReadReceipt',jsonb_build_object(
          'taskContextRef',item#>'{nativeReadReceipt,taskContextRef}',
          'receiptRef',item#>'{nativeReadReceipt,receiptRef}'),
        'nativeScope',jsonb_build_object('processingSetBinding',jsonb_build_object(
          'scope',jsonb_build_object('tenantId',item#>'{nativeScope,processingSetBinding,scope,tenantId}',
            'sourceKey',item#>'{nativeScope,processingSetBinding,scope,sourceKey}',
            'sourceInstanceId',item#>'{nativeScope,processingSetBinding,scope,sourceInstanceId}',
            'scopeId',item#>'{nativeScope,processingSetBinding,scope,scopeId}'),
          'setRevisionRef',item#>'{nativeScope,processingSetBinding,setRevisionRef}',
          'generation',item#>'{nativeScope,processingSetBinding,generation}',
          'processingFamilyRef',item#>'{nativeScope,processingSetBinding,processingFamilyRef}',
          'cohortRef',item#>'{nativeScope,processingSetBinding,cohortRef}',
          'processingObservationRef',item#>'{nativeScope,processingSetBinding,processingObservationRef}',
          'memberRef',item#>'{nativeScope,processingSetBinding,memberRef}',
          'assessmentObservationRef',item#>'{nativeScope,processingSetBinding,assessmentObservationRef}')))), '[]'::jsonb)
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(content_json::jsonb->'evidence')='array'
          THEN content_json::jsonb->'evidence' ELSE '[]'::jsonb END) AS item
        WHERE item->>'kind'='TDMS_NATIVE_RECORD') AS "nativeMetadata"
    FROM assessment_work_revision WHERE tenant_id=${input.tenantId} AND work_item_id=${input.workItemId}
      AND document_version_id=${input.documentVersionId} AND created_by_user_id=${input.actorUserId}
      ${input.workRevisionRef ? sql`AND assessment_work_revision_id=${input.workRevisionRef}` : sql``}
    ORDER BY work_revision DESC LIMIT 1 FOR SHARE`);
  return row;
}
