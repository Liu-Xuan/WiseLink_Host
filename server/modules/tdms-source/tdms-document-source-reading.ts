import type {
  TdmsDocumentSourceReadRequest,
  TdmsDocumentSourceReadResponse,
} from '@shared/tdms-source-reading.interface';
import type { TdmsFileServiceRecordReadResponse } from '@shared/tdms-file-service-import.interface';
import type { TdmsReadContext, TdmsReadReceipt } from '@shared/tdms-source.interface';
import { assertPublicActor, sameScope } from './tdms-source.authorization';
import { identifier, object, strict } from './tdms-source.validation';
import { sourceBodyReadingProjection } from './tdms-assessment-body-policy';
import {
  tdmsError,
  type TdmsDocumentAccess,
  type TdmsPublicActor,
  type TdmsRepository,
  type TdmsSourceAuthorization,
  type TdmsSourceGrant,
  type TdmsSourceScope,
  type TdmsStoredRevision,
} from './tdms-source.types';

interface DocumentSourceReadingDependencies {
  repository: TdmsRepository;
  authorization: TdmsSourceAuthorization;
  documents: TdmsDocumentAccess;
  assertGrant(grant: TdmsSourceGrant, scope?: TdmsSourceScope): void;
  recheck(grant: TdmsSourceGrant, context: TdmsReadContext): Promise<void>;
  receipt(ref: string, grant: TdmsSourceGrant, context: TdmsReadContext): TdmsReadReceipt;
  limitations: readonly string[];
}
interface AuthorizedSourceRow {
  stored: TdmsStoredRevision;
  grant: TdmsSourceGrant;
}

