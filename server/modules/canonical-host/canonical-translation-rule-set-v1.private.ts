/**
 * Host-owned immutable V1 TranslationRuleSet asset and its narrow private
 * selector. This is rule data, not a prompt and not a model/provider adapter.
 *
 * CANDIDATE_ONLY / NOT_WIRED:
 * - no Nest module registration;
 * - no ActionAttempt, ResultEnvelope, ResultGate, CAS, DB, or FileService;
 * - no network, LLM, gateway, runtime config, or secret access;
 * - no 0.11/0.10 runtime dependency.
 *
 * The only selection identity is the exact (ruleSetId, ruleSetVersion) pair
 * plus explicit source/target locales. There is no fallback and no second
 * hash, baseline, fence, or currentness authority.
 */

import {
  TRANSLATION_RULE_PACK_SCHEMA_VERSION,
  selectTranslationRulePack,
  type TranslationRulePack,
} from './canonical-translation-rule-contract';

type Primitive = bigint | boolean | null | number | string | symbol | undefined;

export type ImmutableTranslationRuleSet<T> = T extends Primitive
  ? T
  : T extends readonly (infer Item)[]
    ? readonly ImmutableTranslationRuleSet<Item>[]
    : { readonly [Key in keyof T]: ImmutableTranslationRuleSet<T[Key]> };

function deepFreeze<T>(value: T): ImmutableTranslationRuleSet<T> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value as ImmutableTranslationRuleSet<T>;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value) as ImmutableTranslationRuleSet<T>;
}

export const CANONICAL_TRANSLATION_RULE_SET_V1_ID =
  'wiselink.host.translation-rules.zh-cn.v1';

export const CANONICAL_TRANSLATION_RULE_SET_V1_VERSION = '1.0.0';

const CANONICAL_TRANSLATION_RULE_SET_V1_SOURCE: TranslationRulePack = {
  meta: {
    schemaVersion: TRANSLATION_RULE_PACK_SCHEMA_VERSION,
    rulePackId: CANONICAL_TRANSLATION_RULE_SET_V1_ID,
    rulePackVersion: CANONICAL_TRANSLATION_RULE_SET_V1_VERSION,
    label: 'WiseLink Host engineering translation rules zh-CN V1',
    targetLocale: 'zh-CN',
    sourceLocales: ['en', 'en-US', 'en-GB'],
  },
  terms: [
    {
      ruleId: 'term.warning.zh-cn',
      sourceTerm: 'WARNING',
      targetRenderings: ['警告'],
      severity: 'mandatory',
    },
    {
      ruleId: 'term.caution.zh-cn',
      sourceTerm: 'CAUTION',
      targetRenderings: ['注意'],
      severity: 'mandatory',
    },
    {
      ruleId: 'term.note.zh-cn',
      sourceTerm: 'NOTE',
      targetRenderings: ['注', '注释'],
      severity: 'mandatory',
    },
    {
      ruleId: 'term.flight-deck.zh-cn',
      sourceTerm: 'flight deck',
      targetRenderings: ['驾驶舱'],
      severity: 'mandatory',
    },
    {
      ruleId: 'term.airplane.zh-cn',
      sourceTerm: 'airplane',
      targetRenderings: ['飞机'],
      severity: 'mandatory',
    },
  ],
  noTranslate: [
    {
      ruleId: 'no-translate.aims-2',
      token: 'AIMS-2',
    },
    {
      ruleId: 'no-translate.gadss',
      token: 'GADSS',
    },
    {
      ruleId: 'no-translate.eccn-9e991',
      token: 'ECCN 9E991',
    },
  ],
  deterministic: {
    preservedIdentifierPatterns: [
      String.raw`\b(?:P\/N|S\/N)\s*[:#]?\s*[A-Z0-9][A-Z0-9./-]*\b`,
      String.raw`\b(?:DMC|PMC)\s+[A-Z0-9][A-Z0-9_-]*\b`,
      String.raw`\b(?:SB|SL|SIL|AD|AMM)\s+[A-Z0-9][A-Z0-9./-]*\b`,
      String.raw`\b(?:MSN|LN|MOD)\s*[:#]?\s*[A-Z0-9][A-Z0-9./-]*\b`,
    ],
    numericFidelity: true,
    preservedUnits: [
      'kg',
      'lb',
      'mm',
      'psi',
      'kPa',
      'MPa',
      '°C',
      '°F',
      'Hz',
      'kHz',
      'MHz',
      'N·m',
      'FL',
    ],
    preserveAtaChapterNumbers: true,
    preservePartNumbers: true,
    segmentAlignment: true,
    tableAlignment: true,
    preserveCitations: true,
  },
};

const validatedV1 = selectTranslationRulePack(
  new Map([
    [
      CANONICAL_TRANSLATION_RULE_SET_V1_ID,
      CANONICAL_TRANSLATION_RULE_SET_V1_SOURCE,
    ],
  ]),
  CANONICAL_TRANSLATION_RULE_SET_V1_ID,
  CANONICAL_TRANSLATION_RULE_SET_V1_VERSION,
);

if (validatedV1 === null) {
  throw new Error('CANONICAL_TRANSLATION_RULE_SET_V1_INVALID');
}

export const CANONICAL_TRANSLATION_RULE_SET_V1 = deepFreeze(validatedV1);

export interface PrivateTranslationRuleSetSelection {
  ruleSetId: string;
  ruleSetVersion: string;
  sourceLocale: string;
  targetLocale: string;
}

export interface PrivateTranslationRuleSetProvider {
  select(
    selection: PrivateTranslationRuleSetSelection,
  ): ImmutableTranslationRuleSet<TranslationRulePack> | null;
}

/**
 * Deliberately narrow provider for the single V1 Host-owned asset.
 * It is not registered in canonical-host.module.ts. A later serial owner may
 * wire it after the durable translation boundary and persistence contract are
 * frozen; until then it remains a private, deterministic selection surface.
 */
export class HostOwnedV1TranslationRuleSetPrivateProvider implements PrivateTranslationRuleSetProvider {
  select(
    selection: PrivateTranslationRuleSetSelection,
  ): ImmutableTranslationRuleSet<TranslationRulePack> | null {
    if (
      selection.ruleSetId !== CANONICAL_TRANSLATION_RULE_SET_V1_ID ||
      selection.ruleSetVersion !== CANONICAL_TRANSLATION_RULE_SET_V1_VERSION ||
      selection.targetLocale !==
        CANONICAL_TRANSLATION_RULE_SET_V1.meta.targetLocale ||
      !CANONICAL_TRANSLATION_RULE_SET_V1.meta.sourceLocales.includes(
        selection.sourceLocale,
      )
    ) {
      return null;
    }
    return CANONICAL_TRANSLATION_RULE_SET_V1;
  }
}
