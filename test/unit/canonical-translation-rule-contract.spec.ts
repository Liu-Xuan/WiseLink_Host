import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  TRANSLATION_RESULT_SCHEMA_VERSION,
  TRANSLATION_RULE_PACK_SCHEMA_VERSION,
  buildTranslationTaskContract,
  parseTranslationResultContract,
  selectTranslationRulePack,
  validateTranslationCandidate,
  validateTranslationResultContract,
  type TranslationRulePack,
  type TranslationSourceUnit,
} from '../../server/modules/canonical-host/canonical-translation-rule-contract';
import type { CanonicalTranslationConsumptionBinding } from '../../server/modules/canonical-host/canonical-reader-consumption';

/**
 * WL31 translation owner/rule migration round 1 (C5 cleanup): deterministic
 * contract validation against the REAL frozen FTD-2 package fixture
 * (test/fixtures/real-ftd-frozen2.unified-package.json — Boeing 777 FTD
 * 31-21002, AIMS-2 Block Point V18; this is the real-technical-document
 * rule-effect evidence) and the SYNTHETIC native S1000D contract-shape
 * fixture (server/runtime-assets/technical-publication-parsed-package/
 * v1-frozen-2/fixtures/source/native-s1000d-issue-4-2.parsed.json). The
 * S1000D fixture is a hand-built synthetic package: it proves only the
 * native parser's unit/table SHAPE flows through the contract. It is NOT a
 * real engineering sample, and no test or doc below claims it is. Positive
 * and negative cases prove the rules change accept/reject, diagnostics,
 * and currentness — with no model, provider, mock transport, or synthetic
 * actor masquerading as a real translation execution.
 *
 * Currentness identity reuses the existing private
 * CanonicalTranslationConsumptionBinding; there is no second hash or fence.
 * Rule identity is the exact (rulePackId, rulePackVersion) pair.
 */

const FTD_FIXTURE_PATH = resolve(
  __dirname,
  '../fixtures/real-ftd-frozen2.unified-package.json',
);
const S1000D_FIXTURE_PATH = resolve(
  __dirname,
  '../../server/runtime-assets/technical-publication-parsed-package/v1-frozen-2/fixtures/source/native-s1000d-issue-4-2.parsed.json',
);

interface FtdFixtureUnit {
  continuityKey: string;
  kind: string;
  payload: { role?: string; text?: string };
  sourceRefIds?: string[];
}

interface FtdFixturePackage {
  packageId: string;
  document: { documentId: string };
  integrity: { contentHash: string };
  contentUnits: FtdFixtureUnit[];
}

const ftdFixture = JSON.parse(
  readFileSync(FTD_FIXTURE_PATH, 'utf8'),
) as FtdFixturePackage;

const FTD_DOCUMENT_ID = ftdFixture.document.documentId;
const FTD_CONTENT_HASH = ftdFixture.integrity.contentHash;

interface S1000DFixtureUnit {
  unitId: string;
  kind: string;
  text: string;
  sourcePath: string;
  locator: string;
}

interface S1000DFixturePackage {
  contentUnits: S1000DFixtureUnit[];
}

const s1000dFixture = JSON.parse(
  readFileSync(S1000D_FIXTURE_PATH, 'utf8'),
) as S1000DFixturePackage;

const RECOGNIZED_UNIT_KINDS = new Set([
  'paragraph',
  'heading',
  'text_block',
  'table',
  'preserved_source',
  'step',
  'list_item',
  'warning',
  'caution',
  'note',
  'figure',
]);

/**
 * Real units from the FTD fixture: text-bearing bodies, plus targeted
 * units carrying the key technical tokens (part number, citation, ECCN,
 * FL285) wherever they sit in the document — the corpus is not
 * front-loaded.
 */
function ftdSourceUnits(limit: number): TranslationSourceUnit[] {
  const units: TranslationSourceUnit[] = [];
  const seen = new Set<string>();
  const wanted = [
    '777-FTD-23-20001',
    'ECCN',
    '777-FTD-31-21002',
    'Jan 1, 2023',
    'AIMS-2',
    'FL285',
  ];
  const take = (unit: FtdFixtureUnit): void => {
    if (seen.has(unit.continuityKey)) return;
    seen.add(unit.continuityKey);
    units.push({
      unitKey: unit.continuityKey,
      kind: unit.kind as TranslationSourceUnit['kind'],
      text: unit.payload.text as string,
      sourceRefIds: unit.sourceRefIds ?? [],
    });
  };
  for (const unit of ftdFixture.contentUnits) {
    if (units.length >= limit) break;
    if (!RECOGNIZED_UNIT_KINDS.has(unit.kind)) continue;
    const text = unit.payload?.text;
    if (typeof text !== 'string' || text.trim().length === 0) continue;
    take(unit);
  }
  for (const token of wanted) {
    for (const unit of ftdFixture.contentUnits) {
      const text = unit.payload?.text;
      if (typeof text !== 'string' || !text.includes(token)) continue;
      if (!RECOGNIZED_UNIT_KINDS.has(unit.kind)) continue;
      take(unit);
      break;
    }
  }
  return units;
}

const SOURCE_UNITS = ftdSourceUnits(12);

/**
 * Currentness binding built from the FTD fixture's real identity fields
 * (documentId, packageId, contentHash). The revision identity is the
 * package content hash — the only version identity the frozen package
 * carries.
 */
const FTD_BINDING: CanonicalTranslationConsumptionBinding = {
  documentId: FTD_DOCUMENT_ID,
  revisionId: FTD_CONTENT_HASH,
  sbdPackageId: ftdFixture.packageId,
  sbdContentHash: FTD_CONTENT_HASH,
  tcpPackageId: null,
  tcpContentHash: null,
};

const FTD_RULE_PACK_VERSION = 'v1.0.0';

/**
 * Rule pack derived from the real FTD corpus: mandatory terms,
 * no-translate tokens, identifier/number/unit/ATA/part-number/citation
 * preservation. Version is an independent field — never hidden in the id.
 */
