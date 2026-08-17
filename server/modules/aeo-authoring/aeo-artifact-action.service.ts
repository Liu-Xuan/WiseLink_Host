import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

import {
  AEO_ARTIFACT_ACTION_VERSION,
  AEO_AUTHORING_BOOTSTRAP_ARTIFACT_VERSION,
  AEO_DRAFT_PACKAGE_ARTIFACT_VERSION,
  AEO_WORKING_COPY_ARTIFACT_VERSION,
  AEO_WORD_CANDIDATE_ARTIFACT_VERSION,
  type AeoArtifactActionRequest,
  type AeoArtifactActionResult,
  type AeoAuthoringBootstrapArtifact,
  type AeoArtifactIndexEntry,
  type AeoCandidateDispositionRequest,
  type AeoArtifactPersistReceipt,
  type AeoDraftPackageArtifact,
  type AeoRegistrarCommitReceipt,
  type AeoRegistrarCommitRequest,
  type AeoSimilarCandidateSummary,
  type AeoWorkingCopyArtifact,
  type AeoWorkItemReadModel,
  type AeoWorkItemReadRequest,
} from '../../../shared/aeo-integration';
import {
  AEO_AUTHORING_CLOUD_VERSION,
  type AeoCloudSourceManifest,
  type AeoCloudAuthoringDocument,
  type AeoCloudDraftCheckpoint,
  type AeoKnowledgeAdoptionDecision,
  type AeoSourceBinding,
} from '../../../shared/aeo-editor';
/*
 * The action coordinator builds immutable artifacts only. Database/FileService
 * adapters remain outside this domain service and are injected by the host.
 */

import {
  assertAeoTransactionCoverage,
  assertAeoTransactionReferences,
  normalizeAeoTransactions,
} from './aeo-authoring.checkpoint';
import { summarizeAeoProjection } from './aeo-editor-validation-summary';
import { buildAeoCloudWordDraft } from './aeo-cloud-word-export';
import {
  canonicalStringify,
  isRecord,
  projectionError,
  requireExactKeys,
  requireNonEmptyString,
  requirePositiveInteger,
  requireSha256,
  sha256Hex,
} from './aeo-editor-projection.utils';
import { projectTiptapToAeoBlocks } from './aeo-editor-projection';
import { projectAeoParsedPackageToBootstrap } from './aeo-parsed-package-authoring.projector';
import { normalizeAeoEditorProjection } from './aeo-editor-projection.validation';
import {
  AEO_SIMILAR_SEARCH_PORT,
  normalizeWorkItemReadModel,
  AEO_WORK_ITEM_READ_PORT,
  searchAeoAuthoringCandidates,
  type AeoSimilarSearchPort,
  type AeoWorkItemReadPort,
} from './aeo-same-workitem-host.ports';

export const AEO_ARTIFACT_STORE_PORT = Symbol('AEO_ARTIFACT_STORE_PORT');
export const AEO_HUB_REGISTRAR_PORT = Symbol('AEO_HUB_REGISTRAR_PORT');

export interface AeoArtifactStorePort {
  persistImmutable(input: {
    workItemId: string;
    idempotencyKey: string;
    artifactKind: AeoArtifactIndexEntry['artifactKind'];
    mediaType: string;
    bytes: Uint8Array;
  }): Promise<AeoArtifactPersistReceipt>;
  readActualBytes(artifactRef: string): Promise<Uint8Array>;
}

export interface AeoHubRegistrarPort {
  commitArtifact(
    request: AeoRegistrarCommitRequest,
  ): Promise<AeoRegistrarCommitReceipt>;
}

export class UnconfiguredAeoArtifactStorePort implements AeoArtifactStorePort {
  async persistImmutable(): Promise<AeoArtifactPersistReceipt> {
    projectionError(
      'AEO_ARTIFACT_PERSIST_UNAVAILABLE',
      'CanonicalArtifactStore persist port 尚未冻结。',
    );
  }

  async readActualBytes(): Promise<Uint8Array> {
    projectionError(
      'AEO_ARTIFACT_PERSIST_UNAVAILABLE',
      'CanonicalArtifactStore readback port 尚未冻结。',
    );
  }
}

export class UnconfiguredAeoHubRegistrarPort implements AeoHubRegistrarPort {
  async commitArtifact(): Promise<AeoRegistrarCommitReceipt> {
    projectionError(
      'AEO_REGISTRAR_COMMIT_UNAVAILABLE',
      'Hub Registrar CAS port 尚未冻结。',
    );
  }
}

@Injectable()
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class AeoArtifactActionService {
  constructor(
    @Inject(AEO_WORK_ITEM_READ_PORT)
    private readonly workItems: AeoWorkItemReadPort,
    @Inject(AEO_ARTIFACT_STORE_PORT)
    private readonly artifacts: AeoArtifactStorePort,
    @Inject(AEO_HUB_REGISTRAR_PORT)
    private readonly registrar: AeoHubRegistrarPort,
    @Inject(AEO_SIMILAR_SEARCH_PORT)
    private readonly similar: AeoSimilarSearchPort,
  ) {}

  /**
   * Ordinary CanonicalMiaodaApp path. The controller authenticates the user and
   * overwrites requesterRef from the trusted host context before this method is
   * called. Existing permission-snapshot, WorkItem fresh-read, immutable
   * readback and Registrar CAS checks remain mandatory below. This method must
   * only be called after the canonical host has authenticated the actor and
   * overwritten requesterRef from trusted server context.
   */
  async executeFromAuthenticatedHost(
    value: unknown,
  ): Promise<AeoArtifactActionResult> {
    return this.executeAuthorized(normalizeAeoArtifactActionRequest(value));
  }

  private async executeAuthorized(
    request: AeoArtifactActionRequest,
  ): Promise<AeoArtifactActionResult> {
    let workItem: AeoWorkItemReadModel;
    try {
      workItem = normalizeWorkItemReadModel(
        await this.workItems.read(readRequest(request)),
      );
    } catch (error) {
      return blocked(
        request,
        [
          blocker(
            readCode(error) === 'WORKITEM_PROJECTION_INVALID'
              ? 'WORKITEM_PROJECTION_INVALID'
              : 'CANONICAL_WORKITEM_READ_UNAVAILABLE',
            'CanonicalWorkItemStore',
            `${readCode(error)}: WorkItem fresh-read 失败。`,
          ),
        ],
        null,
      );
    }
    const precondition = checkWorkItemPrecondition(request, workItem);
    if (precondition)
      return blocked(request, [precondition], workItem.stateVersion);

    try {
      const built = await buildArtifact(
        request,
        workItem,
        this.artifacts,
        this.similar,
      );
      const receipt = await this.artifacts.persistImmutable({
        workItemId: request.workItemId,
        idempotencyKey: request.idempotencyKey,
        artifactKind: built.index.artifactKind,
        mediaType: built.index.mediaType,
        bytes: built.bytes,
      });
      assertPersistReceipt(receipt, built.bytes, built.index.mediaType);
      const actual = await this.artifacts.readActualBytes(receipt.artifactRef);
      assertActualBytes(actual, receipt);
      const artifact = {
        ...built.index,
        artifactRef: receipt.artifactRef,
        artifactSha256: receipt.artifactSha256,
        byteLength: receipt.byteLength,
      };
      const commit = await this.registrar.commitArtifact({
        workItemId: request.workItemId,
        requesterRef: request.requesterRef,
        permissionSnapshotVersion: request.permissionSnapshotVersion,
        expectedStateVersion: request.expectedStateVersion,
        expectedAeoStateVersion: workItem.aeo.stateVersion,
        idempotencyKey: request.idempotencyKey,
        decisionType: 'ACCEPT_AEO_ARTIFACT',
        action: request.action,
        artifact,
        nextAeoState: built.nextAeoState,
      });
      const committed = normalizeCommitReceipt(
        commit,
        request.expectedStateVersion,
      );
      return {
        schemaVersion: AEO_ARTIFACT_ACTION_VERSION,
        status: 'COMMITTED',
        action: request.action,
        workItemId: request.workItemId,
        previousStateVersion: request.expectedStateVersion,
        committedStateVersion: committed.committedStateVersion,
        artifact,
        artifactReadback: {
          verified: true,
          sha256: receipt.artifactSha256,
          byteLength: receipt.byteLength,
        },
        decisionId: committed.decisionId,
        validationWriteAuthorization: null,
        blockers: [],
        authority: 'ARTIFACT_ACTION_NOT_APPROVAL_NOT_RELEASE_NOT_DELIVERY',
      };
    } catch (error) {
      const code = readCode(error);
      return blocked(request, [mapActionError(code)], workItem.stateVersion);
    }
  }
}

