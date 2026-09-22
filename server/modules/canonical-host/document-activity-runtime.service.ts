import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod/v4';
import type { DocumentActivityReadingRequest, DocumentActivityReadingResponse } from '@shared/document-activity.interface';
import { UnifiedReaderService } from '../unified-reader/unified-reader.service';
import { DocumentSemanticService } from './document-semantic.service';
import { EngineeringMatterWorkingRepository } from './engineering-matter-working.repository';
import { DocumentParsingHostedService } from '../document-management/src/hosted/nest/document-parsing-hosted.service';
import { selectDocumentSemanticSection } from '../document-management/src/hosted/nest/document-semantic-map';
import { documentOriginalReadingCoverage } from '../document-management/src/hosted/nest/document-original-adapter';
import { buildTranslationSourcePlan } from './canonical-translation-source-plan';
import { materializeDocumentActivityRevision, validateDocumentActivityCandidate } from './document-activity-candidate';
import { DocumentActivityRunRepository, type DocumentActivityRun, type DocumentActivityScope } from './document-activity-run.repository';
import { CANONICAL_SERVICE_SCOPE_AUTHORIZATION, canonicalServiceScopeUnavailable,
  type CanonicalServiceScopeAuthorizationPort } from './canonical-service-scope.authorization';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,96}$/u);
const run = { documentVersionId: id, runRef: id };
const fenced = { ...run, leaseOwner: z.string().regex(/^[A-Za-z0-9:_-]{1,160}$/u),
  leaseToken: z.string().uuid(), leaseGeneration: z.number().int().positive() };
export const documentActivityActionSchemas = [
  z.strictObject({ action: z.literal('ACTIVITY_BEGIN'), documentVersionId: id, parseRunId: id,
    semanticRevision: z.number().int().positive(), requestId: z.string().regex(/^[A-Za-z0-9:_-]{1,160}$/u),
    expectedRevision: z.number().int().nonnegative(), sectionIds: z.array(z.string().min(1).max(160)).min(1).max(100) }),
  z.strictObject({ action: z.literal('ACTIVITY_STATUS'), ...run }),
  z.strictObject({ action: z.literal('ACTIVITY_CANCEL'), ...run }),
  z.strictObject({ action: z.literal('ACTIVITY_CLAIM'), ...run, leaseOwner: fenced.leaseOwner }),
  z.strictObject({ action: z.literal('ACTIVITY_HEARTBEAT'), ...fenced }),
  z.strictObject({ action: z.literal('ACTIVITY_READ'), ...fenced, sectionId: z.string().min(1).max(160),
    offset: z.number().int().nonnegative(), limit: z.number().int().min(1).max(50) }),
  z.strictObject({ action: z.literal('ACTIVITY_SAVE'), ...fenced, candidate: z.unknown(),
    producer: z.strictObject({ skillVersion: z.string().trim().min(1).max(160), modelVersion: z.string().trim().min(1).max(160) }) }),
  z.strictObject({ action: z.literal('ACTIVITY_FAIL'), ...fenced, errorCode: z.string().regex(/^[A-Z0-9_:-]{1,160}$/u) }),
] as const;
const commandSchema = z.discriminatedUnion('action', documentActivityActionSchemas);
export type DocumentActivityCommand = z.infer<typeof commandSchema>;
type SourceContext = { tenantId: string; actorUserId: string; roles: string[] };