const FTD_RULE_PACK: TranslationRulePack = {
  meta: {
    schemaVersion: TRANSLATION_RULE_PACK_SCHEMA_VERSION,
    rulePackId: 'boeing-ftd-zh-cn.baseline',
    rulePackVersion: FTD_RULE_PACK_VERSION,
    label: 'Boeing FTD zh-CN baseline (WL31 round 1)',
    targetLocale: 'zh-CN',
    sourceLocales: ['en-US'],
  },
  terms: [
    {
      ruleId: 'term.aims2',
      sourceTerm: 'AIMS-2',
      targetRenderings: ['AIMS-2'],
      severity: 'mandatory',
    },
    {
      ruleId: 'term.gadss',
      sourceTerm: 'GADSS',
      targetRenderings: ['GADSS'],
      severity: 'mandatory',
    },
    {
      ruleId: 'term.airplane',
      sourceTerm: 'Airplane',
      targetRenderings: ['飞机'],
      severity: 'mandatory',
    },
  ],
  noTranslate: [
    { ruleId: 'notranslate.eccn', token: '9E991' },
    { ruleId: 'notranslate.ftd-number', token: '777-FTD-31-21002' },
  ],
  deterministic: {
    preservedIdentifierPatterns: ['AIMS-2'],
    numericFidelity: true,
    preservedUnits: ['kg', 'mm', 'FL285'],
    preserveAtaChapterNumbers: true,
    preservePartNumbers: true,
    segmentAlignment: true,
    tableAlignment: true,
    preserveCitations: true,
  },
};

const REGISTRY = new Map<string, unknown>([
  [FTD_RULE_PACK.meta.rulePackId, FTD_RULE_PACK],
]);

interface CandidateUnit {
  unitKey: string;
  text: string;
  sourceRefIds: string[];
  engineerRevision: unknown;
}

function candidateFor(
  units: readonly TranslationSourceUnit[],
): CandidateUnit[] {
  // A faithful deterministic "translation": technical tokens, numbers, and
  // identifiers pass through verbatim; the mandated general term is
  // rendered; the exact SourceRef set is carried on every unit.
  return units.map((unit) => ({
    unitKey: unit.unitKey,
    text: `【译文】${unit.text.replace(/Airplane/g, '飞机')}`,
    sourceRefIds: [...unit.sourceRefIds],
    engineerRevision: null,
  }));
}

function validate(
  overrides: Partial<{
    rulePack: unknown;
    rulePackId: string;
    rulePackVersion: string;
    sourceUnits: readonly unknown[];
    candidateUnits: readonly unknown[];
    taskStartBinding: CanonicalTranslationConsumptionBinding | null;
    validationTimeBinding: CanonicalTranslationConsumptionBinding | null;
  }> = {},
) {
  return validateTranslationCandidate({
    rulePack: FTD_RULE_PACK,
    rulePackId: FTD_RULE_PACK.meta.rulePackId,
    rulePackVersion: FTD_RULE_PACK.meta.rulePackVersion,
    sourceUnits: SOURCE_UNITS,
    candidateUnits: candidateFor(SOURCE_UNITS),
    taskStartBinding: FTD_BINDING,
    validationTimeBinding: FTD_BINDING,
    ...overrides,
  });
}

