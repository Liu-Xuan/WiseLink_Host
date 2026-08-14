import { Injectable } from '@nestjs/common';

import {
  AEO_ARTIFACT_ACTION_VERSION,
  AEO_HOSTED_CANDIDATE_VERTICAL_VERSION,
  type AeoArtifactActionRequest,
  type AeoArtifactActionResult,
  type AeoArtifactIndexEntry,
  type AeoAuthoringSessionResult,
  type AeoHostedCandidateVerticalRequest,
  type AeoHostedCandidateVerticalResult,
  type AeoHostedPlatformReadinessResult,
} from '../../../shared/aeo-integration';

import { AeoArtifactActionService } from './aeo-artifact-action.service';
import { AeoAuthoringSessionService } from './aeo-authoring-session.service';
import {
  isRecord,
  projectionError,
  requireExactKeys,
  requireNonEmptyString,
  requirePositiveInteger,
} from './aeo-editor-projection.utils';
import { AeoHostedPlatformReadinessService } from './aeo-hosted-platform.service';

@Injectable()
export class AeoHostedCandidateVerticalService {
  constructor(
    private readonly readiness: AeoHostedPlatformReadinessService,
    private readonly sessions: AeoAuthoringSessionService,
    private readonly actions: AeoArtifactActionService,
  ) {}

  async run(value: unknown): Promise<AeoHostedCandidateVerticalResult> {
    const request = normalizeRequest(value);
    const readiness = await this.readiness.read();
    if (readiness.status !== 'READY') {
      return result(request, readiness, [], null, [
        {
          code: 'AEO_HOSTED_PLATFORM_NOT_READY',
          message: 'hosted platform readiness 未通过，候选纵切保持零写入。',
        },
      ]);
    }

    const initial = await this.openSession(
      request,
      request.expectedStateVersion,
    );
    if (
      initial.status !== 'ACTION_REQUIRED' ||
      initial.actionRequired !== 'BOOTSTRAP_FROM_PARSED_PACKAGE' ||
      initial.artifactIndex.some((item) => isAeoProducedArtifact(item))
    ) {
      return result(request, readiness, [], initial, [
        {
          code: 'AEO_VALIDATION_WORKITEM_NOT_CLEAN',
          message:
            '标准候选纵切只接受尚未生成 AEO artifact 的专用验收 WorkItem，避免覆盖真实草稿。',
        },
      ]);
    }

    const steps: AeoArtifactActionResult[] = [];
    const bootstrap = await this.execute(
      request,
      'BOOTSTRAP_FROM_PARSED_PACKAGE',
      request.expectedStateVersion,
      {},
    );
    steps.push(bootstrap);
    if (bootstrap.status !== 'COMMITTED') {
      return stepBlocked(request, readiness, steps, initial);
    }

    const bootstrappedSession = await this.openSession(
      request,
      bootstrap.committedStateVersion!,
    );
    if (
      bootstrappedSession.status !== 'READY' ||
      !bootstrappedSession.projection
    ) {
      return readbackBlocked(
        request,
        readiness,
        steps,
        bootstrappedSession,
        'bootstrap 提交后无法读回 READY authoring session。',
      );
    }

    const working = await this.execute(
      request,
      'PERSIST_WORKING_COPY',
      bootstrap.committedStateVersion!,
      {
        expectedWorkingRevision: bootstrappedSession.workingRevision,
        expectedContentHash: bootstrappedSession.contentHash,
        projection: bootstrappedSession.projection,
        transactions: bootstrappedSession.transactions,
      },
    );
    steps.push(working);
    if (working.status !== 'COMMITTED' || !working.artifact) {
      return stepBlocked(request, readiness, steps, bootstrappedSession);
    }

    const draft = await this.execute(
      request,
      'FREEZE_DRAFT_PACKAGE',
      working.committedStateVersion!,
      {
        workingArtifactRef: working.artifact.artifactRef,
        workingArtifactSha256: working.artifact.artifactSha256,
        expectedWorkingRevision: working.artifact.workingRevision!,
      },
    );
    steps.push(draft);
    if (draft.status !== 'COMMITTED' || !draft.artifact) {
      return stepBlocked(request, readiness, steps, bootstrappedSession);
    }

    const word = await this.execute(
      request,
      'EXPORT_WORD_CANDIDATE',
      draft.committedStateVersion!,
      {
        draftArtifactRef: draft.artifact.artifactRef,
        draftArtifactSha256: draft.artifact.artifactSha256,
      },
    );
    steps.push(word);
    if (word.status !== 'COMMITTED') {
      return stepBlocked(request, readiness, steps, bootstrappedSession);
    }

    const finalSession = await this.openSession(
      request,
      word.committedStateVersion!,
    );
    const expectedKinds = new Set([
      'AUTHORING_BOOTSTRAP',
      'WORKING_COPY',
      'DRAFT_PACKAGE',
      'WORD_EXPORT',
    ]);
    for (const item of finalSession.artifactIndex) {
      expectedKinds.delete(item.artifactKind);
    }
    if (finalSession.status !== 'READY' || expectedKinds.size > 0) {
      return readbackBlocked(
        request,
        readiness,
        steps,
        finalSession,
        `最终 WorkItem 读回缺少候选 artifact：${[...expectedKinds].join(', ')}`,
      );
    }
    return result(request, readiness, steps, finalSession, []);
  }

