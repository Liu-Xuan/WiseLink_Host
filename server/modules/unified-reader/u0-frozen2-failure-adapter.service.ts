import { Injectable } from '@nestjs/common';

import type { UnifiedParseFailureReport } from '@shared/api.interface';

import { U0FullValidationService } from './u0-full-validation.service';
import {
  U0_FROZEN2_FAILURE_ADAPTER_PORT,
  UNIFIED_READER,
} from './unified-reader.constants';
import type {
  U0FailureProjectStage,
  U0FailureRetryClass,
  U0Frozen2FailureAdapterInput,
  U0Frozen2FailureAdapterPort,
  U0Frozen2FailureAdapterReceipt,
  U0Frozen2FailureAdapterResult,
  U0Frozen2FailureBuildResult,
} from './unified-reader.types';
import {
  canonicalJson,
  requiredText,
  sha256Raw,
  sha256Text,
} from './unified-reader.utils';

interface FailureDefinition {
  stableErrorCode: string;
  reportStage: UnifiedParseFailureReport['stage'];
  projectStage: U0FailureProjectStage;
  retryClass: U0FailureRetryClass;
  message: string;
  userAction: string;
}

const ADAPTER_REVISION = 'candidate.1' as const;
const ADAPTER_BUILD_HASH = sha256Text(
  canonicalJson({
    namespace: 'wiselink-u0-frozen2-failure-adapter-v1',
    port: U0_FROZEN2_FAILURE_ADAPTER_PORT,
    adapterRevision: ADAPTER_REVISION,
    failureContract: `${UNIFIED_READER.failureReportSchemaVersion}/${UNIFIED_READER.failureReportContractRevision}`,
    contractCommit: UNIFIED_READER.contractCommit,
  }),
);