function readRequest(
  request: AeoArtifactActionRequest,
): AeoWorkItemReadRequest {
  return {
    workItemId: request.workItemId,
    requesterRef: request.requesterRef,
    permissionSnapshotVersion: request.permissionSnapshotVersion,
  };
}

function checkWorkItemPrecondition(
  request: AeoArtifactActionRequest,
  workItem: AeoWorkItemReadModel,
) {
  if (workItem.workItemId !== request.workItemId) {
    return blocker(
      'WORKITEM_PROJECTION_INVALID',
      'CanonicalWorkItemStore',
      'WorkItem fresh-read 返回了不同 identity。',
    );
  }
  if (workItem.stateVersion !== request.expectedStateVersion) {
    return blocker(
      'WORKITEM_STATE_CONFLICT',
      'CanonicalWorkItemStore',
      'WorkItem stateVersion 已变化，请重新读取。',
    );
  }
  if (
    workItem.permissionSnapshotVersion !== request.permissionSnapshotVersion
  ) {
    return blocker(
      'PERMISSION_SNAPSHOT_STALE',
      'CanonicalWorkItemStore',
      'permission snapshot 已变化，请重新授权并读取。',
    );
  }
  return null;
}

async function buildArtifact(
  request: AeoArtifactActionRequest,
  workItem: AeoWorkItemReadModel,
  store: AeoArtifactStorePort,
  similar: AeoSimilarSearchPort,
): Promise<{
  bytes: Uint8Array;
  index: Omit<
    AeoArtifactIndexEntry,
    'artifactRef' | 'artifactSha256' | 'byteLength'
  >;
  nextAeoState: AeoWorkItemReadModel['aeo']['state'];
}> {
  if (request.action === 'BOOTSTRAP_FROM_PARSED_PACKAGE') {
    if (latestAeoArtifact(workItem, 'AUTHORING_BOOTSTRAP')) {
      projectionError(
        'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
        '当前 WorkItem 已存在 authoring bootstrap，请使用已提交的 exact artifact。',
      );
    }
    const bytes = await readVerifiedAeoArtifactInput(
      store,
      workItem.authoringSeed.parsedPackage.artifactRef,
      workItem.authoringSeed.parsedPackage.artifactSha256,
    );
    let parsedPackage: unknown;
    try {
      parsedPackage = JSON.parse(Buffer.from(bytes).toString('utf8'));
    } catch {
      projectionError(
        'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
        'Reader 接受的 AEO ParsedPackage 不是有效 JSON。',
      );
    }
    const projected = projectAeoParsedPackageToBootstrap(
      parsedPackage,
      workItem,
    );
    const artifact: AeoAuthoringBootstrapArtifact = {
      schemaVersion: AEO_AUTHORING_BOOTSTRAP_ARTIFACT_VERSION,
      artifactKind: 'AUTHORING_BOOTSTRAP',
      workItemId: workItem.workItemId,
      documentId: workItem.authoringSeed.document.documentId,
      documentVersionId: workItem.authoringSeed.document.documentVersionId,
      parsedPackageId: workItem.authoringSeed.parsedPackage.packageId,
      parsedPackageArtifactRef:
        workItem.authoringSeed.parsedPackage.artifactRef,
      parsedPackageArtifactSha256:
        workItem.authoringSeed.parsedPackage.artifactSha256,
      readerReceiptId: workItem.authoringSeed.parsedPackage.readerReceiptId,
      readerRevision: workItem.authoringSeed.parsedPackage.readerRevision,
      aeoIdentity: workItem.aeoTargetIdentity.value,
      procedureItemId: projected.procedureItemId,
      projection: projected.projection,
      validation: projected.validation,
      sourceManifest: projected.sourceManifest,
      candidateKnowledge: projected.candidateKnowledge,
      authority: 'BOOTSTRAP_CANDIDATE_NOT_DRAFT_NOT_RELEASE',
    };
    return {
      bytes: jsonBytes(artifact),
      index: {
        artifactKind: 'AUTHORING_BOOTSTRAP',
        storeRole: 'CanonicalArtifactStore',
        mediaType: 'application/json',
        schemaVersion: AEO_AUTHORING_BOOTSTRAP_ARTIFACT_VERSION,
        workingRevision: null,
        casToken: workItem.authoringSeed.parsedPackage.artifactSha256,
        state: projected.validation.checkpointEligible
          ? 'CANDIDATE'
          : 'BLOCKED',
      },
      nextAeoState: 'PARSE_READY',
    };
  }

  if (request.action === 'PERSIST_WORKING_COPY') {
    const current = latestAeoArtifact(workItem, 'WORKING_COPY');
    const observedRevision = current?.workingRevision ?? 0;
    if (observedRevision !== request.expectedWorkingRevision) {
      projectionError(
        'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
        `workingRevision 已是 ${observedRevision}，请求基于 ${request.expectedWorkingRevision}。`,
      );
    }
    if ((current?.casToken ?? null) !== request.expectedContentHash) {
      projectionError(
        'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
        '当前 working artifact content CAS 与请求不一致。',
      );
    }
    const previous = await readPreviousAuthoringContext(
      workItem,
      store,
      current,
    );
    let projection = normalizeAeoEditorProjection(request.projection);
    let transactions = normalizeAeoTransactions(request.transactions);
    let dispositionDecision: AeoKnowledgeAdoptionDecision | null = null;
    if (request.candidateDisposition) {
      const candidates = await searchAeoAuthoringCandidates(
        similar,
        workItem,
        previous.bootstrapCandidates,
      );
      const candidate = candidates.find(
        (item) =>
          item.candidateId === request.candidateDisposition?.candidateId,
      );
      if (!candidate) {
        projectionError(
          'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
          '候选已不在同一 WorkItem 的当前检索结果中，请刷新后重新选择。',
        );
      }
      await readVerifiedAeoArtifactInput(
        store,
        candidate.sourceArtifactRef,
        candidate.sourceArtifactSha256,
      );
      const applied = applyCandidateDisposition(
        projection,
        transactions,
        candidate,
        request.candidateDisposition,
        request.idempotencyKey,
        workItem,
      );
      projection = normalizeAeoEditorProjection(applied.projection);
      transactions = normalizeAeoTransactions(applied.transactions);
      dispositionDecision = applied.decision;
    }
    const projectionResult = projectTiptapToAeoBlocks(projection);
    assertAeoTransactionReferences(
      transactions,
      new Set(projection.blockManifest.map((item) => item.blockId)),
    );
    assertAeoTransactionCoverage(
      projectionResult.changedBlockIds,
      transactions,
    );
    const validation = summarizeAeoProjection(projectionResult);
    const artifact: AeoWorkingCopyArtifact = {
      schemaVersion: AEO_WORKING_COPY_ARTIFACT_VERSION,
      artifactKind: 'WORKING_COPY',
      workItemId: workItem.workItemId,
      documentId: workItem.authoringSeed.document.documentId,
      documentVersionId: workItem.authoringSeed.document.documentVersionId,
      parsedPackageId: workItem.authoringSeed.parsedPackage.packageId,
      parsedPackageArtifactSha256:
        workItem.authoringSeed.parsedPackage.artifactSha256,
      aeoIdentity: workItem.aeoTargetIdentity.value,
      workingRevision: observedRevision + 1,
      baseBlockSetHash: projectionResult.projectedFromBlockSetHash,
      contentHash: projectionResult.currentBlockSetHash,
      projection,
      transactions,
      validation,
      sourceManifest: sourceManifest(
        projection,
        previous.sourceManifest,
        dispositionDecision,
      ),
      authority: 'WORKING_COPY_NOT_DRAFT_NOT_RELEASE',
    };
    return {
      bytes: jsonBytes(artifact),
      index: {
        artifactKind: 'WORKING_COPY',
        storeRole: 'CanonicalArtifactStore',
        mediaType: 'application/json',
        schemaVersion: AEO_WORKING_COPY_ARTIFACT_VERSION,
        workingRevision: artifact.workingRevision,
        casToken: artifact.contentHash,
        state: 'AVAILABLE',
      },
      nextAeoState: 'AUTHORING',
    };
  }

  if (request.action === 'FREEZE_DRAFT_PACKAGE') {
    const bytes = await readVerifiedAeoArtifactInput(
      store,
      request.workingArtifactRef,
      request.workingArtifactSha256,
    );
    const working = parseAeoWorkingCopyArtifact(bytes);
    assertAeoWorkingCopyBound(working, workItem);
    if (working.workingRevision !== request.expectedWorkingRevision) {
      projectionError(
        'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
        'working copy revision 与冻结请求不一致。',
      );
    }
    const draftPackageId = `AEODRAFT-${sha256Hex(
      canonicalStringify({
        workItemId: workItem.workItemId,
        workingArtifactSha256: request.workingArtifactSha256,
        workingRevision: working.workingRevision,
        contentHash: working.contentHash,
      }),
    )
      .slice(0, 28)
      .toUpperCase()}`;
    const draft: AeoDraftPackageArtifact = {
      schemaVersion: AEO_DRAFT_PACKAGE_ARTIFACT_VERSION,
      artifactKind: 'DRAFT_PACKAGE',
      draftPackageId,
      workItemId: workItem.workItemId,
      documentId: workItem.authoringSeed.document.documentId,
      documentVersionId: workItem.authoringSeed.document.documentVersionId,
      parsedPackageId: workItem.authoringSeed.parsedPackage.packageId,
      aeoIdentity: workItem.aeoTargetIdentity.value,
      workingArtifactRef: request.workingArtifactRef,
      workingArtifactSha256: request.workingArtifactSha256,
      workingRevision: working.workingRevision,
      contentHash: working.contentHash,
      checkpointEligible: working.validation.checkpointEligible,
      blockingUnresolvedCount: working.validation.blockingUnresolvedCount,
      workingCopy: working,
      authority: 'DRAFT_PACKAGE_NOT_RELEASE',
    };
    return {
      bytes: jsonBytes(draft),
      index: {
        artifactKind: 'DRAFT_PACKAGE',
        storeRole: 'CanonicalArtifactStore',
        mediaType: 'application/json',
        schemaVersion: AEO_DRAFT_PACKAGE_ARTIFACT_VERSION,
        workingRevision: working.workingRevision,
        casToken: request.workingArtifactSha256,
        state: working.validation.checkpointEligible ? 'CANDIDATE' : 'BLOCKED',
      },
      nextAeoState: working.validation.checkpointEligible
        ? 'CHECKPOINTED'
        : 'BLOCKED',
    };
  }

  const draftBytes = await readVerifiedAeoArtifactInput(
    store,
    request.draftArtifactRef,
    request.draftArtifactSha256,
  );
  const draft = parseDraftPackage(draftBytes);
  assertDraftBound(draft, workItem);
  const document = toCloudDocument(draft.workingCopy);
  const checkpoint = toCloudCheckpoint(draft);
  const word = buildAeoCloudWordDraft(document, checkpoint);
  return {
    bytes: word.bytes,
    index: {
      artifactKind: 'WORD_EXPORT',
      storeRole: 'CanonicalArtifactStore',
      mediaType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      schemaVersion: AEO_WORD_CANDIDATE_ARTIFACT_VERSION,
      workingRevision: draft.workingRevision,
      casToken: request.draftArtifactSha256,
      state: draft.checkpointEligible ? 'CANDIDATE' : 'BLOCKED',
    },
    nextAeoState: draft.checkpointEligible ? 'CHECKPOINTED' : 'BLOCKED',
  };
}

