import {
  buildTranslationTaskContract,
  validateTranslationCandidate,
  type TranslationCandidateUnit,
  type TranslationSourceUnit,
} from '../../server/modules/canonical-host/canonical-translation-rule-contract';
import {
  CANONICAL_TRANSLATION_RULE_SET_V1,
  CANONICAL_TRANSLATION_RULE_SET_V1_ID,
  CANONICAL_TRANSLATION_RULE_SET_V1_VERSION,
  HostOwnedV1TranslationRuleSetPrivateProvider,
} from '../../server/modules/canonical-host/canonical-translation-rule-set-v1.private';
import type { CanonicalTranslationConsumptionBinding } from '../../server/modules/canonical-host/canonical-reader-consumption';

const BINDING: CanonicalTranslationConsumptionBinding = {
  documentId: 'DOC-V1',
  revisionId: 'REV-V1',
  sbdPackageId: 'SBD-V1',
  sbdContentHash: 'sha256:sbd-v1',
  tcpPackageId: null,
  tcpContentHash: null,
};

const SOURCE_UNITS: readonly TranslationSourceUnit[] = [
  {
    unitKey: 'UNIT-WARNING',
    kind: 'warning',
    text: 'WARNING: airplane AIMS-2 ATA 31 P/N 777-FTD-31-21002 requires 28 V and 15 psi; see 777-FTD-23-20001.',
    sourceRefIds: ['SRC-P1-WARNING'],
  },
  {
    unitKey: 'UNIT-TABLE',
    kind: 'table',
    text: 'Item|Limit|Unit',
    sourceRefIds: ['SRC-P2-TABLE'],
  },
];

const CANDIDATE_UNITS: readonly TranslationCandidateUnit[] = [
  {
    unitKey: 'UNIT-WARNING',
    text: '警告：飞机 AIMS-2 ATA 31 P/N 777-FTD-31-21002 要求 28 V 和 15 psi；参见 777-FTD-23-20001。',
    sourceRefIds: ['SRC-P1-WARNING'],
    engineerRevision: null,
  },
  {
    unitKey: 'UNIT-TABLE',
    text: '项目|限制|单位',
    sourceRefIds: ['SRC-P2-TABLE'],
    engineerRevision: null,
  },
];

function isDeepFrozen(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every(isDeepFrozen);
}