describe('translation rule contract on the real frozen FTD package (WL31 owner/rule migration round 1, C5)', () => {
  it('loads real source units with non-empty text and sourceRefIds from the fixture', () => {
    expect(SOURCE_UNITS.length).toBeGreaterThanOrEqual(12);
    for (const unit of SOURCE_UNITS) {
      expect(unit.text.trim().length).toBeGreaterThan(0);
      expect(unit.sourceRefIds.length).toBeGreaterThan(0);
    }
    // The targeted real tokens are actually covered by the selection.
    const allText = SOURCE_UNITS.map((unit) => unit.text).join('\n');
    expect(allText).toContain('777-FTD-23-20001');
    expect(allText).toContain('9E991');
    expect(allText).toContain('777-FTD-31-21002');
    expect(allText).toContain('AIMS-2');
    expect(allText).toContain('Jan 1, 2023');
    expect(allText).toContain('FL285');
  });

  it('selects the versioned rule pack by exact id+version pair and fails closed on unknown ids or versions', () => {
    const selected = selectTranslationRulePack(
      REGISTRY,
      'boeing-ftd-zh-cn.baseline',
      FTD_RULE_PACK_VERSION,
    );
    expect(selected).not.toBeNull();
    expect(selected?.meta.rulePackId).toBe('boeing-ftd-zh-cn.baseline');
    expect(selected?.meta.rulePackVersion).toBe(FTD_RULE_PACK_VERSION);

    // Unknown id fails closed.
    expect(
      selectTranslationRulePack(
        REGISTRY,
        'boeing-ftd-zh-cn.baseline.v2',
        FTD_RULE_PACK_VERSION,
      ),
    ).toBeNull();
    expect(
      selectTranslationRulePack(REGISTRY, '', FTD_RULE_PACK_VERSION),
    ).toBeNull();
    // Same id but wrong version fails closed — version is never implied
    // by the id or the schemaVersion.
    expect(
      selectTranslationRulePack(
        REGISTRY,
        'boeing-ftd-zh-cn.baseline',
        'v0.9.9',
      ),
    ).toBeNull();
    expect(
      selectTranslationRulePack(REGISTRY, 'boeing-ftd-zh-cn.baseline', ''),
    ).toBeNull();
  });

  it('builds the private task contract with the exact rule pair and binding identity (fail closed on bad inputs)', () => {
    const task = buildTranslationTaskContract({
      sourceUnits: SOURCE_UNITS,
      rulePack: FTD_RULE_PACK,
      rulePackId: FTD_RULE_PACK.meta.rulePackId,
      rulePackVersion: FTD_RULE_PACK.meta.rulePackVersion,
      taskStartBinding: FTD_BINDING,
    });
    expect(task).not.toBeNull();
    expect(task?.taskStartBinding.documentId).toBe(FTD_DOCUMENT_ID);
    expect(task?.sourceUnits.length).toBe(SOURCE_UNITS.length);
    expect(task?.rulePack.meta.rulePackVersion).toBe(FTD_RULE_PACK_VERSION);

    // Wrong id rejects.
    expect(
      buildTranslationTaskContract({
        sourceUnits: SOURCE_UNITS,
        rulePack: FTD_RULE_PACK,
        rulePackId: 'wrong.pack.id',
        rulePackVersion: FTD_RULE_PACK.meta.rulePackVersion,
        taskStartBinding: FTD_BINDING,
      }),
    ).toBeNull();
    // Wrong version rejects.
    expect(
      buildTranslationTaskContract({
        sourceUnits: SOURCE_UNITS,
        rulePack: FTD_RULE_PACK,
        rulePackId: FTD_RULE_PACK.meta.rulePackId,
        rulePackVersion: 'v0.9.9',
        taskStartBinding: FTD_BINDING,
      }),
    ).toBeNull();
    // Missing binding rejects.
    expect(
      buildTranslationTaskContract({
        sourceUnits: SOURCE_UNITS,
        rulePack: FTD_RULE_PACK,
        rulePackId: FTD_RULE_PACK.meta.rulePackId,
        rulePackVersion: FTD_RULE_PACK.meta.rulePackVersion,
        taskStartBinding: null,
      }),
    ).toBeNull();

    const mixedSourceRefs = [
      {
        ...SOURCE_UNITS[0],
        sourceRefIds: [SOURCE_UNITS[0].sourceRefIds[0], 42 as never],
      },
    ];
    expect(
      buildTranslationTaskContract({
        sourceUnits: mixedSourceRefs,
        rulePack: FTD_RULE_PACK,
        rulePackId: FTD_RULE_PACK.meta.rulePackId,
        rulePackVersion: FTD_RULE_PACK.meta.rulePackVersion,
        taskStartBinding: FTD_BINDING,
      }),
    ).toBeNull();

    expect(
      buildTranslationTaskContract({
        sourceUnits: [SOURCE_UNITS[0], { ...SOURCE_UNITS[0] }],
        rulePack: FTD_RULE_PACK,
        rulePackId: FTD_RULE_PACK.meta.rulePackId,
        rulePackVersion: FTD_RULE_PACK.meta.rulePackVersion,
        taskStartBinding: FTD_BINDING,
      }),
    ).toBeNull();
  });

  it('ACCEPTS a faithful translation of the real source units', () => {
    const result = validate();
    expect(result.verdict).toBe('ACCEPTED');
    expect(result.findings).toEqual([]);
    expect(result.validatedUnitCount).toBe(SOURCE_UNITS.length);
    expect(result.rulePackVersion).toBe(FTD_RULE_PACK_VERSION);
  });

  it('REJECTS when the requested rule pack version differs from the pack itself', () => {
    const result = validate({ rulePackVersion: 'v0.9.9' });
    expect(result.verdict).toBe('REJECTED');
    expect(result.findings.some((f) => f.code === 'UNRECOGNIZED_RULES')).toBe(
      true,
    );
  });

  it('REJECTS invalid preservedIdentifierPatterns regexes without throwing (fail closed)', () => {
    const badRegexPack: TranslationRulePack = {
      ...FTD_RULE_PACK,
      deterministic: {
        ...FTD_RULE_PACK.deterministic,
        preservedIdentifierPatterns: ['[unclosed'],
      },
    };
    // The pack itself fails recognition.
    const result = validate({ rulePack: badRegexPack });
    expect(result.verdict).toBe('REJECTED');
    expect(result.rulePackId).toBeNull();
    expect(result.findings.some((f) => f.code === 'UNRECOGNIZED_RULES')).toBe(
      true,
    );
  });

  it('REJECTS mixed-type rule arrays instead of silently filtering entries', () => {
    const packs: unknown[] = [
      {
        ...FTD_RULE_PACK,
        meta: {
          ...FTD_RULE_PACK.meta,
          sourceLocales: ['en', 42],
        },
      },
      {
        ...FTD_RULE_PACK,
        terms: [
          {
            ...FTD_RULE_PACK.terms[0],
            targetRenderings: ['译文', 42],
          },
        ],
      },
      {
        ...FTD_RULE_PACK,
        deterministic: {
          ...FTD_RULE_PACK.deterministic,
          preservedIdentifierPatterns: [String.raw`\bAIMS-2\b`, 42],
        },
      },
      {
        ...FTD_RULE_PACK,
        deterministic: {
          ...FTD_RULE_PACK.deterministic,
          preservedUnits: ['FL', 42],
        },
      },
    ];

    for (const rulePack of packs) {
      const result = validate({ rulePack });
      expect(result.verdict).toBe('REJECTED');
      expect(result.rulePackId).toBeNull();
      expect(result.findings.map((finding) => finding.code)).toContain(
        'UNRECOGNIZED_RULES',
      );
    }
  });

  it('REJECTS on currentness drift between task-start and validation-time bindings', () => {
    const drifted: CanonicalTranslationConsumptionBinding = {
      ...FTD_BINDING,
      revisionId: 'sha256:different-revision',
    };
    const result = validate({ validationTimeBinding: drifted });
    expect(result.verdict).toBe('REJECTED');
    expect(result.findings.some((f) => f.code === 'CURRENTNESS_DRIFT')).toBe(
      true,
    );
  });

  it('REJECTS when either currentness binding is missing entirely', () => {
    const noTaskStart = validate({ taskStartBinding: null });
    expect(noTaskStart.verdict).toBe('REJECTED');
    expect(
      noTaskStart.findings.some((f) => f.code === 'CURRENTNESS_DRIFT'),
    ).toBe(true);

    const noValidationTime = validate({ validationTimeBinding: null });
    expect(noValidationTime.verdict).toBe('REJECTED');
    expect(
      noValidationTime.findings.some((f) => f.code === 'CURRENTNESS_DRIFT'),
    ).toBe(true);
  });

  it('REJECTS an omission (missing unit) and an addition (extra unit)', () => {
    const candidates = candidateFor(SOURCE_UNITS);
    const omitted = candidates.slice(0, candidates.length - 1);
    const omission = validate({ candidateUnits: omitted });
    expect(omission.verdict).toBe('REJECTED');
    expect(omission.findings.some((f) => f.code === 'MISSING_UNIT')).toBe(true);

    const withExtra = [
      ...candidates,
      {
        unitKey: 'structured-object:SO-EXTRA:not-in-source',
        text: '多余段落：未出现在源文档中。',
        sourceRefIds: ['urn:techpub:source-ref:v1:sha256:extra'],
        engineerRevision: null,
      },
    ];
    const addition = validate({ candidateUnits: withExtra });
    expect(addition.verdict).toBe('REJECTED');
    expect(addition.findings.some((f) => f.code === 'EXTRA_UNIT')).toBe(true);
  });

  it('REJECTS a mandatory-term violation on the real AIMS-2/GADSS text', () => {
    const candidates = candidateFor(SOURCE_UNITS).map((candidate) => ({
      ...candidate,
      // Drop every mandatory term rendering: replace ASCII with CJK noise.
      text: candidate.text
        .replace(/AIMS-2/g, '航电平台')
        .replace(/GADSS/g, '全球遇险系统')
        .replace(/飞机/g, '机型'),
    }));
    const result = validate({ candidateUnits: candidates });
    expect(result.verdict).toBe('REJECTED');
    expect(
      result.findings.some((f) => f.code === 'TERM_MANDATORY_MISSING'),
    ).toBe(true);
  });

  it('REJECTS a no-translate violation when ECCN 9E991 is dropped', () => {
    const candidates = candidateFor(SOURCE_UNITS).map((candidate) => ({
      ...candidate,
      text: candidate.text.replace('9E991', '九九九九一'),
    }));
    const result = validate({ candidateUnits: candidates });
    expect(result.verdict).toBe('REJECTED');
    expect(
      result.findings.some((f) => f.code === 'NO_TRANSLATE_VIOLATED'),
    ).toBe(true);
  });

  it('REJECTS part-number and citation loss on the real FTD references', () => {
    const candidates = candidateFor(SOURCE_UNITS).map((candidate) => ({
      ...candidate,
      text: candidate.text.replace(/777-FTD-23-20001/g, '相关文档'),
    }));
    const result = validate({ candidateUnits: candidates });
    expect(result.verdict).toBe('REJECTED');
    expect(
      result.findings.some(
        (f) =>
          f.code === 'CITATION_NOT_PRESERVED' ||
          f.code === 'PART_NUMBER_NOT_PRESERVED',
      ),
    ).toBe(true);
  });

  it('REJECTS numeric-fidelity loss by token multiset: missing, changed, extra, and wrongly duplicated numbers', () => {
    // Missing: a date is dropped entirely.
    const missing = candidateFor(SOURCE_UNITS).map((candidate) => ({
      ...candidate,
      text: candidate.text.replace(/Jan 1, 2023/g, '近年'),
    }));
    const missingResult = validate({ candidateUnits: missing });
    expect(missingResult.verdict).toBe('REJECTED');
    expect(
      missingResult.findings.some((f) => f.code === 'NUMBER_NOT_PRESERVED'),
    ).toBe(true);

    // Changed: 2023 becomes 2024 (source token missing + extra target token).
    const changed = candidateFor(SOURCE_UNITS).map((candidate) => ({
      ...candidate,
      text: candidate.text.replace(/2023/g, '2024'),
    }));
    const changedResult = validate({ candidateUnits: changed });
    expect(changedResult.verdict).toBe('REJECTED');
    expect(
      changedResult.findings.some((f) => f.code === 'NUMBER_NOT_PRESERVED'),
    ).toBe(true);

    // Extra: inject a number that was never in the source.
    const extra = candidateFor(SOURCE_UNITS).map((candidate) => ({
      ...candidate,
      text: `${candidate.text} 参考编号 99999。`,
    }));
    const extraResult = validate({ candidateUnits: extra });
    expect(extraResult.verdict).toBe('REJECTED');
    expect(
      extraResult.findings.some((f) => f.code === 'NUMBER_NOT_PRESERVED'),
    ).toBe(true);

    // Wrongly duplicated: a number appearing once in the source appears
    // twice in the translation.
    const firstWith2023 = candidateFor(SOURCE_UNITS).findIndex((candidate) =>
      candidate.text.includes('2023'),
    );
    expect(firstWith2023).toBeGreaterThanOrEqual(0);
    const duplicated = candidateFor(SOURCE_UNITS).map((candidate, index) =>
      index === firstWith2023
        ? { ...candidate, text: `${candidate.text} 2023 年再次强调。` }
        : candidate,
    );
    const duplicatedResult = validate({ candidateUnits: duplicated });
    expect(duplicatedResult.verdict).toBe('REJECTED');
    expect(
      duplicatedResult.findings.some((f) => f.code === 'NUMBER_NOT_PRESERVED'),
    ).toBe(true);
  });

  it('REJECTS signed-number drift instead of treating -5 and +5 as equal', () => {
    const signedSource = SOURCE_UNITS.map((unit, index) =>
      index === 0 ? { ...unit, text: `${unit.text} Signed limit -5.` } : unit,
    );
    const candidates = candidateFor(signedSource).map((unit, index) =>
      index === 0 ? { ...unit, text: unit.text.replace('-5', '+5') } : unit,
    );
    const result = validate({
      sourceUnits: signedSource,
      candidateUnits: candidates,
    });
    expect(result.verdict).toBe('REJECTED');
    expect(result.findings.map((finding) => finding.code)).toContain(
      'NUMBER_NOT_PRESERVED',
    );
  });

  it('ACCEPTS identifier and date connector boundary changes when the absolute numbers are preserved', () => {
    const numericOnlyRulePack: TranslationRulePack = {
      ...FTD_RULE_PACK,
      terms: [],
      noTranslate: [],
      deterministic: {
        ...FTD_RULE_PACK.deterministic,
        preservedIdentifierPatterns: [],
        preservedUnits: [],
        preserveAtaChapterNumbers: false,
        preservePartNumbers: false,
        preserveCitations: false,
      },
    };
    const sourceUnits: TranslationSourceUnit[] = [
      {
        unitKey: 'anonymous-connector-unit',
        kind: 'paragraph',
        text: 'Marker A-12 was recorded on 2026-08-28.',
        sourceRefIds: ['anonymous-source-ref'],
      },
    ];
    const result = validateTranslationCandidate({
      rulePack: numericOnlyRulePack,
      rulePackId: numericOnlyRulePack.meta.rulePackId,
      rulePackVersion: numericOnlyRulePack.meta.rulePackVersion,
      sourceUnits,
      candidateUnits: [
        {
          unitKey: 'anonymous-connector-unit',
          text: '标记 A（12）记录于 2026 年 08 月 28 日。',
          sourceRefIds: ['anonymous-source-ref'],
          engineerRevision: null,
        },
      ],
      taskStartBinding: FTD_BINDING,
      validationTimeBinding: FTD_BINDING,
    });

    expect(result.verdict).toBe('ACCEPTED');
    expect(result.findings).toEqual([]);
  });

  it('REJECTS loss of the real technical unit FL285 (flight level)', () => {
    const candidates = candidateFor(SOURCE_UNITS).map((candidate) => ({
      ...candidate,
      text: candidate.text.replace(/FL285/g, '欧洲高空空域'),
    }));
    const result = validate({ candidateUnits: candidates });
    expect(result.verdict).toBe('REJECTED');
    expect(
      result.findings.some(
        (f) =>
          f.code === 'UNIT_NOT_PRESERVED' || f.code === 'NUMBER_NOT_PRESERVED',
      ),
    ).toBe(true);
  });

  it('REJECTS SourceRef omission, addition, mismatch, and duplication on candidate units', () => {
    // Omission: a candidate drops its SourceRef binding.
    const dropped = candidateFor(SOURCE_UNITS).map((candidate, index) =>
      index === 0 ? { ...candidate, sourceRefIds: [] } : candidate,
    );
    const omission = validate({ candidateUnits: dropped });
    expect(omission.verdict).toBe('REJECTED');
    expect(
      omission.findings.some(
        (f) =>
          f.code === 'SOURCE_REF_NOT_BOUND' &&
          f.unitKey === SOURCE_UNITS[0]?.unitKey,
      ),
    ).toBe(true);

    // Addition: an extra SourceRef is injected.
    const added = candidateFor(SOURCE_UNITS).map((candidate, index) =>
      index === 0
        ? {
            ...candidate,
            sourceRefIds: [
              ...candidate.sourceRefIds,
              'urn:techpub:source-ref:v1:sha256:extra-ref',
            ],
          }
        : candidate,
    );
    const addition = validate({ candidateUnits: added });
    expect(addition.verdict).toBe('REJECTED');
    expect(
      addition.findings.some(
        (f) =>
          f.code === 'SOURCE_REF_MISMATCH' &&
          f.unitKey === SOURCE_UNITS[0]?.unitKey,
      ),
    ).toBe(true);

    // Mismatch: the candidate carries a different (wrong) SourceRef.
    const mismatched = candidateFor(SOURCE_UNITS).map((candidate, index) =>
      index === 0
        ? {
            ...candidate,
            sourceRefIds: ['urn:techpub:source-ref:v1:sha256:wrong-ref'],
          }
        : candidate,
    );
    const mismatch = validate({ candidateUnits: mismatched });
    expect(mismatch.verdict).toBe('REJECTED');
    expect(
      mismatch.findings.some((f) => f.code === 'SOURCE_REF_MISMATCH'),
    ).toBe(true);

    // Duplication: the candidate repeats one of its own SourceRefs.
    const duplicated = candidateFor(SOURCE_UNITS).map((candidate, index) =>
      index === 0
        ? {
            ...candidate,
            sourceRefIds: [
              candidate.sourceRefIds[0] as string,
              candidate.sourceRefIds[0] as string,
            ],
          }
        : candidate,
    );
    const duplication = validate({ candidateUnits: duplicated });
    expect(duplication.verdict).toBe('REJECTED');
    expect(
      duplication.findings.some(
        (f) =>
          f.code === 'SOURCE_REF_MISMATCH' &&
          f.unitKey === SOURCE_UNITS[0]?.unitKey,
      ),
    ).toBe(true);
  });

  it('REJECTS when a source unit loses its SourceRef binding or carries duplicate refs', () => {
    const unbound = SOURCE_UNITS.map((unit, index) =>
      index === 0 ? { ...unit, sourceRefIds: [] } : unit,
    );
    const unboundResult = validate({
      sourceUnits: unbound,
      candidateUnits: candidateFor(unbound),
    });
    expect(unboundResult.verdict).toBe('REJECTED');
    expect(
      unboundResult.findings.some((f) => f.code === 'SOURCE_REF_NOT_BOUND'),
    ).toBe(true);

    // Duplicate refs on the SOURCE side also fail closed.
    const duplicatedSource = SOURCE_UNITS.map((unit, index) =>
      index === 0
        ? {
            ...unit,
            sourceRefIds: [
              unit.sourceRefIds[0] as string,
              unit.sourceRefIds[0] as string,
            ],
          }
        : unit,
    );
    const duplicatedResult = validate({
      sourceUnits: duplicatedSource,
      candidateUnits: candidateFor(duplicatedSource),
    });
    expect(duplicatedResult.verdict).toBe('REJECTED');
    expect(
      duplicatedResult.findings.some((f) => f.code === 'SOURCE_REF_MISMATCH'),
    ).toBe(true);
  });

  it('routes CURRENT exact-binding engineer revisions to NEEDS_ENGINEER_REVIEW, never silent acceptance', () => {
    const candidates = candidateFor(SOURCE_UNITS).map((candidate, index) =>
      index === 0
        ? {
            ...candidate,
            engineerRevision: {
              revisionId: 'eng-rev-20260826-001',
              rulePackId: FTD_RULE_PACK.meta.rulePackId,
              rulePackVersion: FTD_RULE_PACK.meta.rulePackVersion,
              sourceBinding: FTD_BINDING,
              currentness: 'CURRENT',
            },
          }
        : candidate,
    );
    const result = validate({ candidateUnits: candidates });
    expect(result.verdict).toBe('NEEDS_ENGINEER_REVIEW');
    expect(result.findings).toEqual([]);
  });

  it('REJECTS a STALE engineer revision (fail closed)', () => {
    const candidates = candidateFor(SOURCE_UNITS).map((candidate, index) =>
      index === 0
        ? {
            ...candidate,
            engineerRevision: {
              revisionId: 'eng-rev-20260826-001',
              rulePackId: FTD_RULE_PACK.meta.rulePackId,
              rulePackVersion: FTD_RULE_PACK.meta.rulePackVersion,
              sourceBinding: FTD_BINDING,
              currentness: 'STALE',
            },
          }
        : candidate,
    );
    const result = validate({ candidateUnits: candidates });
    expect(result.verdict).toBe('REJECTED');
    expect(
      result.findings.some((f) => f.code === 'ENGINEER_REVISION_STALE'),
    ).toBe(true);
  });

  it('REJECTS engineer revisions with ANY binding field drift, not just documentId', () => {
    const driftCases: Array<{
      label: string;
      binding: CanonicalTranslationConsumptionBinding;
    }> = [
      {
        label: 'documentId drift',
        binding: { ...FTD_BINDING, documentId: 'urn:other:document' },
      },
      {
        label: 'revisionId drift',
        binding: { ...FTD_BINDING, revisionId: 'sha256:other-revision' },
      },
      {
        label: 'sbdPackageId drift',
        binding: { ...FTD_BINDING, sbdPackageId: 'urn:other:sbd-package' },
      },
      {
        label: 'sbdContentHash drift',
        binding: { ...FTD_BINDING, sbdContentHash: 'sha256:other-sbd' },
      },
      {
        label: 'tcpPackageId drift (null -> value)',
        binding: { ...FTD_BINDING, tcpPackageId: 'urn:other:tcp' },
      },
      {
        label: 'tcpContentHash drift (null -> value)',
        binding: { ...FTD_BINDING, tcpContentHash: 'sha256:other-tcp' },
      },
    ];
    for (const driftCase of driftCases) {
      const candidates = candidateFor(SOURCE_UNITS).map((candidate, index) =>
        index === 0
          ? {
              ...candidate,
              engineerRevision: {
                revisionId: 'eng-rev-20260826-002',
                rulePackId: FTD_RULE_PACK.meta.rulePackId,
                rulePackVersion: FTD_RULE_PACK.meta.rulePackVersion,
                sourceBinding: driftCase.binding,
                currentness: 'CURRENT',
              },
            }
          : candidate,
      );
      const result = validate({ candidateUnits: candidates });
      expect(result.verdict).toBe('REJECTED');
      expect(
        result.findings.some(
          (f) => f.code === 'ENGINEER_REVISION_IDENTITY_MISMATCH',
        ),
      ).toBe(true);
    }
  });

  it('REJECTS engineer revisions made against a different rule pack id or version', () => {
    const wrongPackId = candidateFor(SOURCE_UNITS).map((candidate, index) =>
      index === 0
        ? {
            ...candidate,
            engineerRevision: {
              revisionId: 'eng-rev-20260826-003',
              rulePackId: 'other.rule.pack',
              rulePackVersion: FTD_RULE_PACK.meta.rulePackVersion,
              sourceBinding: FTD_BINDING,
              currentness: 'CURRENT',
            },
          }
        : candidate,
    );
    const packIdResult = validate({ candidateUnits: wrongPackId });
    expect(packIdResult.verdict).toBe('REJECTED');
    expect(
      packIdResult.findings.some(
        (f) => f.code === 'ENGINEER_REVISION_IDENTITY_MISMATCH',
      ),
    ).toBe(true);

    const wrongPackVersion = candidateFor(SOURCE_UNITS).map(
      (candidate, index) =>
        index === 0
          ? {
              ...candidate,
              engineerRevision: {
                revisionId: 'eng-rev-20260826-004',
                rulePackId: FTD_RULE_PACK.meta.rulePackId,
                rulePackVersion: 'v0.9.9',
                sourceBinding: FTD_BINDING,
                currentness: 'CURRENT',
              },
            }
          : candidate,
    );
    const packVersionResult = validate({ candidateUnits: wrongPackVersion });
    expect(packVersionResult.verdict).toBe('REJECTED');
    expect(
      packVersionResult.findings.some(
        (f) => f.code === 'ENGINEER_REVISION_IDENTITY_MISMATCH',
      ),
    ).toBe(true);
  });

  it('REJECTS malformed engineer revision metadata (no bare-boolean escape)', () => {
    const malformed = candidateFor(SOURCE_UNITS).map((candidate, index) =>
      index === 0
        ? { ...candidate, engineerRevision: { revisionId: '' } }
        : candidate,
    );
    const result = validate({ candidateUnits: malformed });
    expect(result.verdict).toBe('REJECTED');
    expect(result.findings.some((f) => f.code === 'MALFORMED_INPUT')).toBe(
      true,
    );
  });

  it('REJECTS unknown rule pack schemas and mismatched rule pack ids (fail closed)', () => {
    const badSchema = validate({
      rulePack: {
        ...FTD_RULE_PACK,
        meta: { ...FTD_RULE_PACK.meta, schemaVersion: 'unknown.v9' },
      },
    });
    expect(badSchema.verdict).toBe('REJECTED');
    expect(
      badSchema.findings.some((f) => f.code === 'UNRECOGNIZED_RULES'),
    ).toBe(true);
    expect(badSchema.rulePackId).toBeNull();

    const mismatched = validate({ rulePackId: 'other.pack.v1' });
    expect(mismatched.verdict).toBe('REJECTED');
    expect(
      mismatched.findings.some((f) => f.code === 'UNRECOGNIZED_RULES'),
    ).toBe(true);
  });

  it('REJECTS malformed runtime payloads without throwing (units shape guards)', () => {
    const malformed: unknown[] = [null, 'string-row', 42];
    const result = validate({ candidateUnits: malformed });
    expect(result.verdict).toBe('REJECTED');
    expect(result.findings.some((f) => f.code === 'MALFORMED_INPUT')).toBe(
      true,
    );
  });

  it('REJECTS non-array source/candidate payloads without throwing', () => {
    expect(() =>
      validate({ sourceUnits: null as never, candidateUnits: null as never }),
    ).not.toThrow();
    const result = validate({
      sourceUnits: null as never,
      candidateUnits: null as never,
    });
    expect(result.verdict).toBe('REJECTED');
    expect(result.findings.map((finding) => finding.code)).toContain(
      'MALFORMED_INPUT',
    );
  });

  it('REJECTS duplicate source unit keys', () => {
    const duplicatedSource = [SOURCE_UNITS[0], { ...SOURCE_UNITS[0] }];
    const result = validate({
      sourceUnits: duplicatedSource,
      candidateUnits: candidateFor(duplicatedSource),
    });
    expect(result.verdict).toBe('REJECTED');
    expect(
      result.findings.some(
        (finding) =>
          finding.code === 'MALFORMED_INPUT' &&
          finding.message === 'duplicate source unit key',
      ),
    ).toBe(true);
  });
});