export function latestAeoArtifact(
  workItem: AeoWorkItemReadModel,
  kind: AeoArtifactIndexEntry['artifactKind'],
) {
  return workItem.artifactIndex
    .filter((entry) => entry.artifactKind === kind)
    .sort(
      (left, right) =>
        (right.workingRevision ?? 0) - (left.workingRevision ?? 0),
    )[0];
}

export async function readVerifiedAeoArtifactInput(
  store: AeoArtifactStorePort,
  ref: string,
  expectedSha256: string,
): Promise<Uint8Array> {
  let bytes: Uint8Array;
  try {
    bytes = await store.readActualBytes(ref);
  } catch (error) {
    projectionError(
      'AEO_ARTIFACT_INPUT_NOT_FOUND',
      `${readCode(error)}: 输入 artifact 无法读回。`,
    );
  }
  if (sha256Bytes(bytes) !== expectedSha256) {
    projectionError(
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      '输入 artifact 的 actual-byte hash 不匹配。',
    );
  }
  return bytes;
}

function assertPersistReceipt(
  receipt: AeoArtifactPersistReceipt,
  bytes: Uint8Array,
  mediaType: string,
): void {
  if (
    !receipt.artifactRef ||
    receipt.artifactSha256 !== sha256Bytes(bytes) ||
    receipt.byteLength !== bytes.byteLength ||
    receipt.mediaType !== mediaType
  ) {
    projectionError(
      'AEO_ARTIFACT_PERSIST_FAILED',
      'ArtifactStore persist receipt 与写入字节不一致。',
    );
  }
}

function assertActualBytes(
  bytes: Uint8Array,
  receipt: AeoArtifactPersistReceipt,
): void {
  if (
    bytes.byteLength !== receipt.byteLength ||
    sha256Bytes(bytes) !== receipt.artifactSha256
  ) {
    projectionError(
      'AEO_ARTIFACT_READBACK_MISMATCH',
      'ArtifactStore actual-byte readback 与 persist receipt 不一致。',
    );
  }
}

