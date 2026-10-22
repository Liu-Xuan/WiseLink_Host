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

/** Reuse current Host document read policy; this port grants no TDMS source access. */
@Injectable()
// Bound by TdmsSourceModule.register(), not the default closed module.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class MiaodaTdmsDocumentAccess implements TdmsDocumentAccess {
  constructor(
    @Inject(DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER)
    private readonly documentAuthorization: DocumentManagementIngestAuthorizer,
  ) {}

  async assertRead(
    actor: TdmsPublicActor,
    documentVersionId: string,
  ): Promise<void> {
    assertPublicActor(actor);
    const exactDocumentVersionId: string = identifier(documentVersionId);
    await this.documentAuthorization.assertCanRead({
      actorUserId: actor.canonicalSubject.id,
      tenantId: actor.tenantId,
      roles: [...actor.platformRoles],
      action: 'DOCUMENT_READ',
      documentVersionId: exactDocumentVersionId,
    });
  }
}
