import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { FileService } from '@lark-apaas/fullstack-nestjs-core';
import { EngineeringMatterWorkingRepository } from '../../../../canonical-host/engineering-matter-working.repository';
import { deterministicId } from '../../runtime/valueTools.js';
import { MiaodaFileServiceArtifactStore } from '../miaodaFileServiceArtifactStore.js';
import { driveAuthorizationBlockerCode, type DriveEntry } from '../drive-folder-scanner';
import type { DriveSourceCandidate } from '../drive-source-candidate';
import { parseSourceDelegationPolicy, mintSourceDelegationAuthority, type SourceDelegationPolicy } from './source-intake-authority';
import { DriveScanCheckpointRepository } from './drive-scan-checkpoint.repository';
import { FeishuDriveApplicationPageFetcher, type DriveFileMetadata } from './feishu-drive-application-page-fetcher';
import { MiaodaHostedDocumentCatalog } from './miaoda-hosted-document-catalog';
import { SourceIntakeRepository, type SourceIntakeReceipt } from './source-intake.repository';

export interface DriveAcquisitionResult {
  status: 'DISABLED' | 'PROCESSED';
  attempted: number;
  skippedUnsupported: number;
  acquired: Array<{ providerObjectId: string; acquisitionId: string; receipt: SourceIntakeReceipt; acknowledged: boolean }>;
  blocked: Array<{ providerObjectId: string; code: string }>;
}