function normalizeCommitReceipt(
  value: unknown,
  previousStateVersion: number,
): AeoRegistrarCommitReceipt {
  if (!isRecord(value)) {
    projectionError(
      'AEO_REGISTRAR_COMMIT_FAILED',
      'Registrar 回执必须是对象。',
    );
  }
  requireExactKeys(
    value,
    ['decisionId', 'committedStateVersion', 'replayed'],
    'AEO_REGISTRAR_COMMIT_FAILED',
    'registrar receipt',
  );
  const committedStateVersion = requirePositiveInteger(
    value.committedStateVersion,
    'AEO_REGISTRAR_COMMIT_FAILED',
    'committedStateVersion',
  );
  if (committedStateVersion <= previousStateVersion) {
    projectionError(
      'AEO_REGISTRAR_COMMIT_FAILED',
      'Registrar 未推进 WorkItem stateVersion。',
    );
  }
  if (typeof value.replayed !== 'boolean') {
    projectionError('AEO_REGISTRAR_COMMIT_FAILED', 'replayed 必须是 boolean。');
  }
  return {
    decisionId: requireNonEmptyString(
      value.decisionId,
      'AEO_REGISTRAR_COMMIT_FAILED',
      'decisionId',
    ),
    committedStateVersion,
    replayed: value.replayed,
  };
}

export function parseAeoWorkingCopyArtifact(
  bytes: Uint8Array,
): AeoWorkingCopyArtifact {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    projectionError(
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      'working copy 不是 JSON。',
    );
  }
  if (!isRecord(value)) {
    projectionError(
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      'working copy 必须是对象。',
    );
  }
  requireExactKeys(
    value,
    [
      'schemaVersion',
      'artifactKind',
      'workItemId',
      'documentId',
      'documentVersionId',
      'parsedPackageId',
      'parsedPackageArtifactSha256',
      'aeoIdentity',
      'workingRevision',
      'baseBlockSetHash',
      'contentHash',
      'projection',
      'transactions',
      'validation',
      'sourceManifest',
      'authority',
    ],
    'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
    'working copy',
  );
  if (
    value.schemaVersion !== AEO_WORKING_COPY_ARTIFACT_VERSION ||
    value.artifactKind !== 'WORKING_COPY' ||
    value.authority !== 'WORKING_COPY_NOT_DRAFT_NOT_RELEASE'
  ) {
    projectionError(
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      'working copy 合同不受支持。',
    );
  }
  const projection = normalizeAeoEditorProjection(value.projection);
  const transactions = normalizeAeoTransactions(value.transactions);
  const result = projectTiptapToAeoBlocks(projection);
  const validation = summarizeAeoProjection(result);
  const sourceManifest = normalizeArtifactSourceManifest(value.sourceManifest);
  const baseBlockSetHash = requireSha256(
    value.baseBlockSetHash,
    'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
    'baseBlockSetHash',
  );
  const contentHash = requireSha256(
    value.contentHash,
    'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
    'contentHash',
  );
  if (
    contentHash !== result.currentBlockSetHash ||
    baseBlockSetHash !== result.projectedFromBlockSetHash ||
    canonicalStringify(value.validation) !== canonicalStringify(validation)
  ) {
    projectionError(
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      'working copy 语义 hash 不一致。',
    );
  }
  return {
    schemaVersion: AEO_WORKING_COPY_ARTIFACT_VERSION,
    artifactKind: 'WORKING_COPY',
    workItemId: artifactString(value.workItemId, 'workItemId'),
    documentId: artifactString(value.documentId, 'documentId'),
    documentVersionId: artifactString(
      value.documentVersionId,
      'documentVersionId',
    ),
    parsedPackageId: artifactString(value.parsedPackageId, 'parsedPackageId'),
    parsedPackageArtifactSha256: requireSha256(
      value.parsedPackageArtifactSha256,
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      'parsedPackageArtifactSha256',
    ),
    aeoIdentity: artifactString(value.aeoIdentity, 'aeoIdentity'),
    workingRevision: requirePositiveInteger(
      value.workingRevision,
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      'workingRevision',
    ),
    baseBlockSetHash,
    contentHash,
    projection,
    transactions,
    validation,
    sourceManifest,
    authority: 'WORKING_COPY_NOT_DRAFT_NOT_RELEASE',
  };
}

export function parseAeoAuthoringBootstrapArtifact(
  bytes: Uint8Array,
): AeoAuthoringBootstrapArtifact {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    projectionError(
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      'authoring bootstrap 不是 JSON。',
    );
  }
  if (!isRecord(value)) {
    projectionError(
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      'authoring bootstrap 必须是对象。',
    );
  }
  requireExactKeys(
    value,
    [
      'schemaVersion',
      'artifactKind',
      'workItemId',
      'documentId',
      'documentVersionId',
      'parsedPackageId',
      'parsedPackageArtifactRef',
      'parsedPackageArtifactSha256',
      'readerReceiptId',
      'readerRevision',
      'aeoIdentity',
      'procedureItemId',
      'projection',
      'validation',
      'sourceManifest',
      'candidateKnowledge',
      'authority',
    ],
    'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
    'authoring bootstrap',
  );
  if (
    value.schemaVersion !== AEO_AUTHORING_BOOTSTRAP_ARTIFACT_VERSION ||
    value.artifactKind !== 'AUTHORING_BOOTSTRAP' ||
    value.authority !== 'BOOTSTRAP_CANDIDATE_NOT_DRAFT_NOT_RELEASE'
  ) {
    projectionError(
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      'authoring bootstrap 合同不受支持。',
    );
  }
  const projection = normalizeAeoEditorProjection(value.projection);
  const validation = summarizeAeoProjection(
    projectTiptapToAeoBlocks(projection),
  );
  if (canonicalStringify(value.validation) !== canonicalStringify(validation)) {
    projectionError(
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      'authoring bootstrap validation 与投影不一致。',
    );
  }
  if (!Array.isArray(value.candidateKnowledge)) {
    projectionError(
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      'candidateKnowledge 必须是数组。',
    );
  }
  return {
    schemaVersion: AEO_AUTHORING_BOOTSTRAP_ARTIFACT_VERSION,
    artifactKind: 'AUTHORING_BOOTSTRAP',
    workItemId: artifactString(value.workItemId, 'workItemId'),
    documentId: artifactString(value.documentId, 'documentId'),
    documentVersionId: artifactString(
      value.documentVersionId,
      'documentVersionId',
    ),
    parsedPackageId: artifactString(value.parsedPackageId, 'parsedPackageId'),
    parsedPackageArtifactRef: artifactRef(
      value.parsedPackageArtifactRef,
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
    ),
    parsedPackageArtifactSha256: requireSha256(
      value.parsedPackageArtifactSha256,
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      'parsedPackageArtifactSha256',
    ),
    readerReceiptId: artifactString(value.readerReceiptId, 'readerReceiptId'),
    readerRevision: artifactString(value.readerRevision, 'readerRevision'),
    aeoIdentity: artifactString(value.aeoIdentity, 'aeoIdentity'),
    procedureItemId: artifactString(value.procedureItemId, 'procedureItemId'),
    projection,
    validation,
    sourceManifest: normalizeArtifactSourceManifest(value.sourceManifest),
    candidateKnowledge: value.candidateKnowledge.map((entry, index) =>
      normalizeSimilarCandidate(entry, index),
    ),
    authority: 'BOOTSTRAP_CANDIDATE_NOT_DRAFT_NOT_RELEASE',
  };
}

