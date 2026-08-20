import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { HostedOpenClawDiscoveryResult } from '../assessment-workbench/external-discovery-assessment';
import { normalizeHostedOpenClawDiscoveryResult } from '../assessment-workbench/hosted-openclaw-discovery-normalizer';
import { mapHostedOpenClawDiscoveryResult } from '../document-management/src/hosted/openClawDiscoveryProviderMapping';
import { ExternalDiscoveryService } from '../external-discovery/external-discovery.service';
import {
  CANONICAL_AUTHORIZATION,
  CANONICAL_HOST_CLOCK,
  CANONICAL_PERMISSION_SNAPSHOT,
  CANONICAL_WORK_ITEM_REGISTRAR,
} from './canonical-host.constants';
import type {
  CanonicalHostClockPort,
  CanonicalAuthorizationPort,
  CanonicalPermissionSnapshotPort,
  CanonicalWorkItemRegistrarPort,
} from './canonical-host.types';
import {
  CANONICAL_SERVICE_SCOPE_AUTHORIZATION,
  type CanonicalServiceScopeAuthorizationPort,
} from './canonical-service-scope.authorization';

const OPENCLAW_SERVICE_USER_ID = 'service:openclaw-main';
const HOSTED_OPENCLAW_APP_ID = 'app_17c3zn24kv2';

export type PublicHostedDiscoveryResult = Omit<
  HostedOpenClawDiscoveryResult,
  'runtime' | 'runtimeAppId' | 'observedAt'
>;

@Injectable()
export class CanonicalHostOpenClawDiscoveryService {
  constructor(
    @Inject(CANONICAL_WORK_ITEM_REGISTRAR)
    private readonly registrar: CanonicalWorkItemRegistrarPort,
    @Inject(CANONICAL_HOST_CLOCK)
    private readonly clock: CanonicalHostClockPort,
    @Inject(CANONICAL_AUTHORIZATION)
    private readonly authorization: CanonicalAuthorizationPort,
    @Inject(CANONICAL_PERMISSION_SNAPSHOT)
    private readonly permissions: CanonicalPermissionSnapshotPort,
    private readonly discovery: ExternalDiscoveryService,
    @Inject(CANONICAL_SERVICE_SCOPE_AUTHORIZATION)
    private readonly serviceScope: CanonicalServiceScopeAuthorizationPort,
  ) {}

  async record(
    workItemId: string,
    publicResult: PublicHostedDiscoveryResult,
  ): Promise<Record<string, unknown>> {
    const scope = await this.serviceScope.authorizeOpenClawWorkItem({
      operation: 'RECORD_DISCOVERY',
      workItemId,
    });
    if (
      scope.workItemId !== workItemId ||
      scope.appId !== 'app_17bzc551rsg' ||
      !scope.principalId.trim() ||
      !scope.tenantId.trim() ||
      !scope.authorizationFingerprint.trim()
    ) {
      throw Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
        code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
        statusCode: 404,
      });
    }
    const workItem = await this.registrar.getTenantScopedByWorkItemId({
      workItemId,
      tenantId: scope.tenantId,
    });
    const actor = {
      userId: OPENCLAW_SERVICE_USER_ID,
      tenantId: scope.tenantId,
      appId: 'app_17bzc551rsg',
      roles: [] as string[],
      env: 'hosted',
    };
    const decision = await this.authorization.authorize({
      actor,
      action: 'RECORD_OEM_DISCOVERY_RUN',
      workItemId: workItem.workItemId,
      requestId: workItem.requestId,
      documentVersionId: workItem.source.documentVersionId,
    });
    if (!decision.allowed || decision.action !== 'RECORD_OEM_DISCOVERY_RUN') {
      throw new Error('CANONICAL_ACTION_NOT_AUTHORIZED');
    }
    const snapshot = await this.permissions.freshRead({
      actor,
      decision,
      workItemId: workItem.workItemId,
      requestId: workItem.requestId,
      documentVersionId: workItem.source.documentVersionId,
    });
    if (
      snapshot.permissionSnapshotVersion !== decision.permissionSnapshotVersion
    ) {
      throw new Error('OPENCLAW_DISCOVERY_PERMISSION_SNAPSHOT_CHANGED');
    }
    const observedAt = this.clock.nowIso();
    const normalized = normalizeHostedOpenClawDiscoveryResult({
      ...structuredClone(publicResult),
      runtime: 'FEISHU_HOSTED_OPENCLAW',
      runtimeAppId: HOSTED_OPENCLAW_APP_ID,
      observedAt,
    });
    const searchRunRef = `search:${normalized.provider.toLowerCase()}:${randomUUID()}`;
    const mapped = mapHostedOpenClawDiscoveryResult({
      providerResult: toDmProviderResult(normalized),
      searchRunRef,
      observedAt,
      sourceSystem: 'FEISHU_HOSTED_OPENCLAW',
    });
    const stored = (await this.discovery.recordSearchRun(mapped, {
      actorUserId: actor.userId,
      tenantId: scope.tenantId,
      roles: [],
    })) as { disposition?: string };
    return {
      searchRunRef,
      observedAt,
      provider: normalized.provider,
      resultStatus: mapped.resultStatus,
      candidateCount: mapped.candidates.length,
      disposition: stored.disposition ?? 'RECORDED',
      documentManagementIoPerformed: false,
      candidateAdopted: false,
    };
  }
}

function toDmProviderResult(
  value: HostedOpenClawDiscoveryResult,
): Record<string, unknown> {
  const resultStatus = {
    COMPLETE: 'CANDIDATES_FOUND',
    PARTIAL: 'PARTIAL_RESULTS',
    ZERO_RESULT: 'ZERO_RESULTS_FOR_TARGET_IDENTIFIER',
    ZERO_RESULTS_FOR_TARGET_IDENTIFIER: 'ZERO_RESULTS_FOR_TARGET_IDENTIFIER',
    ACCESS_DENIED: 'ACCESS_DENIED',
    TRUNCATED: 'TRUNCATED',
  }[value.resultStatus];
  return {
    provider: value.provider,
    query: value.query,
    resultStatus,
    accessRestricted:
      value.resultStatus === 'ACCESS_DENIED' || value.accessRestricted === true,
    truncated: value.resultStatus === 'TRUNCATED' || value.truncated === true,
    partialOnly: value.resultStatus === 'PARTIAL' || value.partialOnly === true,
    failureCode: value.error?.code ?? null,
    candidates: value.candidates.map((candidate) => ({
      publisher: value.provider,
      title: candidate.title,
      sourceUrl: candidate.sourceUrl,
      matchLevel: candidate.matchLevel,
    })),
  };
}
