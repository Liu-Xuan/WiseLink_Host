import type {
  TranslationBlockCandidateV2,
  TranslationBlockProvenanceV2,
  TranslationBlockRevisionV2,
  TranslationGenerationRequestV2,
  TranslationSourcePlanV2,
  TranslationWorkspaceV2,
} from '@shared/canonical-translation-v2.interface';
import { buildTranslationSourcePlan } from '../../server/modules/canonical-host/canonical-translation-source-plan';
import { buildTranslationBatchV2, nextTranslationWorkV2, translationBatchDependenciesV2 } from '../../server/modules/canonical-host/canonical-translation-v2-batch';
import {
  buildTranslationWorkspaceReadingV2,
  checkTranslationBlockV2,
} from '../../server/modules/canonical-host/canonical-translation-v2-quality';
import {
  DEFAULT_TRANSLATION_GLOSSARY,
  translationGlossaryEntriesSchema,
} from '../../server/modules/canonical-host/canonical-translation-glossary.service';

// Invented content used only for behavioral checks, never aircraft evidence.
function plan(
  texts: string[],
  separateModules = false,
): TranslationSourcePlanV2 {
  return buildTranslationSourcePlan({
    documentVersionId: 'dv-test',
    packageId: 'pkg-test',
    title: 'Synthetic',
    parsedArtifact: {
      storeRole: 'UnifiedArtifactStoreCandidate',
      ref: 'artifact://synthetic/test',
      sha256: '1'.repeat(64),
      byteLength: 1,
      mediaType: 'application/json',
    },
    source: {
      modules: separateModules
        ? texts.map((_text, index) => ({ moduleId: `m${index}`, order: index }))
        : [{ moduleId: 'm', order: 0 }],
      findings: [],
      references: [],
      sourceLocators: texts.map((_text, index) => ({
        sourceRefId: `sr${index}`,
        kind: 'pdf_page',
        artifactId: 'source',
        pageStart: index + 1,
        pageEnd: index + 1,
        charStart: null,
        charEnd: null,
        charOffsetUnit: null,
        normalizedPath: null,
        xpath: null,
        elementId: null,
        quote: null,
        bbox: null,
      })),
      units: texts.map((text, index) => ({
        unitId: `u${index}`,
        kind: 'paragraph',
        moduleId: separateModules ? `m${index}` : 'm',
        parentUnitId: null,
        order: index,
        depth: 0,
        continuityKey: `u${index}`,
        sourceRefIds: [`sr${index}`],
        sourceSegmentIds: [`seg${index}`],
        mapping: {
          status: 'mapped_exactly',
          confidence: 'deterministic',
          findingIds: [],
        },
        payload: { text, role: 'body' },
      })),
    },
  });
}
function candidate(
  sourcePlan: TranslationSourcePlanV2,
  text: string,
): TranslationBlockCandidateV2 {
  return {
    blockId: sourcePlan.blocks[0].blockId,
    elements: [
      {
        elementId: 'e1',
        kind: 'paragraph',
        translatedText: text,
        anchorIds: sourcePlan.blocks[0].anchorIds,
      },
    ],
  };
}
const provenance: TranslationBlockProvenanceV2 = {
  authorKind: 'MODEL',
  authorUserId: 'service:test',
  executionModel: {
    modelRef: 'miaoda/minimax-m3',
    displayName: 'Test',
    providerKind: 'BUILT_IN',
    settingsRevision: 1,
    selectedAt: '2026-09-09T00:00:00.000Z',
  },
  modelVersion: 'test-model',
  skillVersion: 'wiselink-research-and-synthesize@r09.c44',
  promptVersion: 'wiselink-translation-block@r09.c44',
  generationRequestRef: 'TG-test',
  originAttemptId: 'ATT-test',
  providerRequestId: null,
  usage: { inputTokens: 123, outputTokens: 45 },
};
function revision(
  sourcePlan: TranslationSourcePlanV2,
  value: TranslationBlockCandidateV2,
): TranslationBlockRevisionV2 {
  return {
    blockRevisionId: 'TB-test',
    workspaceId: 'TW-test',
    blockId: value.blockId,
    planRevision: 1,
    contentRevision: 1,
    rowVersion: 1,
    candidate: value,
    dependencies: {
      planRevision: 1,
      contextRevision: 1,
      sourceAnchorIds: sourcePlan.blocks[0].anchorIds,
      contextAnchorIds: [],
      methodVersion: 'semantic-translation@2.0',
    },
    provenance,
    generatedAt: null,
    savedAt: '2026-09-09T00:00:00.000Z',
    check: null,
    checkedAt: null,
    selectedForReading: false,
  };
}
function workspace(
  sourcePlan: TranslationSourcePlanV2,
): TranslationWorkspaceV2 {
  return {
    workspaceId: 'TW-test',
    workItemId: 'WI-test',
    tenantId: 'tenant-test',
    rowVersion: 1,
    methodVersion: 'semantic-translation@2.0',
    activeAttemptId: 'ATT-new',
    plan: sourcePlan,
    generationRequests: [],
    resultArtifact: null,
    resultManifest: null,
  };
}