function normalizeSimilarCandidate(
  value: unknown,
  index: number,
): AeoSimilarCandidateSummary {
  if (!isRecord(value)) {
    projectionError(
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      `candidateKnowledge[${index}] 必须是对象。`,
    );
  }
  requireExactKeys(
    value,
    [
      'candidateId',
      'sourceKind',
      'title',
      'reason',
      'sourceArtifactRef',
      'sourceArtifactSha256',
      'eligibility',
    ],
    'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
    `candidateKnowledge[${index}]`,
  );
  const sourceKind = value.sourceKind;
  if (
    sourceKind !== 'HISTORICAL_AEO' &&
    sourceKind !== 'CATEGORY_PATTERN' &&
    sourceKind !== 'SB_SOURCE' &&
    sourceKind !== 'OEM_REFERENCE' &&
    sourceKind !== 'AI_SUGGESTION'
  ) {
    projectionError(
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      `candidateKnowledge[${index}].sourceKind 不受支持。`,
    );
  }
  if (value.eligibility !== 'CANDIDATE_REQUIRES_REVIEW') {
    projectionError(
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      `candidateKnowledge[${index}].eligibility 不受支持。`,
    );
  }
  return {
    candidateId: artifactString(value.candidateId, 'candidateId'),
    sourceKind,
    title: artifactString(value.title, 'title'),
    reason: artifactString(value.reason, 'reason'),
    sourceArtifactRef: artifactRef(
      value.sourceArtifactRef,
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
    ),
    sourceArtifactSha256: requireSha256(
      value.sourceArtifactSha256,
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      'sourceArtifactSha256',
    ),
    eligibility: 'CANDIDATE_REQUIRES_REVIEW',
  };
}

function parseDraftPackage(bytes: Uint8Array): AeoDraftPackageArtifact {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    projectionError(
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      'draft package 不是 JSON。',
    );
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== AEO_DRAFT_PACKAGE_ARTIFACT_VERSION ||
    value.artifactKind !== 'DRAFT_PACKAGE' ||
    value.authority !== 'DRAFT_PACKAGE_NOT_RELEASE'
  ) {
    projectionError(
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      'draft package 合同不受支持。',
    );
  }
  requireExactKeys(
    value,
    [
      'schemaVersion',
      'artifactKind',
      'draftPackageId',
      'workItemId',
      'documentId',
      'documentVersionId',
      'parsedPackageId',
      'aeoIdentity',
      'workingArtifactRef',
      'workingArtifactSha256',
      'workingRevision',
      'contentHash',
      'checkpointEligible',
      'blockingUnresolvedCount',
      'workingCopy',
      'authority',
    ],
    'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
    'draft package',
  );
  const working = parseAeoWorkingCopyArtifact(
    Buffer.from(canonicalStringify(value.workingCopy), 'utf8'),
  );
  const workItemId = artifactString(value.workItemId, 'workItemId');
  const documentId = artifactString(value.documentId, 'documentId');
  const documentVersionId = artifactString(
    value.documentVersionId,
    'documentVersionId',
  );
  const parsedPackageId = artifactString(
    value.parsedPackageId,
    'parsedPackageId',
  );
  const aeoIdentity = artifactString(value.aeoIdentity, 'aeoIdentity');
  const workingArtifactSha256 = requireSha256(
    value.workingArtifactSha256,
    'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
    'workingArtifactSha256',
  );
  const workingRevision = requirePositiveInteger(
    value.workingRevision,
    'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
    'workingRevision',
  );
  const contentHash = requireSha256(
    value.contentHash,
    'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
    'contentHash',
  );
  const checkpointEligible = requireArtifactBoolean(
    value.checkpointEligible,
    'checkpointEligible',
  );
  const blockingUnresolvedCount = requireNonNegativeInteger(
    value.blockingUnresolvedCount,
    'blockingUnresolvedCount',
  );
  if (
    workItemId !== working.workItemId ||
    documentId !== working.documentId ||
    documentVersionId !== working.documentVersionId ||
    parsedPackageId !== working.parsedPackageId ||
    aeoIdentity !== working.aeoIdentity ||
    workingArtifactSha256 !== sha256Bytes(jsonBytes(working)) ||
    contentHash !== working.contentHash ||
    workingRevision !== working.workingRevision ||
    checkpointEligible !== working.validation.checkpointEligible ||
    blockingUnresolvedCount !== working.validation.blockingUnresolvedCount
  ) {
    projectionError(
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      'draft package 与 working copy 不一致。',
    );
  }
  return {
    schemaVersion: AEO_DRAFT_PACKAGE_ARTIFACT_VERSION,
    artifactKind: 'DRAFT_PACKAGE',
    draftPackageId: artifactString(value.draftPackageId, 'draftPackageId'),
    workItemId,
    documentId,
    documentVersionId,
    parsedPackageId,
    aeoIdentity,
    workingArtifactRef: artifactRef(
      value.workingArtifactRef,
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
    ),
    workingArtifactSha256,
    workingRevision,
    contentHash,
    checkpointEligible,
    blockingUnresolvedCount,
    workingCopy: working,
    authority: 'DRAFT_PACKAGE_NOT_RELEASE',
  };
}

function normalizeArtifactSourceManifest(
  value: unknown,
): AeoCloudSourceManifest {
  if (!isRecord(value)) {
    projectionError(
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      'sourceManifest 必须是对象。',
    );
  }
  const keys = ['sourceNotice', 'exactSourceRefs', 'adoptionDecisions'];
  if (value.fixtureKind !== undefined) keys.push('fixtureKind');
  requireExactKeys(
    value,
    keys,
    'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
    'sourceManifest',
  );
  if (!Array.isArray(value.exactSourceRefs)) {
    projectionError(
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      'exactSourceRefs 必须是数组。',
    );
  }
  if (!Array.isArray(value.adoptionDecisions)) {
    projectionError(
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      'adoptionDecisions 必须是数组。',
    );
  }
  const exactSourceRefs = value.exactSourceRefs.map((entry, index) =>
    artifactString(entry, `exactSourceRefs[${index}]`),
  );
  const adoptionDecisions = value.adoptionDecisions.map((entry, index) =>
    normalizeAdoptionDecision(entry, index),
  );
  return {
    sourceNotice: artifactString(value.sourceNotice, 'sourceNotice'),
    ...(value.fixtureKind === undefined
      ? {}
      : { fixtureKind: artifactString(value.fixtureKind, 'fixtureKind') }),
    exactSourceRefs,
    adoptionDecisions,
  };
}

function normalizeAdoptionDecision(
  value: unknown,
  index: number,
): AeoKnowledgeAdoptionDecision {
  if (!isRecord(value)) {
    projectionError(
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      `adoptionDecisions[${index}] 必须是对象。`,
    );
  }
  requireExactKeys(
    value,
    [
      'decisionRef',
      'unitKey',
      'unitKind',
      'knowledgeState',
      'targetBlockId',
      'usage',
      'decisionNote',
      'exactSourceRef',
      'appliedAt',
    ],
    'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
    `adoptionDecisions[${index}]`,
  );
  const unitKind = value.unitKind;
  if (
    unitKind !== 'SOURCE_STEP' &&
    unitKind !== 'HISTORICAL_AEO_STEP' &&
    unitKind !== 'CATEGORY_PATTERN_NODE' &&
    unitKind !== 'AI_SUGGESTION'
  ) {
    projectionError('AEO_ARTIFACT_INPUT_HASH_MISMATCH', 'unitKind 不受支持。');
  }
  const usage = value.usage;
  if (
    usage !== 'ADOPT' &&
    usage !== 'ADAPT' &&
    usage !== 'REFERENCE_ONLY' &&
    usage !== 'IGNORE'
  ) {
    projectionError('AEO_ARTIFACT_INPUT_HASH_MISMATCH', 'usage 不受支持。');
  }
  return {
    decisionRef: artifactString(value.decisionRef, 'decisionRef'),
    unitKey: artifactString(value.unitKey, 'unitKey'),
    unitKind,
    knowledgeState: artifactString(value.knowledgeState, 'knowledgeState'),
    targetBlockId: artifactString(value.targetBlockId, 'targetBlockId'),
    usage,
    decisionNote: artifactString(value.decisionNote, 'decisionNote'),
    exactSourceRef:
      value.exactSourceRef === null
        ? null
        : artifactString(value.exactSourceRef, 'exactSourceRef'),
    appliedAt: artifactString(value.appliedAt, 'appliedAt'),
  };
}

