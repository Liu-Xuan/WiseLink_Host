import type postgres from 'postgres';
import type { LcmDatabaseScope } from '@shared/lcm-configuration-store.interface';
import { LcmStagingError } from './lcm-export.helpers';
import { requiredText } from './lcm-collection-context';

export function validateDatabaseScope(scope: LcmDatabaseScope): void {
  requiredText(scope.tenantId);
  requiredText(scope.actorId);
  if (
    !Array.isArray(scope.authorizedSourceInstanceIds) ||
    !scope.authorizedSourceInstanceIds.length ||
    scope.authorizedSourceInstanceIds.length > 200 ||
    new Set(scope.authorizedSourceInstanceIds).size !==
      scope.authorizedSourceInstanceIds.length
  )
    throw new LcmStagingError(
      'SOURCE_SCOPE_REQUIRED',
      'An exact authorized source scope is required.',
    );
  scope.authorizedSourceInstanceIds.forEach((source: string) =>
    requiredText(source),
  );
}

export async function setDatabaseActor(
  tx: postgres.TransactionSql,
  scope: LcmDatabaseScope,
): Promise<void> {
  await tx`SELECT set_config('app.lcm_tenant_id',${scope.tenantId},true),
    set_config('app.lcm_actor_id',${scope.actorId},true),
    set_config('app.lcm_source_ids',${JSON.stringify(scope.authorizedSourceInstanceIds)},true)`;
}
