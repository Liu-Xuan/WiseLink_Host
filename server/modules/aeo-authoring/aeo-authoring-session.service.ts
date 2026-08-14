import { Inject, Injectable } from '@nestjs/common';

import {
  AEO_AUTHORING_SESSION_VERSION,
  type AeoArtifactIndexEntry,
  type AeoAuthoringBootstrapArtifact,
  type AeoAuthoringSessionRequest,
  type AeoAuthoringSessionResult,
  type AeoSimilarCandidateSummary,
  type AeoWorkItemReadModel,
  type AeoWorkingCopyArtifact,
} from '../../../shared/aeo-integration';
import type { AeoWorkItemBindingBlocker } from '../../../shared/aeo-editor';

import {
  AEO_ARTIFACT_STORE_PORT,
  assertAeoWorkingCopyBound,
  latestAeoArtifact,
  parseAeoAuthoringBootstrapArtifact,
  parseAeoWorkingCopyArtifact,
  readVerifiedAeoArtifactInput,
  type AeoArtifactStorePort,
} from './aeo-artifact-action.service';
import {
  AEO_SIMILAR_SEARCH_PORT,
  AEO_WORK_ITEM_READ_PORT,
  normalizeWorkItemReadModel,
  searchAeoAuthoringCandidates,
  type AeoSimilarSearchPort,
  type AeoWorkItemReadPort,
} from './aeo-aily.service';
import { AeoWorkItemBindingService } from './aeo-work-item-binding.service';
import {
  isRecord,
  projectionError,
  requireExactKeys,
  requireNonEmptyString,
  requirePositiveInteger,
} from './aeo-editor-projection.utils';

type SessionSource =
  | { kind: 'WORKING_COPY'; artifact: AeoWorkingCopyArtifact }
  | { kind: 'AUTHORING_BOOTSTRAP'; artifact: AeoAuthoringBootstrapArtifact };

@Injectable()
export class AeoAuthoringSessionService {
  constructor(
    private readonly binding: AeoWorkItemBindingService,
    @Inject(AEO_WORK_ITEM_READ_PORT)
    private readonly workItems: AeoWorkItemReadPort,
    @Inject(AEO_ARTIFACT_STORE_PORT)
    private readonly artifacts: AeoArtifactStorePort,
    @Inject(AEO_SIMILAR_SEARCH_PORT)
    private readonly similar: AeoSimilarSearchPort,
  ) {}

