import { Inject, Injectable } from '@nestjs/common';

import {
  DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER,
  type DocumentManagementIngestAuthorizer,
} from '../document-management/src/hosted/nest/document-management-hosted.tokens';
import { assertPublicActor } from './tdms-source.authorization';
import type {
  TdmsDocumentAccess,
  TdmsPublicActor,
} from './tdms-source.types';
import { identifier } from './tdms-source.validation';
import { currentDocumentSourceReadContext } from '../document-management/src/hosted/nest/document-source-read.port';
import { MiaodaHostedDocumentCatalog } from '../document-management/src/hosted/nest/miaoda-hosted-document-catalog';
import { tdmsError } from './tdms-source.types';

/** Reuse current Host document read policy; this port grants no TDMS source access. */
@Injectable()
// Bound by TdmsSourceModule.register(), not the default closed module.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class MiaodaTdmsDocumentAccess implements TdmsDocumentAccess {
  constructor(
    @Inject(DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER)
    private readonly documentAuthorization: DocumentManagementIngestAuthorizer,
    private readonly catalog: MiaodaHostedDocumentCatalog,
  ) {}

  async assertRead(
    actor: TdmsPublicActor,
    documentVersionId: string,
  ): Promise<void> {
    assertPublicActor(actor);
    const exactDocumentVersionId: string = identifier(documentVersionId);
    const sourceReadContext = currentDocumentSourceReadContext();
    await this.documentAuthorization.assertCanRead({
      actorUserId: actor.canonicalSubject.id,
      tenantId: actor.tenantId,
      roles: [...actor.platformRoles],
      action: 'DOCUMENT_READ',
      documentVersionId: exactDocumentVersionId,
      ...(sourceReadContext ? { sourceReadContext } : {}),
    });
  }

  async sourceBindings(actor: TdmsPublicActor, documentVersionId: string) {
    await this.assertRead(actor, documentVersionId);
    const provenance = await this.catalog.readDocumentSourceReadProvenance({
      tenantId: actor.tenantId,
      documentVersionId: identifier(documentVersionId),
    });
    if (!provenance) throw tdmsError('DOCUMENT_VERSION_NOT_FOUND', 404);
    await this.assertRead(actor, documentVersionId);
    return structuredClone(provenance.sourceBindings);
  }
}
