import { Inject, Injectable } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod/v4';
import type { DocumentReadingRequest, DocumentReadingResponse } from '@shared/document-reading.interface';
import { UnifiedReaderService } from '../unified-reader/unified-reader.service';
import { DocumentSemanticService } from './document-semantic.service';
import { EngineeringMatterWorkingRepository } from './engineering-matter-working.repository';
import { DocumentParsingHostedService } from '../document-management/src/hosted/nest/document-parsing-hosted.service';
import { documentOriginalReadingCoverage } from '../document-management/src/hosted/nest/document-original-adapter';
import { buildTranslationSourcePlan } from './canonical-translation-source-plan';
import { materializeDocumentReading, validateDocumentReading } from './document-reading-candidate';
import { DocumentReadingRunRepository, type DocumentReadingRun, type DocumentReadingScope } from './document-reading-run.repository';
import { CANONICAL_SERVICE_SCOPE_AUTHORIZATION, canonicalServiceScopeUnavailable,
  type CanonicalServiceScopeAuthorizationPort } from './canonical-service-scope.authorization';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,96}$/u);
const run = { documentVersionId: id, runRef: id };
const fenced = { ...run, leaseOwner: z.string().regex(/^[A-Za-z0-9:_-]{1,160}$/u),
  leaseToken: z.string().uuid(), leaseGeneration: z.number().int().positive() };
export const documentReadingActionSchemas = [
  z.strictObject({ action: z.literal('READING_BEGIN'), documentVersionId: id, parseRunId: id,
    semanticRevision: z.number().int().positive(), requestId: z.string().regex(/^[A-Za-z0-9:_-]{1,160}$/u),
    expectedRevision: z.number().int().nonnegative() }),
  z.strictObject({ action: z.literal('READING_STATUS'), ...run }),
  z.strictObject({ action: z.literal('READING_CANCEL'), ...run }),
  z.strictObject({ action: z.literal('READING_RETRACT'), ...run,
    expectedReadingRevision: z.number().int().positive(),
    requestId: z.string().regex(/^[A-Za-z0-9:_-]{1,160}$/u),
    reasonCode: z.string().regex(/^[A-Z0-9_:-]{1,160}$/u),
    reviewReference: z.string().trim().min(1).max(255) }),
  z.strictObject({ action: z.literal('READING_CLAIM'), ...run, leaseOwner: fenced.leaseOwner }),
  z.strictObject({ action: z.literal('READING_HEARTBEAT'), ...fenced }),
  z.strictObject({ action: z.literal('READING_READ'), ...fenced,
    offset: z.number().int().nonnegative(), limit: z.number().int().min(1).max(50) }),
  z.strictObject({ action: z.literal('READING_SAVE'), ...fenced, candidate: z.unknown(),
    producer: z.strictObject({ skillVersion: z.string().trim().min(1).max(160), modelVersion: z.string().trim().min(1).max(160) }) }),
  z.strictObject({ action: z.literal('READING_FAIL'), ...fenced, errorCode: z.string().regex(/^[A-Z0-9_:-]{1,160}$/u) }),
] as const;
const commandSchema = z.discriminatedUnion('action', documentReadingActionSchemas);
export type DocumentReadingCommand = z.infer<typeof commandSchema>;
type SourceContext = { tenantId: string; actorUserId: string; roles: string[] };