  async open(value: unknown): Promise<AeoAuthoringSessionResult> {
    const request = normalizeSessionRequest(value);
    const observedAt = new Date().toISOString();
    const roleGate = this.binding.readRoleGate();
    if (roleGate.status === 'BLOCKED') {
      return blocked(request, observedAt, roleGate.blockers);
    }

    let workItem: AeoWorkItemReadModel;
    try {
      workItem = normalizeWorkItemReadModel(
        await this.workItems.read({
          workItemId: request.workItemId,
          requesterRef: request.requesterRef,
          permissionSnapshotVersion: request.permissionSnapshotVersion,
        }),
      );
    } catch (error) {
      return blocked(request, observedAt, [
        blocker(
          readCode(error) === 'WORKITEM_PROJECTION_INVALID'
            ? 'WORKITEM_PROJECTION_INVALID'
            : 'CANONICAL_WORKITEM_READ_UNAVAILABLE',
          'CanonicalWorkItemStore',
          `${readCode(error)}: WorkItem fresh-read 失败。`,
        ),
      ]);
    }

    const precondition = checkPreconditions(request, workItem);
    if (precondition) {
      return blocked(
        request,
        observedAt,
        [precondition],
        workItem.stateVersion,
        workItem.permissionSnapshotVersion,
      );
    }

    const index = sessionSourceIndex(workItem);
    if (!index) {
      return {
        ...base(request, observedAt),
        status: 'ACTION_REQUIRED',
        stateVersion: workItem.stateVersion,
        permissionSnapshotVersion: workItem.permissionSnapshotVersion,
        validationRun: workItem.validationRun,
        document: documentSummary(workItem),
        parsedPackage: parsedPackageSummary(workItem),
        artifactIndex: workItem.artifactIndex,
        sourceArtifact: null,
        workingRevision: 0,
        contentHash: null,
        projection: null,
        transactions: [],
        validation: null,
        sourceManifest: null,
        candidateKnowledge: [],
        todos: workItem.todos,
        actionRequired: 'BOOTSTRAP_FROM_PARSED_PACKAGE',
        blockers: [],
      };
    }

    let source: SessionSource;
    try {
      const bytes = await readVerifiedAeoArtifactInput(
        this.artifacts,
        index.artifactRef,
        index.artifactSha256,
      );
      source = parseSource(index, bytes);
      assertSourceBound(source, workItem);
    } catch (error) {
      return blocked(
        request,
        observedAt,
        [
          blocker(
            readCode(error) === 'AEO_ARTIFACT_INPUT_NOT_FOUND'
              ? 'AEO_ARTIFACT_INPUT_NOT_FOUND'
              : 'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
            'CanonicalArtifactStore',
            `${readCode(error)}: 编辑会话 artifact 读回或校验失败。`,
          ),
        ],
        workItem.stateVersion,
        workItem.permissionSnapshotVersion,
      );
    }

    let candidateKnowledge: AeoSimilarCandidateSummary[];
    try {
      candidateKnowledge = await searchAeoAuthoringCandidates(
        this.similar,
        workItem,
        await readBootstrapCandidates(source, workItem, this.artifacts),
      );
    } catch (error) {
      const code = readCode(error);
      const artifactFailure = code.startsWith('AEO_ARTIFACT_INPUT_');
      return blocked(
        request,
        observedAt,
        [
          blocker(
            artifactFailure
              ? code === 'AEO_ARTIFACT_INPUT_NOT_FOUND'
                ? 'AEO_ARTIFACT_INPUT_NOT_FOUND'
                : 'AEO_ARTIFACT_INPUT_HASH_MISMATCH'
              : 'AEO_SIMILAR_SEARCH_UNAVAILABLE',
            artifactFailure ? 'CanonicalArtifactStore' : null,
            `${code}: 候选抽屉未能读取同一 WorkItem 的当前来源候选。`,
          ),
        ],
        workItem.stateVersion,
        workItem.permissionSnapshotVersion,
      );
    }
    return ready(
      request,
      observedAt,
      workItem,
      index,
      source,
      candidateKnowledge,
    );
  }
}

async function readBootstrapCandidates(
  source: SessionSource,
  workItem: AeoWorkItemReadModel,
  artifacts: AeoArtifactStorePort,
): Promise<AeoSimilarCandidateSummary[]> {
  if (source.kind === 'AUTHORING_BOOTSTRAP') {
    return source.artifact.candidateKnowledge;
  }
  const index = latestAeoArtifact(workItem, 'AUTHORING_BOOTSTRAP');
  if (!index) return [];
  const bootstrap = parseAeoAuthoringBootstrapArtifact(
    await readVerifiedAeoArtifactInput(
      artifacts,
      index.artifactRef,
      index.artifactSha256,
    ),
  );
  assertSourceBound(
    { kind: 'AUTHORING_BOOTSTRAP', artifact: bootstrap },
    workItem,
  );
  return bootstrap.candidateKnowledge;
}

function normalizeSessionRequest(value: unknown): AeoAuthoringSessionRequest {
  if (!isRecord(value)) {
    projectionError(
      'AEO_ARTIFACT_ACTION_INVALID',
      'authoring session 请求必须是对象。',
    );
  }
  requireExactKeys(
    value,
    [
      'workItemId',
      'requestId',
      'requesterRef',
      'permissionSnapshotVersion',
      'expectedStateVersion',
    ],
    'AEO_ARTIFACT_ACTION_INVALID',
    'authoring session request',
  );
  return {
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
  };
}