function artifactString(value: unknown, label: string): string {
  return requireNonEmptyString(
    value,
    'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
    label,
  );
}

function requireArtifactBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    projectionError(
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      `${label} 必须是 boolean。`,
    );
  }
  return value;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    projectionError(
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      `${label} 必须是非负整数。`,
    );
  }
  return Number(value);
}

export function assertAeoWorkingCopyBound(
  working: AeoWorkingCopyArtifact,
  workItem: AeoWorkItemReadModel,
): void {
  if (
    working.workItemId !== workItem.workItemId ||
    working.documentId !== workItem.authoringSeed.document.documentId ||
    working.documentVersionId !==
      workItem.authoringSeed.document.documentVersionId ||
    working.parsedPackageId !==
      workItem.authoringSeed.parsedPackage.packageId ||
    working.parsedPackageArtifactSha256 !==
      workItem.authoringSeed.parsedPackage.artifactSha256
  ) {
    projectionError(
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      'working copy 与 WorkItem 输入链不一致。',
    );
  }
}

function assertDraftBound(
  draft: AeoDraftPackageArtifact,
  workItem: AeoWorkItemReadModel,
): void {
  assertAeoWorkingCopyBound(draft.workingCopy, workItem);
  if (
    draft.workItemId !== workItem.workItemId ||
    draft.documentId !== workItem.authoringSeed.document.documentId ||
    draft.documentVersionId !==
      workItem.authoringSeed.document.documentVersionId ||
    draft.parsedPackageId !== workItem.authoringSeed.parsedPackage.packageId
  ) {
    projectionError(
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      'draft package 与 WorkItem 输入链不一致。',
    );
  }
}

function toCloudDocument(
  working: AeoWorkingCopyArtifact,
): AeoCloudAuthoringDocument {
  return {
    schemaVersion: AEO_AUTHORING_CLOUD_VERSION,
    documentId: working.documentId,
    documentKey: working.aeoIdentity,
    templateKey: null,
    formalAeoIdentity: working.aeoIdentity,
    title: `${working.aeoIdentity} 结构化草稿候选`,
    lifecycleState: 'WORKING',
    workingRevision: working.workingRevision,
    baseBlockSetHash: working.baseBlockSetHash,
    currentBlockSetHash: working.contentHash,
    projection: working.projection,
    transactions: working.transactions,
    validation: working.validation,
    sourceManifest: working.sourceManifest,
    updatedAt: '1970-01-01T00:00:00.000Z',
  };
}

function toCloudCheckpoint(
  draft: AeoDraftPackageArtifact,
): AeoCloudDraftCheckpoint {
  const document = toCloudDocument(draft.workingCopy);
  return {
    schemaVersion: AEO_AUTHORING_CLOUD_VERSION,
    checkpointId: draft.draftPackageId,
    checkpointKey: draft.draftPackageId,
    documentId: draft.documentId,
    documentKey: draft.aeoIdentity,
    workingRevision: draft.workingRevision,
    contentHash: draft.contentHash,
    transactionDigest: sha256Hex(
      canonicalStringify(draft.workingCopy.transactions),
    ),
    checkpointState: 'FROZEN_CANDIDATE',
    snapshot: {
      schemaVersion: AEO_AUTHORING_CLOUD_VERSION,
      document,
      projection: document.projection,
      transactions: document.transactions,
      validation: document.validation,
      frozenAt: '1970-01-01T00:00:00.000Z',
    },
    frozenAt: '1970-01-01T00:00:00.000Z',
    persisted: true,
    authority: 'DRAFT_CHECKPOINT_NOT_RELEASE',
  };
}

async function readPreviousAuthoringContext(
  workItem: AeoWorkItemReadModel,
  store: AeoArtifactStorePort,
  current: AeoArtifactIndexEntry | null,
): Promise<{
  sourceManifest: AeoCloudSourceManifest | null;
  bootstrapCandidates: AeoSimilarCandidateSummary[];
}> {
  let sourceManifest: AeoCloudSourceManifest | null = null;
  if (current) {
    const working = parseAeoWorkingCopyArtifact(
      await readVerifiedAeoArtifactInput(
        store,
        current.artifactRef,
        current.artifactSha256,
      ),
    );
    assertAeoWorkingCopyBound(working, workItem);
    sourceManifest = working.sourceManifest;
  }
  const bootstrapIndex = latestAeoArtifact(workItem, 'AUTHORING_BOOTSTRAP');
  if (!bootstrapIndex) {
    return { sourceManifest, bootstrapCandidates: [] };
  }
  const bootstrap = parseAeoAuthoringBootstrapArtifact(
    await readVerifiedAeoArtifactInput(
      store,
      bootstrapIndex.artifactRef,
      bootstrapIndex.artifactSha256,
    ),
  );
  assertAeoAuthoringBootstrapBound(bootstrap, workItem);
  return {
    sourceManifest: sourceManifest ?? bootstrap.sourceManifest,
    bootstrapCandidates: bootstrap.candidateKnowledge,
  };
}

function assertAeoAuthoringBootstrapBound(
  artifact: AeoAuthoringBootstrapArtifact,
  workItem: AeoWorkItemReadModel,
): void {
  if (
    artifact.workItemId !== workItem.workItemId ||
    artifact.documentId !== workItem.authoringSeed.document.documentId ||
    artifact.documentVersionId !==
      workItem.authoringSeed.document.documentVersionId ||
    artifact.parsedPackageId !==
      workItem.authoringSeed.parsedPackage.packageId ||
    artifact.parsedPackageArtifactRef !==
      workItem.authoringSeed.parsedPackage.artifactRef ||
    artifact.parsedPackageArtifactSha256 !==
      workItem.authoringSeed.parsedPackage.artifactSha256 ||
    artifact.readerReceiptId !==
      workItem.authoringSeed.parsedPackage.readerReceiptId ||
    artifact.readerRevision !==
      workItem.authoringSeed.parsedPackage.readerRevision ||
    artifact.aeoIdentity !== workItem.aeoTargetIdentity.value
  ) {
    projectionError(
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      'authoring bootstrap 与当前 WorkItem 输入链不一致。',
    );
  }
}