describe('private TranslationResultContract (runtime-validated result shape)', () => {
  function resultPayload(
    overrides: Partial<{
      rulePackId: string;
      rulePackVersion: string;
      taskStartBinding: CanonicalTranslationConsumptionBinding | null;
      candidateUnits: unknown[];
      schemaVersion: string;
    }> = {},
  ): unknown {
    return {
      schemaVersion: TRANSLATION_RESULT_SCHEMA_VERSION,
      rulePackId: FTD_RULE_PACK.meta.rulePackId,
      rulePackVersion: FTD_RULE_PACK.meta.rulePackVersion,
      taskStartBinding: FTD_BINDING,
      candidateUnits: candidateFor(SOURCE_UNITS),
      ...overrides,
    };
  }

  it('parses a well-formed result contract and fails closed on malformed shapes', () => {
    const parsed = parseTranslationResultContract(resultPayload());
    expect(parsed).not.toBeNull();
    expect(parsed?.rulePackId).toBe(FTD_RULE_PACK.meta.rulePackId);
    expect(parsed?.rulePackVersion).toBe(FTD_RULE_PACK.meta.rulePackVersion);
    expect(parsed?.candidateUnits.length).toBe(SOURCE_UNITS.length);

    // Malformed shapes all fail closed.
    expect(parseTranslationResultContract(null)).toBeNull();
    expect(parseTranslationResultContract(42)).toBeNull();
    expect(
      parseTranslationResultContract(
        resultPayload({ schemaVersion: 'other.v9' }),
      ),
    ).toBeNull();
    expect(
      parseTranslationResultContract(resultPayload({ rulePackId: '' })),
    ).toBeNull();
    expect(
      parseTranslationResultContract(resultPayload({ rulePackVersion: '' })),
    ).toBeNull();
    expect(
      parseTranslationResultContract(resultPayload({ taskStartBinding: null })),
    ).toBeNull();
    expect(
      parseTranslationResultContract(
        resultPayload({ candidateUnits: [null, 'garbage'] }),
      ),
    ).toBeNull();
    expect(
      parseTranslationResultContract(
        resultPayload({
          candidateUnits: candidateFor(SOURCE_UNITS).map((candidate) => ({
            ...candidate,
            engineerRevision: { revisionId: '' },
          })),
        }),
      ),
    ).toBeNull();
  });

  it('ACCEPTS a faithful result contract end-to-end', () => {
    const result = validateTranslationResultContract(resultPayload(), {
      rulePack: FTD_RULE_PACK,
      rulePackId: FTD_RULE_PACK.meta.rulePackId,
      rulePackVersion: FTD_RULE_PACK.meta.rulePackVersion,
      sourceUnits: SOURCE_UNITS,
      taskStartBinding: FTD_BINDING,
      validationTimeBinding: FTD_BINDING,
    });
    expect(result.verdict).toBe('ACCEPTED');
    expect(result.findings).toEqual([]);
    expect(result.validatedUnitCount).toBe(SOURCE_UNITS.length);
  });

  it('REJECTS a result whose rule identity (id or version) does not match the task', () => {
    const base = {
      rulePack: FTD_RULE_PACK,
      rulePackId: FTD_RULE_PACK.meta.rulePackId,
      rulePackVersion: FTD_RULE_PACK.meta.rulePackVersion,
      sourceUnits: SOURCE_UNITS,
      taskStartBinding: FTD_BINDING,
      validationTimeBinding: FTD_BINDING,
    };

    const wrongId = validateTranslationResultContract(
      resultPayload({ rulePackId: 'other.pack' }),
      base,
    );
    expect(wrongId.verdict).toBe('REJECTED');
    expect(wrongId.findings.some((f) => f.code === 'UNRECOGNIZED_RULES')).toBe(
      true,
    );

    const wrongVersion = validateTranslationResultContract(
      resultPayload({ rulePackVersion: 'v0.9.9' }),
      base,
    );
    expect(wrongVersion.verdict).toBe('REJECTED');
    expect(
      wrongVersion.findings.some((f) => f.code === 'UNRECOGNIZED_RULES'),
    ).toBe(true);
  });

  it('REJECTS a result whose task/currentness correlation binding drifts in any field', () => {
    const drifted: CanonicalTranslationConsumptionBinding = {
      ...FTD_BINDING,
      sbdContentHash: 'sha256:drifted-sbd',
    };
    const result = validateTranslationResultContract(
      resultPayload({ taskStartBinding: drifted }),
      {
        rulePack: FTD_RULE_PACK,
        rulePackId: FTD_RULE_PACK.meta.rulePackId,
        rulePackVersion: FTD_RULE_PACK.meta.rulePackVersion,
        sourceUnits: SOURCE_UNITS,
        taskStartBinding: FTD_BINDING,
        validationTimeBinding: FTD_BINDING,
      },
    );
    expect(result.verdict).toBe('REJECTED');
    expect(result.findings.some((f) => f.code === 'CURRENTNESS_DRIFT')).toBe(
      true,
    );
  });

  it('REJECTS a malformed result payload (fail closed, no throw)', () => {
    const result = validateTranslationResultContract('not-an-object', {
      rulePack: FTD_RULE_PACK,
      rulePackId: FTD_RULE_PACK.meta.rulePackId,
      rulePackVersion: FTD_RULE_PACK.meta.rulePackVersion,
      sourceUnits: SOURCE_UNITS,
      taskStartBinding: FTD_BINDING,
      validationTimeBinding: FTD_BINDING,
    });
    expect(result.verdict).toBe('REJECTED');
    expect(result.validatedUnitCount).toBe(0);
    expect(result.findings.some((f) => f.code === 'MALFORMED_INPUT')).toBe(
      true,
    );
  });
});

