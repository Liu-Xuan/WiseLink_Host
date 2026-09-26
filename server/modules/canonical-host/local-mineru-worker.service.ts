import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  LocalMineruWorkerClaimResult, LocalMineruWorkerIdentity, LocalMineruWorkerRenewResult,
  LocalMineruWorkerResult, LocalMineruWorkerSourceReady,
} from '@shared/local-mineru-worker.interface';
import { CANONICAL_SERVICE_SCOPE_AUTHORIZATION, type CanonicalServiceScopeAuthorizationPort,
  type CanonicalVerifiedAutoWorkItemQueueScope } from './canonical-service-scope.authorization';
import { EngineeringMatterWorkingRepository } from './engineering-matter-working.repository';
import { DocumentParsingRepository, documentParseError, documentLocalWorkerReceipt, type DocumentParseScope } from '../document-management/src/hosted/nest/document-parsing.repository';
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
  ) {}

  async claim(input: unknown): Promise<LocalMineruWorkerClaimResult> {
    if (input !== undefined && (!isRecord(input) || Object.keys(input).length !== 0))
      throw documentParseError('LOCAL_MINERU_CLAIM_INPUT_INVALID', 400);
    const service = await this.serviceScope();
    const candidates = await this.repository.listLocalWorkerCandidates(service.tenantId, 50);
    for (const row of candidates) {
      try {
        const claimed = await this.actors.withActorScope(row.actorUserId, async () => {
          const loaded = await this.parsing.readLocalWorkerRun(row.parseRunId, {
            tenantId: service.tenantId, actorUserId: row.actorUserId,
            documentVersionId: row.documentVersionId, roles: [],
          });
          this.assertPrincipal(service, loaded.scope);
          const parser = loaded.run.sourceBinding.parserInput;
          if (parser?.mode !== 'LOCAL_MINERU_WORKER' || !parser.settings?.localMineruFallbackEnabled)
            throw documentParseError('LOCAL_MINERU_RUN_BINDING_INVALID');
          const fence = await this.leases.claim(loaded.scope, row.parseRunId, owner(service), 120_000);
          if (!fence) return null;
          return {
            status: 'CLAIMED' as const, parseRunId: row.parseRunId, documentVersionId: row.documentVersionId,
            sourceSha256: loaded.run.sourceBinding.pdfSha256,
            sourceByteLength: loaded.run.sourceBinding.byteLength,
            settings: { ...parser.settings }, deadlineAt: loaded.run.deadlineAt.toISOString(),
            lease: { leaseOwner: fence.leaseOwner, leaseToken: fence.leaseToken, leaseGeneration: fence.leaseGeneration },
          };
        });
        if (claimed) return claimed;
      } catch (error) {
        const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : null;
        const automaticLeaseLost = error instanceof Error && error.message === 'DOCUMENT_AUTOMATIC_LEASE_REJECTED';
        if (status !== 403 && status !== 404 && !automaticLeaseLost) throw error;
        this.logger.warn(`Local MinerU skipped an inaccessible parse run ${row.parseRunId}.`);
      }
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
    if (identity.lease.leaseOwner !== owner(service)) throw documentParseError('DOCUMENT_STEP_LEASE_REJECTED');
    const row = await this.repository.readLocalWorkerById(service.tenantId, identity.parseRunId);
    if (!row || row.documentVersionId !== identity.documentVersionId)
      throw documentParseError('LOCAL_MINERU_RUN_NOT_FOUND', 404);
    return this.actors.withActorScope(row.actorUserId, async () => {
      const loaded = await this.parsing.readLocalWorkerRun(row.parseRunId, {
        tenantId: service.tenantId, actorUserId: row.actorUserId, documentVersionId: row.documentVersionId, roles: [],
      });
      this.assertPrincipal(service, loaded.scope);
      return action(identity, loaded);
    });
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

function owner(scope: CanonicalVerifiedAutoWorkItemQueueScope): string { return `mineru:${scope.principalId}`; }
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
