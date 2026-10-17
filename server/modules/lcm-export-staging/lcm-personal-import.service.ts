import type { CanonicalMiaodaFinalUserActorContext as Actor } from '../work-item/canonical-object-access.port';
import type {
  LcmExcelImportRequest,
  LcmExcelImportResponse,
  LcmUploadResolveResponse,
} from '@shared/lcm-personal-import.interface';
import type { LcmCollectionContext } from '@shared/lcm-export-staging.interface';
import type { LcmSourceReadGrant } from './lcm-source-reading.port';
import { assertPublicActor } from '../tdms-source/tdms-source.authorization';
import { LcmPersonalSourceRepository } from './lcm-personal-source.repository';
import { LcmNativeMatrixRepository } from './lcm-native-matrix.repository';
import type { LcmNativeMatrix } from '@shared/lcm-native-matrix.interface';
import {
  LcmFileOriginalStore,
  type LcmOriginalBytes,
} from './lcm-file-original.store';
import { canonicalJson, sha256, LcmStagingError } from './lcm-export.helpers';
import {
  collectionScope,
  parseCollectionContext,
} from './lcm-collection-context';
import { parseLcmPersonalExport } from './lcm-native-matrix.parser';
import { lcmReadingError } from './lcm-source-reading.port';
import { lcmOriginalReference } from './lcm-original-reference';

function request(value: unknown): LcmExcelImportRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw lcmReadingError('LCM_IMPORT_INPUT_INVALID', 400);
  const input: Record<string, unknown> = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key: string) =>
        !['requestId', 'aircraftModel', 'selection', 'context'].includes(key),
    ) ||
    typeof input.requestId !== 'string' ||
    !/^[a-zA-Z0-9:_-]{1,160}$/u.test(input.requestId) ||
    typeof input.aircraftModel !== 'string' ||
    !input.aircraftModel.trim() ||
    input.aircraftModel.length > 128 ||
    !input.selection ||
    typeof input.selection !== 'object' ||
    Array.isArray(input.selection)
  )
    throw lcmReadingError('LCM_IMPORT_INPUT_INVALID', 400);
  const selection: Record<string, unknown> = input.selection as Record<
    string,
    unknown
  >;
  const fields: string[] = ['bucketId', 'filePath', 'expectedProviderObjectId'];
  if (
    Object.keys(selection).some((key: string) => !fields.includes(key)) ||
    fields.some(
      (key: string) =>
        typeof selection[key] !== 'string' ||
        !String(selection[key]).trim() ||
        String(selection[key]).length > 1024,
    )
  )
    throw lcmReadingError('LCM_IMPORT_INPUT_INVALID', 400);
  return {
    requestId: input.requestId,
    aircraftModel: input.aircraftModel.trim(),
    selection: {
      bucketId: String(selection.bucketId),
      filePath: String(selection.filePath),
      expectedProviderObjectId: String(selection.expectedProviderObjectId),
    },
    ...(input.context === undefined
      ? {}
      : {
          context: parseCollectionContext(
            Buffer.from(JSON.stringify(input.context)),
          ),
        }),
  };
}

/** Manual uploads and future authorized exporters use this one parsing/persistence entry. */
export class LcmPersonalImportService {
  constructor(
    private readonly sources: LcmPersonalSourceRepository,
    private readonly originals: LcmFileOriginalStore,
  ) {}

  async resolveUpload(
    actor: Actor,
    value: unknown,
  ): Promise<LcmUploadResolveResponse> {
    assertPublicActor(actor);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw lcmReadingError('LCM_IMPORT_INPUT_INVALID', 400);
    const input = value as Record<string, unknown>;
    if (
      Object.keys(input).length !== 1 ||
      typeof input.filePath !== 'string' ||
      !input.filePath ||
      input.filePath.length > 1024
    )
      throw lcmReadingError('LCM_IMPORT_INPUT_INVALID', 400);
    await this.sources.assertCanImport(actor);
    const selection = await this.originals.resolveUpload(actor, input.filePath);
    await this.sources.assertCanImport(actor);
    return { selection };
  }

  async importExcel(
    actor: Actor,
    value: unknown,
  ): Promise<LcmExcelImportResponse> {
    try {
      return await this.importVerified(actor, value);
    } catch (error: unknown) {
      if (error instanceof LcmStagingError)
        throw lcmReadingError(
          error.code,
          error.code === 'SOURCE_ACCESS_DENIED'
            ? 403
            : error.code.includes('CONFLICT')
              ? 409
              : 400,
        );
      throw error;
    }
  }

