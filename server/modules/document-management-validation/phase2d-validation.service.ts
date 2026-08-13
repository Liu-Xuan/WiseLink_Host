import { Injectable } from '@nestjs/common';
import { FileService } from '@lark-apaas/fullstack-nestjs-core';
import { basename } from 'node:path';

import {
  DocumentManagementHostedService,
  type HostedRequestContext,
} from '../document-management/src/hosted/nest';
import { PHASE2D_VALIDATION_ROLE } from './phase2d-validation-authorizer';

const FIRST = {
  fileName: '777-FTD-31-21002_Doc_07042025.pdf',
  sha256: 'd93100d54ea7e5f7eff9f18ac157e31580d31da45a2dcd4b7248969de823f36c',
  byteLength: 119_387,
} as const;
const NEWER = {
  fileName: '777-FTD-31-21002_Doc_09262025.pdf',
  sha256: 'b1b5c198df4a3d42925218f48d70ddc361563c65692be35dac4c81e0d8367a3c',
  byteLength: 122_102,
} as const;

export interface Phase2dValidationRequest {
  firstFilePath?: unknown;
  newerFilePath?: unknown;
}

@Injectable()
export class Phase2dValidationService {
  constructor(
    private readonly fileService: FileService,
    private readonly documentManagement: DocumentManagementHostedService,
  ) {}

  async run(
    request: Phase2dValidationRequest,
    authenticatedContext: HostedRequestContext,
  ) {
    const runId = process.env.WL_DM_PHASE2D_VALIDATION_RUN_ID?.trim();
    if (!runId) {
      throw Object.assign(new Error('Phase 2D validation run ID is not configured.'), {
        code: 'DOCUMENT_MANAGEMENT_VALIDATION_FORBIDDEN',
        statusCode: 403,
      });
    }
    const firstFilePath = exactValidationFilePath(
      request?.firstFilePath,
      FIRST.fileName,
    );
    const newerFilePath = exactValidationFilePath(
      request?.newerFilePath,
      NEWER.fileName,
    );
    const bucketId = await this.fileService.getDefaultBucket();
    const context: HostedRequestContext = {
      ...authenticatedContext,
      roles: [...authenticatedContext.roles, PHASE2D_VALIDATION_ROLE],
    };
    const ingest = (
      filePath: string,
      stage: 'first' | 'exact' | 'newer',
    ) =>
      this.documentManagement.ingestFileServiceSelection(
        {
          selection: { bucketId, filePath },
          sourceChannel: 'phase2d_hosted_validation_file_service',
          sourceRef: `phase2d:${runId}:${stage}:${filePath}`,
          idempotencyKey: `phase2d:${runId}:${stage}`,
          descriptor: {},
        },
        context,
      );

    const first = await ingest(firstFilePath, 'first');
    const exact = await ingest(firstFilePath, 'exact');
    const newer = await ingest(newerFilePath, 'newer');
    const replay = await ingest(newerFilePath, 'newer');
    assertDecision(first, 'INGEST_NEW_FAMILY', 'first');
    assertDecision(exact, 'RESUME_EXISTING_PROCESS', 'exact');
    assertDecision(newer, 'INGEST_NEW_REVISION', 'newer');
    if (replay.disposition !== 'IDEMPOTENT_REPLAY') {
      fail(`replay disposition was ${String(replay.disposition)}`);
    }
    if (
      first.documentVersionId === newer.documentVersionId ||
      first.familyId !== newer.familyId ||
      Number(newer.currentGeneration) !== 2 ||
      replay.documentVersionId !== newer.documentVersionId
    ) {
      fail('version/currentness identity mismatch');
    }
    const [firstReadback, newerReadback] = await Promise.all([
      this.documentManagement.getDocumentVersion(
        String(first.documentVersionId),
        context,
      ),
      this.documentManagement.getDocumentVersion(
        String(newer.documentVersionId),
        context,
      ),
    ]);
    assertVersionReadback(firstReadback, FIRST);
    assertVersionReadback(newerReadback, NEWER);
    return {
      schemaVersion: 'wiselink.3_1.phase2d_hosted_dm_validation.v1',
      status: 'PASS',
      validationRunId: runId,
      decisions: [first, exact, newer, replay].map((entry) => ({
        decision: entry.decision,
        disposition: entry.disposition,
        familyId: entry.familyId,
        documentId: entry.documentId ?? null,
        documentVersionId: entry.documentVersionId,
        currentGeneration: entry.currentGeneration ?? null,
        immutableReadbackVerified: entry.immutableReadbackVerified,
        catalogFreshReadVerified: entry.catalogFreshReadVerified,
      })),
      versions: [
        summarizeVersion(firstReadback.version),
        summarizeVersion(newerReadback.version),
      ],
      current: {
        familyId: newerReadback.family?.familyId,
        documentVersionId: newerReadback.family?.currentDocumentVersionId,
        generation: newerReadback.family?.currentGeneration,
      },
      authority: {
        actorDerivedFromLoginContext: true,
        validationOnly: true,
        workItemCreated: false,
        parsedPackageCreated: false,
        decisionCreated: false,
        executionLogCreated: false,
      },
    };
  }
}

function exactValidationFilePath(value: unknown, expectedFileName: string): string {
  const path = typeof value === 'string' ? value.trim() : '';
  if (!path || basename(path) !== expectedFileName) {
    throw Object.assign(new Error(`Only ${expectedFileName} is accepted.`), {
      code: 'DOCUMENT_MANAGEMENT_VALIDATION_INPUT_INVALID',
      statusCode: 400,
    });
  }
  return path;
}

function assertDecision(
  value: Record<string, unknown>,
  expected: string,
  stage: string,
): void {
  if (value.decision !== expected) {
    fail(`${stage} decision was ${String(value.decision)}`);
  }
}

function assertVersionReadback(
  value: { version?: Record<string, unknown> },
  expected: { sha256: string; byteLength: number },
): void {
  if (
    value.version?.pdfSha256 !== expected.sha256 ||
    Number(value.version?.byteLength) !== expected.byteLength
  ) {
    fail('DocumentVersion actual-byte identity mismatch');
  }
}

function summarizeVersion(value: Record<string, unknown>) {
  return {
    documentVersionId: value.documentVersionId,
    revisionId: value.revisionId,
    businessRevision: value.businessRevision,
    pdfSha256: value.pdfSha256,
    byteLength: Number(value.byteLength),
    originalFilename: value.originalFilename,
  };
}

function fail(detail: string): never {
  throw Object.assign(new Error(`Phase 2D hosted validation failed: ${detail}`), {
    code: 'DOCUMENT_MANAGEMENT_VALIDATION_FAILED',
    statusCode: 409,
  });
}