function checkPreconditions(
  request: AeoAuthoringSessionRequest,
  workItem: AeoWorkItemReadModel,
): AeoWorkItemBindingBlocker | null {
  if (workItem.workItemId !== request.workItemId) {
    return blocker(
      'WORKITEM_PROJECTION_INVALID',
      'CanonicalWorkItemStore',
      'WorkItem fresh-read 返回了不同 identity。',
    );
  }
  if (workItem.requestId !== request.requestId) {
    return blocker(
      'WORKITEM_PROJECTION_INVALID',
      'CanonicalWorkItemStore',
      'WorkItem requestId 与深链不一致。',
    );
  }
  if (workItem.stateVersion !== request.expectedStateVersion) {
    return blocker(
      'WORKITEM_STATE_CONFLICT',
      'CanonicalWorkItemStore',
      'WorkItem stateVersion 已变化，请从当前事项重新打开。',
    );
  }
  if (
    workItem.permissionSnapshotVersion !== request.permissionSnapshotVersion
  ) {
    return blocker(
      'PERMISSION_SNAPSHOT_STALE',
      'CanonicalWorkItemStore',
      'permission snapshot 已变化，请重新授权并打开。',
    );
  }
  if (
    workItem.authoringPurpose !== 'AEO' ||
    workItem.aeoTargetIdentity.confirmationStatus !== 'HUMAN_CONFIRMED' ||
    workItem.aeoTargetIdentity.authority !==
      'CANONICAL_WORKITEM_SERVER_FRESH_READ' ||
    workItem.sourceContext.document.classificationStatus !== 'CONFIRMED'
  ) {
    return blocker(
      'DOCUMENT_CLASSIFICATION_NOT_CONFIRMED',
      'CanonicalDocumentCatalog',
      '只有 server fresh-read 且人工确认 AEO target 的 WorkItem 可进入编辑器。',
    );
  }
  if (
    workItem.sourceContext.parsedPackage.validationStatus !== 'ACCEPTED' ||
    workItem.authoringSeed.parsedPackage.validationStatus !== 'ACCEPTED'
  ) {
    return blocker(
      'PARSED_PACKAGE_READER_NOT_ACCEPTED',
      'CanonicalUnifiedReader',
      'source ParsedPackage 或 AEO authoring seed 尚未由 Reader 接受。',
    );
  }
  return null;
}

function sessionSourceIndex(
  workItem: AeoWorkItemReadModel,
): AeoArtifactIndexEntry | null {
  return (
    latestAeoArtifact(workItem, 'WORKING_COPY') ??
    latestAeoArtifact(workItem, 'AUTHORING_BOOTSTRAP') ??
    null
  );
}

function parseSource(
  index: AeoArtifactIndexEntry,
  bytes: Uint8Array,
): SessionSource {
  if (index.artifactKind === 'WORKING_COPY') {
    return {
      kind: 'WORKING_COPY',
      artifact: parseAeoWorkingCopyArtifact(bytes),
    };
  }
  if (index.artifactKind === 'AUTHORING_BOOTSTRAP') {
    return {
      kind: 'AUTHORING_BOOTSTRAP',
      artifact: parseAeoAuthoringBootstrapArtifact(bytes),
    };
  }
  projectionError(
    'AEO_ARTIFACT_INPUT_HASH_MISMATCH',
    '编辑会话只接受 WORKING_COPY 或 AUTHORING_BOOTSTRAP。',
  );
}

function assertSourceBound(
  source: SessionSource,
  workItem: AeoWorkItemReadModel,
): void {
  if (source.kind === 'WORKING_COPY') {
    assertAeoWorkingCopyBound(source.artifact, workItem);
    return;
  }
  const artifact = source.artifact;
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
      'authoring bootstrap 与 WorkItem 输入链不一致。',
    );
  }
}