export function applyCandidateDisposition(
  projection: AeoWorkingCopyArtifact['projection'],
  transactions: AeoWorkingCopyArtifact['transactions'],
  candidate: AeoSimilarCandidateSummary,
  disposition: AeoCandidateDispositionRequest,
  idempotencyKey: string,
  workItem: AeoWorkItemReadModel,
): {
  projection: AeoWorkingCopyArtifact['projection'];
  transactions: AeoWorkingCopyArtifact['transactions'];
  decision: AeoKnowledgeAdoptionDecision;
} {
  if (
    !projection.blockManifest.some(
      (block) => block.blockId === disposition.targetBlockId,
    )
  ) {
    projectionError(
      'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
      '候选处置目标内容块已变化，请刷新后重新选择。',
    );
  }
  const isCandidateBinding = (binding: AeoSourceBinding) =>
    binding.sourceArtifactRef === candidate.sourceArtifactRef &&
    binding.sourceNodeRef === candidate.candidateId &&
    binding.sourceSha256 === candidate.sourceArtifactSha256;
  const binding = buildCandidateSourceBinding(
    candidate,
    disposition,
    idempotencyKey,
  );
  const blockManifest = projection.blockManifest.map((block) => ({
    ...block,
    sourceBindings: [
      ...block.sourceBindings.filter((item) => !isCandidateBinding(item)),
      ...(block.blockId === disposition.targetBlockId && binding
        ? [binding]
        : []),
    ],
  }));
  const exactSourceRef =
    disposition.usage === 'IGNORE' ? null : candidateExactSourceRef(candidate);
  const decisionRef = `AEODEC-${sha256Hex(
    canonicalStringify({
      workItemId: workItem.workItemId,
      candidateId: candidate.candidateId,
      targetBlockId: disposition.targetBlockId,
      usage: disposition.usage,
      idempotencyKey,
    }),
  )
    .slice(0, 28)
    .toUpperCase()}`;
  return {
    projection: { ...projection, blockManifest },
    transactions: [
      ...transactions,
      {
        sequence: transactions.length + 1,
        kind: 'IMPORT_KNOWLEDGE',
        affectedBlockIds: [disposition.targetBlockId],
      },
    ],
    decision: {
      decisionRef,
      unitKey: candidate.candidateId,
      unitKind: candidateUnitKind(candidate.sourceKind),
      knowledgeState: candidate.eligibility,
      targetBlockId: disposition.targetBlockId,
      usage: disposition.usage,
      decisionNote: disposition.decisionNote,
      exactSourceRef,
      appliedAt: workItem.observedAt,
    },
  };
}

function buildCandidateSourceBinding(
  candidate: AeoSimilarCandidateSummary,
  disposition: AeoCandidateDispositionRequest,
  idempotencyKey: string,
): AeoSourceBinding | null {
  if (disposition.usage === 'IGNORE') return null;
  const originType =
    disposition.usage === 'ADAPT' ? 'SOURCE_ADAPTED' : 'SOURCE_ADOPTED';
  const usage: AeoSourceBinding['usage'] =
    disposition.usage === 'ADOPT'
      ? 'ADOPTED'
      : disposition.usage === 'ADAPT'
        ? 'ADAPTED'
        : 'REFERENCE_ONLY';
  return {
    bindingId: `AEOSRC-${sha256Hex(
      canonicalStringify({
        candidateId: candidate.candidateId,
        sourceArtifactSha256: candidate.sourceArtifactSha256,
        targetBlockId: disposition.targetBlockId,
        usage: disposition.usage,
        idempotencyKey,
      }),
    )
      .slice(0, 24)
      .toUpperCase()}`,
    originType,
    usage,
    sourceArtifactRef: candidate.sourceArtifactRef,
    sourceNodeRef: candidate.candidateId,
    sourceVersion: `sha256:${candidate.sourceArtifactSha256}`,
    sourceSha256: candidate.sourceArtifactSha256,
    locator: candidate.candidateId,
    language: 'NONE',
  };
}

function candidateUnitKind(
  sourceKind: AeoSimilarCandidateSummary['sourceKind'],
): AeoKnowledgeAdoptionDecision['unitKind'] {
  if (sourceKind === 'HISTORICAL_AEO') return 'HISTORICAL_AEO_STEP';
  if (sourceKind === 'CATEGORY_PATTERN') return 'CATEGORY_PATTERN_NODE';
  if (sourceKind === 'AI_SUGGESTION') return 'AI_SUGGESTION';
  return 'SOURCE_STEP';
}

function candidateExactSourceRef(
  candidate: AeoSimilarCandidateSummary,
): string {
  return `${candidate.sourceArtifactRef}@sha256:${candidate.sourceArtifactSha256}#${candidate.candidateId}:${candidate.sourceArtifactSha256}`;
}

function sourceManifest(
  projection: AeoWorkingCopyArtifact['projection'],
  previous: AeoCloudSourceManifest | null,
  decision: AeoKnowledgeAdoptionDecision | null,
): AeoWorkingCopyArtifact['sourceManifest'] {
  const exactSourceRefs = Array.from(
    new Set(
      projection.blockManifest.flatMap((item) =>
        item.sourceBindings.map(
          (binding) =>
            `${binding.sourceArtifactRef}@${binding.sourceVersion}#${binding.sourceNodeRef}:${binding.sourceSha256}`,
        ),
      ),
    ),
  ).sort();
  return {
    sourceNotice: '同一 WorkItem 的来源绑定工作副本；不是发布版本。',
    ...(previous?.fixtureKind ? { fixtureKind: previous.fixtureKind } : {}),
    exactSourceRefs,
    adoptionDecisions: decision
      ? [
          ...(previous?.adoptionDecisions ?? []).filter(
            (item) => item.unitKey !== decision.unitKey,
          ),
          decision,
        ]
      : (previous?.adoptionDecisions ?? []),
  };
}

function jsonBytes(value: unknown): Uint8Array {
  return Buffer.from(canonicalStringify(value), 'utf8');
}

