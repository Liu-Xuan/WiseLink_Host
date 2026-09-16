import { Injectable } from '@nestjs/common';
import type { DocumentRevisionReadingIdentity, DocumentRevisionReadingRequest } from '@shared/document-revision-reading.interface';
import type { DocumentSemanticReadingRequest, DocumentSemanticReadingResponse } from '@shared/document-semantic-map.interface';
import { UnifiedReaderService } from '../unified-reader/unified-reader.service';
import { DocumentParsingHostedService } from '../document-management/src/hosted/nest/document-parsing-hosted.service';
import { EngineeringMatterWorkingRepository } from './engineering-matter-working.repository';
import { DocumentSemanticService } from './document-semantic.service';
import { buildDocumentRevisionReading } from './document-revision-reading';

@Injectable()
// Registered by CanonicalHostModule.forRoot.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentRevisionReadingService {
  constructor(private readonly reader: UnifiedReaderService, private readonly semantics: DocumentSemanticService,
    private readonly actors: EngineeringMatterWorkingRepository, private readonly parsing: DocumentParsingHostedService) {}

  async read(input: DocumentRevisionReadingRequest, context: { tenantId: string; actorUserId: string; roles: string[] }) {
    return this.actors.withActorScope(context.actorUserId, () => this.readAuthorized(input, context));
  }

  /** The guarded browser request already carries its authenticated SQL/RLS identity. */
  async readForBrowser(input: DocumentRevisionReadingRequest, context: { tenantId: string; actorUserId: string; roles: string[] }) {
    return this.readAuthorized(input, context);
  }

  async readSemanticForBrowser(input: DocumentSemanticReadingRequest,
    context: { tenantId: string; actorUserId: string; roles: string[] }): Promise<DocumentSemanticReadingResponse> {
    if (![input.documentVersionId, input.parseRunId].every(value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(value)) ||
      (input.semanticRevision !== undefined && (!Number.isSafeInteger(input.semanticRevision) || input.semanticRevision < 1)))
      throw new Error('DOCUMENT_SEMANTIC_IDENTITY_INVALID');
    const loaded = await this.reader.readDocumentOriginal(input.documentVersionId, input.parseRunId, context);
    if (loaded.original.binding.documentVersionId !== input.documentVersionId || loaded.original.binding.parseRunId !== input.parseRunId)
      throw new Error('DOCUMENT_REVISION_BINDING_MISMATCH');
    const familyId = loaded.run.sourceBinding.familyId;
    if (!familyId) throw new Error('DOCUMENT_SEMANTIC_FAMILY_NOT_FOUND');
    const semanticMap = await this.semantics.read({ ...context, documentVersionId: input.documentVersionId }, loaded, input.semanticRevision);
    if (input.semanticRevision !== undefined && semanticMap?.semanticRevision !== input.semanticRevision)
      throw new Error('DOCUMENT_SEMANTIC_REVISION_NOT_FOUND');
    await this.parsing.status(input.documentVersionId, context);
    return { familyId, binding: loaded.original.binding, coverage: loaded.original.coverage, semanticMap };
  }

  private async readAuthorized(input: DocumentRevisionReadingRequest, context: { tenantId: string; actorUserId: string; roles: string[] }) {
    for (const identity of [input.before, input.after]) {
      if (![identity.documentVersionId, identity.parseRunId].every(value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(value)) ||
        !Number.isSafeInteger(identity.semanticRevision) || identity.semanticRevision < 1)
        throw new Error('DOCUMENT_REVISION_IDENTITY_INVALID');
    }
    if (typeof input.roleKey !== 'string' || !/^[A-Za-z0-9_.-]{1,120}$/.test(input.roleKey))
      throw new Error('DOCUMENT_REVISION_ROLE_INVALID');
    const load = async (identity: DocumentRevisionReadingIdentity) => {
      const loaded = await this.reader.readDocumentOriginal(identity.documentVersionId, identity.parseRunId, context);
      if (loaded.original.binding.documentVersionId !== identity.documentVersionId ||
        loaded.original.binding.parseRunId !== identity.parseRunId)
        throw new Error('DOCUMENT_REVISION_BINDING_MISMATCH');
      const map = await this.semantics.read({ ...context, documentVersionId: identity.documentVersionId }, loaded, identity.semanticRevision);
      if (!map || map.semanticRevision !== identity.semanticRevision) throw new Error('DOCUMENT_SEMANTIC_REVISION_NOT_FOUND');
      return { loaded, map };
    };
    const before = await load(input.before);
    const after = await load(input.after);
    const familyId = before.loaded.run.sourceBinding.familyId;
    if (!familyId || familyId !== after.loaded.run.sourceBinding.familyId)
      throw new Error('DOCUMENT_REVISION_SAME_FAMILY_REQUIRED');
    const result = buildDocumentRevisionReading(familyId, before.loaded.original, before.map,
      after.loaded.original, after.map, input.roleKey);
    // Both ACLs are checked again after artifact and semantic reads.
    await this.parsing.status(input.before.documentVersionId, context);
    await this.parsing.status(input.after.documentVersionId, context);
    return result;
  }
}