  private openSession(
    request: AeoHostedCandidateVerticalRequest,
    stateVersion: number,
  ) {
    return this.sessions.open({
      workItemId: request.workItemId,
      requestId: request.requestId,
      requesterRef: request.requesterRef,
      permissionSnapshotVersion: request.permissionSnapshotVersion,
      expectedStateVersion: stateVersion,
    });
  }

  private execute(
    request: AeoHostedCandidateVerticalRequest,
    action: AeoArtifactActionRequest['action'],
    stateVersion: number,
    extras: Record<string, unknown>,
  ) {
    return this.actions.execute({
      schemaVersion: AEO_ARTIFACT_ACTION_VERSION,
      action,
      workItemId: request.workItemId,
      requestId: request.requestId,
      runId: request.runId,
      requesterRef: request.requesterRef,
      permissionSnapshotVersion: request.permissionSnapshotVersion,
      expectedStateVersion: stateVersion,
      idempotencyKey: `aeo-validation:${request.runId}:${action}`,
      ...extras,
    });
  }
}

function normalizeRequest(value: unknown): AeoHostedCandidateVerticalRequest {
  if (!isRecord(value)) {
    projectionError(
      'AEO_ARTIFACT_ACTION_INVALID',
      'hosted candidate vertical 请求必须是对象。',
    );
  }
  requireExactKeys(
    value,
    [
      'schemaVersion',
      'workItemId',
      'requestId',
      'requesterRef',
      'permissionSnapshotVersion',
      'expectedStateVersion',
      'runId',
      'confirmation',
    ],
    'AEO_ARTIFACT_ACTION_INVALID',
    'hosted candidate vertical request',
  );
  if (
    value.schemaVersion !== AEO_HOSTED_CANDIDATE_VERTICAL_VERSION ||
    value.confirmation !== 'RUN_AEO_CANDIDATE_VERTICAL'
  ) {
    projectionError(
      'AEO_ARTIFACT_ACTION_INVALID',
      '候选纵切必须提供受支持版本和显式 confirmation。',
    );
  }
  return {
    schemaVersion: AEO_HOSTED_CANDIDATE_VERTICAL_VERSION,
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
    runId: requireNonEmptyString(
      value.runId,
      'AEO_ARTIFACT_ACTION_INVALID',
      'runId',
    ),
    confirmation: 'RUN_AEO_CANDIDATE_VERTICAL',
  };
}

function isAeoProducedArtifact(item: AeoArtifactIndexEntry): boolean {
  return [
    'AUTHORING_BOOTSTRAP',
    'WORKING_COPY',
    'DRAFT_PACKAGE',
    'WORD_EXPORT',
    'RELEASE_PACKAGE',
    'XML_EXPORT',
  ].includes(item.artifactKind);
}

function stepBlocked(
  request: AeoHostedCandidateVerticalRequest,
  readiness: AeoHostedCandidateVerticalResult['readiness'],
  steps: AeoArtifactActionResult[],
  session: AeoAuthoringSessionResult,
): AeoHostedCandidateVerticalResult {
  return result(request, readiness, steps, session, [
    {
      code: 'AEO_VALIDATION_STEP_BLOCKED',
      message: `${steps.at(-1)?.action ?? 'UNKNOWN'} 未提交，纵切已显式停止。`,
    },
  ]);
}

function readbackBlocked(
  request: AeoHostedCandidateVerticalRequest,
  readiness: AeoHostedCandidateVerticalResult['readiness'],
  steps: AeoArtifactActionResult[],
  session: AeoAuthoringSessionResult,
  message: string,
): AeoHostedCandidateVerticalResult {
  return result(request, readiness, steps, session, [
    { code: 'AEO_VALIDATION_FINAL_READBACK_FAILED', message },
  ]);
}

function result(
  request: AeoHostedCandidateVerticalRequest,
  readiness: AeoHostedCandidateVerticalResult['readiness'],
  steps: AeoArtifactActionResult[],
  finalSession: AeoAuthoringSessionResult | null,
  validationBlockers: AeoHostedCandidateVerticalResult['validationBlockers'],
): AeoHostedCandidateVerticalResult {
  const lastState = steps.at(-1)?.committedStateVersion ?? null;
  return {
    schemaVersion: AEO_HOSTED_CANDIDATE_VERTICAL_VERSION,
    status: validationBlockers.length === 0 ? 'COMPLETED' : 'BLOCKED',
    workItemId: request.workItemId,
    requestId: request.requestId,
    runId: request.runId,
    initialStateVersion: request.expectedStateVersion,
    finalStateVersion: lastState ?? finalSession?.stateVersion ?? null,
    readiness,
    steps,
    finalSession,
    validationBlockers,
    validationWriteAuthorizations: steps.flatMap((step) =>
      step.validationWriteAuthorization
        ? [step.validationWriteAuthorization]
        : [],
    ),
    authority: 'VALIDATION_CANDIDATES_NOT_APPROVAL_NOT_RELEASE_NOT_DELIVERY',
  };
}
