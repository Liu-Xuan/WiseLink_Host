import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  collectPredicatePaths,
  parseApplicabilityPredicate,
} from './predicateDsl.js';

export const WISELINK_V3_1_JOB_AID_RULE_PACK_VERSION = '0.2';
// Compatibility baseline only. Runtime completeness is derived from the
// selected immutable CriterionSetVersion; future Job Aid revisions may have a
// different member count.
export const WISELINK_V3_1_JOB_AID_EXPECTED_CRITERIA_COUNT = 150;
export const WISELINK_V3_1_ATTACHMENT5_EXPECTED_ITEM_COUNT = 31;

const REQUIRED_CRITERION_FIELDS = Object.freeze([
  'criterion_id',
  'global_sequence',
  'stage_code',
  'stage_name',
  'criterion_name',
  'evaluation_question',
  'automation_mode',
  'blocker_level',
  'applicability_predicate',
  'normative_force',
  'source_provenance',
]);

export async function loadJobAidRulePackFromFile(path) {
  const bytes = await readFile(path);
  const rulePack = JSON.parse(bytes.toString('utf8'));
  const validation = validateJobAidRulePack(rulePack);
  return {
    rulePack,
    sourcePath: path,
    sourceHash: sha256(bytes),
    validation,
  };
}

export function validateJobAidRulePack(rulePack, options = {}) {
  if (!rulePack || typeof rulePack !== 'object') throw new TypeError('Job Aid rule pack must be an object.');
  const criteria = rulePack.criteria;
  if (!Array.isArray(criteria)) throw new TypeError('Job Aid rule pack criteria must be an array.');
  const expectedCriteriaCount = options.expectedCriteriaCount
    ?? rulePack.package_meta?.criteria_count;
  if (!Number.isInteger(expectedCriteriaCount) || expectedCriteriaCount < 1) {
    throw new Error('package_meta.criteria_count must be a positive integer.');
  }
  if (criteria.length !== expectedCriteriaCount) {
    throw new Error(`Expected ${expectedCriteriaCount} criteria, found ${criteria.length}.`);
  }

  const declaredVersion = String(rulePack.package_meta?.schema_version ?? '');
  const expectedSchemaVersion = String(
    options.expectedSchemaVersion ?? declaredVersion,
  );
  if (!declaredVersion) {
    throw new Error('Job Aid rule pack schema version is required.');
  }
  if (declaredVersion !== expectedSchemaVersion) {
    throw new Error(`Expected Job Aid schema version ${expectedSchemaVersion}, found ${declaredVersion || 'missing'}.`);
  }
  if (rulePack.package_meta?.criteria_count !== criteria.length) {
    throw new Error('package_meta.criteria_count does not match criteria length.');
  }

  const controlledEnums = {
    automation_mode: requiredEnum(rulePack, 'automation_mode'),
    blocker_level: requiredEnum(rulePack, 'blocker_level'),
    normative_force: requiredEnum(rulePack, 'normative_force'),
    source_provenance: requiredEnum(rulePack, 'source_provenance'),
  };

  const criterionIds = new Set();
  const globalSequences = new Set();
  const predicatePaths = new Set();
  for (const [index, criterion] of criteria.entries()) {
    for (const field of REQUIRED_CRITERION_FIELDS) {
      if (criterion?.[field] === undefined || criterion[field] === null || criterion[field] === '') {
        throw new Error(`Criterion at index ${index} is missing required field ${field}.`);
      }
    }
    if (criterionIds.has(criterion.criterion_id)) {
      throw new Error(`Duplicate criterion id: ${criterion.criterion_id}.`);
    }
    criterionIds.add(criterion.criterion_id);
    if (criterion.global_sequence !== index + 1 || globalSequences.has(criterion.global_sequence)) {
      throw new Error(`Criterion ${criterion.criterion_id} has invalid global_sequence ${criterion.global_sequence}.`);
    }
    globalSequences.add(criterion.global_sequence);
    for (const [field, allowedValues] of Object.entries(controlledEnums)) {
      if (!allowedValues.includes(criterion[field])) {
        throw new Error(`Criterion ${criterion.criterion_id} has invalid ${field}: ${criterion[field]}.`);
      }
    }
    const ast = parseApplicabilityPredicate(criterion.applicability_predicate);
    for (const path of collectPredicatePaths(ast)) predicatePaths.add(path);
  }

  const attachmentItems = rulePack.formal_attachment5?.items;
  if (!Array.isArray(attachmentItems)) {
    throw new TypeError('formal_attachment5.items must be an array.');
  }
  const expectedAttachmentCount = options.expectedAttachmentCount
    ?? rulePack.package_meta?.formal_attachment5_item_count;
  if (!Number.isInteger(expectedAttachmentCount) || expectedAttachmentCount < 0) {
    throw new Error('package_meta.formal_attachment5_item_count must be a non-negative integer.');
  }
  if (attachmentItems.length !== expectedAttachmentCount) {
    throw new Error(`Expected ${expectedAttachmentCount} Attachment 5 items, found ${attachmentItems.length}.`);
  }
  if (rulePack.package_meta?.formal_attachment5_item_count !== attachmentItems.length) {
    throw new Error('package_meta.formal_attachment5_item_count does not match Attachment 5 items length.');
  }
  const attachmentIds = new Set();
  for (const item of attachmentItems) {
    if (!item?.item_id) throw new Error('Attachment 5 item is missing item_id.');
    if (attachmentIds.has(item.item_id)) throw new Error(`Duplicate Attachment 5 item id: ${item.item_id}.`);
    attachmentIds.add(item.item_id);
    for (const criterionId of item.mapped_criteria_ids ?? []) {
      if (!criterionIds.has(criterionId)) {
        throw new Error(`Attachment 5 item ${item.item_id} maps unknown criterion ${criterionId}.`);
      }
    }
  }
  for (const criterion of criteria) {
    for (const attachmentId of criterion.attachment5_item_ids ?? []) {
      if (!attachmentIds.has(attachmentId)) {
        throw new Error(`Criterion ${criterion.criterion_id} maps unknown Attachment 5 item ${attachmentId}.`);
      }
      const attachment = attachmentItems.find((item) => item.item_id === attachmentId);
      if (!(attachment.mapped_criteria_ids ?? []).includes(criterion.criterion_id)) {
        throw new Error(`Attachment 5 mapping is not reciprocal: ${criterion.criterion_id} <-> ${attachmentId}.`);
      }
    }
  }

  return Object.freeze({
    valid: true,
    rulePackVersion: declaredVersion,
    criteriaCount: criteria.length,
    attachment5ItemCount: attachmentItems.length,
    criterionIds: [...criterionIds],
    predicatePaths: [...predicatePaths].sort(),
  });
}

function requiredEnum(rulePack, name) {
  const values = rulePack.enums?.[name];
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`Job Aid rule pack is missing controlled enum ${name}.`);
  }
  return values;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
