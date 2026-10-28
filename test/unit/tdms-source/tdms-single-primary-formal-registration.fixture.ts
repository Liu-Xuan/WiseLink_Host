import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { PgDialect } from 'drizzle-orm/pg-core';
import { dmDocumentVersion } from '@server/database/schema';
import { MiaodaHostedDocumentCatalog } from '../../../server/modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog';
import { SessionResolver } from '../../../server/modules/identity/session-resolver.service';
import type { VerifiedIdentity } from '../../../server/modules/identity/identity.types';
import { TdmsDocumentSourceReadAdapter } from '../../../server/modules/tdms-source/tdms-document-source-read.adapter';
import { TdmsDailyMetadataController } from '../../../server/modules/tdms-source/tdms-daily-metadata.controller';
import { DocumentManagementHostedService } from '../../../server/modules/document-management/src/hosted/nest/document-management-hosted.service';
import { OrdinaryDocumentManagementAuthorizer } from '../../../server/modules/document-management-runtime/ordinary-document-management-authorizer';
import { assertDocumentUploadAuthorityCurrent } from '../../../server/modules/document-management/src/hosted/nest/document-upload-authority';
import { TdmsFormalDocumentRegistrationService } from '../../../server/modules/tdms-source/tdms-formal-document-registration.service';
import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import type { TdmsReceiverRepository } from '../../../server/modules/tdms-source/tdms-receiver.repository';
import type { MiaodaTdmsSourceAuthorization } from '../../../server/modules/tdms-source/miaoda-tdms-source-authorization';
import type {
  TdmsArtifactStore,
  TdmsSourceAuthorization,
} from '../../../server/modules/tdms-source/tdms-source.types';
import { adaptTdmsDailySource } from '../../../server/modules/tdms-source/tdms-daily-source-adapter';
import {
  canonical,
  hash,
  object,
} from '../../../server/modules/tdms-source/tdms-source.validation';
import { legacyOriginalServices, syntheticFormalOriginal } from './tdms-receiver-legacy-original.fixture';
import { actor } from './tdms-fixtures';

type Row = Record<string, unknown>;
export const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export const committedAt = '2026-10-18T15:00:00.000Z';