export function normalizeAeoArtifactActionRequest(
  value: unknown,
): AeoArtifactActionRequest {
  if (!isRecord(value)) {
    projectionError(
      'AEO_ARTIFACT_ACTION_INVALID',
      'artifact action 请求必须是对象。',
    );
  }
  const action = value.action;
  if (
    action !== 'BOOTSTRAP_FROM_PARSED_PACKAGE' &&
    action !== 'PERSIST_WORKING_COPY' &&
    action !== 'FREEZE_DRAFT_PACKAGE' &&
    action !== 'EXPORT_WORD_CANDIDATE'
  ) {
    projectionError(
      'AEO_ARTIFACT_ACTION_INVALID',
      'artifact action 不受支持。',
    );
  }
  const common = [
    'schemaVersion',
    'action',
    'workItemId',
    'requestId',
    'runId',
    'requesterRef',
    'permissionSnapshotVersion',
    'expectedStateVersion',
    'idempotencyKey',
  ];
  const extras =
    action === 'BOOTSTRAP_FROM_PARSED_PACKAGE'
      ? []
      : action === 'PERSIST_WORKING_COPY'
        ? [
            'expectedWorkingRevision',
            'expectedContentHash',
            'projection',
            'transactions',
            ...(value.candidateDisposition === undefined
              ? []
              : ['candidateDisposition']),
          ]
        : action === 'FREEZE_DRAFT_PACKAGE'
          ? [
              'workingArtifactRef',
              'workingArtifactSha256',
              'expectedWorkingRevision',
            ]
          : ['draftArtifactRef', 'draftArtifactSha256'];
  requireExactKeys(
    value,
    [...common, ...extras],
    'AEO_ARTIFACT_ACTION_INVALID',
    'artifact action request',
  );
  if (value.schemaVersion !== AEO_ARTIFACT_ACTION_VERSION) {
    projectionError('AEO_ARTIFACT_ACTION_INVALID', 'schemaVersion 不受支持。');
  }
  const base = {
    schemaVersion: AEO_ARTIFACT_ACTION_VERSION,
    workItemId: requireNonEmptyString(
      value.workItemId,
      'AEO_ARTIFACT_ACTION_INVALID',
      'workItemId',
    ),
    requestId: requireNonEmptyString(
      value.requestId,
      'AEO_ARTIFACT_ACTION_INVALID',
      'requestId',
    ),
    runId: requireNonEmptyString(
      value.runId,
      'AEO_ARTIFACT_ACTION_INVALID',
      'runId',
    ),
    requesterRef: requireNonEmptyString(
      value.requesterRef,
      'AEO_ARTIFACT_ACTION_INVALID',
      'requesterRef',
    ),
    permissionSnapshotVersion: requireNonEmptyString(
      value.permissionSnapshotVersion,
      'AEO_ARTIFACT_ACTION_INVALID',
      'permissionSnapshotVersion',
    ),
    expectedStateVersion: requirePositiveInteger(
      value.expectedStateVersion,
      'AEO_ARTIFACT_ACTION_INVALID',
      'expectedStateVersion',
    ),
    idempotencyKey: requireNonEmptyString(
      value.idempotencyKey,
      'AEO_ARTIFACT_ACTION_INVALID',
      'idempotencyKey',
    ),
  };
  if (action === 'BOOTSTRAP_FROM_PARSED_PACKAGE') {
    return { ...base, action };
  }
  if (action === 'PERSIST_WORKING_COPY') {
    return {
      ...base,
      action,
      expectedWorkingRevision:
        value.expectedWorkingRevision === 0
          ? 0
          : requirePositiveInteger(
              value.expectedWorkingRevision,
              'AEO_ARTIFACT_ACTION_INVALID',
              'expectedWorkingRevision',
            ),
      expectedContentHash:
        value.expectedContentHash === null
          ? null
          : requireSha256(
              value.expectedContentHash,
              'AEO_ARTIFACT_ACTION_INVALID',
              'expectedContentHash',
            ),
      projection: normalizeAeoEditorProjection(value.projection),
      transactions: normalizeAeoTransactions(value.transactions),
      ...(value.candidateDisposition === undefined
        ? {}
        : {
            candidateDisposition: normalizeCandidateDisposition(
              value.candidateDisposition,
            ),
          }),
    };
  }
  if (action === 'FREEZE_DRAFT_PACKAGE') {
    return {
      ...base,
      action,
      workingArtifactRef: artifactRef(value.workingArtifactRef),
      workingArtifactSha256: requireSha256(
        value.workingArtifactSha256,
        'AEO_ARTIFACT_ACTION_INVALID',
        'workingArtifactSha256',
      ),
      expectedWorkingRevision: requirePositiveInteger(
        value.expectedWorkingRevision,
        'AEO_ARTIFACT_ACTION_INVALID',
        'expectedWorkingRevision',
      ),
    };
  }
  return {
    ...base,
    action,
    draftArtifactRef: artifactRef(value.draftArtifactRef),
    draftArtifactSha256: requireSha256(
      value.draftArtifactSha256,
      'AEO_ARTIFACT_ACTION_INVALID',
      'draftArtifactSha256',
    ),
  };
}

function normalizeCandidateDisposition(
  value: unknown,
): AeoCandidateDispositionRequest {
  if (!isRecord(value)) {
    projectionError(
      'AEO_ARTIFACT_ACTION_INVALID',
      'candidateDisposition 必须是对象。',
    );
  }
  requireExactKeys(
    value,
    ['candidateId', 'targetBlockId', 'usage', 'decisionNote'],
    'AEO_ARTIFACT_ACTION_INVALID',
    'candidateDisposition',
  );
  if (
    value.usage !== 'ADOPT' &&
    value.usage !== 'ADAPT' &&
    value.usage !== 'REFERENCE_ONLY' &&
    value.usage !== 'IGNORE'
  ) {
    projectionError(
      'AEO_ARTIFACT_ACTION_INVALID',
      'candidateDisposition.usage 不受支持。',
    );
  }
  return {
    candidateId: requireNonEmptyString(
      value.candidateId,
      'AEO_ARTIFACT_ACTION_INVALID',
      'candidateDisposition.candidateId',
    ),
    targetBlockId: requireNonEmptyString(
      value.targetBlockId,
      'AEO_ARTIFACT_ACTION_INVALID',
      'candidateDisposition.targetBlockId',
    ),
    usage: value.usage,
    decisionNote: requireNonEmptyString(
      value.decisionNote,
      'AEO_ARTIFACT_ACTION_INVALID',
      'candidateDisposition.decisionNote',
    ),
  };
}

function artifactRef(
  value: unknown,
  code = 'AEO_ARTIFACT_ACTION_INVALID',
): string {
  const ref = requireNonEmptyString(value, code, 'artifactRef');
  if (
    !/^(artifact|drive|miaoda-file):\/\/[A-Za-z0-9._~!$&'()*+,;=:@/%-]+$/u.test(
      ref,
    )
  ) {
    projectionError(code, 'artifact ref 不受支持。');
  }
  return ref;
}

function blocked(
  request: AeoArtifactActionRequest,
  blockers: AeoArtifactActionResult['blockers'],
  previousStateVersion: number | null = null,
): AeoArtifactActionResult {
  return {
    schemaVersion: AEO_ARTIFACT_ACTION_VERSION,
    status: 'BLOCKED',
    action: request.action,
    workItemId: request.workItemId,
    previousStateVersion,
    committedStateVersion: null,
    artifact: null,
    artifactReadback: null,
    decisionId: null,
    validationWriteAuthorization: null,
    blockers,
    authority: 'ARTIFACT_ACTION_NOT_APPROVAL_NOT_RELEASE_NOT_DELIVERY',
  };
}

function blocker(
  code: AeoArtifactActionResult['blockers'][number]['code'],
  role: AeoArtifactActionResult['blockers'][number]['role'],
  message: string,
) {
  return { code, role, message };
}

function mapActionError(code: string) {
  const stable = new Set([
    'AEO_ARTIFACT_ACTION_INVALID',
    'AEO_ARTIFACT_INPUT_NOT_FOUND',
    'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
    'AEO_ARTIFACT_PERSIST_UNAVAILABLE',
    'AEO_ARTIFACT_PERSIST_FAILED',
    'AEO_ARTIFACT_READBACK_MISMATCH',
    'AEO_SIMILAR_SEARCH_UNAVAILABLE',
    'AEO_REGISTRAR_COMMIT_UNAVAILABLE',
    'AEO_REGISTRAR_COMMIT_FAILED',
    'WORKITEM_STATE_CONFLICT',
  ]);
  const mapped = stable.has(code) ? code : 'AEO_ARTIFACT_PERSIST_FAILED';
  const role: AeoArtifactActionResult['blockers'][number]['role'] =
    mapped === 'AEO_SIMILAR_SEARCH_UNAVAILABLE'
      ? null
      : mapped.startsWith('AEO_REGISTRAR')
        ? 'CanonicalWorkItemStore'
        : 'CanonicalArtifactStore';
  return blocker(
    mapped as AeoArtifactActionResult['blockers'][number]['code'],
    role,
    `${code}: AEO artifact action 失败。`,
  );
}

function readCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : error instanceof Error
      ? error.message
      : 'UNKNOWN_ERROR';
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
