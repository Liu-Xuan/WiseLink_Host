import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';
import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  LocalMineruWorkerClaimResult, LocalMineruWorkerIdentity, LocalMineruWorkerRenewResult,
  LocalMineruWorkerResult, LocalMineruWorkerSourceReady,
} from '@shared/local-mineru-worker.interface';
import { CANONICAL_SERVICE_SCOPE_AUTHORIZATION, type CanonicalServiceScopeAuthorizationPort,
  type CanonicalVerifiedAutoWorkItemQueueScope } from './canonical-service-scope.authorization';
import { EngineeringMatterWorkingRepository } from './engineering-matter-working.repository';
import { DocumentParsingRepository, documentParseError, documentLocalWorkerReceipt, type DocumentParseRow, type DocumentParseScope } from '../document-management/src/hosted/nest/document-parsing.repository';
import { DocumentParsingHostedService } from '../document-management/src/hosted/nest/document-parsing-hosted.service';
import { DocumentStepLeaseRepository, type DocumentStepFence } from '../document-management/src/hosted/nest/document-step-lease.repository';

/** Gateway authenticates transport; Host resolves actor and source from a durable delegated run. */
@Injectable()
// Registered in CanonicalHostModule.forRoot alongside the document runtime.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class LocalMineruWorkerService {
  private readonly logger = new Logger(LocalMineruWorkerService.name);
  constructor(
    @Inject(CANONICAL_SERVICE_SCOPE_AUTHORIZATION) private readonly authorization: CanonicalServiceScopeAuthorizationPort,
    private readonly actors: EngineeringMatterWorkingRepository,
    private readonly repository: DocumentParsingRepository,
    private readonly parsing: DocumentParsingHostedService,
    private readonly leases: DocumentStepLeaseRepository,
    private readonly workItems: MiaodaWorkItemRepository,
  ) {}

  async claim(input: unknown): Promise<LocalMineruWorkerClaimResult> {
    if (input !== undefined && (!isRecord(input) || Object.keys(input).length !== 0))
      throw documentParseError('LOCAL_MINERU_CLAIM_INPUT_INVALID', 400);
    const service = await this.serviceScope();
    const delegations = await this.workItems.listActiveLocalWorkerDelegations({ tenantId: service.tenantId, principalId: service.principalId, limit: 50 });
    for (const delegation of delegations) {
      try {
        const claimed = await this.actors.withActorScope(delegation.actorUserId, async () => {
          const scope = await this.delegatedScope(service, delegation.workItemId, delegation.actorUserId, delegation.documentVersionId);
          if (!scope) return null;
          const candidates = await this.repository.listLocalWorkerCandidates(service.tenantId, 50, scope);
          for (const row of candidates) {
            const loaded = await this.parsing.readLocalWorkerRun(row.parseRunId, scope);
            this.assertPrincipal(service, loaded.scope);
            const parser = loaded.run.sourceBinding.parserInput;
            if (parser?.mode !== 'LOCAL_MINERU_WORKER' || !parser.settings?.localMineruFallbackEnabled)
              throw documentParseError('LOCAL_MINERU_RUN_BINDING_INVALID');
            const fence = await this.leases.claim(loaded.scope, row.parseRunId, owner(service, loaded.scope.automaticWorkItem!), 120_000);
            if (!fence) continue;
            return {
              status: 'CLAIMED' as const, parseRunId: row.parseRunId, documentVersionId: row.documentVersionId,
              sourceSha256: loaded.run.sourceBinding.pdfSha256, sourceByteLength: loaded.run.sourceBinding.byteLength,
              settings: { ...parser.settings }, deadlineAt: loaded.run.deadlineAt.toISOString(),
              lease: { leaseOwner: fence.leaseOwner, leaseToken: fence.leaseToken, leaseGeneration: fence.leaseGeneration },
            };
          }
          return null;
        });
        if (claimed) return claimed;
      } catch (error) {
        const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : null;
        const automaticLeaseLost = error instanceof Error && error.message === 'DOCUMENT_AUTOMATIC_LEASE_REJECTED';
        if (status !== 403 && status !== 404 && !automaticLeaseLost) throw error;
        this.logger.warn(`Local MinerU skipped an inaccessible document delegation ${delegation.workItemId}.`);
      }
    }
    // A browser-admitted parse has its own actor request and no automatic WorkItem
    // lease. A completed grant is only a service-readable actor/source directory.
    let beforeWorkItemId: string | undefined;
    for (let page = 0; page < 100; page++) {
      const completed = await this.workItems.listCompletedLocalWorkerDiscovery({ tenantId: service.tenantId,
        beforeWorkItemId, limit: 50 });
      for (const discovery of completed) {
        try {
          const claimed = await this.actors.withActorScope(discovery.actorUserId, async () => {
            const verified = await this.workItems.loadCompletedLocalWorkerDiscovery({ tenantId: service.tenantId,
              workItemId: discovery.workItemId, actorUserId: discovery.actorUserId,
              documentVersionId: discovery.documentVersionId });
            if (!verified) return null;
            const scope = browserScope(service, verified);
            const candidates = await this.repository.listLocalWorkerCandidates(service.tenantId, 50, scope);
            for (const row of candidates) {
              if (!matchesBrowserRun(verified, row)) continue;
              const loaded = await this.parsing.readLocalWorkerRun(row.parseRunId, scope);
              if (!matchesBrowserRun(verified, loaded.run)) continue;
              this.assertPrincipal(service, loaded.scope);
              const fence = await this.leases.claim(loaded.scope, row.parseRunId,
                browserOwner(service, row.parseRunId), 120_000);
              if (!fence) continue;
              return { status: 'CLAIMED' as const, parseRunId: row.parseRunId,
                documentVersionId: row.documentVersionId, sourceSha256: loaded.run.sourceBinding.pdfSha256,
                sourceByteLength: loaded.run.sourceBinding.byteLength,
                settings: { ...loaded.run.sourceBinding.parserInput!.settings! },
                deadlineAt: loaded.run.deadlineAt.toISOString(),
                lease: { leaseOwner: fence.leaseOwner, leaseToken: fence.leaseToken,
                  leaseGeneration: fence.leaseGeneration } };
            }
            return null;
          });
          if (claimed) return claimed;
        } catch (error) {
          const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : null;
          if (status !== 403 && status !== 404) throw error;
          this.logger.warn(`Local MinerU skipped an inaccessible browser parse for ${discovery.documentVersionId}.`);
        }
      }
      if (completed.length < 50) break;
      beforeWorkItemId = completed.at(-1)!.workItemId;
      if (page === 99) throw documentParseError('LOCAL_MINERU_BROWSER_DISCOVERY_LIMIT', 503);
    }
    return { status: 'IDLE' };
  }

  async source(input: unknown): Promise<{ bytes: Uint8Array } | LocalMineruWorkerSourceReady> {
    return this.withRun(input, async (identity, loaded) => {
      const source = await this.parsing.readLocalWorkerOriginal(identity.parseRunId, loaded.scope, fenceOf(identity));
      if (source.candidateReady) {
        await this.release(loaded.scope, fenceOf(identity));
        return { status: 'CANDIDATE_READY', parseRunId: identity.parseRunId };
      }
      return { bytes: source.bytes };
    });
  }

  async renew(input: unknown): Promise<LocalMineruWorkerRenewResult> {
    return this.withRun(input, async (identity, loaded) => {
      if (!await this.leases.renew(loaded.scope, fenceOf(identity), 120_000))
        throw documentParseError('DOCUMENT_STEP_LEASE_REJECTED');
      return { status: 'RENEWED', deadlineAt: loaded.run.deadlineAt.toISOString() };
    });
  }

  /** Check the current fence or its committed receipt before accepting a binary upload. */
  async validateUpload(input: unknown): Promise<void> {
    await this.withRun(input, async (identity, loaded) => {
      const receipt = documentLocalWorkerReceipt(loaded.run);
      if (receipt && receipt.leaseOwner === identity.lease.leaseOwner &&
        receipt.leaseToken === identity.lease.leaseToken && receipt.leaseGeneration === identity.lease.leaseGeneration) return;
      await this.leases.check(loaded.scope, fenceOf(identity));
    });
  }

  async result(input: unknown, bytes: Uint8Array): Promise<LocalMineruWorkerResult> {
    if (bytes.length === 0 || bytes.length > 64 * 1024 * 1024)
      throw documentParseError('MINERU_CANDIDATE_TOO_LARGE', 413);
    return this.withRun(input, async (identity, loaded) => {
      const saved = await this.parsing.acceptLocalWorkerCandidate(identity.parseRunId, loaded.scope, fenceOf(identity), bytes);
      await this.release(loaded.scope, fenceOf(identity));
      return { status: saved.status === 'PUBLISHED' ? 'PUBLISHED' : 'ACCEPTED', parseRunId: identity.parseRunId,
        candidateSha256: createHash('sha256').update(bytes).digest('hex') };
    });
  }

  private async release(scope: DocumentParseScope, fence: DocumentStepFence): Promise<void> {
    try { await this.leases.release(scope, fence); }
    catch { this.logger.warn(`Local MinerU ${fence.parseRunId} lease release failed; saved acceptance is retained and the lease expires normally.`); }
  }

  private async withRun<T>(input: unknown, action: (
    identity: LocalMineruWorkerIdentity,
    loaded: Awaited<ReturnType<DocumentParsingHostedService['readLocalWorkerRun']>>,
  ) => Promise<T>): Promise<T> {
    const identity = localMineruWorkerIdentity(input);
    const service = await this.serviceScope();
    if (!identity.lease.leaseOwner.startsWith(`mineru:${service.principalId}:`)) throw documentParseError('DOCUMENT_STEP_LEASE_REJECTED');
    const delegations = await this.workItems.listActiveLocalWorkerDelegations({ tenantId: service.tenantId,
      principalId: service.principalId, documentVersionId: identity.documentVersionId, limit: 100 });
    for (const delegation of delegations) {
      const result = await this.actors.withActorScope(delegation.actorUserId, async () => {
        const scope = await this.delegatedScope(service, delegation.workItemId, delegation.actorUserId, identity.documentVersionId);
        if (!scope || identity.lease.leaseOwner !== owner(service, scope.automaticWorkItem)) return null;
        const row = await this.repository.readLocalWorkerById(service.tenantId, identity.parseRunId);
        if (!row || row.actorUserId !== scope.actorUserId || row.documentVersionId !== scope.documentVersionId ||
            row.sourceBinding.documentId !== scope.automaticWorkItem.documentId ||
            row.sourceBinding.sourceArtifactId !== scope.automaticWorkItem.sourceArtifactId ||
            row.sourceBinding.pdfSha256 !== scope.automaticWorkItem.sourceFileSha256 ||
            row.sourceBinding.byteLength !== scope.automaticWorkItem.sourceByteLength) return null;
        const loaded = await this.parsing.readLocalWorkerRun(row.parseRunId, scope);
        this.assertPrincipal(service, loaded.scope);
        return { value: await action(identity, loaded) };
      });
      if (result) return result.value;
    }
    if (identity.lease.leaseOwner === browserOwner(service, identity.parseRunId)) {
      let beforeWorkItemId: string | undefined;
      for (let page = 0; page < 100; page++) {
        const completed = await this.workItems.listCompletedLocalWorkerDiscovery({ tenantId: service.tenantId,
          documentVersionId: identity.documentVersionId, beforeWorkItemId, limit: 50 });
        for (const discovery of completed) {
          const result = await this.actors.withActorScope(discovery.actorUserId, async () => {
            const verified = await this.workItems.loadCompletedLocalWorkerDiscovery({ tenantId: service.tenantId,
              workItemId: discovery.workItemId, actorUserId: discovery.actorUserId,
              documentVersionId: discovery.documentVersionId });
            if (!verified) return null;
            const scope = browserScope(service, verified);
            const row = await this.repository.readLocalWorkerById(service.tenantId, identity.parseRunId);
            if (!row || !matchesBrowserRun(verified, row)) return null;
            const loaded = await this.parsing.readLocalWorkerRun(row.parseRunId, scope);
            if (!matchesBrowserRun(verified, loaded.run)) return null;
            this.assertPrincipal(service, loaded.scope);
            return { value: await action(identity, loaded) };
          });
          if (result) return result.value;
        }
        if (completed.length < 50) break;
        beforeWorkItemId = completed.at(-1)!.workItemId;
        if (page === 99) throw documentParseError('LOCAL_MINERU_BROWSER_DISCOVERY_LIMIT', 503);
      }
    }
    throw documentParseError('LOCAL_MINERU_RUN_NOT_FOUND', 404);
  }

  private async delegatedScope(service: CanonicalVerifiedAutoWorkItemQueueScope, workItemId: string, actorUserId: string, documentVersionId: string) {
    // The discovery table is service-readable; the WorkItem JOIN must run after
    // actor entry because its ordinary RLS is also actor-bound.
    const binding = await this.workItems.loadActiveAutoProcessingLease({ tenantId: service.tenantId,
      workItemId, leaseOwner: service.principalId, now: new Date() });
    const grant = binding?.authorization;
    if (!grant || grant.actorUserId !== actorUserId || grant.documentVersionId !== documentVersionId) return null;
    return { tenantId: service.tenantId, actorUserId, documentVersionId, roles: [] as string[], automaticWorkItem: {
      workItemId: grant.workItemId, requestId: grant.requestId, principalId: service.principalId, documentId: grant.documentId,
      sourceArtifactId: grant.sourceArtifactId, sourceFileSha256: grant.sourceFileSha256,
      sourceByteLength: Number(grant.sourceByteLength), leaseGeneration: grant.leaseGeneration,
    } };
  }

  private assertPrincipal(service: CanonicalVerifiedAutoWorkItemQueueScope, scope: DocumentParseScope): void {
    if (scope.tenantId !== service.tenantId ||
      (scope.automaticWorkItem && scope.automaticWorkItem.principalId !== service.principalId))
      throw documentParseError('LOCAL_MINERU_SERVICE_SCOPE_MISMATCH', 403);
  }

  private async serviceScope(): Promise<CanonicalVerifiedAutoWorkItemQueueScope> {
    await this.authorization.assertAutoWorkItemQueueTransport();
    const scope = await this.authorization.authorizeOpenClawAutoWorkItemQueue();
    if (scope.appId !== 'app_17bzc551rsg' || !scope.tenantId || !scope.authorizationFingerprint ||
      !/^[A-Za-z0-9:_-]{1,153}$/u.test(scope.principalId))
      throw documentParseError('LOCAL_MINERU_SERVICE_SCOPE_UNAVAILABLE', 503);
    return scope;
  }
}

