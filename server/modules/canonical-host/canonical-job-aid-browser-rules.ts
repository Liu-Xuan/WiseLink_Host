import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const CANONICAL_ACTIVE_JOB_AID_CRITERION_SET_ID =
  'JACS-72D0484B6F1C17A38F671F46';

export interface CanonicalJobAidBrowserRule {
  criterionName: string;
  evaluationQuestion: string;
  decisionRule: string;
  appliesWhen: string;
  gapMetadata: {
    blockerLevel: 'HARD_BLOCK' | 'ACTION_BLOCK' | 'WARNING' | 'NONE';
    automationMode: 'HYBRID' | 'RULE' | 'HUMAN_REQUIRED' | 'AI_ASSISTED';
    stageCode: string;
    stageName: string;
  };
}

export async function readActiveJobAidBrowserRules(
  criterionSetId: string,
): Promise<Map<string, CanonicalJobAidBrowserRule>> {
  if (criterionSetId !== CANONICAL_ACTIVE_JOB_AID_CRITERION_SET_ID) {
    throw new Error('ENGINEER_REVIEW_RULESET_CHANGED');
  }
  const rulePack = await readPackagedRulePack();
  if (!Array.isArray(rulePack.criteria)) {
    throw new Error('ENGINEER_REVIEW_RULE_CONTENT_UNAVAILABLE');
  }
  const rules = new Map<string, CanonicalJobAidBrowserRule>();
  for (const value of rulePack.criteria) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('ENGINEER_REVIEW_RULE_CONTENT_UNAVAILABLE');
    }
    const criterion = value as Record<string, unknown>;
    const criterionId = browserRuleText(criterion.criterion_id);
    if (rules.has(criterionId)) {
      throw new Error(`ENGINEER_REVIEW_CRITERION_DUPLICATE:${criterionId}`);
    }
    rules.set(criterionId, {
      criterionName: browserRuleText(criterion.criterion_name),
      evaluationQuestion: browserRuleText(criterion.evaluation_question),
      decisionRule: browserRuleText(criterion.decision_rule),
      appliesWhen: browserRuleText(criterion.applies_when),
      gapMetadata: {
        blockerLevel: browserRuleEnum(criterion.blocker_level, [
          'HARD_BLOCK',
          'ACTION_BLOCK',
          'WARNING',
          'NONE',
        ] as const),
        automationMode: browserRuleEnum(criterion.automation_mode, [
          'HYBRID',
          'RULE',
          'HUMAN_REQUIRED',
          'AI_ASSISTED',
        ] as const),
        stageCode: browserRuleText(criterion.stage_code),
        stageName: browserRuleText(criterion.stage_name),
      },
    });
  }
  return rules;
}

async function readPackagedRulePack(): Promise<Record<string, unknown>> {
  const relativePath = 'job-aid/rule-pack-0.2.json';
  const candidates = [
    resolve(
      process.cwd(),
      'dist/server/runtime-assets/assessment-host',
      relativePath,
    ),
    resolve(
      process.cwd(),
      'server/runtime-assets/assessment-host',
      relativePath,
    ),
    resolve(__dirname, '../../runtime-assets/assessment-host', relativePath),
  ];
  for (const path of candidates) {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as Record<
        string,
        unknown
      >;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new Error('ASSESSMENT_RUNTIME_ASSET_NOT_PACKAGED:' + relativePath);
}

function browserRuleText(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('ENGINEER_REVIEW_RULE_CONTENT_UNAVAILABLE');
  }
  return value.trim();
}

function browserRuleEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] {
  const text = browserRuleText(value);
  if (!allowed.includes(text)) {
    throw new Error('ENGINEER_REVIEW_RULE_CONTENT_UNAVAILABLE');
  }
  return text as T[number];
}