/** Server-only technical-library intake; the source policy is absent by default. */
@Injectable()
// Registered in DocumentManagementHostedModule.register dynamic providers.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DriveSourceAcquisitionService {
  private readonly store: MiaodaFileServiceArtifactStore;

  constructor(
    private readonly checkpoints: DriveScanCheckpointRepository,
    private readonly fetcher: FeishuDriveApplicationPageFetcher,
    private readonly catalog: MiaodaHostedDocumentCatalog,
    private readonly intake: SourceIntakeRepository,
    private readonly actorScope: EngineeringMatterWorkingRepository,
    fileService: FileService,
  ) {
    this.store = new MiaodaFileServiceArtifactStore(fileService);
  }

  async processPending(tenantId: string): Promise<DriveAcquisitionResult> {
    const policy = parseSourceDelegationPolicy(process.env.WISELINK_SOURCE_INTAKE_POLICIES_JSON)
      .find(item => item.tenantId === tenantId && item.sourceKey === 'technical-library');
    if (!policy?.enabled) return { status: 'DISABLED', attempted: 0,
      skippedUnsupported: 0,
      acquired: [], blocked: [] };
    if (policy.executorPrincipalId !== process.env.FEISHU_OAUTH_CLIENT_ID?.trim())
      throw new Error('SOURCE_EXECUTOR_PRINCIPAL_MISMATCH');
    return this.actorScope.withActorScope(policy.responsibilityActorUserId, async () => {
      const pending = await this.checkpoints.listPendingCandidates(tenantId, policy.sourceKey);
      const supported = pending.filter(candidate => candidate.entryType === 'file' &&
        candidate.name.toLowerCase().endsWith('.pdf'));
      const result: DriveAcquisitionResult = { status: 'PROCESSED',
        attempted: Math.min(supported.length, 50),
        skippedUnsupported: pending.length - supported.length,
        acquired: [], blocked: [] };
      // One invocation does bounded work. Failed exact rows move behind the
      // untouched rows so a bad file cannot starve later observations.
      for (const candidate of supported.slice(0, 50)) {
        this.assertCurrentPolicy(policy);
        try {
          result.acquired.push(await this.acquireOne(policy, candidate));
        } catch (error) {
          await this.checkpoints.deferCandidate(tenantId, policy.sourceKey, candidate);
          result.blocked.push({ providerObjectId: candidate.providerObjectId,
            code: errorCode(error) });
        }
      }
      return result;
    });
  }

  private async acquireOne(policy: SourceDelegationPolicy, candidate: DriveSourceCandidate): Promise<DriveAcquisitionResult['acquired'][number]> {
    if (candidate.sourceKey !== policy.sourceKey || candidate.entryType !== 'file' ||
      !candidate.name.toLowerCase().endsWith('.pdf'))
      throw new Error('DRIVE_SOURCE_FILE_UNSUPPORTED');
    await this.assertFreshMembership(policy, candidate);
    let metadata: DriveFileMetadata | undefined;
    let bytes: Buffer | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const before = await this.fetcher.metadata(candidate.providerObjectId);
      if (candidate.modifiedTime && before.latestModifyTime &&
        candidate.modifiedTime !== before.latestModifyTime)
        throw new Error('DRIVE_OBSERVATION_STALE');
      const downloaded = await this.fetcher.downloadFile(candidate.providerObjectId);
      const after = await this.fetcher.metadata(candidate.providerObjectId);
      if (before.title === after.title && before.latestModifyTime === after.latestModifyTime) {
        metadata = after; bytes = downloaded; break;
      }
    }
    if (!metadata || !bytes) throw new Error('DRIVE_FILE_CHANGED_DURING_DOWNLOAD');
    if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-')))
      throw new Error('DRIVE_SOURCE_NOT_PDF');
    this.assertCurrentPolicy(policy);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const immutable = await this.store.persistImmutableSource({ bytes, sha256,
      byteLength: bytes.length, mediaType: 'application/pdf' });
    if (!immutable.readbackVerified) throw new Error('DRIVE_IMMUTABLE_READBACK_REQUIRED');
    const immutableLocator = immutable as { bucketId: string; filePath: string;
      providerObjectId: string; providerVersionId: string; readbackVerified: boolean };
    const sourceArtifactId = deterministicId('source_artifact', sha256, bytes.length);
    const observationId = deterministicId('drive_observation', policy.tenantId,
      policy.sourceKey, policy.rootToken, candidate.providerObjectId,
      candidate.ancestorTokens?.join('/') ?? '', metadata.title,
      candidate.providerVersionId ?? '', metadata.latestModifyTime ?? '', sha256);
    const acquisitionId = `ACQ-${observationId}`;
    const idempotencyKey = `tenant:${encodeURIComponent(policy.tenantId)}:request:${observationId}`;
    if (idempotencyKey.length > 255) throw new Error('DRIVE_ACQUISITION_REQUEST_KEY_INVALID');
    const acquiredAt = new Date();
    this.assertCurrentPolicy(policy);
    await this.assertFreshMembership(policy, candidate);
    this.assertCurrentPolicy(policy);
    await this.catalog.recordAcquisition({
      sourceArtifact: { sourceArtifactId, sha256, byteLength: bytes.length,
        mediaType: 'application/pdf', bucketId: immutableLocator.bucketId,
        filePath: immutableLocator.filePath, providerObjectId: immutableLocator.providerObjectId,
        providerVersionId: immutableLocator.providerVersionId, readbackVerified: true,
        createdAt: acquiredAt },
      acquisition: { acquisitionId, sourceArtifactId,
        sourceChannel: 'wiselink_drive_source',
        sourceRef: `DRIVE:${policy.sourceKey}:${candidate.providerObjectId}`,
        selectionBucketId: immutableLocator.bucketId, selectionFilePath: immutableLocator.filePath,
        providerObjectId: immutableLocator.providerObjectId,
        providerVersionId: immutableLocator.providerVersionId,
        acquiredBy: policy.responsibilityActorUserId, acquiredAt, idempotencyKey,
        sourceDescriptor: { sourceKey: policy.sourceKey, rootToken: policy.rootToken,
          driveFileToken: candidate.providerObjectId,
          driveRevision: candidate.providerVersionId,
          driveModifiedTime: metadata.latestModifyTime,
          observedParentToken: candidate.observedParentToken,
          ancestorTokens: candidate.ancestorTokens,
          sha256, byteLength: bytes.length },
      },
    });
    this.assertCurrentPolicy(policy);
    await this.assertFreshMembership(policy, candidate);
    this.assertCurrentPolicy(policy);
    const authority = mintSourceDelegationAuthority({ tenantId: policy.tenantId,
      sourceKey: policy.sourceKey, observation: { sourceKey: policy.sourceKey,
        rootToken: policy.rootToken,
        providerObjectId: immutableLocator.providerObjectId,
        providerVersionId: immutableLocator.providerVersionId,
        selectionBucketId: immutableLocator.bucketId,
        selectionFilePath: immutableLocator.filePath } });
    const receipt = await this.intake.reserve({ acquisitionId, tenantId: policy.tenantId,
      actorUserId: policy.responsibilityActorUserId,
      documentDelivery: policy.documentDelivery,
      engineeringMode: policy.engineeringMode, authority });
    const acknowledged = await this.checkpoints.acknowledgeCandidate(policy.tenantId,
      policy.sourceKey, candidate);
    return { providerObjectId: candidate.providerObjectId, acquisitionId,
      receipt, acknowledged };
  }

  private assertCurrentPolicy(expected: SourceDelegationPolicy): void {
    const current = parseSourceDelegationPolicy(process.env.WISELINK_SOURCE_INTAKE_POLICIES_JSON)
      .find(item => item.tenantId === expected.tenantId && item.sourceKey === expected.sourceKey);
    if (!current?.enabled || JSON.stringify(current) !== JSON.stringify(expected) ||
      current.executorPrincipalId !== process.env.FEISHU_OAUTH_CLIENT_ID?.trim())
      throw new Error('SOURCE_DELEGATION_CHANGED');
  }

  private async assertFreshMembership(policy: SourceDelegationPolicy,
    candidate: DriveSourceCandidate): Promise<void> {
    const chain = candidate.ancestorTokens;
    if (!chain?.length || chain[0] !== policy.rootToken ||
      chain[chain.length - 1] !== candidate.observedParentToken ||
      new Set(chain).size !== chain.length)
      throw new Error('DRIVE_ROOT_MEMBERSHIP_UNPROVEN');
    for (let index = 0; index < chain.length - 1; index += 1) {
      const entries = await this.listFolder(chain[index]!);
      if (!entries.some(entry => entry.token === chain[index + 1] && entry.type === 'folder'))
        throw new Error('DRIVE_ROOT_MEMBERSHIP_CHANGED');
    }
    const entries = await this.listFolder(chain[chain.length - 1]!);
    const matched = entries.find(entry => entry.token === candidate.providerObjectId && entry.type === 'file');
    const actualVersion = matched && (readText(matched, 'version_id') ?? readText(matched, 'revision'));
    const actualModified = matched && (matched.modifiedTime ?? readText(matched, 'modified_time'));
    if (!matched || matched.name !== candidate.name ||
      (candidate.providerVersionId && candidate.providerVersionId !== actualVersion) ||
      (candidate.modifiedTime && candidate.modifiedTime !== actualModified))
      throw new Error('DRIVE_OBSERVATION_STALE');
  }

  private async listFolder(folderToken: string): Promise<DriveEntry[]> {
    const entries: DriveEntry[] = [];
    const tokens = new Set<string>();
    let next: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      const response = await this.fetcher.list(folderToken, next);
      entries.push(...response.files);
      if (!response.hasMore) return entries;
      if (!response.nextPageToken || tokens.has(response.nextPageToken))
        throw new Error('DRIVE_MEMBERSHIP_PAGE_INVALID');
      next = response.nextPageToken;
      tokens.add(next);
    }
    throw new Error('DRIVE_MEMBERSHIP_PAGE_LIMIT');
  }
}

function readText(value: Record<string, unknown>, key: string): string | null {
  return typeof value[key] === 'string' && value[key] ? value[key] as string : null;
}

function errorCode(error: unknown): string {
  const auth = driveAuthorizationBlockerCode(error);
  if (auth) return auth;
  if (error && typeof error === 'object') {
    const value = error as { code?: unknown; message?: unknown };
    if (typeof value.code === 'string' && value.code) return value.code;
    if (typeof value.code === 'number' && Number.isFinite(value.code))
      return `DRIVE_HTTP_CODE_${value.code}`;
    if (typeof value.message === 'string' && /^[A-Z][A-Z0-9_]+$/u.test(value.message))
      return value.message;
  }
  return 'DRIVE_SOURCE_ACQUISITION_FAILED';
}
