import { Injectable } from '@nestjs/common';
import { FileService } from '@lark-apaas/fullstack-nestjs-core';
import { MiaodaHostedDocumentCatalog } from '../document-management/src/hosted/nest/miaoda-hosted-document-catalog';
import { MiaodaTdmsArtifactStore } from './miaoda-tdms-artifact-store';
import { MiaodaTdmsSourceAuthorization } from './miaoda-tdms-source-authorization';
import { TdmsReceiverRepository } from './tdms-receiver.repository';
import { assertReceiverMembers } from './tdms-receiver-authorization.validation';
import {
  assertReceiverSelectionRevision,
  checkedReceiverSelection,
} from './tdms-receiver-selection.validation';
import { canonical } from './tdms-source.validation';
import { tdmsError, type TdmsArtifactStore } from './tdms-source.types';
import { assertTdmsReceiverScope } from './tdms-receiver-sql-context';

/** The unchanged daily wire resolves only a previously verified, actor-owned association. */
@Injectable()
export class MiaodaTdmsDailyArtifactStore extends MiaodaTdmsArtifactStore {
  constructor(
    files: FileService,
    catalog: MiaodaHostedDocumentCatalog,
    private readonly authorization: MiaodaTdmsSourceAuthorization,
    private readonly receivers: TdmsReceiverRepository,
  ) {
    super(files, catalog);
  }

  override async acquireSelection(
    input: Parameters<MiaodaTdmsArtifactStore['acquireSelection']>[0],
  ) {
    // Recheck the original request pin immediately around I/O without holding its SQL lock over the I/O.
    await assertTdmsReceiverScope(input.scope);
    const result = await super.acquireSelection(input);
    await assertTdmsReceiverScope(input.scope);
    return result;
  }

  async resolveDailySelection(
    input: Parameters<
      NonNullable<TdmsArtifactStore['resolveDailySelection']>
    >[0],
  ) {
    const { actor, scope, packageId, observation, payloadDigest } = input;
    await assertTdmsReceiverScope(scope);
    // Check independent scope rights before looking up the actor's current visible association.
    await this.authorization.current(actor, scope, 'IMPORT');
    await this.authorization.current(actor, scope, 'READ_RECORD');
    const stored = await this.receivers.selection(
      actor,
      scope,
      packageId,
      observation.bindingId,
    );
    if (!stored) {
      // No current visible association: it may be absent or member-RLS hidden.
      // Keep that distinction private; this is not proof of a missing upload.
      throw tdmsError('TDMS_UPLOAD_SELECTION_UNAVAILABLE', 404);
    }
    checkedReceiverSelection(
      stored,
      actor,
      scope,
      packageId,
      observation.bindingId,
    );
    if (
      stored.payloadDigest !== payloadDigest ||
      canonical(stored.observation) !== canonical(observation)
    )
      throw tdmsError('TDMS_UPLOAD_ASSOCIATION_PACKAGE_CONFLICT', 409);
    const recheck = async () => {
      const current = await this.authorization.current(actor, scope, 'IMPORT');
      assertReceiverSelectionRevision(stored, current);
      await this.authorization.authorizeImport(
        actor,
        scope,
        stored.memberClaims,
      );
      const read = await this.authorization.current(
        actor,
        scope,
        'READ_RECORD',
      );
      assertReceiverSelectionRevision(stored, read);
      assertReceiverMembers(
        stored.memberClaims,
        read.decision.permittedMembers,
      );
    };
    await recheck();
    // Reuses default bucket, current owner/object, before-after metadata and actual bytes.
    // This I/O runs outside the capture transaction; the caller rechecks Source before its CAS.
    await this.acquireSelection({
      scope,
      actor,
      packageId,
      artifact: stored.artifact,
    });
    await recheck();
    await assertTdmsReceiverScope(scope);
    return structuredClone(stored.artifact);
  }
}
