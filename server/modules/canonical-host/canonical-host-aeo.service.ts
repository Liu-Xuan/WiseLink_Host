import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { FileService } from '@lark-apaas/fullstack-nestjs-core';
import { Inject, Injectable } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import type {
  CanonicalAeoCandidateProjection,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import {
  AEO_ARTIFACT_ACTION_VERSION,
  AEO_ARTIFACT_INDEX_VERSION,
  type AeoArtifactActionResult,
  type AeoArtifactIndexEntry,
  type AeoArtifactPersistReceipt,
  type AeoHostedPlatformBindingDescriptor,
  type AeoRegistrarCommitReceipt,
  type AeoRegistrarCommitRequest,
  type AeoSimilarCandidateSummary,
  type AeoWorkItemReadModel,
  type AeoWorkItemReadRequest,
} from '@shared/aeo-integration';
import {
  AeoAuthoringModule,
  AEO_HOSTED_PLATFORM_PORT_BUNDLE,
  AEO_SAME_WORKITEM_ASSESSMENT_ADAPTER,
  provideAeoSameWorkItemAssessmentAdapter,
  type AeoHostedPlatformPortBundle,
  type AeoSameWorkItemAssessmentAdapterPort,
} from '../aeo-authoring/public-api';
import { AeoArtifactActionService } from '../aeo-authoring/aeo-artifact-action.service';
import { AeoAuthoringSessionService } from '../aeo-authoring/aeo-authoring-session.service';
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

const TARGET_WORK_ITEM_ID = 'WI-9fd1dd58-c7ed-4889-bc67-9a5d3bfbd52e';
const TARGET_DOCUMENT_VERSION_ID =
  'document_version_f4813607b91ee1a20e754e2d';
const TARGET_ASSESSMENT_SHA256 =
  '33fa0888b8b1756b4fdfdfbd849dddc97edc93e938e558cbb53015f16481df22';
const TARGET_ASSESSMENT_BYTE_LENGTH = 2_570_655;
const TARGET_PACKAGE_SHA256 =
  '84d37eda63352934a69f7b1b37c0e174b74c7274e47d9041513e990c5091e1ac';
const TARGET_PACKAGE_BYTE_LENGTH = 273_349;
const TARGET_AEO_IDENTITY = 'AEO-B787-46-0015-R09' as const;
const AEO_OWNER_COMMIT =
  '8a2ea67aea5d60c0c72750a9e539404214296aeb' as const;
const R09_ARTIFACT_REF =
  'artifact://CanonicalArtifactStore/phase10-aeo/r09-authoring-seed';
const R09_SHA256 =
  'f781b660dbc8457c800dae5e5d0d4cbef877f6d591985f4fe5f8f118dbbfa80d';
const R09_BYTE_LENGTH = 78_811;

const CANONICAL_ROLES = [
  'CanonicalMiaodaApp',
  'CanonicalAily',
  'CanonicalWorkItemStore',
  'CanonicalDocumentCatalog',
  'CanonicalArtifactStore',
  'CanonicalUnifiedReader',
] as const;

export interface Phase10AeoCandidateLoopResponse {
  schemaVersion: 'wiselink.3_1.phase10_aeo_candidate_loop.v1';
  status: 'CANDIDATE_WORD_EXPORTED';
  workItem: CanonicalWorkItemProjection;
  transition: [5, 9];
  targetIdentity: typeof TARGET_AEO_IDENTITY;
  disposition: 'ADOPT';
  sourceCandidateCount: number;
  word: {
    artifactRef: string;
    artifactSha256: string;
    byteLength: number;
    mediaType: string;
    ooxmlZipSignature: 'PK';
  };
  authority: {
    candidateOnly: true;
    automaticallyAdopted: false;
    engineeringApproved: false;
    productionPublished: false;
    currentChanged: false;
  };
}

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
    private readonly artifactStore: UnifiedArtifactStorePort,
    private readonly repository: MiaodaWorkItemRepository,
    private readonly fileService: FileService,
  ) {}

  async runPhase10CandidateLoop(
    actor: CanonicalHostActor,
  ): Promise<Phase10AeoCandidateLoopResponse> {
    const runId = phase10RunId();
    const workItem = await this.registrar.getByWorkItemId(TARGET_WORK_ITEM_ID);
    assertExactPhase10Input(workItem);
    const decision = await this.authorization.authorize({
      actor,
      action: 'RUN_AEO_CANDIDATE_LOOP',
      workItemId: workItem.workItemId,
      requestId: workItem.requestId,
      documentVersionId: workItem.source.documentVersionId,
    });
    if (
      decision.allowed !== true ||
      decision.action !== 'RUN_AEO_CANDIDATE_LOOP'
    ) {
      throw new Error('CANONICAL_ACTION_NOT_AUTHORIZED');
    }
    const permission = await this.permissionSnapshots.freshRead({
      actor,
      decision,
      workItemId: workItem.workItemId,
      requestId: workItem.requestId,
      documentVersionId: workItem.source.documentVersionId,
    });
    if (
      !permission.permissionSnapshotVersion ||
      permission.permissionSnapshotVersion !==
        decision.permissionSnapshotVersion
    ) {
      throw new Error('AEO_PERMISSION_SNAPSHOT_CHANGED');
    }
    const attempt = await this.repository.reserveAssessmentAction({
      workItemId: workItem.workItemId,
      actionType: 'RUN_AEO_CANDIDATE_LOOP',
      triggerRequestId: workItem.requestId,
      requestOrigin: 'MIAODA',
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
      attemptNo: 1,
    });
    if (!attempt.created) {
      throw new Error('AEO_CANDIDATE_LOOP_ALREADY_ATTEMPTED');
    }

    let context: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | null = null;
    try {
      const [assessmentBytes, sourcePackageBytes, r09Bytes] = await Promise.all([
        this.artifactStore.readActualBytes(workItem.assessment!.artifact),
        this.artifactStore.readActualBytes(workItem.package!.artifact),
        readR09Bytes(),
      ]);
      assertBytes(
        assessmentBytes,
        TARGET_ASSESSMENT_SHA256,
        TARGET_ASSESSMENT_BYTE_LENGTH,
        'AEO_ASSESSMENT_ACTUAL_BYTES_MISMATCH',
      );
      assertBytes(
        sourcePackageBytes,
        TARGET_PACKAGE_SHA256,
        TARGET_PACKAGE_BYTE_LENGTH,
        'AEO_SOURCE_PACKAGE_ACTUAL_BYTES_MISMATCH',
      );
      assertBytes(
        r09Bytes,
        R09_SHA256,
        R09_BYTE_LENGTH,
        'AEO_R09_SEED_ACTUAL_BYTES_MISMATCH',
      );

      const r09 = JSON.parse(Buffer.from(r09Bytes).toString('utf8')) as {
        parsePackageId: string;
      };
      const seed = r09Seed(r09.parsePackageId, r09Bytes);
      const bundle = new Phase10AeoHostedBundle({
        actor,
        registrar: this.registrar,
        fileService: this.fileService,
        initialWorkItem: seed,
        initialBytes: new Map([[R09_ARTIFACT_REF, r09Bytes]]),
        attemptId: attempt.attemptId,
      });
      context = await NestFactory.createApplicationContext(
        AeoAuthoringModule.forRoot({
          hostedPlatformBundleProvider: {
            provide: AEO_HOSTED_PLATFORM_PORT_BUNDLE,
            useValue: bundle,
          },
          sameWorkItemAssessmentAdapterProvider:
            provideAeoSameWorkItemAssessmentAdapter(),
        }),
        { logger: false },
      );
      const adapter = context.get<AeoSameWorkItemAssessmentAdapterPort>(
        AEO_SAME_WORKITEM_ASSESSMENT_ADAPTER,
      );
      const adapted = adapter.adapt({
        canonicalWorkItem: workItem,
        assessmentActualBytes: assessmentBytes,
        sourceParsedPackageActualBytes: sourcePackageBytes,
        authoringSeed: seed.authoringSeed,
        authoringSeedActualBytes: r09Bytes,
        aeoTargetIdentity: {
          value: 'AEO-B787-46-0015',
          confirmationStatus: 'HUMAN_CONFIRMED',
          authority: 'CANONICAL_WORKITEM_SERVER_FRESH_READ',
          confirmationRef:
            'artifact://canonical-host/phase10/AEO-B787-46-0015-R09-target-confirmation',
        },
        acceptedOemReferences: [],
        observedAt: new Date().toISOString(),
      });
      const authorizedAeoWorkItem = structuredClone(adapted.workItem);
      authorizedAeoWorkItem.permissionSnapshotVersion =
        permission.permissionSnapshotVersion;
      bundle.activate(authorizedAeoWorkItem, adapted.candidates, [
        ...adapted.referenceArtifacts,
      ]);
      const actions = context.get(AeoArtifactActionService);
      const sessions = context.get(AeoAuthoringSessionService);
      const common = {
        schemaVersion: AEO_ARTIFACT_ACTION_VERSION,
        workItemId: workItem.workItemId,
        requestId: workItem.requestId,
        requesterRef: `miaoda-user://${actor.userId}`,
        permissionSnapshotVersion: permission.permissionSnapshotVersion,
        runId,
      } as const;

      const bootstrap = requireCommitted(await actions.executeFromAuthenticatedHost({
        ...common,
        action: 'BOOTSTRAP_FROM_PARSED_PACKAGE',
        expectedStateVersion: 5,
        idempotencyKey: `${runId}:bootstrap`,
      }));
      let session = await sessions.open({
        workItemId: common.workItemId,
        requestId: common.requestId,
        requesterRef: common.requesterRef,
        permissionSnapshotVersion: common.permissionSnapshotVersion,
        expectedStateVersion: bootstrap.committedStateVersion!,
      });
      if (session.status !== 'READY' || !session.projection) {
        throw new Error('AEO_BOOTSTRAP_SESSION_NOT_READY');
      }
      const candidate = adapted.candidates[0];
      const targetBlock = session.projection.blockManifest[0];
      if (!candidate || !targetBlock) {
        throw new Error('AEO_ADOPT_CANDIDATE_OR_TARGET_REQUIRED');
      }
      const working = requireCommitted(await actions.executeFromAuthenticatedHost({
        ...common,
        action: 'PERSIST_WORKING_COPY',
        expectedStateVersion: 6,
        idempotencyKey: `${runId}:working:adopt`,
        expectedWorkingRevision: session.workingRevision,
        expectedContentHash: session.contentHash,
        projection: session.projection,
        transactions: session.transactions,
        candidateDisposition: {
          candidateId: candidate.candidateId,
          targetBlockId: targetBlock.blockId,
          usage: 'ADOPT',
          decisionNote:
            'Phase10 DEV candidate-only ADOPT for explicit review; not engineering approval.',
        },
      }));
      const draft = requireCommitted(await actions.executeFromAuthenticatedHost({
        ...common,
        action: 'FREEZE_DRAFT_PACKAGE',
        expectedStateVersion: 7,
        idempotencyKey: `${runId}:draft`,
        workingArtifactRef: working.artifact!.artifactRef,
        workingArtifactSha256: working.artifact!.artifactSha256,
        expectedWorkingRevision: working.artifact!.workingRevision!,
      }));
      const word = requireCommitted(await actions.executeFromAuthenticatedHost({
        ...common,
        action: 'EXPORT_WORD_CANDIDATE',
        expectedStateVersion: 8,
        idempotencyKey: `${runId}:word`,
        draftArtifactRef: draft.artifact!.artifactRef,
        draftArtifactSha256: draft.artifact!.artifactSha256,
      }));
      const wordBytes = await bundle.readActualBytes(word.artifact!.artifactRef);
      if (Buffer.from(wordBytes).subarray(0, 2).toString('ascii') !== 'PK') {
        throw new Error('AEO_WORD_CANDIDATE_NOT_OOXML');
      }
      const updated = await this.registrar.getByWorkItemId(workItem.workItemId);
      if (
        updated.revision !== 9 ||
        updated.aeo?.status !== 'CANDIDATE_WORD_EXPORTED'
      ) {
        throw new Error('AEO_FINAL_WORK_ITEM_READBACK_MISMATCH');
      }
      await this.repository.completeAssessmentAction(attempt.attemptId);
      return {
        schemaVersion: 'wiselink.3_1.phase10_aeo_candidate_loop.v1',
        status: 'CANDIDATE_WORD_EXPORTED',
        workItem: updated,
        transition: [5, 9],
        targetIdentity: TARGET_AEO_IDENTITY,
        disposition: 'ADOPT',
        sourceCandidateCount: adapted.candidates.filter(
          (item) => item.sourceKind === 'SB_SOURCE',
        ).length,
        word: {
          artifactRef: word.artifact!.artifactRef,
          artifactSha256: word.artifact!.artifactSha256,
          byteLength: wordBytes.byteLength,
          mediaType: word.artifact!.mediaType,
          ooxmlZipSignature: 'PK',
        },
        authority: {
          candidateOnly: true,
          automaticallyAdopted: false,
          engineeringApproved: false,
          productionPublished: false,
          currentChanged: false,
        },
      };
    } catch (error) {
      await this.repository.failAssessmentAction({
        attemptId: attempt.attemptId,
        errorCode: errorCode(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      await context?.close();
    }
  }
}

class Phase10AeoHostedBundle implements AeoHostedPlatformPortBundle {
  private workItem: AeoWorkItemReadModel;
  private candidates: AeoSimilarCandidateSummary[] = [];
  private readonly memoryBytes: Map<string, Uint8Array>;
  private readonly stored = new Map<
    string,
    { bucketId: string; filePath: string; sha256: string; byteLength: number; mediaType: string }
  >();

  constructor(
    private readonly input: {
      actor: CanonicalHostActor;
      registrar: CanonicalWorkItemRegistrarPort;
      fileService: FileService;
      initialWorkItem: AeoWorkItemReadModel;
      initialBytes: Map<string, Uint8Array>;
      attemptId: string;
    },
  ) {
    this.workItem = structuredClone(input.initialWorkItem);
    this.memoryBytes = new Map(
      [...input.initialBytes].map(([key, bytes]) => [key, Uint8Array.from(bytes)]),
    );
  }

  activate(
    workItem: AeoWorkItemReadModel,
    candidates: AeoSimilarCandidateSummary[],
    references: Array<{ artifactRef: string; bytes: Uint8Array }>,
  ): void {
    this.workItem = structuredClone(workItem);
    this.candidates = structuredClone(candidates);
    for (const reference of references) {
      this.memoryBytes.set(reference.artifactRef, Uint8Array.from(reference.bytes));
    }
  }

  describe(): AeoHostedPlatformBindingDescriptor {
    return {
      schemaVersion: 'wiselink.3_1.aeo_hosted_platform_binding.v0.candidate.5',
      bindingId: 'binding://canonical-host/phase10-validation-only',
      bindingRevision: AEO_OWNER_COMMIT,
      mode: 'ACTIVE',
      activationManifest: null,
      activationManifestSha256: null,
      authority: 'BINDING_DESCRIPTOR_NOT_WRITE_AUTHORIZATION',
    };
  }

  resolveAll() {
    const resolutionVersion = 'canonical-host.phase10.validation-only';
    return {
      resolutionVersion,
      roles: CANONICAL_ROLES.map((role) => ({
        role,
        status: 'VERIFIED_CANONICAL' as const,
        resolutionVersion,
        exactIdentityRef: `miaoda://app_17bzc551rsg/${role}`,
        tenantRef: this.input.actor.tenantId,
        environmentRef: this.input.actor.env,
        accessBaseUrl:
          role === 'CanonicalMiaodaApp'
            ? 'https://hv5zjf4j8yb.feishuapp.com/app/app_17bzc551rsg'
            : null,
        verifiedAt: new Date().toISOString(),
      })),
    };
  }

  async read(request: AeoWorkItemReadRequest): Promise<AeoWorkItemReadModel> {
    if (
      request.workItemId !== this.workItem.workItemId ||
      request.permissionSnapshotVersion !== this.workItem.permissionSnapshotVersion
    ) {
      throw new Error('AEO_WORK_ITEM_READ_IDENTITY_MISMATCH');
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
    if (input.workItemId !== TARGET_WORK_ITEM_ID || input.bytes.byteLength < 1) {
      throw new Error('AEO_ARTIFACT_INPUT_INVALID');
    }
    const bytes = Uint8Array.from(input.bytes);
    const digest = sha256(bytes);
    const extension = input.artifactKind === 'WORD_EXPORT' ? 'docx' : 'json';
    const filePath =
      `aeo-candidate-artifacts/${input.artifactKind.toLowerCase()}/` +
      `${digest}.${extension}`;
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
      request.permissionSnapshotVersion !== this.workItem.permissionSnapshotVersion
    ) {
      throw new Error('AEO_WORK_ITEM_CAS_PRECONDITION_FAILED');
    }
    const current = await this.input.registrar.getByWorkItemId(request.workItemId);
    if (current.revision !== request.expectedStateVersion) {
      throw new Error('WORK_ITEM_CAS_CONFLICT');
    }
    const artifacts = [
      ...(current.aeo?.artifacts ?? []),
      {
        artifactKind: request.artifact.artifactKind as CanonicalAeoCandidateProjection['artifacts'][number]['artifactKind'],
        artifactRef: request.artifact.artifactRef,
        artifactSha256: request.artifact.artifactSha256,
        byteLength: request.artifact.byteLength,
        mediaType: request.artifact.mediaType,
        state: request.artifact.state,
      },
    ];
    const projection: CanonicalAeoCandidateProjection = {
      status:
        request.action === 'EXPORT_WORD_CANDIDATE'
          ? 'CANDIDATE_WORD_EXPORTED'
          : 'CANDIDATE_AUTHORING_IN_PROGRESS',
      targetIdentity: TARGET_AEO_IDENTITY,
      disposition: 'ADOPT',
      authorityLevel: 'candidate_only',
      sourceCandidateCount: this.candidates.filter(
        (item) => item.sourceKind === 'SB_SOURCE',
      ).length,
      automaticallyAdopted: false,
      engineeringApproved: false,
      actionAttemptId: this.input.attemptId,
      ownerCommit: AEO_OWNER_COMMIT,
      artifacts,
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
    this.workItem.aeo.stateVersion = `AEO-STATE-${next.revision}`;
    this.workItem.aeo.state = request.nextAeoState;
    this.workItem.artifactIndex.push(structuredClone(request.artifact));
    return {
      decisionId: `AEO-CAS:${this.input.attemptId}:${next.revision}`,
      committedStateVersion: next.revision,
      replayed: false,
    };
  }
}

function r09Seed(
  parsePackageId: string,
  bytes: Uint8Array,
): AeoWorkItemReadModel {
  const document = {
    documentId: 'DOC-AEO-001',
    documentVersionId: 'DOCV-AEO-001-R09',
    classificationStatus: 'CONFIRMED' as const,
    catalogRole: 'CanonicalDocumentCatalog' as const,
    classificationFingerprint: `sha256:${'d'.repeat(64)}`,
  };
  const parsedPackage = {
    packageId: parsePackageId,
    artifactRef: R09_ARTIFACT_REF,
    artifactSha256: sha256(bytes),
    contractId: 'aeo_structured_parse_v1',
    contractRevision: 'candidate.1',
    readerReceiptId: 'READER-AEO-PHASE10-R09',
    readerRevision: 'aeo-structured-parse-reader.candidate.1',
    validationStatus: 'ACCEPTED' as const,
  };
  return {
    schemaVersion: AEO_ARTIFACT_INDEX_VERSION,
    workItemId: 'WI-AEO-PHASE10-SEED',
    requestId: 'REQ-AEO-PHASE10-SEED',
    stateVersion: 1,
    permissionSnapshotVersion: 'PERM-AEO-PHASE10-SEED',
    sourceDocumentFamily: 'AEO',
    authoringPurpose: 'AEO',
    aeoTargetIdentity: {
      value: TARGET_AEO_IDENTITY,
      confirmationStatus: 'HUMAN_CONFIRMED',
      authority: 'CANONICAL_WORKITEM_SERVER_FRESH_READ',
      confirmationRef:
        'artifact://canonical-host/phase10/r09-target-confirmation',
    },
    validationRun: null,
    sourceContext: {
      document,
      parsedPackage: {
        ...parsedPackage,
        fullValidatorRevision: parsedPackage.readerRevision,
      },
      assessment: null,
    },
    authoringSeed: {
      document: { ...document, family: 'AEO' },
      parsedPackage,
      aeoIdentity: TARGET_AEO_IDENTITY,
    },
    aeo: {
      state: 'PARSE_READY',
      stateVersion: 'AEO-STATE-1',
      summary: 'Exact R09 authoring seed; DEV candidate only.',
      blockers: [],
    },
    artifactIndex: [],
    todos: [],
    observedAt: new Date().toISOString(),
  };
}

function assertExactPhase10Input(workItem: CanonicalWorkItemProjection): void {
  if (
    workItem.workItemId !== TARGET_WORK_ITEM_ID ||
    workItem.revision !== 5 ||
    workItem.phase !== 'CANDIDATE_READBACK_VERIFIED' ||
    workItem.source.documentVersionId !== TARGET_DOCUMENT_VERSION_ID ||
    workItem.package?.artifact.sha256 !== TARGET_PACKAGE_SHA256 ||
    workItem.package.artifact.byteLength !== TARGET_PACKAGE_BYTE_LENGTH ||
    workItem.assessment?.status !== 'CANDIDATE_ONLY_RESYNTHESIZED' ||
    workItem.assessment.artifact.sha256 !== TARGET_ASSESSMENT_SHA256 ||
    workItem.assessment.artifact.byteLength !== TARGET_ASSESSMENT_BYTE_LENGTH ||
    workItem.aeo
  ) {
    throw new Error('AEO_PHASE10_EXACT_INPUT_MISMATCH');
  }
}

function phase10RunId(): string {
  if (process.env.WL_PHASE10_AEO_VALIDATION_ENABLED !== 'true') {
    throw Object.assign(new Error('AEO_PHASE10_VALIDATION_DISABLED'), {
      statusCode: 403,
    });
  }
  const runId = process.env.WL_PHASE10_AEO_VALIDATION_RUN_ID?.trim();
  if (!runId) {
    throw Object.assign(new Error('AEO_PHASE10_VALIDATION_RUN_ID_REQUIRED'), {
      statusCode: 403,
    });
  }
  return runId;
}

async function readR09Bytes(): Promise<Uint8Array> {
  return readFile(
    resolve(
      __dirname,
      '../../runtime-assets/phase10-aeo/aeo-r09-authoring-seed.json',
    ),
  );
}

function requireCommitted(
  result: AeoArtifactActionResult,
): AeoArtifactActionResult {
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