/** One bounded source query per currently authorized scope. No parsing/assessment dependency. */
export async function readDocumentVersionSources(
  actor: TdmsPublicActor,
  input: TdmsDocumentSourceReadRequest,
  dependencies: DocumentSourceReadingDependencies,
): Promise<TdmsDocumentSourceReadResponse> {
  assertPublicActor(actor);
  strict(object(input), ['documentVersionId', 'after', 'limit']);
  const documentVersionId: string = identifier(input.documentVersionId);
  const after: string | undefined = input.after === undefined ? undefined : identifier(input.after);
  const limit: number = input.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw tdmsError('TDMS_DOCUMENT_SOURCE_LIMIT_INVALID');
  const { repository, authorization, documents } = dependencies;
  if (!authorization.available)
    throw tdmsError('TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED', 503);
  const context: TdmsReadContext = { documentVersionId };
  await documents.assertRead(actor, documentVersionId);
  const catalogueGrants: TdmsSourceGrant[] = await authorization.catalogue(actor, context);
  if (!catalogueGrants.length) throw tdmsError('TDMS_SOURCE_NOT_FOUND', 404);
  const grants: TdmsSourceGrant[] = [];
  for (const catalogueGrant of catalogueGrants) {
    dependencies.assertGrant(catalogueGrant);
    const grant: TdmsSourceGrant = await authorization.authorize(
      actor, catalogueGrant.scope, 'READ_RECORD', context,
    );
    dependencies.assertGrant(grant, catalogueGrant.scope);
    const duplicate: TdmsSourceGrant | undefined = grants.find(
      (item: TdmsSourceGrant) => sameScope(item.scope, grant.scope),
    );
    if (duplicate) {
      if (duplicate.permissionRevision !== grant.permissionRevision)
        throw tdmsError('TDMS_SOURCE_PERMISSION_CHANGED', 409);
    } else grants.push(grant);
  }

  const result = await repository.transaction(async (tx) => {
    if (!tx.documentVersionCatalogue)
      throw tdmsError('TDMS_DOCUMENT_SOURCE_REPOSITORY_UNCONFIGURED', 503);
    const rows: AuthorizedSourceRow[] = [];
    for (const grant of grants) {
      await dependencies.recheck(grant, context);
      const page: TdmsStoredRevision[] = await tx.documentVersionCatalogue(grant.scope, {
        documentVersionId,
        ...(after ? { after } : {}),
        limit: limit + 1,
      });
      for (const stored of page) {
        if (!sameScope(stored.scope, grant.scope))
          throw tdmsError('TDMS_STORED_SCOPE_MISMATCH', 409);
        if (!stored.record.relatedDocumentVersionIds.includes(documentVersionId))
          throw tdmsError('TDMS_DOCUMENT_SOURCE_BINDING_MISMATCH', 409);
        if (!after || stored.record.sourceRevisionRef > after)
          rows.push({ stored, grant });
      }
      await dependencies.recheck(grant, context);
    }
    rows.sort((left: AuthorizedSourceRow, right: AuthorizedSourceRow) =>
      left.stored.record.sourceRevisionRef.localeCompare(right.stored.record.sourceRevisionRef),
    );
    const window: AuthorizedSourceRow[] = rows.slice(0, limit + 1);
    // The lookahead determines hasMore. It must meet the same current read authority.
    for (const row of window)
      for (const id of row.stored.record.relatedDocumentVersionIds)
        await documents.assertRead(actor, id);
    for (const grant of grants) await dependencies.recheck(grant, context);
    const records: TdmsFileServiceRecordReadResponse[] = [];
    for (const { stored, grant } of window.slice(0, limit)) {
      const receipt: TdmsReadReceipt = sourceRecordReadReceipt(
        stored.record,
        dependencies.receipt(stored.record.sourceRevisionRef, grant, context),
      );
      await tx.saveReceipt({
        scope: grant.scope,
        actorId: actor.canonicalSubject.id,
        receipt,
        context,
      });
      records.push(sourceRecordReadResponse(stored, receipt, dependencies.limitations));
    }
    for (const grant of grants) await dependencies.recheck(grant, context);
    return {
      window,
      response: {
        documentVersionId,
        sourceStatus: records.length ? 'AVAILABLE' as const : 'NO_BOUND_RECORDS' as const,
        records,
        hasMore: window.length > limit,
        nextAfter: window.length > limit ? window[limit - 1]!.stored.record.sourceRevisionRef : null,
      },
    };
  });
  // Fresh after commit/receipt waits; a prior successful read never acts as cached authority.
  await documents.assertRead(actor, documentVersionId);
  for (const { stored } of result.window)
    for (const id of stored.record.relatedDocumentVersionIds)
      await documents.assertRead(actor, id);
  for (const grant of grants) await dependencies.recheck(grant, context);
  return result.response;
}

export function sourceRecordReadReceipt(
  record: TdmsStoredRevision['record'],
  receipt: TdmsReadReceipt,
): TdmsReadReceipt {
  const projection = sourceBodyReadingProjection(record);
  return projection.bodyReadPolicy.kind === 'METADATA_ONLY'
    ? { ...receipt, fieldPaths: [
        'recordRef', 'sourceRevisionRef', 'sourceRecordId', 'recordKind', 'title',
        'fileType', 'state', 'authors', 'sourceVersion', 'businessVersion',
        'sourceModifiedAt', 'observedAt', 'capturedAt', 'relatedDocumentVersionIds',
      ] }
    : receipt;
}

export function sourceRecordReadResponse(
  stored: TdmsStoredRevision,
  receipt: TdmsReadReceipt,
  limitations: readonly string[],
): TdmsFileServiceRecordReadResponse {
  const projection = sourceBodyReadingProjection(stored.record);
  return {
    record: projection.record,
    bodyReadPolicy: projection.bodyReadPolicy,
    selectedFields: null,
    ...(projection.bodyReadPolicy.kind !== 'METADATA_ONLY' && stored.attachmentAcquisitions?.length
      ? {
          attachmentAcquisitions: stored.attachmentAcquisitions.map((fact) => ({
            ...fact,
            currentSourcePermissionChecked: true as const,
            semanticReadPerformed: false as const,
            engineeringExecutionVerified: false as const,
          })),
        }
      : {}),
    receipt,
    limitations: [...limitations, ...(projection.limitation ? [projection.limitation] : [])],
  };
}