function ready(
  request: AeoAuthoringSessionRequest,
  observedAt: string,
  workItem: AeoWorkItemReadModel,
  index: AeoArtifactIndexEntry,
  source: SessionSource,
  candidateKnowledge: AeoSimilarCandidateSummary[],
): AeoAuthoringSessionResult {
  const working = source.kind === 'WORKING_COPY' ? source.artifact : null;
  const bootstrap =
    source.kind === 'AUTHORING_BOOTSTRAP' ? source.artifact : null;
  const artifact = working ?? bootstrap!;
  return {
    ...base(request, observedAt),
    status: 'READY',
    stateVersion: workItem.stateVersion,
    permissionSnapshotVersion: workItem.permissionSnapshotVersion,
    validationRun: workItem.validationRun,
    document: documentSummary(workItem),
    parsedPackage: parsedPackageSummary(workItem),
    artifactIndex: workItem.artifactIndex,
    sourceArtifact: index,
    workingRevision: working?.workingRevision ?? 0,
    contentHash: working?.contentHash ?? null,
    projection: artifact.projection,
    transactions: working?.transactions ?? [],
    validation: artifact.validation,
    sourceManifest: artifact.sourceManifest,
    candidateKnowledge,
    todos: workItem.todos,
    actionRequired: null,
    blockers: [],
  };
}

function documentSummary(workItem: AeoWorkItemReadModel) {
  return {
    documentId: workItem.authoringSeed.document.documentId,
    documentVersionId: workItem.authoringSeed.document.documentVersionId,
    aeoIdentity: workItem.aeoTargetIdentity.value,
    aeoState: workItem.aeo.state,
    summary: workItem.aeo.summary,
  };
}

function parsedPackageSummary(workItem: AeoWorkItemReadModel) {
  return {
    packageId: workItem.authoringSeed.parsedPackage.packageId,
    artifactRef: workItem.authoringSeed.parsedPackage.artifactRef,
    artifactSha256: workItem.authoringSeed.parsedPackage.artifactSha256,
    readerReceiptId: workItem.authoringSeed.parsedPackage.readerReceiptId,
    readerRevision: workItem.authoringSeed.parsedPackage.readerRevision,
  };
}

function base(
  request: AeoAuthoringSessionRequest,
  observedAt: string,
): Pick<
  AeoAuthoringSessionResult,
  'schemaVersion' | 'workItemId' | 'requestId' | 'observedAt' | 'authority'
> {
  return {
    schemaVersion: AEO_AUTHORING_SESSION_VERSION,
    workItemId: request.workItemId,
    requestId: request.requestId,
    observedAt,
    authority: 'AUTHORING_SESSION_NOT_APPROVAL_NOT_RELEASE_NOT_DELIVERY',
  };
}

function blocked(
  request: AeoAuthoringSessionRequest,
  observedAt: string,
  blockers: AeoWorkItemBindingBlocker[],
  stateVersion: number | null = null,
  permissionSnapshotVersion: string | null = null,
): AeoAuthoringSessionResult {
  return {
    ...base(request, observedAt),
    status: 'BLOCKED',
    stateVersion,
    permissionSnapshotVersion,
    validationRun: null,
    document: null,
    parsedPackage: null,
    artifactIndex: [],
    sourceArtifact: null,
    workingRevision: 0,
    contentHash: null,
    projection: null,
    transactions: [],
    validation: null,
    sourceManifest: null,
    candidateKnowledge: [],
    todos: [],
    actionRequired: null,
    blockers,
  };
}

function blocker(
  code: AeoWorkItemBindingBlocker['code'],
  role: AeoWorkItemBindingBlocker['role'],
  message: string,
): AeoWorkItemBindingBlocker {
  return { code, role, message };
}

function readCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : 'UNKNOWN';
}
