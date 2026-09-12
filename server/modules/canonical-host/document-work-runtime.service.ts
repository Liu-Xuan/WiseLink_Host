import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DocumentSourceProjectionService } from './document-source-projection.service';
import { UnifiedReaderService } from '../unified-reader/unified-reader.service';
import { DocumentParsingHostedService } from '../document-management/src/hosted/nest/document-parsing-hosted.service';
import { DocumentStepLeaseRepository } from '../document-management/src/hosted/nest/document-step-lease.repository';
import { EngineeringMatterWorkingRepository } from './engineering-matter-working.repository';
import { CANONICAL_SERVICE_SCOPE_AUTHORIZATION, canonicalServiceScopeUnavailable,
  type CanonicalServiceScopeAuthorizationPort } from './canonical-service-scope.authorization';

@Injectable()
// CanonicalHostModule.forRoot dynamic registration.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentWorkRuntimeService {
  constructor(
    @Inject(CANONICAL_SERVICE_SCOPE_AUTHORIZATION) private readonly authorization: CanonicalServiceScopeAuthorizationPort,
    private readonly actors: EngineeringMatterWorkingRepository,
    private readonly parsing: DocumentParsingHostedService,
    private readonly leases: DocumentStepLeaseRepository,
    private readonly reader: UnifiedReaderService,
    private readonly sourceProjection: DocumentSourceProjectionService,
  ) {}

  /** Bounded engineering input from one published original, never translation. */
  async readOriginal(input: { documentVersionId: string; parseRunId: string; offset?: number; limit?: number }) {
    if (!this.authorization.authorizeDocumentWork) throw canonicalServiceScopeUnavailable();
    const authorized = await this.authorization.authorizeDocumentWork({ documentVersionId: input.documentVersionId });
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 20;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      throw new Error('DOCUMENT_ORIGINAL_PAGE_INVALID');
    const scope = { tenantId: authorized.tenantId, actorUserId: authorized.actorUserId,
      documentVersionId: authorized.documentVersionId, roles: [] as string[] };
    return this.actors.withActorScope(scope.actorUserId, async () => {
      const loaded = await this.reader.readDocumentOriginal(scope.documentVersionId, input.parseRunId, scope);
      const { original, structuredSource, run } = loaded;
      if (run.parseRunId !== input.parseRunId || original.binding.parseRunId !== input.parseRunId ||
          original.binding.documentVersionId !== scope.documentVersionId || !run.manifestArtifact ||
          run.manifestArtifact.relativePath !== 'original/manifest.json' || run.manifestArtifact.readback !== 'VERIFIED')
        throw new Error('DOCUMENT_ORIGINAL_EXACT_BINDING_MISMATCH');
      const units = structuredSource.units.slice(offset, offset + limit);
      // Keep unit-specific table/selector payloads intact; never truncate text.
      const refs = new Set<string>();
      const collectRefs = (value: unknown): void => {
        if (Array.isArray(value)) { value.forEach(collectRefs); return; }
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
          if (key === 'sourceRefIds' && Array.isArray(child)) {
            for (const ref of child) if (typeof ref === 'string') refs.add(ref);
          } else collectRefs(child);
        }
      };
      units.forEach(collectRefs);
      return { binding: original.binding,
        artifact: { ref: `document-original://${encodeURIComponent(scope.documentVersionId)}/${encodeURIComponent(run.parseRunId)}`,
          sha256: run.manifestArtifact.sha256, byteLength: run.manifestArtifact.byteLength,
          mediaType: run.manifestArtifact.mediaType },
        units, sourceLocators: structuredSource.sourceLocators.filter(locator => refs.has(locator.sourceRefId)),
        locations: original.locations.filter(location => refs.has(location.sourceRefId)),
        coverage: original.coverage, findings: structuredSource.findings, producer: original.producer,
        totalUnits: structuredSource.units.length,
        nextOffset: offset + units.length < structuredSource.units.length ? offset + units.length : null };
    });
  }

  async run(input: { action: 'STATUS' | 'STEP' | 'CANCEL' | 'INDEX'; documentVersionId: string; parseRunId?: string }) {
    if (!this.authorization.authorizeDocumentWork) throw canonicalServiceScopeUnavailable();
    const authorized = await this.authorization.authorizeDocumentWork({ documentVersionId: input.documentVersionId });
    const scope = { tenantId: authorized.tenantId, actorUserId: authorized.actorUserId,
      documentVersionId: authorized.documentVersionId, roles: [] as string[] };
    return this.actors.withActorScope(scope.actorUserId, async () => {
      // Re-read normal source permission for every operation, including cancel.
      const state = await this.parsing.status(scope.documentVersionId, scope);
      if (input.action === 'STATUS') return { ...state,
        nextSourceProjectionRunId: state.latestRun?.status === 'PUBLISHED' ? await this.sourceProjection.nextPendingRun(scope) : null };
      if (input.action === 'INDEX') {
        if (!input.parseRunId) throw new Error('DOCUMENT_ORIGINAL_RUN_REQUIRED');
        return this.sourceProjection.step(scope, input.parseRunId);
      }
      const run = state.latestRun;
      if (!run || run.parseRunId !== input.parseRunId) throw Object.assign(new Error('DOCUMENT_WORK_RUN_NOT_FOUND'), { statusCode: 404 });
      if (input.action === 'CANCEL') {
        await this.leases.cancel(scope, run.parseRunId);
        return this.parsing.status(scope.documentVersionId, scope);
      }
      if (!['RUNNING', 'STAGING'].includes(run.status)) return { status: run.status, parseRunId: run.parseRunId };
      const fence = await this.leases.claim(scope, run.parseRunId, `document:${randomUUID()}`, 120_000);
      if (!fence) return { status: 'BUSY', parseRunId: run.parseRunId };
      let renewal: Promise<void> = Promise.resolve();
      let renewalFailed = false;
      const timer = setInterval(() => {
        renewal = renewal.then(async () => {
          if (!await this.leases.renew(scope, fence)) renewalFailed = true;
        }).catch(() => { renewalFailed = true; });
      }, 30_000);
      try {
        // The plugin execution is awaited. No database transaction spans the
        // external call; P locks and checks this fence in each persistence step.
        const result = await this.parsing.executeStep(run.parseRunId, scope, fence);
        if (renewalFailed && result.status !== 'PUBLISHED') throw new Error('DOCUMENT_STEP_RENEWAL_FAILED');
        return result;
      } finally {
        clearInterval(timer);
        await renewal;
        await this.leases.release(scope, fence);
      }
    });
  }
}