@Injectable()
// Registered by CanonicalHostModule.forRoot.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentReadingRuntimeService {
  constructor(@Inject(CANONICAL_SERVICE_SCOPE_AUTHORIZATION) private readonly authorization: CanonicalServiceScopeAuthorizationPort,
    private readonly actors: EngineeringMatterWorkingRepository, private readonly reader: UnifiedReaderService,
    private readonly semantics: DocumentSemanticService, private readonly parsing: DocumentParsingHostedService,
    private readonly runs: DocumentReadingRunRepository) {}

  /** Only explicitly admitted source requests are produced. This service does not invoke a model. */
  async run(raw: unknown) {
    const input = commandSchema.parse(raw);
    if (!this.authorization.authorizeDocumentWork) throw canonicalServiceScopeUnavailable();
    const auth = await this.authorization.authorizeDocumentWork({ documentVersionId: input.documentVersionId });
    if (auth.documentVersionId !== input.documentVersionId) throw new Error('DOCUMENT_READING_AUTHORIZATION_SCOPE_MISMATCH');
    const scope: DocumentReadingScope = { tenantId: auth.tenantId, actorUserId: auth.actorUserId, documentVersionId: auth.documentVersionId };
    const context = { ...scope, roles: [] as string[] };
    return this.actors.withActorScope(scope.actorUserId, async () => {
      if (input.action === 'READING_BEGIN') {
        const source = await this.load(scope.documentVersionId, input.parseRunId, input.semanticRevision, context);
        const row = await this.runs.begin(scope, { requestId: input.requestId, parseRunId: input.parseRunId,
          parseRevision: source.loaded.original.binding.parseRevision, semanticRevision: input.semanticRevision,
          manifestSha256: source.artifact.sha256, expectedRevision: input.expectedRevision });
        return summary(row);
      }
      // RLS/run ownership and fresh ordinary source ACL are both required. Control operations
      // stop here and manage lifecycle only, without taking original bytes,
      // semantic maps or source plans. Their success proves task control, not
      // that the original is still downloadable or byte-correct; a historical
      // run keeps the exact source/parse registration recorded at BEGIN.
      const row = await this.runs.readRun(scope, input.runRef);
      if (!row) throw new Error('DOCUMENT_READING_RUN_NOT_FOUND');
      if (input.action !== 'READING_READ' && input.action !== 'READING_SAVE') {
        await this.parsing.status(scope.documentVersionId, context);
      }
      if (input.action === 'READING_STATUS') {
        // A consumer with an uncertain checkpoint only polls STATUS and never
        // claims again. Reconcile the deadline here so it cannot stay RUNNING forever.
        await this.runs.expire(scope, input.runRef);
        const current = await this.runs.readRun(scope, input.runRef);
        if (!current) throw new Error('DOCUMENT_READING_RUN_NOT_FOUND');
        const retraction = await this.runs.readRetraction(scope, input.runRef);
        return summary(current, retraction);
      }
      if (input.action === 'READING_RETRACT') {
        await this.parsing.status(scope.documentVersionId, context);
        const retraction = await this.runs.retract(scope, input);
        return summary(row, retraction);
      }
      if (await this.runs.readRetraction(scope, input.runRef))
        throw new Error('DOCUMENT_READING_RETRACTED');
      if (input.action === 'READING_CANCEL') {
        await this.runs.cancel(scope, input.runRef);
        return summary((await this.runs.readRun(scope, input.runRef))!);
      }
      if (input.action === 'READING_CLAIM') {
        const fence = await this.runs.claim(scope, input.runRef, input.leaseOwner);
        return { ...summary((await this.runs.readRun(scope, input.runRef))!), fence };
      }
      if (input.action === 'READING_HEARTBEAT') {
        if (!await this.runs.renew(scope, input)) throw new Error('DOCUMENT_READING_LEASE_REJECTED');
        return { runRef: input.runRef, renewed: true };
      }
      if (input.action === 'READING_FAIL') {
        await this.runs.fail(scope, input, input.errorCode);
        return summary((await this.runs.readRun(scope, input.runRef))!);
      }
      // Only READING_READ and READING_SAVE reach here. Content health is proven
      // where bytes are actually consumed: reload the exact registered version
      // and re-check integrity before any delivery or save. This comparison is a
      // binding check on registered fields, not a byte verification.
      const source = await this.load(scope.documentVersionId, row.parseRunId, row.semanticRevision, context);
      if (source.artifact.sha256 !== row.manifestSha256 || source.loaded.original.binding.parseRevision !== row.parseRevision)
        throw new Error('DOCUMENT_READING_ORIGINAL_CHANGED');
      const plan = buildTranslationSourcePlan({ documentVersionId: scope.documentVersionId, packageId: row.parseRunId,
        parsedArtifact: { storeRole: 'UnifiedArtifactStoreCandidate', ref: `document-original://${encodeURIComponent(scope.documentVersionId)}/${encodeURIComponent(row.parseRunId)}`,
          sha256: source.artifact.sha256, byteLength: source.artifact.byteLength, mediaType: 'application/json' },
        title: '', source: source.loaded.structuredSource });
      const sourceCoverage = documentOriginalReadingCoverage(source.loaded.original);
      if (input.action === 'READING_READ') {
        const available = source.loaded.structuredSource.units;
        if (input.offset >= available.length && (input.offset !== 0 || available.length !== 0))
          throw new Error('DOCUMENT_READING_PAGE_INVALID');
        const units = available.slice(input.offset, input.offset + input.limit);
        const unitIds = units.map(unit => unit.unitId);
        const anchors = plan.anchors.filter(anchor => unitIds.includes(anchor.sourceUnitId));
        const range = { offset: input.offset, unitIds, anchorIds: anchors.map(anchor => anchor.anchorId),
          nextOffset: input.offset + units.length < available.length ? input.offset + units.length : null };
        await this.parsing.status(scope.documentVersionId, context);
        await this.runs.recordDelivery(scope, input, range);
        return { runRef: row.runRef, sourceBinding: { original: source.loaded.original.binding, semanticRevision: row.semanticRevision },
          units, anchors, range, sourceCoverage };
      }
      const command = { candidate: input.candidate, producer: input.producer };
      return this.runs.save(scope, input, command, (current, revision) => {
        const deliveredIds = new Set(current.deliveredRanges.flatMap(range => range.anchorIds));
        const candidate = validateDocumentReading(input.candidate, {
          sourceBinding: { original: source.loaded.original.binding, semanticRevision: current.semanticRevision },
          sourceUnitIds: source.loaded.structuredSource.units.map(unit => unit.unitId), delivered: current.deliveredRanges,
          deliveredAnchors: plan.anchors.filter(anchor => deliveredIds.has(anchor.anchorId)), sourceCoverage });
        return materializeDocumentReading(candidate, { readingRunRef: current.runRef, readingRevision: revision,
          producer: input.producer,
          savedAt: new Date().toISOString() });
      });
    });
  }

  /** Native browser identity is already set by its guarded request; no Hosted actor wrapper. */
  async readForBrowser(input: DocumentReadingRequest, context: SourceContext): Promise<DocumentReadingResponse> {
    id.parse(input.documentVersionId); id.parse(input.parseRunId);
    z.number().int().positive().parse(input.semanticRevision);
    if (input.readingRevision !== undefined) z.number().int().positive().parse(input.readingRevision);
    const identity = await this.parsing.inspectPublishedIdentity(input.documentVersionId, input.parseRunId, context);
    const ready = await this.semantics.readReady({ ...context, documentVersionId: input.documentVersionId }, input.parseRunId, input.semanticRevision);
    if (!ready || ready.semanticRevision !== input.semanticRevision) throw new Error('DOCUMENT_SEMANTIC_REVISION_NOT_FOUND');
    const state = await this.runs.readSavedState({ ...context, documentVersionId: input.documentVersionId }, input.parseRunId, input.semanticRevision, input.readingRevision);
    const result = state.reading;
    if (result) {
      if (!isDeepStrictEqual(result.sourceBinding.original, identity.binding) || result.sourceBinding.semanticRevision !== input.semanticRevision ||
        (input.readingRevision !== undefined && result.readingRevision !== input.readingRevision))
        throw new Error('DOCUMENT_READING_RESULT_BINDING_MISMATCH');
    }
    await this.parsing.status(input.documentVersionId, context);
    return { familyId: identity.familyId, sourceBinding: { original: identity.binding, semanticRevision: input.semanticRevision },
      status: state.status, reading: result };
  }

  private async load(documentVersionId: string, parseRunId: string, semanticRevision: number, context: SourceContext) {
    const loaded = await this.reader.readDocumentOriginal(documentVersionId, parseRunId, context);
    const artifact = loaded.run.manifestArtifact;
    if (loaded.original.binding.documentVersionId !== documentVersionId || loaded.original.binding.parseRunId !== parseRunId ||
      loaded.run.status !== 'PUBLISHED' || !artifact || artifact.relativePath !== 'original/manifest.json' || artifact.readback !== 'VERIFIED')
      throw new Error('DOCUMENT_READING_EXACT_ORIGINAL_REQUIRED');
    const map = await this.semantics.read({ ...context, documentVersionId }, loaded, semanticRevision);
    if (!map || map.semanticRevision !== semanticRevision) throw new Error('DOCUMENT_SEMANTIC_REVISION_NOT_FOUND');
    return { loaded, artifact, map };
  }
}

function summary(run: DocumentReadingRun, retraction: Awaited<ReturnType<DocumentReadingRunRepository['readRetraction']>> = null) {
  return { runRef: run.runRef, requestId: run.requestId, documentVersionId: run.documentVersionId,
    parseRunId: run.parseRunId, semanticRevision: run.semanticRevision,
    expectedRevision: run.expectedRevision, status: retraction ? 'RETRACTED' : run.status, deadline: run.deadline,
    readingRevision: run.readingRevision, result: retraction ? null : run.result,
    errorCode: run.errorCode, retraction };
}