describe('translation v2 quality and actual reading coverage', () => {
  it('delivers exact full-document source context while retaining old registered scopes', () => {
    const sourcePlan = plan(['Synthetic first section.', 'Synthetic second section.'], true);
    const work = workspace(sourcePlan);
    const targetId = sourcePlan.blocks[0].blockId;
    const dependencies = translationBatchDependenciesV2(work, [targetId]);
    expect(dependencies.sourceAnchorIds).toEqual(sourcePlan.blocks[0].anchorIds);
    expect(dependencies.contextAnchorIds).toEqual(sourcePlan.blocks[1].anchorIds);
    const request: TranslationGenerationRequestV2 = {
      generationRequestRef: 'TG-full', clientRequestId: 'client-full', attemptId: 'ATT-new',
      leaseGeneration: 1, blockIds: [targetId], dependencies, purpose: 'GENERATE',
      targetBlockRevisionId: null, status: 'REGISTERED', registeredAt: '2026-09-09T00:00:00.000Z',
      finishedAt: null, error: null,
    };
    const batch = buildTranslationBatchV2(work, request, []);
    expect(batch.documentContext.blocks.map((block) => block.blockId)).toEqual([sourcePlan.blocks[1].blockId]);
    expect([...batch.anchors, ...batch.documentContext.anchors].map((anchor) => anchor.anchorId))
      .toEqual(sourcePlan.anchors.map((anchor) => anchor.anchorId));
    expect(batch.sourcePlanAnchorCount).toBe(sourcePlan.anchors.length);
    expect(batch.sourcePlanBlockCount).toBe(sourcePlan.blocks.length);
    const old = buildTranslationBatchV2(work, {
      ...request, generationRequestRef: 'TG-old', dependencies: { ...dependencies, contextAnchorIds: [] },
    }, []);
    expect(old.documentContext.blocks).toEqual([]);
    expect(old.documentContext.anchors).toEqual([]);
  });
  it('keeps a 65-block repair scope while scheduling bounded generation batches', () => {
    const sourcePlan = plan(Array.from({ length: 65 }, () =>
      'Inspect the synthetic component and record its status. '.repeat(12)), true);
    expect(sourcePlan.blocks).toHaveLength(65);
    const work = workspace(sourcePlan);
    const ids = sourcePlan.blocks.map(block => block.blockId);
    const next = nextTranslationWorkV2(work, [], buildTranslationWorkspaceReadingV2(work, []),
      undefined, { retranslateBlockIds: ids });
    expect(next.kind).toBe('GENERATE');
    if (next.kind !== 'GENERATE') throw new Error('expected generation batch');
    expect(next.blockIds.length).toBeGreaterThan(0);
    expect(next.blockIds.length).toBeLessThan(65);
    expect(next.blockIds).toEqual(ids.slice(0, next.blockIds.length));
  });
  it('permits two corrections per attempt, binds each to the latest issues, and stops after the second checked failure', () => {
    const sourcePlan = plan(['Keep the component installed.']);
    const work = workspace(sourcePlan);
    const blockId = sourcePlan.blocks[0].blockId;
    const blocked = (text: string, code: string, revisionId: string, contentRevision: number): TranslationBlockRevisionV2 => {
      const value = candidate(sourcePlan, text);
      return { ...revision(sourcePlan, value), blockRevisionId: revisionId, contentRevision,
        check: checkTranslationBlockV2({ plan: sourcePlan, candidate: value,
          semanticReview: { result: { blockId, issues: [{ code, severity: 'BLOCK',
            message: `Synthetic ${code}`, anchorIds: sourcePlan.blocks[0].anchorIds }] }, provenance } }),
        checkedAt: '2026-09-09T00:01:00.000Z' };
    };
    const request = (ref: string, targetBlockRevisionId: string, status: TranslationGenerationRequestV2['status']): TranslationGenerationRequestV2 => ({
      generationRequestRef: ref, clientRequestId: ref, attemptId: 'ATT-new', leaseGeneration: 1,
      blockIds: [blockId], dependencies: revision(sourcePlan, candidate(sourcePlan, '保持组件安装。')).dependencies,
      purpose: 'CORRECT', targetBlockRevisionId, status, registeredAt: '2026-09-09T00:00:00.000Z',
      finishedAt: status === 'REGISTERED' ? null : '2026-09-09T00:01:00.000Z', error: null });
    const first = blocked('保持组件安装。', 'FIRST_ISSUE', 'TB-first', 1);
    const firstWork = nextTranslationWorkV2(work, [first], buildTranslationWorkspaceReadingV2(work, [first]));
    expect(firstWork).toMatchObject({ kind: 'CORRECT', targetBlockRevisionId: 'TB-first' });
    work.generationRequests.push(request('TG-first', 'TB-first', 'SAVED'));
    const second = blocked('使组件保持安装状态。', 'SECOND_ISSUE', 'TB-second', 2);
    const revisions = [first, second];
    const secondWork = nextTranslationWorkV2(work, revisions, buildTranslationWorkspaceReadingV2(work, revisions));
    expect(secondWork).toMatchObject({ kind: 'CORRECT', targetBlockRevisionId: 'TB-second' });
    const secondRequest = request('TG-second', 'TB-second', 'REGISTERED');
    const batch = buildTranslationBatchV2(work, secondRequest, revisions);
    expect(batch.previousBlockRevisionId).toBe('TB-second');
    expect(batch.correctionIssues.map(issue => issue.code)).toEqual(['SECOND_ISSUE']);
    work.generationRequests.push(secondRequest);
    expect(nextTranslationWorkV2(work, revisions, buildTranslationWorkspaceReadingV2(work, revisions)))
      .toMatchObject({ kind: 'UNRESOLVED_GENERATION', request: { generationRequestRef: 'TG-second' } });
    secondRequest.status = 'SAVED';
    const third = blocked('组件应维持安装。', 'THIRD_ISSUE', 'TB-third', 3);
    const checked = [first, second, third];
    expect(nextTranslationWorkV2(work, checked, buildTranslationWorkspaceReadingV2(work, checked)))
      .toEqual({ kind: 'DONE' });
    work.activeAttemptId = 'ATT-successor';
    expect(nextTranslationWorkV2(work, checked, buildTranslationWorkspaceReadingV2(work, checked)))
      .toMatchObject({ kind: 'CORRECT', targetBlockRevisionId: 'TB-third' });
  });
  it('batches complete pending checks within source and count bounds only for a capable caller', () => {
    const sourcePlan = plan(
      Array.from(
        { length: 34 },
        () =>
          'Do not replace the unit unless the indication remains after 5 seconds.',
      ),
      true,
    );
    expect(sourcePlan.blocks).toHaveLength(34);
    const work = workspace(sourcePlan);
    const revisions = sourcePlan.blocks.map((block, index) => {
      const value: TranslationBlockCandidateV2 = {
        blockId: block.blockId,
        elements: [
          {
            elementId: `e${index}`,
            kind: 'paragraph',
            translatedText: '除非指示在 5 秒后仍然存在，否则不要更换该组件。',
            anchorIds: block.anchorIds,
          },
        ],
      };
      const entry = revision(sourcePlan, value);
      return {
        ...entry,
        blockRevisionId: `TB-${index}`,
        rowVersion: 2,
        dependencies: {
          ...entry.dependencies,
          sourceAnchorIds: block.anchorIds,
        },
        check: checkTranslationBlockV2({ plan: sourcePlan, candidate: value }),
      };
    });
    expect(
      revisions.every((entry) => entry.check.semanticCheck === 'PENDING'),
    ).toBe(true);
    expect(revisions.flatMap((entry) => entry.check.issues)).toEqual([]);
    const reading = buildTranslationWorkspaceReadingV2(work, revisions);
    expect(nextTranslationWorkV2(work, revisions, reading).kind).toBe('CHECK');
    const bounded = nextTranslationWorkV2(
      work,
      revisions,
      reading,
      sourcePlan.blocks[0].sourceCharacterCount * 2,
      { batchSemanticChecks: true },
    );
    expect(bounded.kind).toBe('CHECK_BATCH');
    if (bounded.kind !== 'CHECK_BATCH')
      throw new Error('Expected a complete two-block batch');
    expect(bounded.checkTargets).toEqual(
      revisions.slice(0, 2).map((entry) => ({
        blockId: entry.blockId,
        blockRevisionId: entry.blockRevisionId,
        rowVersion: 2,
      })),
    );
    const maximum = nextTranslationWorkV2(work, revisions, reading, 1_000_000, {
      batchSemanticChecks: true,
    });
    expect(maximum.kind === 'CHECK_BATCH' && maximum.blockIds.length).toBe(8);
    const oversized = nextTranslationWorkV2(work, revisions, reading, 1, {
      batchSemanticChecks: true,
    });
    expect(oversized).toEqual({
      kind: 'CHECK',
      blockIds: [sourcePlan.blocks[0].blockId],
      targetBlockRevisionId: 'TB-0',
    });
  });
  it('accepts a natural paragraph with three original anchors and equivalent full dates', () => {
    const sourcePlan = plan([
      'On September 3, 2024,',
      'the controller',
      'was identified as PN-12O.',
    ]);
    const check = checkTranslationBlockV2({
      plan: sourcePlan,
      candidate: candidate(
        sourcePlan,
        '2024年9月3日，该控制器被标识为 PN-12O。',
      ),
    });
    expect(check.issues).toEqual([]);
    expect(check.semanticCheck).toBe('PENDING');
  });
  it('checks connected reading elements once when one source anchor supports two paragraphs', () => {
    const sourcePlan = plan(['Item A has 2 parts. Item B has 3 parts.']);
    const value = candidate(sourcePlan, 'A 项有 2 个部件。');
    value.elements.push({
      ...value.elements[0],
      elementId: 'e2',
      translatedText: 'B 项有 3 个部件。',
    });
    expect(
      checkTranslationBlockV2({ plan: sourcePlan, candidate: value }).issues,
    ).toEqual([]);
  });
  it.each([
    [
      ['Refer to MOD-A-12-00A-', '932A-D, paragraph 10.'],
      '参见 MOD-A-12-00A-932A-D 第 10 段。',
    ],
    [
      [
        'PN4A-0018- Displays and 31 CORE NET- LS1975568 *[1]*[2]',
        '0003 Crew Alerting WORK CSM',
        '(DCA) System',
      ],
      'PN4A-0018-0003 显示告警（DCA）系统 31 CORE NETWORK CSM LS1975568 *[1]*[2]',
    ],
  ])(
    'accepts preserved identifiers across explicit PDF line wraps',
    (source, translated) => {
      const sourcePlan = plan(source);
      expect(
        checkTranslationBlockV2({
          plan: sourcePlan,
          candidate: candidate(sourcePlan, translated),
        }).issues,
      ).toEqual([]);
      expect(
        checkTranslationBlockV2({
          plan: sourcePlan,
          candidate: candidate(sourcePlan, translated),
        }).semanticCheck,
      ).toBe('PENDING');
      for (const changed of [
        translated.replace('0018', '0019').replace('932A', '932B'),
        `${translated} PN4A-0018-0003`,
      ]) {
        expect(
          checkTranslationBlockV2({
            plan: sourcePlan,
            candidate: candidate(sourcePlan, changed),
          }).issues.map((issue) => issue.code),
        ).toContain('PROTECTED_VALUE_CHANGED');
      }
    },
  );
  it('does not join separate same-line identifiers or invent a missing hyphen', () => {
    for (const source of [
      ['Use PN4A-0018- 0003.'],
      ['Use PN4A-0018', '0003.'],
    ]) {
      const sourcePlan = plan(source);
      expect(
        checkTranslationBlockV2({
          plan: sourcePlan,
          candidate: candidate(sourcePlan, '使用 PN4A-0018-0003。'),
        }).issues.map((issue) => issue.code),
      ).toContain('PROTECTED_VALUE_CHANGED');
    }
  });
  it('identifies omitted values and repeated footnotes so a correction can preserve the source', () => {
    const sourcePlan = plan([
      'PN4A-0018-0003 Displays and Crew Alerting (DCA) Sys- 31 DCA EMPPI OPS *[1]*[1]',
      'tem',
    ]);
    const check = checkTranslationBlockV2({
      plan: sourcePlan,
      candidate: candidate(
        sourcePlan,
        'PN4A-0018-0003 显示与机组警告 (DCA) 系统 2',
      ),
    });
    const issue = check.issues.find(
      (item) => item.code === 'PROTECTED_VALUE_CHANGED',
    );
    expect(issue?.severity).toBe('BLOCK');
    expect(issue?.message).toContain(
      '"missing":{"dates":[],"identifiers":[],"numbers":["1","1","31"]}',
    );
    expect(issue?.message).toContain(
      '"added":{"dates":[],"identifiers":[],"numbers":["2"]}',
    );
    expect(
      checkTranslationBlockV2({
        plan: sourcePlan,
        candidate: candidate(
          sourcePlan,
          'PN4A-0018-0003 显示与机组警告 (DCA) 系统 31 DCA EMPPI OPS *[1]*[1]',
        ),
      }).issues,
    ).toEqual([]);
  });
  it('accepts spacing in equivalent Chinese publication dates while retaining changed-date detection', () => {
    const sourcePlan = plan(['Issue 001, 24 Sep 2020']);
    for (const date of ['2020 年 9 月 24 日', '2020年 9月 24日']) {
      expect(
        checkTranslationBlockV2({
          plan: sourcePlan,
          candidate: candidate(sourcePlan, `版本 001，${date}`),
        }).issues,
      ).toEqual([]);
    }
    expect(
      checkTranslationBlockV2({
        plan: sourcePlan,
        candidate: candidate(sourcePlan, '版本 001，2020 年 9 月 23 日'),
      }).issues.map((issue) => issue.code),
    ).toContain('PROTECTED_VALUE_CHANGED');
  });
  it('detects a changed date, O-to-0 part number and channel-value swap despite equal number totals', () => {
    const sourcePlan = plan([
      'On September 3, 2024 use PN-12O. Channel A: 5 seconds; Channel B: 10 seconds.',
    ]);
    const check = checkTranslationBlockV2({
      plan: sourcePlan,
      candidate: candidate(
        sourcePlan,
        '2024年3月9日使用 PN-120。A 通道：10 秒；B 通道：5 秒。',
      ),
    });
    expect(check.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'PROTECTED_VALUE_CHANGED',
        'OBJECT_VALUE_RELATION_CHANGED',
      ]),
    );
  });
  it('detects numeric-unit reassignment without imposing source fragment boundaries', () => {
    const sourcePlan = plan(['The values are 5 seconds and 10 minutes.']);
    expect(
      checkTranslationBlockV2({
        plan: sourcePlan,
        candidate: candidate(sourcePlan, '数值为 5 分钟和 10 秒。'),
      }).issues.map((issue) => issue.code),
    ).toContain('NUMBER_UNIT_RELATION_CHANGED');
  });
  it('retains source BLOCK when a model semantic check reports no translation issues', () => {
    const sourcePlan = plan(['A source fragment.']);
    sourcePlan.blocks[0].sourceIssues.push({
      code: 'SOURCE_TEST_GAP',
      origin: 'SOURCE',
      severity: 'BLOCK',
      message: 'Synthetic missing source',
      blockIds: ['b1'],
      anchorIds: ['a1'],
    });
    const check = checkTranslationBlockV2({
      plan: sourcePlan,
      candidate: candidate(sourcePlan, '一个来源片段。'),
      semanticReview: { result: { blockId: 'b1', issues: [] }, provenance },
    });
    expect(check.semanticCheck).toBe('COMPLETED');
    expect(check.issues[0]).toMatchObject({
      severity: 'BLOCK',
      origin: 'SOURCE',
    });
  });
  it('requires a scope-bound semantic check for negation and preserves its material finding', () => {
    const sourcePlan = plan([
      'Do not replace the unit unless the indication remains.',
    ]);
    const value = candidate(sourcePlan, '如果指示消失，则更换该组件。');
    expect(
      checkTranslationBlockV2({ plan: sourcePlan, candidate: value })
        .semanticCheck,
    ).toBe('PENDING');
    const check = checkTranslationBlockV2({
      plan: sourcePlan,
      candidate: value,
      semanticReview: {
        result: {
          blockId: 'b1',
          issues: [
            {
              code: 'NEGATION_SCOPE_CHANGED',
              severity: 'BLOCK',
              anchorIds: ['a1'],
              message: '除非和否定的含义被翻转。',
            },
          ],
        },
        provenance,
      },
    });
    expect(check.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'NEGATION_SCOPE_CHANGED',
          severity: 'BLOCK',
        }),
      ]),
    );
  });
  it('keeps missing, saved pending, blocked and readable as distinct facts and retains original model attribution', () => {
    const sourcePlan = plan(['A description.']);
    const value = candidate(sourcePlan, '一项说明。');
    const record = revision(sourcePlan, value);
    const state = workspace(sourcePlan);
    expect(
      buildTranslationWorkspaceReadingV2(state, []).blocks[0].readingStatus,
    ).toBe('MISSING');
    const pending = buildTranslationWorkspaceReadingV2(state, [record]);
    expect(pending.completeness).toBe('PARTIAL');
    expect(pending.coverage.savedSourceCharacters).toBeGreaterThan(0);
    expect(pending.coverage.readableSourceCharacters).toBe(0);
    record.check = checkTranslationBlockV2({
      plan: sourcePlan,
      candidate: value,
    });
    record.check.issues.push({
      code: 'TEST',
      severity: 'BLOCK',
      origin: 'TRANSLATION',
      message: 'Synthetic block',
      blockIds: ['b1'],
      anchorIds: ['a1'],
    });
    expect(
      buildTranslationWorkspaceReadingV2(state, [record]).blocks[0]
        .readingStatus,
    ).toBe('BLOCKED');
    record.check.issues = [
      {
        code: 'TERM_REVIEW',
        severity: 'REVIEW',
        origin: 'TRANSLATION',
        message: 'Synthetic review',
        blockIds: ['b1'],
        anchorIds: ['a1'],
      },
    ];
    record.selectedForReading = true;
    const reading = buildTranslationWorkspaceReadingV2(state, [record]);
    expect(reading.completeness).toBe('COMPLETE_WITH_ISSUES');
    expect(reading.blocks[0].selected!.provenance.originAttemptId).toBe(
      'ATT-test',
    );
    record.dependencies.contextRevision = 2;
    expect(
      buildTranslationWorkspaceReadingV2(state, [record]).completeness,
    ).toBe('PARTIAL');
  });
});