describe('translation rule contract on the synthetic native S1000D contract-shape fixture (table unit shape)', () => {
  /**
   * SYNTHETIC fixture: native-s1000d-issue-4-2.parsed.json is a hand-built
   * synthetic package that proves only the native parser's unit/table
   * SHAPE flows through the contract — it is NOT a real engineering
   * document sample, and real rule-effect evidence comes from the Boeing
   * FTD fixture above. The fixture's content units carry
   * unitId/kind/text/locator but no sourceRefIds array; the unit's own
   * urn-styled unitId IS its source reference, and the mapping below is
   * the adapter the Host would perform. Cell-parity table alignment
   * cannot be proven on this fixture: its table text is parser-flattened
   * with no cell separators (exact structural blocker, recorded in
   * docs/WL31_TRANSLATION_OWNER_RULE_MIGRATION_20260826.md — not faked).
   */
  function s1000dSourceUnits(): TranslationSourceUnit[] {
    return s1000dFixture.contentUnits
      .filter((unit) => RECOGNIZED_UNIT_KINDS.has(unit.kind))
      .map((unit) => ({
        unitKey: unit.unitId,
        kind: unit.kind as TranslationSourceUnit['kind'],
        text: unit.text,
        sourceRefIds: [unit.unitId],
      }));
  }

  const S1000D_RULE_PACK: TranslationRulePack = {
    meta: {
      schemaVersion: TRANSLATION_RULE_PACK_SCHEMA_VERSION,
      rulePackId: 's1000d-fixture-zh-cn.baseline',
      rulePackVersion: 'v1.0.0',
      label: 'Synthetic S1000D fixture zh-CN baseline (WL31 round 1)',
      targetLocale: 'zh-CN',
      sourceLocales: ['en-US'],
    },
    terms: [],
    noTranslate: [
      { ruleId: 'notranslate.manual', token: 'FIXTURE-MANUAL-001' },
    ],
    deterministic: {
      preservedIdentifierPatterns: [],
      numericFidelity: true,
      preservedUnits: [],
      preserveAtaChapterNumbers: false,
      preservePartNumbers: false,
      segmentAlignment: true,
      tableAlignment: true,
      preserveCitations: false,
    },
  };

  const S1000D_BINDING: CanonicalTranslationConsumptionBinding = {
    documentId: 'urn:s1000d:fixture:dm:FIXTURE:descript:001',
    revisionId: 'urn:s1000d:fixture:issue:001-00',
    sbdPackageId:
      'urn:s1000d:fixture:package:sha256:b5f52e0c4c26d925e863bf1aee708b04f21ab66cdfb69f65a7fca93d3844eed8',
    sbdContentHash:
      'sha256:b5f52e0c4c26d925e863bf1aee708b04f21ab66cdfb69f65a7fca93d3844eed8',
    tcpPackageId: null,
    tcpContentHash: null,
  };

  function validateS1000D(
    candidateUnits: readonly unknown[],
  ): ReturnType<typeof validateTranslationCandidate> {
    const sourceUnits = s1000dSourceUnits();
    return validateTranslationCandidate({
      rulePack: S1000D_RULE_PACK,
      rulePackId: S1000D_RULE_PACK.meta.rulePackId,
      rulePackVersion: S1000D_RULE_PACK.meta.rulePackVersion,
      sourceUnits,
      candidateUnits,
      taskStartBinding: S1000D_BINDING,
      validationTimeBinding: S1000D_BINDING,
    });
  }

  it('the synthetic fixture carries a table unit (parser table shape, not an engineering sample)', () => {
    const tables = s1000dFixture.contentUnits.filter(
      (unit) => unit.kind === 'table',
    );
    expect(tables.length).toBeGreaterThanOrEqual(1);
    expect(tables[0]?.text).toContain('Fixture parts');
  });

  it('ACCEPTS a faithful translation of the synthetic S1000D units including the table unit', () => {
    const candidates = s1000dSourceUnits().map((unit) => ({
      unitKey: unit.unitKey,
      text: `【译文】${unit.text}`,
      sourceRefIds: [...unit.sourceRefIds],
      engineerRevision: null,
    }));
    const result = validateS1000D(candidates);
    expect(result.verdict).toBe('ACCEPTED');
    expect(result.findings).toEqual([]);
    expect(result.validatedUnitCount).toBe(s1000dSourceUnits().length);
  });

  it('REJECTS a no-translate violation inside the synthetic S1000D step text (FIXTURE-MANUAL-001)', () => {
    const candidates = s1000dSourceUnits().map((unit) => ({
      unitKey: unit.unitKey,
      text: `【译文】${unit.text}`.replace('FIXTURE-MANUAL-001', '手册引用'),
      sourceRefIds: [...unit.sourceRefIds],
      engineerRevision: null,
    }));
    const result = validateS1000D(candidates);
    expect(result.verdict).toBe('REJECTED');
    expect(
      result.findings.some((f) => f.code === 'NO_TRANSLATE_VIOLATED'),
    ).toBe(true);
  });

  it('REJECTS SourceRef mismatch on the synthetic S1000D table unit', () => {
    const candidates = s1000dSourceUnits().map((unit) =>
      unit.kind === 'table'
        ? {
            unitKey: unit.unitKey,
            text: `【译文】${unit.text}`,
            sourceRefIds: ['urn:wrong:source-ref'],
            engineerRevision: null,
          }
        : {
            unitKey: unit.unitKey,
            text: `【译文】${unit.text}`,
            sourceRefIds: [...unit.sourceRefIds],
            engineerRevision: null,
          },
    );
    const result = validateS1000D(candidates);
    expect(result.verdict).toBe('REJECTED');
    expect(result.findings.some((f) => f.code === 'SOURCE_REF_MISMATCH')).toBe(
      true,
    );
  });
});
