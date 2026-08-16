import { Injectable } from '@nestjs/common';

import type { ControlledAilyHolisticDynamicInput } from './aily-holistic-assessment';
import {
  BASE_ONE_SHOT_PURPOSE,
  buildBaseOneShotAssessmentPacket,
  consumeBaseOneShotAssessmentResult,
  type BaseOneShotAssessmentPacket,
  type BaseOneShotAssessmentResult,
  type BaseOneShotCorrelation,
} from './base-one-shot-assessment.processor';

export const DYNAMIC_RULES_EVALUATION_PURPOSE =
  'EVALUATE_DYNAMIC_RULES' as const;

export type DynamicRulesEvaluationCorrelation = BaseOneShotCorrelation;

export type DynamicRulesEvaluationInput = Omit<
  BaseOneShotAssessmentPacket,
  'purpose' | 'operatorInstruction' | 'correlation' | 'expectedSelfCheck'
> & {
  purpose: typeof DYNAMIC_RULES_EVALUATION_PURPOSE;
  callerCorrelationRef: string;
  operatorInstruction: string[];
  expectedSelfCheck: Record<string, unknown>;
};

export interface DynamicRulesEvaluationPrivateEnvelope {
  callerCorrelationRef: string;
  correlation: DynamicRulesEvaluationCorrelation;
}

export interface DynamicRulesEvaluationRequest {
  privateEnvelope: DynamicRulesEvaluationPrivateEnvelope;
  modelInput: DynamicRulesEvaluationInput;
}

export type DynamicRulesEvaluationResult = BaseOneShotAssessmentResult;

/**
 * Pure host seam for one dynamic-N fixed-rules model call. Only modelInput may
 * be sent to OpenClaw. privateEnvelope stays inside the canonical host so the
 * model never receives a WorkItem, ActionAttempt, revision or write authority.
 */
@Injectable()
export class DynamicRulesEvaluationProcessor {
  buildRequest(
    assessmentInput: Record<string, unknown>,
    input: ControlledAilyHolisticDynamicInput,
    correlation: DynamicRulesEvaluationCorrelation,
    callerCorrelationRef: string,
  ): DynamicRulesEvaluationRequest {
    return buildDynamicRulesEvaluationRequest(
      assessmentInput,
      input,
      correlation,
      callerCorrelationRef,
    );
  }

  consumeOutput(
    request: DynamicRulesEvaluationRequest,
    output: string,
  ): DynamicRulesEvaluationResult {
    return consumeDynamicRulesEvaluationOutput(request, output);
  }
}

export function buildDynamicRulesEvaluationRequest(
  assessmentInput: Record<string, unknown>,
  input: ControlledAilyHolisticDynamicInput,
  correlation: DynamicRulesEvaluationCorrelation,
  callerCorrelationRef: string,
): DynamicRulesEvaluationRequest {
  if (
    typeof callerCorrelationRef !== 'string' ||
    callerCorrelationRef.trim() === ''
  ) {
    throw new Error('DYNAMIC_RULES_CALLER_CORRELATION_REF_REQUIRED');
  }
  const historical = buildBaseOneShotAssessmentPacket(
    assessmentInput,
    input,
    correlation,
  );
  const operatorInstruction = historical.operatorInstruction.map(
    (instruction) => {
      if (instruction.startsWith('correlation 必须逐字复制')) {
        return 'callerCorrelationRef 必须逐字复制输入中的同名值；不得生成或推导 WorkItem、ActionAttempt、revision、actor 或 authority。';
      }
      if (instruction.startsWith('Base 只执行固定 Job Aid')) {
        return instruction.replace(
          'Base 只执行固定 Job Aid',
          '本次 EVALUATE_DYNAMIC_RULES 只执行固定 Job Aid',
        );
      }
      if (instruction.startsWith('整体综合由托管 OpenClaw')) {
        return instruction.replace(
          '整体综合由托管 OpenClaw',
          '整体综合由后续独立 OpenClaw overall 动作',
        );
      }
      return instruction;
    },
  );
  operatorInstruction.push(
    'sourceRefs 只能复用对应 criterionTable 行经 valueDictionaries 解码出的 sourceEvidenceCandidateIds；不得生成未知、跨规则或重复来源 ID。',
  );

  const expectedSelfCheck = structuredClone(historical.expectedSelfCheck);
  delete expectedSelfCheck.transportId;
  delete expectedSelfCheck.workItemId;
  const responseInstruction = structuredClone(
    historical.responseInstruction,
  ) as Record<string, unknown>;
  const requiredSections = responseInstruction.requiredSections;
  if (!Array.isArray(requiredSections)) {
    throw new Error('DYNAMIC_RULES_RESPONSE_SECTIONS_INVALID');
  }
  responseInstruction.requiredSections = requiredSections.map((section) =>
    section === 'correlation' ? 'callerCorrelationRef' : section,
  );
  delete responseInstruction.echoCorrelationExactly;
  delete responseInstruction.doNotInferCorrelationFromContextIdOrAssessmentPackageId;
  responseInstruction.echoCallerCorrelationRefExactly = true;

  const {
    correlation: _privateCorrelation,
    purpose: _historicalPurpose,
    ...publicHistorical
  } = historical;
  const modelInput: DynamicRulesEvaluationInput = {
    ...publicHistorical,
    purpose: DYNAMIC_RULES_EVALUATION_PURPOSE,
    callerCorrelationRef,
    operatorInstruction,
    expectedSelfCheck,
    responseInstruction,
  };
  assertNoPrivateAuthorityInModelInput(modelInput, correlation);
  return {
    privateEnvelope: {
      callerCorrelationRef,
      correlation: { ...correlation },
    },
    modelInput,
  };
}