/** Deliberate persistence port: IDs/commands come from real DM Core; no PG/RLS claim. */
class MemoryCatalog {
  artifacts = new Map<string, Row>();
  acquisitions = new Map<string, Row>();
  preflights = new Map<string, Row>();
  versions = new Map<string, Row>();
  families = new Map<string, Row>();
  commits = 0;
  beforeCommit?: () => void;
  lookupFailure?: Error;
  missingCommittedAt = false;
  async readSourceArtifactByContent(input: {
    sha256: string;
    byteLength: number;
  }) {
    return copy(
      [...this.artifacts.values()].find(
        (row) =>
          row.sha256 === input.sha256 && row.byteLength === input.byteLength,
      ) ?? null,
    );
  }
  async recordAcquisition(value: unknown) {
    const input = object(value),
      artifact = object(input.sourceArtifact),
      acquisition = object(input.acquisition);
    this.artifacts.set(String(artifact.sourceArtifactId), copy(artifact));
    const key = String(acquisition.idempotencyKey);
    const stored = this.acquisitions.get(key);
    if (stored) return copy(stored);
    const row = {
      ...copy(acquisition),
      documentVersionId: null,
      status: 'ACQUIRED_READBACK_VERIFIED',
    };
    this.acquisitions.set(key, row);
    return copy(row);
  }
  async findIngestionByIdempotency(value: unknown) {
    if (this.lookupFailure) throw this.lookupFailure;
    const input = object(value),
      row = this.acquisitions.get(String(input.idempotencyKey));
    if (!row) return null;
    const selection = object(input.selection);
    if (
      row.sourceChannel !== input.sourceChannel ||
      row.sourceRef !== input.sourceRef ||
      row.selectionBucketId !== selection.bucketId ||
      row.selectionFilePath !== selection.filePath
    )
      throw Object.assign(new Error('ACQUISITION_IDEMPOTENCY_CONFLICT'), {
        code: 'ACQUISITION_IDEMPOTENCY_CONFLICT',
      });
    if (!row.documentVersionId)
      return { status: 'INCOMPLETE', acquisitionId: row.acquisitionId };
    const version = this.versions.get(String(row.documentVersionId))!;
    const family = this.families.get(String(version.familyId))!;
    const source = this.artifacts.get(String(row.sourceArtifactId))!;
    const preflight = [...this.preflights.values()].find(
      (p) => p.acquisitionId === row.acquisitionId,
    )!;
    const descriptor = object(row.sourceDescriptor);
    return copy({
      status: 'COMMITTED',
      ...version,
      acquisitionId: row.acquisitionId,
      preflightId: preflight.preflightId,
      decision: preflight.decision,
      identityReadback: {
        documentNumber: family.canonicalDocumentNumber,
        documentFamily: family.documentFamily,
        issuerAuthority: family.issuerAuthority,
        businessRevision: version.businessRevision,
        revisionDate: version.revisionDate,
        sourceGeneratedDate: version.sourceGeneratedDate,
        pageCount: descriptor.pageCount,
      },
      sha256: source.sha256,
      byteLength: source.byteLength,
      selectionBucketId: row.selectionBucketId,
      selectionFilePath: row.selectionFilePath,
      selectedProviderObjectId: row.providerObjectId,
      selectedProviderVersionId: row.providerVersionId,
      tdmsRegistration: descriptor.tdmsRegistration,
      committedAt: this.missingCommittedAt ? null : committedAt,
      immutableReadbackVerified: true,
      catalogFreshReadVerified: true,
    });
  }
  async assertImmutableSourceReuseSafe() {
    return { disposition: 'INDEPENDENT_TDMS_CANDIDATE_REUSE_ALLOWED' };
  }
  async assertIncompleteIngestionRecoverySafe(value: unknown) {
    const input = object(value);
    return {
      disposition: 'INCOMPLETE_INGESTION_RECOVERY_ALLOWED',
      acquisition: input.acquisition,
    };
  }
  async listIngressDocuments() {
    return [];
  }
  async observeFamily(key: string) {
    return copy(
      [...this.families.values()].find((f) => f.canonicalIdentityKey === key) ??
        null,
    );
  }
  async recordPreflight(value: unknown) {
    const input = object(value);
    this.preflights.set(String(input.preflightId), copy(input));
    return copy(input);
  }
  async findExactDocumentVersion() {
    return null;
  }
  async readDocumentVersion(id: string) {
    return copy(this.versions.get(id) ?? null);
  }
  async readFamily(id: string) {
    return copy(this.families.get(id) ?? null);
  }
  async commitNewVersion(value: unknown) {
    const input = object(value),
      upload = object(input.uploadCommit);
    const scope = {
      actorUserId: String(upload.actorUserId),
      tenantId: String(upload.tenantId),
    };
    this.beforeCommit?.();
    await assertDocumentUploadAuthorityCurrent(upload.authority, scope);
    const version = object(input.documentVersion),
      family = object(input.family);
    const storedFamily = {
      ...copy(family),
      currentGeneration: 1,
      currentDocumentVersionId: version.documentVersionId,
    };
    this.families.set(String(family.familyId), storedFamily);
    this.versions.set(String(version.documentVersionId), {
      ...copy(version),
      lifecycleStatus: 'COMMITTED_IMMUTABLE',
    });
    const acquisition = [...this.acquisitions.values()].find(
      (a) => a.acquisitionId === version.acquisitionId,
    )!;
    acquisition.documentVersionId = version.documentVersionId;
    acquisition.status = 'COMMITTED_CANONICAL';
    // This memory port persists the exact real Core commit command for the new read-lineage dependency.
    const preflight = this.preflights.get(String(input.preflightId));
    if (!preflight) throw new Error('SYNTHETIC_COMMIT_PREFLIGHT_MISSING');
    Object.assign(preflight, { documentVersionId: version.documentVersionId, status: 'COMMITTED',
      commitIdempotencyKey: input.idempotencyKey, committedAt });
    this.commits++;
    return {
      disposition: input.preflightDecision,
      familyId: family.familyId,
      documentId: object(input.document).documentId,
      documentVersionId: version.documentVersionId,
      currentGeneration: 1,
      currentnessChanged: true,
    };
  }
  async readOriginalRegistryIdentity(id: string) {
    const version = this.versions.get(id);
    return version
      ? {
          version,
          source: this.artifacts.get(String(version.sourceArtifactId)),
        }
      : null;
  }
  async readMetadataSource(id: string) {
    const version = this.versions.get(id);
    return version
      ? {
          version,
          source: this.artifacts.get(String(version.sourceArtifactId)),
          family: this.families.get(String(version.familyId)),
        }
      : null;
  }
  async readDocumentSourceReadProvenance(input: { documentVersionId: string; tenantId: string }) {
    // Real query construction/classifier over explicit Memory persistence rows; no PG/RLS claim.
    const database = { select: () => ({ from: (table: unknown) => {
      if (table !== dmDocumentVersion) throw new Error('UNEXPECTED_PROVENANCE_TABLE');
      const query = { innerJoin: (..._args: unknown[]) => query, leftJoin: (..._args: unknown[]) => query,
        where: async (condition: unknown) => {
          const built = new PgDialect().sqlToQuery(condition as never);
          const version = this.versions.get(String(built.params[0]));
          const family = version && this.families.get(String(version.familyId));
          const artifact = version && this.artifacts.get(String(version.sourceArtifactId));
          if (!version || !family || !artifact || !String(family.canonicalIdentityKey).startsWith(String(built.params[1]))) return [];
          return [...this.acquisitions.values()].filter(acquisition => acquisition.documentVersionId === version.documentVersionId &&
            acquisition.sourceArtifactId === version.sourceArtifactId).flatMap(acquisition => {
            const preflights = [...this.preflights.values()].filter(row => row.acquisitionId === acquisition.acquisitionId &&
              row.documentVersionId === version.documentVersionId && row.status === 'COMMITTED');
            return (preflights.length ? preflights : [null]).map(preflight => ({
              version, family, artifact,
              acquisition: { ...acquisition, sourceDescriptorJson: JSON.stringify(acquisition.sourceDescriptor) },
              preflight: preflight ? { ...preflight, normalizedDescriptorJson: JSON.stringify(preflight.normalizedDescriptor) } : null,
            }));
          });
        } };
      return query;
    } }) };
    return new MiaodaHostedDocumentCatalog(database as never).readDocumentSourceReadProvenance(input);
  }