@Injectable()
export class U0Frozen2FailureAdapterService
  implements U0Frozen2FailureAdapterPort
{
  constructor(private readonly validator: U0FullValidationService) {}

  build(input: U0Frozen2FailureAdapterInput): U0Frozen2FailureBuildResult {
    validateInput(input);
    const definition = definitionFor(input.cause.code);
    const parameters: UnifiedParseFailureReport['parameters'] = {
      workItemId: input.correlation.workItemId,
      requestId: input.correlation.requestId,
      documentId: input.correlation.documentId ?? 'UNAVAILABLE',
      documentVersionId: input.correlation.documentVersionId,
      permissionSnapshotVersion:
        input.correlation.permissionSnapshotVersion,
      classificationFingerprint:
        input.correlation.classificationFingerprint,
      sourceArtifactId: input.source.sourceArtifactId,
      causeCode: input.cause.code,
      errorClass: input.cause.errorClass,
      stableErrorCode: definition.stableErrorCode,
      projectStage: definition.projectStage,
      retryClass: definition.retryClass,
      userAction: definition.userAction,
      selectedPackageContractId: UNIFIED_READER.packageSchemaVersion,
      selectedPackageContractRevision: UNIFIED_READER.contractRevision,
      selectedFailureContractRevision:
        UNIFIED_READER.failureReportContractRevision,
      u0ContractCommit: UNIFIED_READER.contractCommit,
      u0ManifestSha256: UNIFIED_READER.contractManifestSha256,
      producerId: input.producer.producerId,
      producerRevision: input.producer.producerRevision,
      executionRoute: input.producer.executionRoute,
      packageAttempted: input.packageAttempt !== null,
      ...(input.packageAttempt
        ? {
            attemptedPackageId: input.packageAttempt.packageId,
            attemptedPackageContractId: input.packageAttempt.contractId,
            attemptedPackageContractRevision:
              input.packageAttempt.contractRevision,
          }
        : {}),
    };
    const identityCore = {
      namespace: 'techpub-parse-failure-id-v1',
      sourceKind: input.source.sourceKind,
      inputHash: input.source.inputHash,
      stage: definition.reportStage,
      code: definition.stableErrorCode,
      producerBuildHash: input.producer.producerBuildHash,
      parameters,
    };
    const failureId =
      `urn:techpub:parse-failure:v1:sha256:${sha256Text(
        canonicalJson(identityCore),
      ).slice('sha256:'.length)}`;
    const report: UnifiedParseFailureReport = {
      $schema: UNIFIED_READER.failureReportSchemaId,
      schemaVersion: UNIFIED_READER.failureReportSchemaVersion,
      contractRevision: UNIFIED_READER.failureReportContractRevision,
      failureId,
      sourceKind: input.source.sourceKind,
      inputRef: input.source.inputRef,
      inputHash: input.source.inputHash,
      stage: definition.reportStage,
      code: definition.stableErrorCode,
      message: definition.message,
      blocking: true,
      packageProduced: false,
      producer: {
        name: input.producer.producerId,
        version: input.producer.producerRevision,
        buildHash: input.producer.producerBuildHash,
      },
      observedAt: input.observedAt,
      parameters,
    };
    return {
      report,
      reportBytes: new TextEncoder().encode(`${canonicalJson(report)}\n`),
      taxonomy: {
        stableErrorCode: definition.stableErrorCode,
        causeCode: input.cause.code,
        errorClass: input.cause.errorClass,
        reportStage: definition.reportStage,
        projectStage: definition.projectStage,
        retryClass: definition.retryClass,
        userAction: definition.userAction,
      },
    };
  }

  async validateActualBytes(input: {
    source: U0Frozen2FailureAdapterInput;
    artifact: import('@shared/api.interface').UnifiedPackageArtifactDescriptor;
    actualBytes: Uint8Array;
  }): Promise<U0Frozen2FailureAdapterResult> {
    const built = this.build(input.source);
    if (
      input.actualBytes.byteLength !== built.reportBytes.byteLength ||
      input.artifact.byteLength !== built.reportBytes.byteLength ||
      input.artifact.sha256 !== sha256Raw(built.reportBytes) ||
      sha256Raw(input.actualBytes) !== input.artifact.sha256 ||
      !sameBytes(input.actualBytes, built.reportBytes)
    ) {
      throw new Error('U0_FAILURE_ADAPTER_REJECTED:ACTUAL_BYTE_MISMATCH');
    }
    const strictValidation = await this.validator.validateFailureReport({
      artifact: input.artifact,
      bytes: input.actualBytes,
      failureId: built.report.failureId,
    });
    const receiptCore = {
      schemaVersion:
        'wiselink.3_1.u0_frozen2_failure_adapter_receipt.v0.candidate.1' as const,
      adapter: {
        port: U0_FROZEN2_FAILURE_ADAPTER_PORT,
        adapterId: 'U0Frozen2FailureAdapterService' as const,
        adapterRevision: ADAPTER_REVISION,
        buildHash: ADAPTER_BUILD_HASH,
      },
      selectedFailureContract: {
        schemaId: UNIFIED_READER.failureReportSchemaId,
        schemaVersion: UNIFIED_READER.failureReportSchemaVersion,
        contractRevision: UNIFIED_READER.failureReportContractRevision,
        contractCommit: UNIFIED_READER.contractCommit,
        contractManifestSha256: UNIFIED_READER.contractManifestSha256,
        schemaRelativePath:
          'schema/parse-failure-report.schema.json' as const,
        semanticValidator:
          'scripts.contract_core.validate_parse_failure_report' as const,
      },
      failureId: built.report.failureId,
      failureArtifact: { ...input.artifact },
      actualByteReadbackVerified: true as const,
      strictValidation,
      taxonomy: built.taxonomy,
      correlation: { ...input.source.correlation },
      input: { ...input.source.source },
      packageAttempt: input.source.packageAttempt
        ? { ...input.source.packageAttempt }
        : null,
      producer: { ...input.source.producer },
      authority: {
        failureContractAuthority: 'U0_FROZEN_2' as const,
        createsWorkItemState: false as const,
        writeAuthorized: false as const,
        publicationAuthorized: false as const,
      },
    };
    const receiptHash = sha256Text(canonicalJson(receiptCore));
    const receipt: U0Frozen2FailureAdapterReceipt = {
      ...receiptCore,
      receiptId:
        `u0_failure_adapter_receipt_${receiptHash.slice(
          'sha256:'.length,
          'sha256:'.length + 32,
        )}`,
      receiptHash,
    };
    return {
      report: built.report,
      reportBytes: Uint8Array.from(input.actualBytes),
      artifact: { ...input.artifact },
      receipt,
    };
  }
}