export function consumeDynamicRulesEvaluationOutput(
  request: DynamicRulesEvaluationRequest,
  output: string,
): DynamicRulesEvaluationResult {
  if (
    request.modelInput.callerCorrelationRef !==
    request.privateEnvelope.callerCorrelationRef
  ) {
    throw new Error('DYNAMIC_RULES_PRIVATE_ENVELOPE_MISMATCH');
  }
  const rawOutputBytes = Buffer.byteLength(output, 'utf8');
  const outputBudget = request.modelInput.responseInstruction.outputBudget as
    | Record<string, unknown>
    | undefined;
  const maxOutputBytes = outputBudget?.maxUtf8Bytes;
  if (
    !Number.isInteger(maxOutputBytes) ||
    rawOutputBytes > Number(maxOutputBytes)
  ) {
    throw new Error(
      `BASE_ONE_SHOT_OUTPUT_BUDGET_EXCEEDED:${rawOutputBytes}:` +
        String(maxOutputBytes),
    );
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(output) as Record<string, unknown>;
  } catch {
    throw new Error('BASE_ONE_SHOT_OUTPUT_JSON_INVALID');
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    parsed.callerCorrelationRef !==
      request.privateEnvelope.callerCorrelationRef ||
    Object.prototype.hasOwnProperty.call(parsed, 'correlation')
  ) {
    throw new Error('DYNAMIC_RULES_CALLER_CORRELATION_REF_MISMATCH');
  }
  const hostBoundOutput = { ...parsed };
  delete hostBoundOutput.callerCorrelationRef;
  hostBoundOutput.correlation = {
    ...request.privateEnvelope.correlation,
  };
  const hostBoundSerialized = JSON.stringify(hostBoundOutput);
  const legacyPacket = {
    ...request.modelInput,
    purpose: BASE_ONE_SHOT_PURPOSE,
    correlation: { ...request.privateEnvelope.correlation },
    responseInstruction: {
      ...request.modelInput.responseInstruction,
      outputBudget: {
        ...outputBudget,
        maxUtf8Bytes: Math.max(
          Number(maxOutputBytes),
          Buffer.byteLength(hostBoundSerialized, 'utf8'),
        ),
      },
    },
  } as unknown as BaseOneShotAssessmentPacket;
  const result = consumeBaseOneShotAssessmentResult(
    legacyPacket,
    hostBoundSerialized,
  );
  assertSourceRefsBoundToInput(request.modelInput, result);
  return result;
}