  async readOwnedAcquisitionVersionBinding(input: {
    documentVersionId: string;
  }) {
    return this.versions.has(input.documentVersionId);
  }
}

export function fixture(input?: { bytes: Buffer; package: unknown }) {
  const { bytes, package: pkg } = input ?? syntheticFormalOriginal();
  const prepared = adaptTdmsDailySource({
    requestId: 'TDMSIMPORT-' + hash(pkg),
    package: pkg,
  });
  const env = prepared.envelope,
    observation = env.package.artifactBindings[0];
  expect(bytes.length).toBe(observation.byteLength);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(
    observation.blobSha256,
  );
  const s = legacyOriginalServices();
  const receiverRepository = Reflect.get(
    s.receiver,
    'receivers',
  ) as TdmsReceiverRepository;
  const select = receiverRepository.selection.bind(receiverRepository);
  jest
    .spyOn(receiverRepository, 'selection')
    .mockImplementation(async (currentActor, ...keys) => {
      const stored = await select(currentActor, ...keys);
      return stored?.actorSubjectId === currentActor.canonicalSubject.id
        ? stored
        : null;
    });
  s.f.row.scopeId = 'SL';
  for (const action of Object.values(s.f.actions))
    action.permittedMembers = copy(prepared.memberClaims);
  s.f.actions.READ_RELATIONS.allowed = false;
  const selection = {
    ...s.selection,
    filePath: `tdms-source/uploads/${env.requestId}_${observation.bindingId}`,
  };
  s.f.objects.clear();
  s.f.objects.set(selection.filePath, {
    bytes,
    metadata: {
      bucketID: selection.bucketId,
      filePath: selection.filePath,
      id: selection.expectedProviderObjectId,
      name: `${env.requestId}_${observation.bindingId}`,
      createdBy: { userID: actor().canonicalSubject.id },
      metadata: {
        mimeType: observation.mediaType,
        contentLength: bytes.length,
      },
    },
  });
  const catalog = new MemoryCatalog();
  const catalogPort = s.f.catalog as unknown as Pick<
    MemoryCatalog,
    'recordAcquisition' | 'readSourceArtifactByContent'
  >;
  jest
    .spyOn(catalogPort, 'recordAcquisition')
    .mockImplementation((input) => catalog.recordAcquisition(input));
  jest
    .spyOn(catalogPort, 'readSourceArtifactByContent')
    .mockImplementation((input) => catalog.readSourceArtifactByContent(input));
  const request = {
    headers: { cookie: 'wl_session=synthetic-formal-http-session' },
    userContext: {
      userId: actor().canonicalSubject.id, tenantId: actor().tenantId,
      appId: actor().applicationScopeId, env: actor().env,
    },
  } as unknown as Request;
  const readSession = { valid: true, actorUserId: actor().canonicalSubject.id, tenantId: actor().tenantId,
    revision: 1, expiresAt: new Date(Date.now() + 60_000), sessionId: 'synthetic-formal-http-session-id' };
  // Each explicit test HTTP caller has its own token/server record. No unknown token receives an identity.
  const readSessionRecords = new Map([['synthetic-formal-http-session', readSession]]);
  const readSessions = new SessionResolver({ validate: async (token: string) => {
    const stored = readSessionRecords.get(token);
    if (!stored || !s.identity.valid || !stored.valid) return null;
    const identity: VerifiedIdentity = { subjectMappingId: 'synthetic-formal-mapping', provenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
      miaodaUserId: stored.actorUserId, tenantId: stored.tenantId, feishuUserId: null, feishuOpenId: 'synthetic-open-id',
      namespacedSubject: { namespace: 'FEISHU_OPEN_ID', subject: 'synthetic-open-id', tenantKey: 'synthetic-tenant-key' },
      verifiedAt: '2026-10-18T00:00:00.000Z' };
    return { identity, sessionId: stored.sessionId, revision: stored.revision, expiresAt: stored.expiresAt };
  } } as never, { applicationScopeId: actor().applicationScopeId, sessionEnvironment: actor().env } as never,
  { use: (_request: Request, _response: unknown, next: () => void) => next() } as never);
  const sourceRead = new TdmsDocumentSourceReadAdapter(readSessions, receiverRepository,
    Reflect.get(s.service, 'authorization') as MiaodaTdmsSourceAuthorization);
  const authorizer = new OrdinaryDocumentManagementAuthorizer(
    {
      loadTenantDocumentAuthorizationBinding: async () => null,
    } as unknown as ConstructorParameters<
      typeof OrdinaryDocumentManagementAuthorizer
    >[0],
    s.f.files as unknown as ConstructorParameters<
      typeof OrdinaryDocumentManagementAuthorizer
    >[1],
    catalog as unknown as ConstructorParameters<
      typeof OrdinaryDocumentManagementAuthorizer
    >[2],
    undefined,
    sourceRead,
  );
  const documents = new DocumentManagementHostedService(
    s.f.files as unknown as ConstructorParameters<
      typeof DocumentManagementHostedService
    >[0],
    catalog as unknown as ConstructorParameters<
      typeof DocumentManagementHostedService
    >[1],
    authorizer,
    {
      organizeDocumentIntake: async () => ({
        matterId: 'synthetic-family-matter',
      }),
    } as unknown as ConstructorParameters<
      typeof DocumentManagementHostedService
    >[3],
  );
  const formal = new TdmsFormalDocumentRegistrationService(
    s.receiver,
    documents,
  );
  const service = new TdmsSourceService(
    s.repository,
    Reflect.get(s.service, 'authorization') as TdmsSourceAuthorization,
    Reflect.get(s.service, 'artifacts') as TdmsArtifactStore,
    s.documents,
    formal,
  );
  const stage = () =>
    s.receiver.stage(request, env.requestId, observation.bindingId, {
      package: env.package,
      selection,
    });
  const register = () =>
    formal.register(request, env.requestId, observation.bindingId, {
      package: env.package,
    });
  const read = () => formal.read(request, env.requestId, observation.bindingId);
  const dailyController = new TdmsDailyMetadataController(service, s.receiver);
  return {
    ...s,
    bytes,
    env,
    observation,
    catalog,
    documents,
    formal,
    service,
    request,
    selection,
    stage,
    register,
    read,
    dailyController,
    readSession,
    readSessionRecords,
    readSessions,
    sourceRead,
  };
}
