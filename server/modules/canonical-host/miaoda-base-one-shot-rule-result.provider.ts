import { CapabilityService } from '@lark-apaas/fullstack-nestjs-core';
import { Inject, Injectable } from '@nestjs/common';

import {
  BASE_ONE_SHOT_PURPOSE,
  consumeBaseOneShotAssessmentResult,
  type BaseOneShotAssessmentPacket,
} from '../assessment-workbench/base-one-shot-assessment.processor';
import type {
  CanonicalBaseRuleResult,
  CanonicalBaseRuleResultProviderPort,
} from './canonical-host.types';

export const BASE_ONE_SHOT_RESULT_CAPABILITY =
  'wl-base-one-shot-assessment-result';
export const BASE_ONE_SHOT_RESULT_RECORD_ID = 'recvsrpBvPFAIC';

const BASE_TOKEN = 'TWOVbMcJBaMvlDsvY5GceKibn7d';
const TABLE_ID = 'tblV8mJeyvVZcthC';
const OUTPUT_FIELD = '综合评估草稿｜DeepSeek-V4｜DEV.输出结果';
const INPUT_PACKET_KEYS = [
  'correlation',
  'expectedSelfCheck',
  'jobAidContext',
  'operatorInstruction',
  'parsedSource',
  'purpose',
  'responseInstruction',
  'subjectContext',
] as const;

interface BitableRecord {
  id: string;
  record: Record<string, unknown>;
}

@Injectable()
// Registered by CanonicalHostModule.forRoot through the host-selected provider.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class MiaodaBaseOneShotRuleResultProvider
  implements CanonicalBaseRuleResultProviderPort
{
  readonly configured = true;

  constructor(
    @Inject() private readonly capabilityService: CapabilityService,
  ) {}

  async readResult(
    input: Parameters<CanonicalBaseRuleResultProviderPort['readResult']>[0],
  ): Promise<CanonicalBaseRuleResult> {
    // This is an exact, read-existing-result bridge for the Phase 13 record.
    // The host has already reserved its own persistence ActionAttempt; this
    // provider neither triggers Base AI nor treats that host attempt as the
    // earlier Base transport attempt embedded in the packet.
    let result: unknown;
    try {
      result = await this.capabilityService
        .load(BASE_ONE_SHOT_RESULT_CAPABILITY)
        .call('getRecord', { recordID: BASE_ONE_SHOT_RESULT_RECORD_ID });
    } catch (error) {
      throw withCause('BASE_ONE_SHOT_CAPABILITY_READ_FAILED', error);
    }

    const baseRecord = requiredBitableRecord(result);
    const row = baseRecord.record;
    const output = optionalText(row[OUTPUT_FIELD]);
    if (!output) throw new Error('BASE_ONE_SHOT_OUTPUT_EMPTY');
    if (row['处理状态'] !== 'READY') {
      throw new Error('BASE_ONE_SHOT_RESULT_NOT_READY');
    }

    const packetText = requiredText(row['LLM输入'], 'LLM_INPUT');
    const packet = parsePacket(packetText);
    validateRowIdentity(row, packet, input.expectedRevision);
    validatePacketIdentity(packet, input);
    validateOutputTopLevel(packet, output);

    const consumed = consumeBaseOneShotAssessmentResult(
      packet as unknown as BaseOneShotAssessmentPacket,
      output,
    );
    const subject = requiredRecord(packet.subjectContext, 'SUBJECT_CONTEXT');
    const parsedPackage = requiredRecord(
      subject.unifiedParsedPackage,
      'UNIFIED_PARSED_PACKAGE',
    );
    const identity = requiredRecord(
      requiredRecord(packet.jobAidContext, 'JOB_AID_CONTEXT').identity,
      'JOB_AID_IDENTITY',
    );
    const overallSelfCheck = consumed.overallSelfCheck;
    const sourceBoundCandidateCount = consumed.ruleResults.filter(
      (rule) => Array.isArray(rule.sourceRefs) && rule.sourceRefs.length > 0,
    ).length;

    return {
      sourceResultId:
        `base://${BASE_TOKEN}/${TABLE_ID}/${baseRecord.id}` +
        `@${packet.correlation.transportId}`,
      workItemId: packet.correlation.workItemId,
      documentVersionId: packet.correlation.documentVersionId,
      packageId: requiredString(parsedPackage.packageId, 'PACKAGE_ID'),
      packageArtifactSha256: requiredString(
        parsedPackage.artifactHash,
        'PACKAGE_ARTIFACT_SHA256',
      ),
      criterionSetId: requiredString(
        requiredRecord(identity.criterionSet, 'CRITERION_SET').criterionSetId,
        'CRITERION_SET_ID',
      ),
      criterionCount: consumed.criterionCount,
      evaluationItemCount: consumed.ruleResults.length,
      unresolvedCount: requiredCount(
        overallSelfCheck.rulesWithMissingInputs,
        consumed.criterionCount,
        'UNRESOLVED_COUNT',
      ),
      sourceBoundCandidateCount,
      artifactBytes: Buffer.from(output, 'utf8'),
    };
  }
}

