import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { FileService } from '@lark-apaas/fullstack-nestjs-core';
import { Inject, Injectable } from '@nestjs/common';

import type {
  CanonicalAeoCandidateProjection,
  CanonicalAeoCandidateRunResponse,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import {
  AEO_ARTIFACT_ACTION_VERSION,
  AEO_ARTIFACT_INDEX_VERSION,
  type AeoArtifactIndexEntry,
  type AeoArtifactPersistReceipt,
  type AeoRegistrarCommitReceipt,
  type AeoRegistrarCommitRequest,
  type AeoSimilarCandidateSummary,
  type AeoWorkItemReadModel,
  type AeoWorkItemReadRequest,
} from '@shared/aeo-integration';
import {
  AeoArtifactActionService,
  AeoAuthoringSessionService,
  AeoReviewedIntegratedAssessmentConsumer,
  type AeoArtifactStorePort,
  type AeoHubRegistrarPort,
  type AeoSimilarSearchPort,
  type AeoWorkItemReadPort,
} from '../aeo-authoring/public-api';
import { UNIFIED_ARTIFACT_STORE } from '../unified-reader/unified-reader.constants';
import type { UnifiedArtifactStorePort } from '../unified-reader/unified-reader.types';
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';
import {
  CANONICAL_AUTHORIZATION,
  CANONICAL_PERMISSION_SNAPSHOT,
  CANONICAL_WORK_ITEM_REGISTRAR,
} from './canonical-host.constants';
import type {
  CanonicalAuthorizationPort,
  CanonicalHostActor,
  CanonicalPermissionSnapshotPort,
  CanonicalWorkItemRegistrarPort,
} from './canonical-host.types';
import { authorizeAndLoadCanonicalWorkItem } from './canonical-authorized-work-item-reader';

const AEO_OWNER_COMMIT = '74333547ae5cd1878259812353d59563cc9041da' as const;
const R09_TEMPLATE_IDENTITY = 'AEO-B787-46-0015-R09';
const R09_TEMPLATE_ARTIFACT_REF =
  'artifact://CanonicalArtifactStore/aeo-authoring/templates/r09-controlled-template.json';
const R09_TEMPLATE_SHA256 =
  'f781b660dbc8457c800dae5e5d0d4cbef877f6d591985f4fe5f8f118dbbfa80d';
const R09_TEMPLATE_BYTE_LENGTH = 78_811;

@Injectable()
export class CanonicalHostAeoService {
  constructor(
    @Inject(CANONICAL_WORK_ITEM_REGISTRAR)
    private readonly registrar: CanonicalWorkItemRegistrarPort,
    @Inject(CANONICAL_AUTHORIZATION)
    private readonly authorization: CanonicalAuthorizationPort,
    @Inject(CANONICAL_PERMISSION_SNAPSHOT)
    private readonly permissionSnapshots: CanonicalPermissionSnapshotPort,
    @Inject(UNIFIED_ARTIFACT_STORE)
    private readonly unifiedArtifacts: UnifiedArtifactStorePort,
    private readonly repository: MiaodaWorkItemRepository,
    private readonly fileService: FileService,
    private readonly reviewedAssessment: AeoReviewedIntegratedAssessmentConsumer,
  ) {}

  async generateCandidate(
    workItemId: string,
    actor: CanonicalHostActor,
  ): Promise<CanonicalAeoCandidateRunResponse> {
    let authorized = await this.authorizeAndLoad(workItemId, actor);
    let canonical = requiredAeoInput(authorized.workItem);
    assertAeoPermissionSnapshot(
      canonical,
      authorized.permissionSnapshotVersion,
    );
    const permissionSnapshotVersion = authorized.permissionSnapshotVersion;

    if (canonical.aeo?.status === 'CANDIDATE_WORD_EXPORTED') {
      const integrated = requiredConfirmedOverall(canonical, false);
      assertAeoBindsCurrentOverall(canonical.aeo, integrated);
      return response(canonical, true);
    }

    const integrated = requiredConfirmedOverall(canonical, true);
    const targetIdentity = deriveCandidateTarget(canonical);
    const attempt = await this.repository.reserveAssessmentAction({
      workItemId: canonical.workItemId,
      actionType: 'RUN_AEO_CANDIDATE_LOOP',
      triggerRequestId: canonical.requestId,
      requestOrigin: 'MIAODA',
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
      attemptNo: 1,
    });
    if (!attempt.created) {
      authorized = await this.authorizeAndLoad(workItemId, actor);
      canonical = requiredAeoInput(authorized.workItem);
      assertAeoPermissionSnapshot(
        canonical,
        authorized.permissionSnapshotVersion,
      );
      if (
        canonical.aeo?.status === 'CANDIDATE_WORD_EXPORTED' &&
        canonical.aeo.actionAttemptId === attempt.attemptId
      ) {
        const currentIntegrated = requiredConfirmedOverall(canonical, false);
        assertAeoBindsCurrentOverall(canonical.aeo, currentIntegrated);
        return response(canonical, true);
      }
      throw new Error('AEO_CANDIDATE_LOOP_IN_PROGRESS_OR_INCOMPLETE');
    }

    try {
      const [dynamicBytes, overallBytes, templateBytes] = await Promise.all([
        this.unifiedArtifacts.readActualBytes(integrated.baseRules.artifact),
        this.unifiedArtifacts.readActualBytes(
          integrated.overallSynthesis.artifact,
        ),
        readR09TemplateBytes(),
      ]);
      assertBytes(
        templateBytes,
        R09_TEMPLATE_SHA256,
        R09_TEMPLATE_BYTE_LENGTH,
        'AEO_AUTHORING_TEMPLATE_ACTUAL_BYTES_MISMATCH',
      );

      const template = JSON.parse(
        Buffer.from(templateBytes).toString('utf8'),
      ) as { parsePackageId?: unknown };
      if (
        typeof template.parsePackageId !== 'string' ||
        template.parsePackageId.trim() === ''
      ) {
        throw new Error('AEO_AUTHORING_TEMPLATE_PACKAGE_ID_REQUIRED');
      }

      const serverDerived = makeAeoWorkItem({
        canonical,
        permissionSnapshotVersion,
        targetIdentity,
        templatePackageId: template.parsePackageId,
      });
      const consumed = this.reviewedAssessment.consume({
        canonicalWorkItem: canonical,
        serverDerivedAeoWorkItem: serverDerived,
        dynamicEvaluationActualBytes: { bytes: dynamicBytes },
        overallActualBytes: { bytes: overallBytes },
        overallHumanConfirmation: {
          status: 'HUMAN_CONFIRMED',
          authority: 'CANONICAL_WORKITEM_SERVER_FRESH_READ',
          confirmationRef:
            `artifact://canonical-host/work-items/${canonical.workItemId}/` +
            `overall-confirmations/${integrated.overallForAeoConfirmation.actionAttemptId}`,
          workItemId: canonical.workItemId,
          workItemRevision: canonical.revision,
          overallArtifactRef: integrated.overallSynthesis.artifact.ref,
          overallArtifactSha256: integrated.overallSynthesis.artifact.sha256,
        },
      });

      const context = new CanonicalAeoActionContext({
        actor,
        registrar: this.registrar,
        fileService: this.fileService,
        workItem: consumed.workItem,
        candidates: consumed.candidates,
        targetIdentity,
        attemptId: attempt.attemptId,
        sourceOverall: {
          revision: integrated.overallSynthesis.revision,
          artifactRef: integrated.overallSynthesis.artifact.ref,
          artifactSha256: integrated.overallSynthesis.artifact.sha256,
          confirmationActionAttemptId:
            integrated.overallForAeoConfirmation.actionAttemptId,
          confirmedWorkItemRevision:
            integrated.overallForAeoConfirmation.workItemRevision,
          engineerReviewRevision:
            integrated.overallSynthesis.basedOnEngineerReviewRevision,
          engineerReviewArtifactSha256:
            integrated.overallSynthesis.basedOnEngineerReviewArtifactSha256,
        },
        initialBytes: new Map([
          [R09_TEMPLATE_ARTIFACT_REF, templateBytes],
          ...consumed.referenceArtifacts.map(
            (item) => [item.artifactRef, item.bytes] as const,
          ),
        ]),
      });
      const actions = new AeoArtifactActionService(
        context,
        context,
        context,
        context,
      );
      const sessions = new AeoAuthoringSessionService(
        context,
        context,
        context,
      );
      const runId = `AEO-${stableSuffix(canonical)}`;
      const common = {
        schemaVersion: AEO_ARTIFACT_ACTION_VERSION,
        workItemId: canonical.workItemId,
        requestId: canonical.requestId,
        requesterRef: `miaoda-user://${actor.userId}`,
        permissionSnapshotVersion,
        runId,
      } as const;

      const bootstrap = requireCommitted(
        await actions.executeFromAuthenticatedHost({
          ...common,
          action: 'BOOTSTRAP_FROM_PARSED_PACKAGE',
          expectedStateVersion: canonical.revision,
          idempotencyKey: `${runId}:bootstrap`,
        }),
      );
      const session = await sessions.open({
        workItemId: canonical.workItemId,
        requestId: canonical.requestId,
        requesterRef: common.requesterRef,
        permissionSnapshotVersion,
        expectedStateVersion: requiredCommittedRevision(bootstrap),
      });
      if (session.status !== 'READY' || !session.projection) {
        throw new Error('AEO_BOOTSTRAP_SESSION_NOT_READY');
      }
      const candidate = consumed.candidates[0];
      const targetBlock = session.projection.blockManifest[0];
      if (!candidate || !targetBlock) {
        throw new Error('AEO_CANDIDATE_OR_TARGET_BLOCK_REQUIRED');
      }

      const working = requireCommitted(
        await actions.executeFromAuthenticatedHost({
          ...common,
          action: 'PERSIST_WORKING_COPY',
          expectedStateVersion: requiredCommittedRevision(bootstrap),
          idempotencyKey: `${runId}:working`,
          expectedWorkingRevision: session.workingRevision,
          expectedContentHash: session.contentHash,
          projection: session.projection,
          transactions: session.transactions,
          candidateDisposition: {
            candidateId: candidate.candidateId,
            targetBlockId: targetBlock.blockId,
            usage: 'ADOPT',
            decisionNote:
              '工程师显式生成 candidate-only AEO working copy；' +
              '该处置不构成工程批准、正式发布或适航结论。',
          },
        }),
      );
      const draft = requireCommitted(
        await actions.executeFromAuthenticatedHost({
          ...common,
          action: 'FREEZE_DRAFT_PACKAGE',
          expectedStateVersion: requiredCommittedRevision(working),
          idempotencyKey: `${runId}:draft`,
          workingArtifactRef: requiredArtifact(working).artifactRef,
          workingArtifactSha256: requiredArtifact(working).artifactSha256,
          expectedWorkingRevision:
            requiredArtifact(working).workingRevision ?? 0,
        }),
      );
      const word = requireCommitted(
        await actions.executeFromAuthenticatedHost({
          ...common,
          action: 'EXPORT_WORD_CANDIDATE',
          expectedStateVersion: requiredCommittedRevision(draft),
          idempotencyKey: `${runId}:word`,
          draftArtifactRef: requiredArtifact(draft).artifactRef,
          draftArtifactSha256: requiredArtifact(draft).artifactSha256,
        }),
      );
      const wordBytes = await context.readActualBytes(
        requiredArtifact(word).artifactRef,
      );
      if (Buffer.from(wordBytes).subarray(0, 2).toString('ascii') !== 'PK') {
        throw new Error('AEO_WORD_CANDIDATE_NOT_OOXML');
      }

      const finalAuthorized = await this.authorizeAndLoad(
        canonical.workItemId,
        actor,
      );
      const updated = finalAuthorized.workItem;
      if (
        updated.aeo?.status !== 'CANDIDATE_WORD_EXPORTED' ||
        updated.aeo.targetIdentity !== targetIdentity ||
        updated.aeo.artifacts.length !== 4
      ) {
        throw new Error('AEO_FINAL_WORKITEM_READBACK_MISMATCH');
      }
      await this.repository.completeAssessmentAction(attempt.attemptId);
      return response(updated, false);
    } catch (error) {
      await this.repository.failAssessmentAction({
        attemptId: attempt.attemptId,
        errorCode: errorCode(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private authorizeAndLoad(workItemId: string, actor: CanonicalHostActor) {
    return authorizeAndLoadCanonicalWorkItem({
      authorization: this.authorization,
      permissionSnapshots: this.permissionSnapshots,
      registrar: this.registrar,
      actor,
      action: 'RUN_AEO_CANDIDATE_LOOP',
      workItemId,
    });
  }
}

function requiredAeoInput(
  workItem: CanonicalWorkItemProjection,
): CanonicalWorkItemProjection {
  if (
    workItem.phase !== 'CANDIDATE_READBACK_VERIFIED' ||
    !workItem.package ||
    workItem.classification.status !== 'CONFIRMED' ||
    workItem.classification.normalizedFamily !== 'SB'
  ) {
    throw new Error('AEO_CANDIDATE_SOURCE_NOT_READY');
  }
  return workItem;
}

function assertAeoPermissionSnapshot(
  workItem: CanonicalWorkItemProjection,
  permissionSnapshotVersion: string,
): void {
  if (workItem.permissionSnapshotVersion !== permissionSnapshotVersion) {
    throw new Error('AEO_PERMISSION_SNAPSHOT_CHANGED');
  }
}

class CanonicalAeoActionContext
  implements
    AeoWorkItemReadPort,
    AeoSimilarSearchPort,
    AeoArtifactStorePort,
    AeoHubRegistrarPort
{
  private workItem: AeoWorkItemReadModel;
  private readonly candidates: AeoSimilarCandidateSummary[];
  private readonly memoryBytes: Map<string, Uint8Array>;
  private readonly stored = new Map<
    string,
    {
      bucketId: string;
      filePath: string;
      sha256: string;
      byteLength: number;
      mediaType: string;
    }
  >();

  constructor(
    private readonly input: {
      actor: CanonicalHostActor;
      registrar: CanonicalWorkItemRegistrarPort;
      fileService: FileService;
      workItem: AeoWorkItemReadModel;
      candidates: AeoSimilarCandidateSummary[];
      targetIdentity: string;
      attemptId: string;
      sourceOverall: CanonicalAeoCandidateProjection['sourceOverall'];
      initialBytes: Map<string, Uint8Array>;
    },
  ) {
    this.workItem = structuredClone(input.workItem);
    this.candidates = structuredClone(input.candidates);
    this.memoryBytes = new Map(
      [...input.initialBytes].map(([ref, bytes]) => [
        ref,
        Uint8Array.from(bytes),
      ]),
    );
  }

  async read(request: AeoWorkItemReadRequest): Promise<AeoWorkItemReadModel> {
    if (
      request.workItemId !== this.workItem.workItemId ||
      request.requesterRef !== `miaoda-user://${this.input.actor.userId}` ||
      request.permissionSnapshotVersion !==
        this.workItem.permissionSnapshotVersion
    ) {
      throw new Error('AEO_WORKITEM_READ_IDENTITY_MISMATCH');
    }
    return structuredClone(this.workItem);
  }

  async search(): Promise<AeoSimilarCandidateSummary[]> {
    return structuredClone(this.candidates);
  }

  async persistImmutable(input: {
    workItemId: string;
    idempotencyKey: string;
    artifactKind: AeoArtifactIndexEntry['artifactKind'];
    mediaType: string;
    bytes: Uint8Array;
  }): Promise<AeoArtifactPersistReceipt> {
    if (
      input.workItemId !== this.workItem.workItemId ||
      input.bytes.byteLength < 1
    ) {
      throw new Error('AEO_ARTIFACT_INPUT_INVALID');
    }
    const bytes = Uint8Array.from(input.bytes);
    const digest = sha256(bytes);
    const extension = input.artifactKind === 'WORD_EXPORT' ? 'docx' : 'json';
    const filePath =
      `aeo-candidate-artifacts/${safePathSegment(input.workItemId)}/` +
      `${input.artifactKind.toLowerCase()}/${digest}.${extension}`;
    const bucketId = await this.input.fileService.getDefaultBucket();
    const scoped = this.input.fileService.from(bucketId);
    const existing = await scoped.getFileMetadata(filePath);
    if (existing === null) {
      const uploaded = await scoped.upload(bytes, {
        filePath,
        fileName: `${digest}.${extension}`,
        contentType: input.mediaType,
        upsert: false,
      });
      if (canonicalPath(uploaded.filePath) !== canonicalPath(filePath)) {
        throw new Error('AEO_ARTIFACT_UPLOAD_PATH_MISMATCH');
      }
    }
    const ref = `artifact://CanonicalArtifactStore/${filePath}`;
    this.stored.set(ref, {
      bucketId,
      filePath,
      sha256: digest,
      byteLength: bytes.byteLength,
      mediaType: input.mediaType,
    });
    const actual = await this.readActualBytes(ref);
    if (!sameBytes(bytes, actual)) {
      throw new Error('AEO_ARTIFACT_ACTUAL_BYTE_MISMATCH');
    }
    return {
      artifactRef: ref,
      artifactSha256: digest,
      byteLength: bytes.byteLength,
      mediaType: input.mediaType,
    };
  }

  async readActualBytes(artifactRef: string): Promise<Uint8Array> {
    const memory = this.memoryBytes.get(artifactRef);
    if (memory) return Uint8Array.from(memory);
    const descriptor = this.stored.get(artifactRef);
    if (!descriptor) throw new Error('AEO_ARTIFACT_INPUT_NOT_FOUND');
    const scoped = this.input.fileService.from(descriptor.bucketId);
    const metadata = await scoped.getFileMetadata(descriptor.filePath);
    if (
      metadata === null ||
      metadata.bucketID !== descriptor.bucketId ||
      canonicalPath(metadata.filePath) !== canonicalPath(descriptor.filePath) ||
      Number(metadata.metadata?.contentLength) !== descriptor.byteLength ||
      metadata.metadata?.mimeType !== descriptor.mediaType
    ) {
      throw new Error('AEO_ARTIFACT_READBACK_MISMATCH:METADATA');
    }
    const downloaded = await scoped.download(descriptor.filePath);
    const bytes = await bodyBytes(downloaded.content);
    if (
      bytes.byteLength !== descriptor.byteLength ||
      sha256(bytes) !== descriptor.sha256
    ) {
      throw new Error('AEO_ARTIFACT_READBACK_MISMATCH:BYTES');
    }
    return bytes;
  }

  async commitArtifact(
    request: AeoRegistrarCommitRequest,
  ): Promise<AeoRegistrarCommitReceipt> {
    if (
      request.workItemId !== this.workItem.workItemId ||
      request.expectedStateVersion !== this.workItem.stateVersion ||
      request.expectedAeoStateVersion !== this.workItem.aeo.stateVersion ||
      request.permissionSnapshotVersion !==
        this.workItem.permissionSnapshotVersion
    ) {
      throw new Error('AEO_WORKITEM_CAS_PRECONDITION_FAILED');
    }
    const current = await this.input.registrar.getTenantScopedByWorkItemId({
      workItemId: request.workItemId,
      tenantId: this.input.actor.tenantId,
    });
    if (current.revision !== request.expectedStateVersion) {
      throw new Error('WORK_ITEM_CAS_CONFLICT');
    }
    const existing = current.aeo?.artifacts.find(
      (item) => item.artifactKind === request.artifact.artifactKind,
    );
    if (existing) {
      if (
        existing.artifactSha256 !== request.artifact.artifactSha256 ||
        existing.artifactRef !== request.artifact.artifactRef
      ) {
        throw new Error('AEO_ARTIFACT_KIND_ALREADY_COMMITTED');
      }
      return {
        decisionId: `AEO-CAS:${this.input.attemptId}:${current.revision}`,
        committedStateVersion: current.revision,
        replayed: true,
      };
    }
    const artifact = {
      artifactKind: request.artifact
        .artifactKind as CanonicalAeoCandidateProjection['artifacts'][number]['artifactKind'],
      artifactRef: request.artifact.artifactRef,
      artifactSha256: request.artifact.artifactSha256,
      byteLength: request.artifact.byteLength,
      mediaType: request.artifact.mediaType,
      state: request.artifact.state,
    };
    const projection: CanonicalAeoCandidateProjection = {
      status:
        request.action === 'EXPORT_WORD_CANDIDATE'
          ? 'CANDIDATE_WORD_EXPORTED'
          : 'CANDIDATE_AUTHORING_IN_PROGRESS',
      targetIdentity: this.input.targetIdentity,
      disposition: 'ADOPT',
      authorityLevel: 'candidate_only',
      sourceCandidateCount: this.candidates.length,
      automaticallyAdopted: false,
      engineeringApproved: false,
      actionAttemptId: this.input.attemptId,
      ownerCommit: AEO_OWNER_COMMIT,
      authoringTemplate: {
        role: 'CONTROLLED_TEMPLATE_SOURCE',
        identity: R09_TEMPLATE_IDENTITY,
        artifactRef: R09_TEMPLATE_ARTIFACT_REF,
        artifactSha256: R09_TEMPLATE_SHA256,
      },
      sourceOverall: structuredClone(this.input.sourceOverall),
      artifacts: [...(current.aeo?.artifacts ?? []), artifact],
    };
    const next = await this.input.registrar.compareAndSet({
      workItemId: current.workItemId,
      expectedRevision: current.revision,
      syncPrimaryAttempt: false,
      next: {
        ...withoutRevision(current),
        aeo: projection,
      },
    });
    this.workItem.stateVersion = next.revision;
    this.workItem.aeo.stateVersion = `AEO-STATE-${next.revision}-${request.artifact.artifactSha256.slice(0, 12)}`;
    this.workItem.aeo.state = request.nextAeoState;
    this.workItem.artifactIndex.push(structuredClone(request.artifact));
    return {
      decisionId: `AEO-CAS:${this.input.attemptId}:${next.revision}`,
      committedStateVersion: next.revision,
      replayed: false,
    };
  }
}

function requiredConfirmedOverall(
  workItem: CanonicalWorkItemProjection,
  requireCurrentRevision: boolean,
) {
  const integrated = workItem.integratedAssessment;
  const overall = integrated?.overallSynthesis;
  const confirmation = integrated?.overallForAeoConfirmation;
  if (
    integrated?.status !== 'OVERALL_CANDIDATE_READY' ||
    !overall ||
    overall.status !== 'CANDIDATE_ONLY' ||
    overall.staleReason !== null ||
    !confirmation ||
    confirmation.status !== 'HUMAN_CONFIRMED' ||
    confirmation.authority !== 'CANONICAL_WORKITEM_SERVER_FRESH_READ' ||
    (requireCurrentRevision
      ? confirmation.workItemRevision !== workItem.revision
      : confirmation.workItemRevision > workItem.revision) ||
    confirmation.overallRevision !== overall.revision ||
    confirmation.overallArtifactRef !== overall.artifact.ref ||
    confirmation.overallArtifactSha256 !== overall.artifact.sha256
  ) {
    throw new Error('AEO_CONFIRMED_OVERALL_NOT_CURRENT');
  }
  const reviews = integrated.engineerReviews ?? null;
  if (
    overall.basedOnEngineerReviewRevision !== (reviews?.revision ?? null) ||
    overall.basedOnEngineerReviewArtifactSha256 !==
      (reviews?.artifact.sha256 ?? null)
  ) {
    throw new Error('AEO_CONFIRMED_OVERALL_REVIEW_BINDING_STALE');
  }
  return {
    ...integrated,
    overallSynthesis: overall,
    overallForAeoConfirmation: confirmation,
  };
}

function assertAeoBindsCurrentOverall(
  aeo: CanonicalAeoCandidateProjection,
  integrated: ReturnType<typeof requiredConfirmedOverall>,
): void {
  const overall = integrated.overallSynthesis;
  const confirmation = integrated.overallForAeoConfirmation;
  if (
    aeo.sourceOverall.revision !== overall.revision ||
    aeo.sourceOverall.artifactRef !== overall.artifact.ref ||
    aeo.sourceOverall.artifactSha256 !== overall.artifact.sha256 ||
    aeo.sourceOverall.confirmationActionAttemptId !==
      confirmation.actionAttemptId ||
    aeo.sourceOverall.confirmedWorkItemRevision !==
      confirmation.workItemRevision ||
    aeo.sourceOverall.engineerReviewRevision !==
      overall.basedOnEngineerReviewRevision ||
    aeo.sourceOverall.engineerReviewArtifactSha256 !==
      overall.basedOnEngineerReviewArtifactSha256
  ) {
    throw new Error('AEO_CANDIDATE_STALE_FOR_CURRENT_OVERALL');
  }
}

function makeAeoWorkItem(input: {
  canonical: CanonicalWorkItemProjection;
  permissionSnapshotVersion: string;
  targetIdentity: string;
  templatePackageId: string;
}): AeoWorkItemReadModel {
  const { canonical } = input;
  const dynamic = canonical.integratedAssessment!.baseRules;
  const overall = canonical.integratedAssessment!.overallSynthesis!;
  return {
    schemaVersion: AEO_ARTIFACT_INDEX_VERSION,
    workItemId: canonical.workItemId,
    requestId: canonical.requestId,
    stateVersion: canonical.revision,
    permissionSnapshotVersion: input.permissionSnapshotVersion,
    sourceDocumentFamily: 'SB',
    authoringPurpose: 'AEO',
    aeoTargetIdentity: {
      value: input.targetIdentity,
      confirmationStatus: 'HUMAN_CONFIRMED',
      authority: 'CANONICAL_WORKITEM_SERVER_FRESH_READ',
      confirmationRef:
        `artifact://canonical-host/work-items/${canonical.workItemId}/` +
        `aeo-targets/${stableSuffix(canonical)}`,
    },
    validationRun: null,
    sourceContext: {
      document: {
        documentId: canonical.source.documentId,
        documentVersionId: canonical.source.documentVersionId,
        classificationStatus: 'CONFIRMED',
        catalogRole: 'CanonicalDocumentCatalog',
        classificationFingerprint: canonical.classification.fingerprint,
      },
      parsedPackage: {
        packageId: canonical.package!.packageId,
        artifactRef: canonical.package!.artifact.ref,
        artifactSha256: canonical.package!.artifact.sha256,
        contractId: canonical.package!.contractId,
        contractRevision: canonical.package!.contractRevision,
        readerReceiptId: canonical.package!.readerReceiptId,
        fullValidatorRevision:
          canonical.package!.fullValidatorProof.validatorRevision,
        validationStatus: 'ACCEPTED',
      },
      assessment: {
        status: 'CANDIDATE_ONLY',
        criterionSetId: dynamic.criterionSetId,
        criterionCount: dynamic.criterionCount,
        evaluationItemCount: dynamic.evaluationItemCount,
        packageStatus:
          canonical.assessment?.packageStatus ?? 'OPENCLAW_DYNAMIC_COMPLETE',
        applicabilityOverall:
          canonical.assessment?.applicabilityOverall ?? '待核实',
        authorityLevel: 'candidate_only',
        blocksEngineeringClosure: true,
        externalDiscoveryStatus: overall.discoveryStatus,
        externalDiscoveryIsEvidence: false,
        previousOverallStale: false,
        staleReason: null,
        currentContextHash: `sha256:${dynamic.artifact.sha256}`,
        currentTransportHash: `sha256:${overall.artifact.sha256}`,
        artifactRef: overall.artifact.ref,
        artifactSha256: overall.artifact.sha256,
        artifactByteLength: overall.artifact.byteLength,
        evaluateAttemptId: dynamic.actionAttemptId,
        resynthesisAttemptId: overall.actionAttemptId,
      },
    },
    authoringSeed: {
      document: {
        documentId: 'CONTROLLED-TEMPLATE-AEO-B787-46-0015',
        documentVersionId: 'CONTROLLED-TEMPLATE-AEO-B787-46-0015-R09',
        family: 'AEO',
        classificationStatus: 'CONFIRMED',
        catalogRole: 'CanonicalDocumentCatalog',
        classificationFingerprint: `sha256:${R09_TEMPLATE_SHA256}`,
      },
      parsedPackage: {
        packageId: input.templatePackageId,
        artifactRef: R09_TEMPLATE_ARTIFACT_REF,
        artifactSha256: R09_TEMPLATE_SHA256,
        contractId: 'aeo_structured_parse_v1',
        contractRevision: 'candidate.1',
        readerReceiptId: 'CONTROLLED-TEMPLATE-R09-READER-RECEIPT',
        readerRevision: 'aeo-structured-parse-reader.candidate.1',
        validationStatus: 'ACCEPTED',
      },
      aeoIdentity: R09_TEMPLATE_IDENTITY,
    },
    aeo: {
      state: 'NOT_STARTED',
      stateVersion: `AEO-STATE-${canonical.revision}-${stableSuffix(canonical)}`,
      summary:
        `候选目标 ${input.targetIdentity}；` +
        `受控模板来源 ${R09_TEMPLATE_IDENTITY}；等待显式 candidate-only 编写。`,
      blockers: ['候选不构成工程批准、正式发布或适航结论。'],
    },
    artifactIndex: [],
    todos: [
      {
        todoId: 'AEO-REVIEW-CANDIDATE',
        label: '工程师复核 AEO Working、Draft 与 Word 候选',
        state: 'OPEN',
      },
    ],
    observedAt: new Date().toISOString(),
  };
}

async function readR09TemplateBytes(): Promise<Uint8Array> {
  const candidates = [
    resolve(
      process.cwd(),
      'dist/server/runtime-assets/aeo-authoring/r09-controlled-template.json',
    ),
    resolve(
      process.cwd(),
      'server/runtime-assets/aeo-authoring/r09-controlled-template.json',
    ),
    resolve(
      __dirname,
      '../../runtime-assets/aeo-authoring/r09-controlled-template.json',
    ),
  ];
  for (const candidate of candidates) {
    try {
      return new Uint8Array(await readFile(candidate));
    } catch {
      // Try the next build/source location.
    }
  }
  throw new Error('AEO_AUTHORING_TEMPLATE_NOT_FOUND');
}

function deriveCandidateTarget(workItem: CanonicalWorkItemProjection): string {
  const source =
    workItem.package?.documentIdentity?.documentCode ??
    workItem.source.documentId;
  const documentCode = source
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48);
  if (!documentCode) throw new Error('AEO_DOCUMENT_CODE_REQUIRED');
  return `AEO-CANDIDATE-${documentCode}-${stableSuffix(workItem)}`;
}

function stableSuffix(workItem: CanonicalWorkItemProjection): string {
  return createHash('sha256')
    .update(
      `${workItem.workItemId}\u0000${workItem.source.documentVersionId}\u0000` +
        `${workItem.integratedAssessment?.overallSynthesis?.artifact.sha256 ?? ''}`,
    )
    .digest('hex')
    .slice(0, 10)
    .toUpperCase();
}

function response(
  workItem: CanonicalWorkItemProjection,
  replayed: boolean,
): CanonicalAeoCandidateRunResponse {
  const aeo = workItem.aeo;
  if (!aeo || aeo.status !== 'CANDIDATE_WORD_EXPORTED') {
    throw new Error('AEO_FINAL_WORKITEM_READBACK_MISMATCH');
  }
  return {
    schemaVersion: 'wiselink.3_1.aeo_candidate_run.v1',
    status: 'CANDIDATE_WORD_EXPORTED',
    workItem,
    aeo,
    replayed,
    baseAiCallCount: 0,
    authority: {
      candidateOnly: true,
      automaticallyAdopted: false,
      engineeringApproved: false,
      productionPublished: false,
      currentChanged: false,
    },
  };
}

function requireCommitted<
  T extends {
    status: string;
    artifact: unknown;
    committedStateVersion: number | null;
    blockers: unknown;
    action: string;
  },
>(result: T): T {
  if (
    result.status !== 'COMMITTED' ||
    !result.artifact ||
    result.committedStateVersion === null
  ) {
    throw new Error(
      `AEO_ACTION_BLOCKED:${result.action}:${JSON.stringify(result.blockers)}`,
    );
  }
  return result;
}

function requiredCommittedRevision(value: {
  committedStateVersion: number | null;
}): number {
  if (value.committedStateVersion === null) {
    throw new Error('AEO_COMMITTED_REVISION_REQUIRED');
  }
  return value.committedStateVersion;
}

function requiredArtifact<T extends { artifact: AeoArtifactIndexEntry | null }>(
  value: T,
): AeoArtifactIndexEntry {
  if (!value.artifact) throw new Error('AEO_COMMITTED_ARTIFACT_REQUIRED');
  return value.artifact;
}

function assertBytes(
  bytes: Uint8Array,
  expectedSha256: string,
  expectedByteLength: number,
  code: string,
): void {
  if (
    bytes.byteLength !== expectedByteLength ||
    sha256(bytes) !== expectedSha256
  ) {
    throw new Error(code);
  }
}

function withoutRevision(
  workItem: CanonicalWorkItemProjection,
): Omit<CanonicalWorkItemProjection, 'revision'> {
  const { revision: _revision, ...rest } = workItem;
  return rest;
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

function safePathSegment(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9_-]+/gu, '-').slice(0, 96);
  if (!safe) throw new Error('AEO_WORKITEM_PATH_INVALID');
  return safe;
}

function canonicalPath(value: string): string {
  return value.replace(/^\/+/, '');
}

async function bodyBytes(body: unknown): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return Uint8Array.from(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (
    body &&
    typeof body === 'object' &&
    'arrayBuffer' in body &&
    typeof body.arrayBuffer === 'function'
  ) {
    return new Uint8Array(await body.arrayBuffer());
  }
  if (
    body &&
    typeof body === 'object' &&
    'getReader' in body &&
    typeof body.getReader === 'function'
  ) {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        const chunk = Uint8Array.from(result.value as Uint8Array);
        chunks.push(chunk);
        byteLength += chunk.byteLength;
      }
    } finally {
      reader.releaseLock?.();
    }
    const output = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }
  throw new Error('AEO_ARTIFACT_READBACK_MISMATCH:BODY');
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String(error.code).slice(0, 160);
  }
  if (error instanceof Error && /^[A-Z0-9_]+/u.test(error.message)) {
    return error.message.split(':', 1)[0].slice(0, 160);
  }
  return 'AEO_CANDIDATE_LOOP_FAILED';
}