function owner(scope: CanonicalVerifiedAutoWorkItemQueueScope, grant: NonNullable<DocumentParseScope['automaticWorkItem']>): string {
  const value = `mineru:${scope.principalId}:${grant.workItemId}:g${grant.leaseGeneration}`;
  if (!/^[A-Za-z0-9_-]{1,96}$/u.test(grant.workItemId) || !Number.isSafeInteger(grant.leaseGeneration) || grant.leaseGeneration < 1 ||
      !/^[A-Za-z0-9:_-]{1,160}$/u.test(value)) throw documentParseError('LOCAL_MINERU_LEASE_OWNER_INVALID', 503);
  return value;
}
type CompletedDiscovery = Awaited<ReturnType<MiaodaWorkItemRepository['listCompletedLocalWorkerDiscovery']>>[number];
function browserScope(service: CanonicalVerifiedAutoWorkItemQueueScope, discovery: CompletedDiscovery) {
  return { tenantId: service.tenantId, actorUserId: discovery.actorUserId,
    documentVersionId: discovery.documentVersionId, roles: [] as string[] };
}
function matchesBrowserRun(discovery: CompletedDiscovery, run: DocumentParseRow): boolean {
  const binding = run.sourceBinding;
  return !binding.automaticWorkItem && run.tenantId === discovery.tenantId &&
    run.actorUserId === discovery.actorUserId && run.documentVersionId === discovery.documentVersionId &&
    binding.documentVersionId === discovery.documentVersionId && binding.documentId === discovery.documentId &&
    binding.sourceArtifactId === discovery.sourceArtifactId && binding.pdfSha256 === discovery.sourceFileSha256 &&
    binding.byteLength === discovery.sourceByteLength && binding.parserInput?.mode === 'LOCAL_MINERU_WORKER' &&
    binding.parserInput.settings?.localMineruFallbackEnabled === true;
}
function browserOwner(service: CanonicalVerifiedAutoWorkItemQueueScope, parseRunId: string): string {
  const value = `mineru:${service.principalId}:${parseRunId}`;
  if (!/^PRUN-[A-Za-z0-9-]{1,90}$/u.test(parseRunId) || !/^[A-Za-z0-9:_-]{1,160}$/u.test(value))
    throw documentParseError('LOCAL_MINERU_LEASE_OWNER_INVALID', 503);
  return value;
}
function fenceOf(input: LocalMineruWorkerIdentity): DocumentStepFence { return { parseRunId: input.parseRunId, ...input.lease }; }
function isRecord(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input);
}
export function localMineruWorkerIdentity(input: unknown): LocalMineruWorkerIdentity {
  if (!isRecord(input) || Object.keys(input).sort().join(',') !== 'documentVersionId,lease,parseRunId' ||
    typeof input.parseRunId !== 'string' || !/^PRUN-[A-Za-z0-9-]{1,90}$/u.test(input.parseRunId) ||
    typeof input.documentVersionId !== 'string' || !/^[A-Za-z0-9_-]{1,96}$/u.test(input.documentVersionId) ||
    !isRecord(input.lease) || Object.keys(input.lease).sort().join(',') !== 'leaseGeneration,leaseOwner,leaseToken' ||
    typeof input.lease.leaseOwner !== 'string' || !/^[A-Za-z0-9:_-]{1,160}$/u.test(input.lease.leaseOwner) ||
    typeof input.lease.leaseToken !== 'string' || !/^[A-Za-z0-9-]{1,96}$/u.test(input.lease.leaseToken) ||
    !Number.isSafeInteger(input.lease.leaseGeneration) || Number(input.lease.leaseGeneration) < 1)
    throw documentParseError('LOCAL_MINERU_LEASE_INPUT_INVALID', 400);
  return input as unknown as LocalMineruWorkerIdentity;
}