it('normalizes confirmed source date conventions without double-counting date digits or permitting field swaps', () => {
  const sourcePlan = plan(['Originated Date: 06/10/2021\nLast Revised Date: 07/28/2025']);
  sourcePlan.documentContext.dateOrder = 'MDY';
  const issues = (text: string) => checkTranslationBlockV2({ plan: sourcePlan, candidate: candidate(sourcePlan, text) }).issues;
  expect(issues('原始日期：2021-6-10\n最后修订日期：2025年7月28日')).toEqual([]);
  expect(issues('原始日期：2025-7-28\n最后修订日期：2021-6-10')).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'DATE_FIELD_RELATION_CHANGED' }),
  ]));
  delete sourcePlan.documentContext.dateOrder;
  expect(issues('原始日期：2021-6-10\n最后修订日期：2025-7-28')).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'PROTECTED_VALUE_CHANGED' }),
  ]));
  const signed = plan(['Limit -0.25; version V18 and part AB-12.']);
  expect(checkTranslationBlockV2({ plan: signed, candidate: candidate(signed, '限制 0.25；版本 V18 和件号 AB-12。') }).issues)
    .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'PROTECTED_VALUE_CHANGED' })]));
});

it('validates edited glossary entries and applies the registered snapshot to generation and checks', () => {
  expect(DEFAULT_TRANSLATION_GLOSSARY.entries).toHaveLength(8);
  expect(() => translationGlossaryEntriesSchema.parse([
    { entryId: 'one', kind: 'TERM', sourceText: 'flight deck',
      targetRenderings: ['驾驶舱'], note: null },
    { entryId: 'two', kind: 'TERM', sourceText: 'FLIGHT DECK',
      targetRenderings: ['飞行甲板'], note: null },
  ])).toThrow();
  expect(() => translationGlossaryEntriesSchema.parse([
    { entryId: 'one', kind: 'NO_TRANSLATE', sourceText: 'AIMS-2',
      targetRenderings: ['AIMS-2'], note: null },
  ])).toThrow();

  const sourcePlan = plan(['Inspect the flight deck and AIMS-2.']);
  const work = workspace(sourcePlan);
  const glossary = { revision: 2, entries: [
    { entryId: 'deck', kind: 'TERM' as const, sourceText: 'flight deck',
      targetRenderings: ['驾驶舱'], note: null },
    { entryId: 'aims', kind: 'NO_TRANSLATE' as const, sourceText: 'AIMS-2',
      targetRenderings: [], note: null },
  ] };
  const request: TranslationGenerationRequestV2 = {
    generationRequestRef: 'TG-glossary', clientRequestId: 'glossary',
    attemptId: 'ATT-new', leaseGeneration: 1,
    blockIds: [sourcePlan.blocks[0].blockId],
    dependencies: translationBatchDependenciesV2(work, [sourcePlan.blocks[0].blockId]),
    purpose: 'GENERATE', targetBlockRevisionId: null,
    status: 'REGISTERED', registeredAt: '2026-09-09T00:00:00.000Z',
    finishedAt: null, error: null, glossary,
  };
  expect(buildTranslationBatchV2(work, request, []).terminology)
    .toMatchObject({ terms: [{ sourceTerm: 'flight deck', targetRenderings: ['驾驶舱'] }],
      noTranslate: [{ token: 'AIMS-2' }] });
  const issues = checkTranslationBlockV2({ plan: sourcePlan,
    candidate: candidate(sourcePlan, '检查飞行甲板。'), glossary }).issues;
  expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
    'GLOSSARY_TERM_MISSING', 'GLOSSARY_TOKEN_CHANGED',
  ]));
  const historical = buildTranslationBatchV2(work, { ...request, glossary: undefined }, []);
  expect(historical.terminology.terms).toHaveLength(5);
});
