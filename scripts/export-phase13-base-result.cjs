#!/usr/bin/env node
'use strict';

const { readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  consumeBaseOneShotAssessmentResult,
} = require('../dist/server/modules/assessment-workbench/' +
  'base-one-shot-assessment.processor.js');

const FIELDS = [
  { fieldId: 'fld1jDDXe6', fieldName: 'LLM输入' },
  { fieldId: 'flda5xI0Xd', fieldName: 'ActionAttemptId' },
  { fieldId: 'fldotMD28b', fieldName: 'TransportId' },
  { fieldId: 'fldYSNUjB2', fieldName: 'WorkItemId' },
  { fieldId: 'fldhxNdo6a', fieldName: 'ExpectedRevision' },
  { fieldId: 'fldwUN1FU3', fieldName: 'CriterionCount' },
  { fieldId: 'fldBwbdujG', fieldName: '处理状态' },
  {
    fieldId: 'fld8rfdCni',
    fieldName: '综合评估草稿｜DeepSeek-V4｜DEV.输出结果',
  },
  {
    fieldId: 'fldBGozAza',
    fieldName: '综合评估草稿｜DeepSeek-V4｜DEV.思考过程',
  },
];

function runLarkCli(args) {
  const result = spawnSync('lark-cli', args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(
      `PHASE13_BASE_EXPORT_READBACK_PROCESS_FAILED:${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `PHASE13_BASE_EXPORT_READBACK_CLI_FAILED:${result.status}:` +
        (result.stderr || result.stdout || '').trim(),
    );
  }
  let response;
  try {
    response = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `PHASE13_BASE_EXPORT_READBACK_RESPONSE_NOT_JSON:${error.message}`,
    );
  }
  if (response?.ok !== true) {
    throw new Error(
      `PHASE13_BASE_EXPORT_READBACK_FAILED:${JSON.stringify(
        response?.error ?? response,
      )}`,
    );
  }
  return response;
}

function readRecordFields(response, expectedRecordId) {
  const data = response?.data;
  const names = data?.fields;
  const rows = data?.data;
  if (
    !Array.isArray(names) ||
    !Array.isArray(rows) ||
    rows.length !== 1 ||
    !Array.isArray(rows[0]) ||
    !Array.isArray(data.record_id_list) ||
    data.record_id_list.length !== 1 ||
    data.record_id_list[0] !== expectedRecordId ||
    data.has_more !== false
  ) {
    throw new Error('PHASE13_BASE_EXPORT_READBACK_SHAPE_INVALID');
  }
  return Object.fromEntries(
    names.map((name, index) => [name, rows[0][index]]),
  );
}

function normalizeSingleSelect(value) {
  if (Array.isArray(value) && value.length === 1) return value[0];
  if (typeof value === 'string') return value;
  return null;
}

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`PHASE13_BASE_EXPORT_${label}_REQUIRED`);
  }
  return value;
}

function requiredPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`PHASE13_BASE_EXPORT_${label}_INVALID`);
  }
  return value;
}

function requiredCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`PHASE13_BASE_EXPORT_${label}_INVALID`);
  }
  return value;
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `PHASE13_BASE_EXPORT_${label}_MISMATCH:` +
        `${JSON.stringify(actual)}:${JSON.stringify(expected)}`,
    );
  }
}

function privateTmpPath(value, label) {
  const resolved = resolve(requiredText(value, label));
  if (!resolved.startsWith('/private/tmp/')) {
    throw new Error(`PHASE13_BASE_EXPORT_${label}_MUST_BE_PRIVATE_TMP`);
  }
  return resolved;
}

function packetIdentity(packet) {
  const correlation = packet?.correlation;
  const upstream = packet?.subjectContext?.unifiedParsedPackage;
  const expected = packet?.expectedSelfCheck;
  if (
    packet?.purpose !== 'ONE_SHOT_JOB_AID_DYNAMIC_N_CANDIDATE' ||
    packet?.responseInstruction?.mustReturnEveryInputRuleExactlyOnce !== true ||
    packet?.responseInstruction?.authorityLevel !== 'candidate_only' ||
    packet?.responseInstruction?.engineeringConclusion !== null ||
    packet?.responseInstruction?.forbiddenSections?.includes(
      'overallAssessment',
    ) !== true
  ) {
    throw new Error('PHASE13_BASE_EXPORT_PACKET_BOUNDARY_INVALID');
  }
  const criterionCount = requiredPositiveInteger(
    packet?.responseInstruction?.expectedRuleCount,
    'PACKET_CRITERION_COUNT',
  );
  requireEqual(
    packet?.jobAidContext?.criterionTable?.rows?.length,
    criterionCount,
    'PACKET_CRITERION_ROWS',
  );
  requireEqual(
    packet?.jobAidContext?.resourceTable?.rows?.length,
    criterionCount,
    'PACKET_RESOURCE_ROWS',
  );
  requireEqual(expected?.criterionCount, criterionCount, 'PACKET_SELF_CHECK');
  return {
    workItemId: requiredText(correlation?.workItemId, 'WORK_ITEM_ID'),
    actionAttemptId: requiredText(
      correlation?.actionAttemptId,
      'ACTION_ATTEMPT_ID',
    ),
    transportId: requiredText(correlation?.transportId, 'TRANSPORT_ID'),
    expectedRevision: requiredPositiveInteger(
      correlation?.expectedRevision,
      'EXPECTED_REVISION',
    ),
    documentVersionId: requiredText(
      correlation?.documentVersionId,
      'DOCUMENT_VERSION_ID',
    ),
    packageId: requiredText(upstream?.packageId, 'PACKAGE_ID'),
    packageArtifactSha256: requiredText(
      upstream?.artifactHash,
      'PACKAGE_ARTIFACT_SHA256',
    ).replace(/^sha256:/u, ''),
    criterionSetId: requiredText(
      expected?.criterionSetId,
      'CRITERION_SET_ID',
    ),
    criterionCount,
  };
}

function assertRecordIdentity(fields, serializedPacket, identity) {
  requireEqual(fields['LLM输入'], serializedPacket, 'PACKET_ACTUAL_BYTES');
  requireEqual(
    fields.ActionAttemptId,
    identity.actionAttemptId,
    'ACTION_ATTEMPT_ID',
  );
  requireEqual(fields.TransportId, identity.transportId, 'TRANSPORT_ID');
  requireEqual(fields.WorkItemId, identity.workItemId, 'WORK_ITEM_ID');
  requireEqual(
    Number(fields.ExpectedRevision),
    identity.expectedRevision,
    'EXPECTED_REVISION',
  );
  requireEqual(
    Number(fields.CriterionCount),
    identity.criterionCount,
    'CRITERION_COUNT',
  );
  requireEqual(
    normalizeSingleSelect(fields['处理状态']),
    'READY',
    'PROCESSING_STATUS',
  );
}

function writeAndReadback(path, contents, label) {
  writeFileSync(path, contents, 'utf8');
  requireEqual(readFileSync(path, 'utf8'), contents, `${label}_READBACK`);
}

function runSelfCheck() {
  let unsafePathRejected = false;
  try {
    privateTmpPath('./phase13-output.json', 'WRAPPER_OUTPUT_PATH');
  } catch (error) {
    unsafePathRejected =
      error instanceof Error &&
      error.message ===
        'PHASE13_BASE_EXPORT_WRAPPER_OUTPUT_PATH_MUST_BE_PRIVATE_TMP';
  }
  if (!unsafePathRejected) {
    throw new Error('PHASE13_BASE_EXPORT_SELF_CHECK_UNSAFE_PATH_NOT_REJECTED');
  }

  let mismatchedPacketRejected = false;
  try {
    assertRecordIdentity(
      {
        'LLM输入': '{"packet":"different"}',
        ActionAttemptId: 'ATT-SELF-CHECK',
        TransportId: 'TRANSPORT-SELF-CHECK',
        WorkItemId: 'WI-SELF-CHECK',
        ExpectedRevision: 1,
        CriterionCount: 1,
        '处理状态': ['READY'],
      },
      '{"packet":"expected"}',
      {
        actionAttemptId: 'ATT-SELF-CHECK',
        transportId: 'TRANSPORT-SELF-CHECK',
        workItemId: 'WI-SELF-CHECK',
        expectedRevision: 1,
        criterionCount: 1,
      },
    );
  } catch (error) {
    mismatchedPacketRejected =
      error instanceof Error &&
      error.message.startsWith(
        'PHASE13_BASE_EXPORT_PACKET_ACTUAL_BYTES_MISMATCH:',
      );
  }
  if (!mismatchedPacketRejected) {
    throw new Error(
      'PHASE13_BASE_EXPORT_SELF_CHECK_PACKET_DRIFT_NOT_REJECTED',
    );
  }
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      unsafeOutputPathRejected: true,
      packetActualByteDriftRejected: true,
      onlineReadPerformed: false,
      onlineWritePerformed: false,
    }, null, 2)}\n`,
  );
}

function main() {
  if (process.argv[2] === '--self-check') {
    runSelfCheck();
    return;
  }
  const [
    packetPath,
    baseToken,
    tableId,
    recordId,
    wrapperOutputPath,
    rawOutputPath,
  ] = process.argv.slice(2);
  if (
    !packetPath ||
    !baseToken ||
    !tableId ||
    !recordId ||
    !wrapperOutputPath ||
    !rawOutputPath
  ) {
    throw new Error(
      'usage: export-phase13-base-result.cjs <packet> <baseToken> ' +
        '<tableId> <recordId> <wrapperOutput> <rawOutput>',
    );
  }
  const resolvedWrapperPath = privateTmpPath(
    wrapperOutputPath,
    'WRAPPER_OUTPUT_PATH',
  );
  const resolvedRawPath = privateTmpPath(rawOutputPath, 'RAW_OUTPUT_PATH');
  if (resolvedWrapperPath === resolvedRawPath) {
    throw new Error('PHASE13_BASE_EXPORT_OUTPUT_PATHS_MUST_DIFFER');
  }

  const serializedPacket = readFileSync(packetPath, 'utf8').trim();
  let packet;
  try {
    packet = JSON.parse(serializedPacket);
  } catch (error) {
    throw new Error(`PHASE13_BASE_EXPORT_PACKET_JSON_INVALID:${error.message}`);
  }
  const identity = packetIdentity(packet);
  const args = [
    'base',
    '+record-get',
    '--as',
    'user',
    '--base-token',
    baseToken,
    '--table-id',
    tableId,
    '--record-id',
    recordId,
  ];
  for (const field of FIELDS) args.push('--field-id', field.fieldId);
  args.push('--format', 'json');

  const response = runLarkCli(args);
  const fields = readRecordFields(response, recordId);
  assertRecordIdentity(fields, serializedPacket, identity);

  const output = fields['综合评估草稿｜DeepSeek-V4｜DEV.输出结果'];
  const thinking = fields['综合评估草稿｜DeepSeek-V4｜DEV.思考过程'];
  if (typeof output !== 'string' || output.trim() === '') {
    process.stdout.write(
      `${JSON.stringify({
        ok: false,
        operation: 'READ_ONLY_BASE_RECORD_EXPORT',
        onlineMutationPerformed: false,
        recordId,
        recordRevision: response?.data?.rev ?? null,
        generationState: 'OUTPUT_EMPTY',
        wrapperWritten: false,
        rawOutputWritten: false,
        thinkingBytes:
          typeof thinking === 'string'
            ? Buffer.byteLength(thinking, 'utf8')
            : 0,
      }, null, 2)}\n`,
    );
    process.exitCode = 2;
    return;
  }
  writeAndReadback(resolvedRawPath, output, 'RAW_OUTPUT');
  const consumed = consumeBaseOneShotAssessmentResult(packet, output);
  requireEqual(
    consumed.criterionCount,
    identity.criterionCount,
    'CONSUMED_CRITERION_COUNT',
  );
  requireEqual(
    consumed.ruleResults.length,
    identity.criterionCount,
    'CONSUMED_RULE_COUNT',
  );
  requireEqual(
    consumed.correlation.workItemId,
    identity.workItemId,
    'CONSUMED_WORK_ITEM_ID',
  );
  requireEqual(
    consumed.correlation.documentVersionId,
    identity.documentVersionId,
    'CONSUMED_DOCUMENT_VERSION_ID',
  );

  const unresolvedCount = requiredCount(
    consumed.overallSelfCheck.rulesWithMissingInputs,
    'UNRESOLVED_COUNT',
  );
  const sourceBoundCandidateCount = consumed.ruleResults.filter(
    (result) => Array.isArray(result.sourceRefs) && result.sourceRefs.length > 0,
  ).length;
  const recordRevision = requiredPositiveInteger(
    response?.data?.rev,
    'BASE_RECORD_REVISION',
  );
  const wrapper = {
    sourceResultId:
      `feishu-base:${baseToken}:${tableId}:${recordId}:rev:${recordRevision}`,
    workItemId: identity.workItemId,
    documentVersionId: identity.documentVersionId,
    packageId: identity.packageId,
    packageArtifactSha256: identity.packageArtifactSha256,
    criterionSetId: identity.criterionSetId,
    criterionCount: identity.criterionCount,
    evaluationItemCount: identity.criterionCount,
    unresolvedCount,
    sourceBoundCandidateCount,
    artifactBytes: output,
    packet,
  };
  const serializedWrapper = `${JSON.stringify([wrapper], null, 2)}\n`;
  writeAndReadback(resolvedWrapperPath, serializedWrapper, 'WRAPPER_OUTPUT');

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      operation: 'READ_ONLY_BASE_RECORD_EXPORT',
      onlineMutationPerformed: false,
      baseToken,
      tableId,
      recordId,
      recordRevision,
      wrapperOutputPath: resolvedWrapperPath,
      rawOutputPath: resolvedRawPath,
      workItemId: identity.workItemId,
      documentVersionId: identity.documentVersionId,
      criterionSetId: identity.criterionSetId,
      criterionCount: identity.criterionCount,
      returnedRuleCount: consumed.ruleResults.length,
      unresolvedCount,
      sourceBoundCandidateCount,
      outputBytes: Buffer.byteLength(output, 'utf8'),
      thinkingBytes:
        typeof thinking === 'string'
          ? Buffer.byteLength(thinking, 'utf8')
          : 0,
      authorityLevel: consumed.authorityLevel,
      engineeringConclusion: consumed.engineeringConclusion,
    }, null, 2)}\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      ok: false,
      operation: 'READ_ONLY_BASE_RECORD_EXPORT',
      onlineMutationPerformed: false,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2)}\n`,
  );
  process.exitCode = 1;
}