describe('Host-owned immutable V1 TranslationRuleSet private provider', () => {
  it('exports a recursively immutable, independently versioned Host asset', () => {
    expect(CANONICAL_TRANSLATION_RULE_SET_V1.meta.rulePackId).toBe(
      CANONICAL_TRANSLATION_RULE_SET_V1_ID,
    );
    expect(CANONICAL_TRANSLATION_RULE_SET_V1.meta.rulePackVersion).toBe(
      CANONICAL_TRANSLATION_RULE_SET_V1_VERSION,
    );
    expect(CANONICAL_TRANSLATION_RULE_SET_V1.meta.schemaVersion).not.toBe(
      CANONICAL_TRANSLATION_RULE_SET_V1_VERSION,
    );
    expect(isDeepFrozen(CANONICAL_TRANSLATION_RULE_SET_V1)).toBe(true);
  });

  it('selects only the exact id/version/source/target tuple with no fallback', () => {
    const provider = new HostOwnedV1TranslationRuleSetPrivateProvider();
    const exact = provider.select({
      ruleSetId: CANONICAL_TRANSLATION_RULE_SET_V1_ID,
      ruleSetVersion: CANONICAL_TRANSLATION_RULE_SET_V1_VERSION,
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
    });
    expect(exact).toBe(CANONICAL_TRANSLATION_RULE_SET_V1);

    const base = {
      ruleSetId: CANONICAL_TRANSLATION_RULE_SET_V1_ID,
      ruleSetVersion: CANONICAL_TRANSLATION_RULE_SET_V1_VERSION,
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
    };
    expect(provider.select({ ...base, ruleSetId: 'unknown' })).toBeNull();
    expect(provider.select({ ...base, ruleSetVersion: '1.0.1' })).toBeNull();
    expect(provider.select({ ...base, sourceLocale: 'fr' })).toBeNull();
    expect(provider.select({ ...base, targetLocale: 'zh-TW' })).toBeNull();
  });

  it('builds the private task with the exact rule identity and currentness binding', () => {
    const task = buildTranslationTaskContract({
      sourceUnits: SOURCE_UNITS,
      rulePack: CANONICAL_TRANSLATION_RULE_SET_V1,
      rulePackId: CANONICAL_TRANSLATION_RULE_SET_V1_ID,
      rulePackVersion: CANONICAL_TRANSLATION_RULE_SET_V1_VERSION,
      taskStartBinding: BINDING,
    });
    expect(task).not.toBeNull();
    expect(task?.rulePack.meta).toMatchObject({
      rulePackId: CANONICAL_TRANSLATION_RULE_SET_V1_ID,
      rulePackVersion: CANONICAL_TRANSLATION_RULE_SET_V1_VERSION,
    });
    expect(task?.taskStartBinding).toEqual(BINDING);
  });

  it('accepts a faithful candidate and rejects terminology, identifiers, units, tables, and SourceRef drift', () => {
    const faithful = validateTranslationCandidate({
      rulePack: CANONICAL_TRANSLATION_RULE_SET_V1,
      rulePackId: CANONICAL_TRANSLATION_RULE_SET_V1_ID,
      rulePackVersion: CANONICAL_TRANSLATION_RULE_SET_V1_VERSION,
      sourceUnits: SOURCE_UNITS,
      candidateUnits: CANDIDATE_UNITS,
      taskStartBinding: BINDING,
      validationTimeBinding: BINDING,
    });
    expect(faithful.verdict).toBe('ACCEPTED');

    const violations = [
      CANDIDATE_UNITS.map((unit) =>
        unit.unitKey === 'UNIT-WARNING'
          ? { ...unit, text: unit.text.replace('警告', '提示') }
          : unit,
      ),
      CANDIDATE_UNITS.map((unit) =>
        unit.unitKey === 'UNIT-WARNING'
          ? { ...unit, text: unit.text.replace('AIMS-2', 'AIMS 二代') }
          : unit,
      ),
      CANDIDATE_UNITS.map((unit) =>
        unit.unitKey === 'UNIT-WARNING'
          ? { ...unit, text: unit.text.replace('15 psi', '15 kPa') }
          : unit,
      ),
      CANDIDATE_UNITS.map((unit) =>
        unit.unitKey === 'UNIT-TABLE'
          ? { ...unit, text: '项目|限制单位' }
          : unit,
      ),
      CANDIDATE_UNITS.map((unit) =>
        unit.unitKey === 'UNIT-WARNING'
          ? { ...unit, sourceRefIds: ['SRC-P9-OTHER'] }
          : unit,
      ),
    ];

    const expectedCodes = [
      'TERM_MANDATORY_MISSING',
      'NO_TRANSLATE_VIOLATED',
      'UNIT_NOT_PRESERVED',
      'TABLE_ALIGNMENT_BROKEN',
      'SOURCE_REF_MISMATCH',
    ];
    violations.forEach((candidateUnits, index) => {
      const result = validateTranslationCandidate({
        rulePack: CANONICAL_TRANSLATION_RULE_SET_V1,
        rulePackId: CANONICAL_TRANSLATION_RULE_SET_V1_ID,
        rulePackVersion: CANONICAL_TRANSLATION_RULE_SET_V1_VERSION,
        sourceUnits: SOURCE_UNITS,
        candidateUnits,
        taskStartBinding: BINDING,
        validationTimeBinding: BINDING,
      });
      expect(result.verdict).toBe('REJECTED');
      expect(result.findings.map((finding) => finding.code)).toContain(
        expectedCodes[index],
      );
    });
  });
});