@Injectable()
// Registered by CanonicalHostModule.forRoot.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentActivityRuntimeService {
  constructor(@Inject(CANONICAL_SERVICE_SCOPE_AUTHORIZATION) private readonly authorization: CanonicalServiceScopeAuthorizationPort,
    private readonly actors: EngineeringMatterWorkingRepository, private readonly reader: UnifiedReaderService,
    private readonly semantics: DocumentSemanticService, private readonly parsing: DocumentParsingHostedService,
    private readonly runs: DocumentActivityRunRepository) {}

  /** Only explicitly admitted source requests are produced. This service does not invoke a model. */
  async run(raw: unknown) {
    const input = commandSchema.parse(raw);
    if (!this.authorization.authorizeDocumentWork) throw canonicalServiceScopeUnavailable();
    const auth = await this.authorization.authorizeDocumentWork({ documentVersionId: input.documentVersionId });
    if (auth.documentVersionId !== input.documentVersionId) throw new Error('DOCUMENT_ACTIVITY_AUTHORIZATION_SCOPE_MISMATCH');
    const scope: DocumentActivityScope = { tenantId: auth.tenantId, actorUserId: auth.actorUserId, documentVersionId: auth.documentVersionId };
    const context = { ...scope, roles: [] as string[] };
    return this.actors.withActorScope(scope.actorUserId, async () => {
      if (input.action === 'ACTIVITY_BEGIN') {
        if (new Set(input.sectionIds).size !== input.sectionIds.length) throw new Error('DOCUMENT_ACTIVITY_SELECTION_INVALID');
        const source = await this.load(scope.documentVersionId, input.parseRunId, input.semanticRevision, context);
        const selection = { sectionIds: [...input.sectionIds].sort() };
        for (const sectionId of selection.sectionIds) selectDocumentSemanticSection(source.loaded.original, source.map, sectionId);
        const row = await this.runs.begin(scope, { requestId: input.requestId, parseRunId: input.parseRunId,
          parseRevision: source.loaded.original.binding.parseRevision, semanticRevision: input.semanticRevision,
          manifestSha256: source.artifact.sha256, selection, expectedRevision: input.expectedRevision });
        return summary(row);
      }
      // RLS owns the run; control operations recheck ordinary source ACL/catalog
      // without downloading content or hydrating semantic maps.
      const row = await this.runs.readRun(scope, input.runRef);
      if (!row) throw new Error('DOCUMENT_ACTIVITY_RUN_NOT_FOUND');
      if (input.action !== 'ACTIVITY_READ' && input.action !== 'ACTIVITY_SAVE') {
        await this.parsing.status(scope.documentVersionId, context);
      }
      if (input.action === 'ACTIVITY_STATUS') {
        await this.runs.expire(scope, input.runRef);
        const current = await this.runs.readRun(scope, input.runRef);
        if (!current) throw new Error('DOCUMENT_ACTIVITY_RUN_NOT_FOUND');
        return summary(current);
      }
      if (input.action === 'ACTIVITY_CANCEL') {
        await this.runs.cancel(scope, input.runRef);
        return summary((await this.runs.readRun(scope, input.runRef))!);
      }
      if (input.action === 'ACTIVITY_CLAIM') {
        const fence = await this.runs.claim(scope, input.runRef, input.leaseOwner);
        return { ...summary((await this.runs.readRun(scope, input.runRef))!), fence };
      }
      if (input.action === 'ACTIVITY_HEARTBEAT') {
        if (!await this.runs.renew(scope, input)) throw new Error('DOCUMENT_ACTIVITY_LEASE_REJECTED');
        return { runRef: input.runRef, renewed: true };
      }
      if (input.action === 'ACTIVITY_FAIL') {
        await this.runs.fail(scope, input, input.errorCode);
        return summary((await this.runs.readRun(scope, input.runRef))!);
      }
      // READ/SAVE prove content integrity on the exact registered source.
      const source = await this.load(scope.documentVersionId, row.parseRunId, row.semanticRevision, context);
      if (source.artifact.sha256 !== row.manifestSha256 || source.loaded.original.binding.parseRevision !== row.parseRevision)
        throw new Error('DOCUMENT_ACTIVITY_ORIGINAL_CHANGED');
      const plan = buildTranslationSourcePlan({ documentVersionId: scope.documentVersionId, packageId: row.parseRunId,
        parsedArtifact: { storeRole: 'UnifiedArtifactStoreCandidate', ref: `document-original://${encodeURIComponent(scope.documentVersionId)}/${encodeURIComponent(row.parseRunId)}`,
          sha256: source.artifact.sha256, byteLength: source.artifact.byteLength, mediaType: 'application/json' },
        title: '', source: source.loaded.structuredSource });
      const sourceCoverage = documentOriginalReadingCoverage(source.loaded.original);
      if (input.action === 'ACTIVITY_READ') {
        if (!row.selection.sectionIds.includes(input.sectionId)) throw new Error('DOCUMENT_ACTIVITY_SELECTION_INVALID');
        const selection = selectDocumentSemanticSection(source.loaded.original, source.map, input.sectionId);
        const ids = new Set([...selection.unitIds, ...selection.contextUnitIds]);
        const available = source.loaded.structuredSource.units.filter(unit => ids.has(unit.unitId));
        if (input.offset >= available.length && (input.offset !== 0 || available.length !== 0))
          throw new Error('DOCUMENT_ACTIVITY_PAGE_INVALID');
        const units = available.slice(input.offset, input.offset + input.limit);
        const unitIds = units.map(unit => unit.unitId);
        const anchors = plan.anchors.filter(anchor => unitIds.includes(anchor.sourceUnitId));
        const range = { sectionId: input.sectionId, offset: input.offset, unitIds, anchorIds: anchors.map(anchor => anchor.anchorId),
          nextOffset: input.offset + units.length < available.length ? input.offset + units.length : null };
        await this.parsing.status(scope.documentVersionId, context);
        await this.runs.recordDelivery(scope, input, range);
        return { runRef: row.runRef, sourceBinding: { original: source.loaded.original.binding, semanticRevision: row.semanticRevision },
          selection, units, anchors, range, sourceCoverage };
      }
      const command = { candidate: input.candidate, producer: input.producer };
      return this.runs.save(scope, input, command, (current, revision) => {
        const deliveredIds = new Set(current.deliveredRanges.flatMap(range => range.anchorIds));
        const candidate = validateDocumentActivityCandidate(input.candidate, {
          sourceBinding: { original: source.loaded.original.binding, semanticRevision: current.semanticRevision },
          selection: current.selection, deliveredRanges: current.deliveredRanges,
          deliveredAnchors: plan.anchors.filter(anchor => deliveredIds.has(anchor.anchorId)), sourceCoverage });
        return materializeDocumentActivityRevision(candidate, { runRef: current.runRef, candidateRevision: revision,
          statementIds: candidate.statements.map(() => `DAS-${randomUUID()}`), producer: input.producer,
          savedAt: new Date().toISOString() });
      });
    });
  }

  /** Native browser identity is already set by its guarded request; no Hosted actor wrapper. */
  async readForBrowser(input: DocumentActivityReadingRequest, context: SourceContext): Promise<DocumentActivityReadingResponse> {
    id.parse(input.documentVersionId); id.parse(input.parseRunId);
    if (input.candidateRevision !== undefined) z.number().int().positive().parse(input.candidateRevision);
    const identity = await this.parsing.inspectPublishedIdentity(input.documentVersionId, input.parseRunId, context);
    const result = await this.runs.readSaved({ ...context, documentVersionId: input.documentVersionId }, input.parseRunId, input.candidateRevision);
    if (result) {
      if (!isDeepStrictEqual(result.sourceBinding.original, identity.binding) ||
        (input.candidateRevision !== undefined && result.candidateRevision !== input.candidateRevision))
        throw new Error('DOCUMENT_ACTIVITY_RESULT_BINDING_MISMATCH');
      const ready = await this.semantics.readReady({ ...context, documentVersionId: input.documentVersionId }, input.parseRunId, result.sourceBinding.semanticRevision);
      if (!ready || ready.semanticRevision !== result.sourceBinding.semanticRevision) throw new Error('DOCUMENT_SEMANTIC_REVISION_NOT_FOUND');
    }
    await this.parsing.status(input.documentVersionId, context);
    return { familyId: identity.familyId, binding: identity.binding, candidate: result };
  }

  private async load(documentVersionId: string, parseRunId: string, semanticRevision: number, context: SourceContext) {
    const loaded = await this.reader.readDocumentOriginal(documentVersionId, parseRunId, context);
    const artifact = loaded.run.manifestArtifact;
    if (loaded.original.binding.documentVersionId !== documentVersionId || loaded.original.binding.parseRunId !== parseRunId ||
      loaded.run.status !== 'PUBLISHED' || !artifact || artifact.relativePath !== 'original/manifest.json' || artifact.readback !== 'VERIFIED')
      throw new Error('DOCUMENT_ACTIVITY_EXACT_ORIGINAL_REQUIRED');
    const map = await this.semantics.read({ ...context, documentVersionId }, loaded, semanticRevision);
    if (!map || map.semanticRevision !== semanticRevision) throw new Error('DOCUMENT_SEMANTIC_REVISION_NOT_FOUND');
    return { loaded, artifact, map };
  }
}

function summary(run: DocumentActivityRun) {
  return { runRef: run.runRef, requestId: run.requestId, documentVersionId: run.documentVersionId,
    parseRunId: run.parseRunId, semanticRevision: run.semanticRevision, selection: run.selection,
    expectedRevision: run.expectedRevision, status: run.status, deadline: run.deadline,
    candidateRevision: run.candidateRevision, result: run.result, errorCode: run.errorCode };
}