function validateInput(input: U0Frozen2FailureAdapterInput): void {
  if (
    input.schemaVersion !==
      'wiselink.3_1.u0_frozen2_failure_adapter_input.v0.candidate.1' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(
      input.observedAt,
    )
  ) {
    throw new Error('U0_FAILURE_ADAPTER_REJECTED:INPUT');
  }
  const values = [
    input.cause.code,
    input.cause.errorClass,
    input.source.sourceArtifactId,
    input.source.inputRef,
    input.correlation.workItemId,
    input.correlation.requestId,
    input.correlation.documentVersionId,
    input.correlation.permissionSnapshotVersion,
    input.correlation.classificationFingerprint,
    input.producer.producerId,
    input.producer.producerRevision,
    input.producer.executionRoute,
  ];
  values.forEach((value, index) => requiredText(value, `input.${index}`, 1000));
  if (
    !/^sha256:[0-9a-f]{64}$/u.test(input.source.inputHash) ||
    !/^sha256:[0-9a-f]{64}$/u.test(input.producer.producerBuildHash) ||
    !/^sha256:[0-9a-f]{64}$/u.test(
      input.correlation.classificationFingerprint,
    )
  ) {
    throw new Error('U0_FAILURE_ADAPTER_REJECTED:HASH_WIRE');
  }
}

function definitionFor(cause: string): FailureDefinition {
  if (cause.includes('ARTIFACT_READBACK')) {
    return definition(
      'ARTIFACT_READBACK_MISMATCH',
      'projection',
      'READBACK_ARTIFACT',
      'SAFE_WITH_SAME_INPUT',
      'The persisted artifact failed exact actual-byte readback.',
      '修复 ArtifactStore 读回一致性后用相同输入重试。',
    );
  }
  if (cause.includes('ARTIFACT_STORE') || cause.includes('PERSIST')) {
    return definition(
      'ARTIFACT_PERSIST_FAILED',
      'projection',
      'PERSIST_ARTIFACT',
      'SAFE_WITH_SAME_INPUT',
      'The immutable artifact could not be persisted.',
      '修复 ArtifactStore 后用相同输入重试。',
    );
  }
  if (cause.includes('READER_')) {
    return definition(
      'READER_REJECTED',
      'projection',
      'READBACK_ARTIFACT',
      'REQUIRES_INPUT_OR_OWNER_ACTION',
      'The selected Reader rejected the frozen package query or binding.',
      '检查 package、query 与 sourceRefs；不得返回未绑定结果。',
    );
  }
  if (cause.includes('FULL_U0') || cause.includes('PACKAGE_')) {
    return definition(
      'PACKAGE_SEMANTIC_VALIDATION_FAILED',
      'projection',
      'VALIDATE_PACKAGE',
      'REQUIRES_INPUT_OR_OWNER_ACTION',
      'The package failed the selected frozen.2 validation contract.',
      '核对 producer 输出、sourceRefs 和 frozen.2 合同后重新解析。',
    );
  }
  if (cause.includes('PROFILE') || cause.includes('UNSUPPORTED')) {
    return definition(
      'PRODUCER_UNSUPPORTED',
      'discovery',
      'CLASSIFY_OR_ROUTE',
      'NOT_SAFE_WITHOUT_OWNER_ACTION',
      'No registered producer supports the selected profile.',
      '复核文档分类并由模块 owner 注册受控 Parser Profile。',
    );
  }
  return definition(
    'SOURCE_BINDING_FAILED',
    'parse',
    'PARSE_SOURCE',
    'REQUIRES_INPUT_OR_OWNER_ACTION',
    'The parse pipeline stopped without an accepted package.',
    '查看冻结 FailureReport 并修复明确的输入或解析实现错误。',
  );
}

function definition(
  stableErrorCode: string,
  reportStage: UnifiedParseFailureReport['stage'],
  projectStage: U0FailureProjectStage,
  retryClass: U0FailureRetryClass,
  message: string,
  userAction: string,
): FailureDefinition {
  return {
    stableErrorCode,
    reportStage,
    projectStage,
    retryClass,
    message,
    userAction,
  };
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}