function requiredBitableRecord(value: unknown): BitableRecord {
  const record = requiredRecord(value, 'GET_RECORD_RESULT');
  if (
    record.id !== BASE_ONE_SHOT_RESULT_RECORD_ID ||
    !isRecord(record.record)
  ) {
    throw new Error('BASE_ONE_SHOT_GET_RECORD_SHAPE_INVALID');
  }
  return record as unknown as BitableRecord;
}

interface RuntimePacket extends Record<string, unknown> {
  purpose: string;
  correlation: {
    transportId: string;
    workItemId: string;
    actionAttemptId: string;
    expectedRevision: number;
    documentVersionId: string;
  };
  expectedSelfCheck: Record<string, unknown>;
  jobAidContext: Record<string, unknown>;
  responseInstruction: Record<string, unknown>;
  subjectContext: Record<string, unknown>;
}

function parsePacket(value: string): RuntimePacket {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('BASE_ONE_SHOT_INPUT_JSON_INVALID');
  }
  const packet = requiredRecord(parsed, 'INPUT_PACKET');
  if (
    JSON.stringify(Object.keys(packet).sort()) !==
      JSON.stringify([...INPUT_PACKET_KEYS].sort()) ||
    packet.purpose !== BASE_ONE_SHOT_PURPOSE
  ) {
    throw new Error('BASE_ONE_SHOT_INPUT_PACKET_DRIFT');
  }
  const correlation = requiredRecord(packet.correlation, 'CORRELATION');
  for (const key of [
    'transportId',
    'workItemId',
    'actionAttemptId',
    'documentVersionId',
  ]) {
    requiredString(correlation[key], `CORRELATION_${key}`);
  }
  if (!Number.isSafeInteger(correlation.expectedRevision)) {
    throw new Error('BASE_ONE_SHOT_CORRELATION_REVISION_INVALID');
  }
  return packet as unknown as RuntimePacket;
}

function validateRowIdentity(
  row: Record<string, unknown>,
  packet: RuntimePacket,
  expectedRevision: number,
): void {
  if (
    requiredText(row['ActionAttemptId'], 'ACTION_ATTEMPT_ID') !==
      packet.correlation.actionAttemptId ||
    requiredText(row['TransportId'], 'TRANSPORT_ID') !==
      packet.correlation.transportId ||
    requiredText(row['WorkItemId'], 'WORK_ITEM_ID') !==
      packet.correlation.workItemId ||
    row['ExpectedRevision'] !== packet.correlation.expectedRevision ||
    row['ExpectedRevision'] !== expectedRevision ||
    row['CriterionCount'] !==
      requiredRecord(packet.expectedSelfCheck, 'EXPECTED_SELF_CHECK')
        .criterionCount
  ) {
    throw new Error('BASE_ONE_SHOT_RECORD_PACKET_IDENTITY_MISMATCH');
  }
}

function validatePacketIdentity(
  packet: RuntimePacket,
  input: Parameters<CanonicalBaseRuleResultProviderPort['readResult']>[0],
): void {
  const workItem = input.workItem;
  const subject = requiredRecord(packet.subjectContext, 'SUBJECT_CONTEXT');
  const parsedPackage = requiredRecord(
    subject.unifiedParsedPackage,
    'UNIFIED_PARSED_PACKAGE',
  );
  if (
    packet.correlation.workItemId !== workItem.workItemId ||
    packet.correlation.documentVersionId !==
      workItem.source.documentVersionId ||
    packet.correlation.expectedRevision !== input.expectedRevision ||
    parsedPackage.documentVersionId !== workItem.source.documentVersionId ||
    parsedPackage.packageId !== workItem.package?.packageId ||
    parsedPackage.artifactHash !== workItem.package?.artifact.sha256
  ) {
    throw new Error('BASE_ONE_SHOT_WORK_ITEM_PACKET_IDENTITY_MISMATCH');
  }
}

function validateOutputTopLevel(
  packet: RuntimePacket,
  output: string,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return;
  }
  if (!isRecord(parsed)) return;
  const requiredSections = packet.responseInstruction.requiredSections;
  if (
    !Array.isArray(requiredSections) ||
    requiredSections.some((key) => typeof key !== 'string') ||
    JSON.stringify(Object.keys(parsed).sort()) !==
      JSON.stringify([...requiredSections].sort())
  ) {
    throw new Error('BASE_ONE_SHOT_OUTPUT_TOP_LEVEL_SHAPE_INVALID');
  }
}

function optionalText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || typeof value.text !== 'string') {
    throw new Error('BASE_ONE_SHOT_TEXT_CELL_INVALID');
  }
  const text = value.text.trim();
  return text || null;
}

function requiredText(value: unknown, field: string): string {
  const text = optionalText(value);
  if (!text) throw new Error(`BASE_ONE_SHOT_TEXT_REQUIRED:${field}`);
  return text;
}

function requiredRecord(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`BASE_ONE_SHOT_OBJECT_REQUIRED:${field}`);
  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`BASE_ONE_SHOT_STRING_REQUIRED:${field}`);
  }
  return value;
}

function requiredCount(value: unknown, max: number, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > max) {
    throw new Error(`BASE_ONE_SHOT_COUNT_INVALID:${field}`);
  }
  return Number(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function withCause(message: string, cause: unknown): Error {
  const error = new Error(message);
  (error as Error & { cause?: unknown }).cause = cause;
  return error;
}