  private async importVerified(
    actor: Actor,
    value: unknown,
  ): Promise<LcmExcelImportResponse> {
    assertPublicActor(actor);
    const input: LcmExcelImportRequest = request(value);
    await this.sources.assertCanImport(actor);
    const upload: LcmOriginalBytes = await this.originals.acquireUpload(
      actor,
      input.selection,
    );
    const parsed: LcmNativeMatrix = parseLcmPersonalExport(
      upload.bytes,
      input.aircraftModel,
    );
    const original: LcmOriginalBytes = await this.originals.retain(
      actor,
      upload,
    );
    const baseContext: LcmCollectionContext = input.context ?? {
      schemaVersion: 'wiselink.lcm.collection_context.v1',
      collectionId: 'manual-file',
      sourceOrigin: 'local-file',
      pageUrl: null,
      filters: { aircraftModel: input.aircraftModel, status: null },
      observedAt: null,
      sourceEvidence:
        'User Excel import; source observation/effectivity time not supplied.',
    };
    const identityContext = { ...baseContext, collectionId: undefined };
    const contentKey: string = sha256(
      canonicalJson({
        rawSha256: original.sha256,
        aircraftModel: input.aircraftModel,
        context: identityContext,
      }),
    );
    const context: LcmCollectionContext = {
      ...baseContext,
      collectionId: input.context?.collectionId ?? `file:${contentKey}`,
    };
    const payloadKey: string = sha256(canonicalJson({ contentKey, context }));
    const grant: LcmSourceReadGrant = await this.sources.register(
      actor,
      original.sha256,
    );
    const sourceInstanceId: string = grant.scope.authorizedSourceInstanceIds[0];
    await this.sources.admitRequest(
      actor,
      sourceInstanceId,
      input.requestId,
      payloadKey,
      upload,
    );
    const persistence = {
      scope: grant.scope,
      sourceInstanceId,
      requestId: `collection:${context.collectionId}`,
      context,
      originalFileName: original.reference.originalFileName,
      localSourcePath: `FileService:${original.reference.bucketId}/${original.reference.filePath}`,
      rawSha256: original.sha256,
      rawByteLength: original.byteLength,
      artifactRef: canonicalJson(original.reference),
      personalSourceAdmission: {
        applicationScopeId: actor.applicationScopeId,
        permissionRevision: grant.permissionRevision,
      },
    };
    const result = await new LcmNativeMatrixRepository(
      this.sources.sql,
    ).importSnapshot({ ...persistence, matrix: parsed });
    const after: LcmSourceReadGrant = await this.sources.authorize(actor);
    if (canonicalJson(grant) !== canonicalJson(after))
      throw lcmReadingError('LCM_SOURCE_PERMISSION_CHANGED', 409);
    await this.sources.completeRequest(
      actor,
      sourceInstanceId,
      input.requestId,
      payloadKey,
      result.snapshotId,
    );
    return {
      requestId: input.requestId,
      ...result,
      sourceInstanceId,
      scopeKey: collectionScope(parsed, context),
      sourceRowCount: parsed.rows.length,
      aircraftColumnCount: parsed.aircraft.length,
      stateCellCount: parsed.rows.length * parsed.aircraft.length,
      originalSha256: original.sha256,
      originalByteLength: original.byteLength,
      candidateOnly: true,
    };
  }

  async original(actor: Actor, snapshotId: string): Promise<LcmOriginalBytes> {
    if (!/^[a-f0-9]{64}$/u.test(snapshotId))
      throw lcmReadingError('LCM_SNAPSHOT_ID_INVALID', 400);
    const before: LcmSourceReadGrant = await this.sources.authorize(actor);
    const stored = await this.sources.original(actor, snapshotId);
    const reference = lcmOriginalReference(stored.artifactRef);
    if (!reference) throw lcmReadingError('LCM_ORIGINAL_REFERENCE_ONLY', 404);
    const original: LcmOriginalBytes = await this.originals.read(
      reference,
      stored.sha256,
      stored.byteLength,
    );
    const after: LcmSourceReadGrant = await this.sources.authorize(actor);
    if (canonicalJson(before) !== canonicalJson(after))
      throw lcmReadingError('LCM_SOURCE_PERMISSION_CHANGED', 409);
    return original;
  }
}