function assertNoPrivateAuthorityInModelInput(
  input: DynamicRulesEvaluationInput,
  privateCorrelation: DynamicRulesEvaluationCorrelation,
): void {
  const serialized = JSON.stringify(input);
  const forbiddenKeys = [
    'workItemId',
    'actionAttemptId',
    'expectedRevision',
    'transportId',
    'actorToken',
    'writeAuthority',
    'baseToken',
    'recordId',
    'apiKey',
  ];
  if (forbiddenKeys.some((key) => serialized.includes(`"${key}"`))) {
    throw new Error('DYNAMIC_RULES_PRIVATE_AUTHORITY_FIELD_EXPOSED');
  }
  for (const value of [
    privateCorrelation.workItemId,
    privateCorrelation.actionAttemptId,
    privateCorrelation.transportId,
  ]) {
    if (serialized.includes(value)) {
      throw new Error('DYNAMIC_RULES_PRIVATE_CORRELATION_VALUE_EXPOSED');
    }
  }
}

function assertSourceRefsBoundToInput(
  input: DynamicRulesEvaluationInput,
  result: DynamicRulesEvaluationResult,
): void {
  const catalog = input.jobAidContext.sourceEvidenceCatalog;
  const catalogColumns = catalog?.columns;
  const catalogRows = catalog?.rows;
  if (!Array.isArray(catalogColumns) || !Array.isArray(catalogRows)) {
    throw new Error('DYNAMIC_RULES_SOURCE_EVIDENCE_CATALOG_INVALID');
  }
  const catalogIdIndex = catalogColumns.indexOf('candidateId');
  if (catalogIdIndex < 0) {
    throw new Error('DYNAMIC_RULES_SOURCE_EVIDENCE_CANDIDATE_ID_MISSING');
  }
  const catalogIds = new Set<string>();
  for (const row of catalogRows) {
    const value = Array.isArray(row) ? row[catalogIdIndex] : null;
    if (typeof value !== 'string' || catalogIds.has(value)) {
      throw new Error('DYNAMIC_RULES_SOURCE_EVIDENCE_CATALOG_INVALID');
    }
    catalogIds.add(value);
  }

  const criterionTable = input.jobAidContext.criterionTable;
  const sourceIndex = criterionTable.columns.indexOf(
    'sourceEvidenceCandidateIds',
  );
  if (
    sourceIndex < 0 ||
    criterionTable.rows.length !== result.ruleResults.length
  ) {
    throw new Error('DYNAMIC_RULES_SOURCE_REF_BINDING_INVALID');
  }
  const dictionary = criterionTable.valueDictionaries
    ?.sourceEvidenceCandidateIds;
  if (!Array.isArray(dictionary)) {
    throw new Error('DYNAMIC_RULES_SOURCE_REF_DICTIONARY_INVALID');
  }

  result.ruleResults.forEach((ruleResult, index) => {
    const encoded = criterionTable.rows[index][sourceIndex];
    const allowedValues = Number.isInteger(encoded)
      ? dictionary[Number(encoded)]
      : encoded;
    if (
      !Array.isArray(allowedValues) ||
      allowedValues.some((value) => typeof value !== 'string')
    ) {
      throw new Error(`DYNAMIC_RULES_SOURCE_REF_BINDING_INVALID:${index}`);
    }
    const allowed = new Set(allowedValues as string[]);
    if ([...allowed].some((value) => !catalogIds.has(value))) {
      throw new Error(`DYNAMIC_RULES_SOURCE_REF_CATALOG_DRIFT:${index}`);
    }
    const returned = ruleResult.sourceRefs;
    if (
      !Array.isArray(returned) ||
      returned.some((value) => typeof value !== 'string')
    ) {
      throw new Error(`DYNAMIC_RULES_SOURCE_REF_TYPE_INVALID:${index}`);
    }
    const returnedIds = returned as string[];
    if (new Set(returnedIds).size !== returnedIds.length) {
      throw new Error(`DYNAMIC_RULES_SOURCE_REF_DUPLICATED:${index}`);
    }
    const invalid = returnedIds.find((value) => !allowed.has(value));
    if (invalid) {
      throw new Error(
        `DYNAMIC_RULES_SOURCE_REF_NOT_BOUND:${index}:${invalid}`,
      );
    }
  });
}
