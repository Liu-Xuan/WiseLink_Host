import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type {
  CanonicalBaseRuleCandidateProjection,
  CanonicalOverallEngineeringSummary,
  CanonicalSourceBoundEngineeringStatement,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';

import {
  buildOpenClawOverallSynthesisInput,
  consumeOpenClawOverallSynthesisOutput,
  expectedOverallApplicabilityStatus,
  type OpenClawOverallSynthesisInput,
  type OpenClawEngineerReviewContext,
} from '../../server/modules/canonical-host/openclaw-overall-synthesis.processor';
import { projectCommonAssessmentContext } from '../../server/modules/canonical-host/canonical-host-common-context.service';
import { canonicalJson } from '../../server/modules/action-attempt/action-attempt-envelope';
import {
  buildOverallReadingEvidence,
  projectOverallAssessmentReading,
  type OverallAssessmentReadingSummary,
} from '../../server/modules/canonical-host/overall-assessment-reading';

const REAL_737_PACKAGE_PATH = resolve(
  __dirname,
  '../../server/runtime-assets/assessment-host/real-sb/737-34-3830-original-issue/unified-package.frozen-2.json',
);
const REAL_777_PACKAGE_PATH = resolve(
  __dirname,
  '../fixtures/real-ftd-frozen2.unified-package.json',
);
const BASE_SHA = 'a'.repeat(64);
const PACKAGE_SHA = 'b'.repeat(64);

interface FrozenSourceRef {
  sourceRefId: string;
  pageStart: number;
  pageEnd: number;
  quote: string;
}

interface FrozenPackage {
  packageId: string;
  contractRevision: 'frozen.2';
  source: {
    legacyIdentifiers: Array<{ namespace: string; value: string }>;
  };
  document: {
    documentId: string;
    title: { value: string };
    identifiers: Array<{ scheme: string; value: string }>;
  };
  contentUnits: unknown[];
  sourceRefs: FrozenSourceRef[];
}

const real737Bytes = readFileSync(REAL_737_PACKAGE_PATH);
const real737Package = JSON.parse(
  real737Bytes.toString('utf8'),
) as FrozenPackage;
const real777Bytes = readFileSync(REAL_777_PACKAGE_PATH);
const real777Package = JSON.parse(
  real777Bytes.toString('utf8'),
) as FrozenPackage;

describe('source-bound Overall engineering summary', () => {
  it('carries shared background alongside the real current source corpus, not as adopted evidence', () => {
    const input = buildRealInput(
      real737Package,
      real737Bytes,
      [real737Package.sourceRefs[0]],
      [],
    );
    expect(input.commonContext).toMatchObject({
      primaryDocument: {
        documentVersionRef: input.unifiedSourceContext.documentVersionId,
      },
      knowledgeRetrieval: { status: 'NOT_CONNECTED', fragments: [] },
      discussion: { usage: 'DISCUSSION_NOT_ADOPTION' },
    });
    expect(input.adoptedDocumentVersions).toHaveLength(1);
    expect(input.unifiedSourceContext.currentDocumentSourceRefIds).toHaveLength(
      real737Package.sourceRefs.length,
    );
  });

  it('produces the 737-34-3830 engineering decision surface without any AIMS-2 contamination', () => {
    const background = sourceRef(real737Package, '0x1009 fault code');
    const actionAndEffectivity = sourceRef(
      real737Package,
      '737-8200 without Extended Range Twin Engine Operations',
    );
    const detailedEffectivity = sourceRef(
      real737Package,
      'line number(s) 5602',
    );
    const materialAndSoftware = sourceRef(
      real737Package,
      'Installation of the FMC OPS will erase all existing',
    );
    const weightAndLoad = sourceRef(
      real737Package,
      'Weight and Balance Changes None',
    );
    const refs = [
      background,
      actionAndEffectivity,
      detailedEffectivity,
      materialAndSoftware,
      weightAndLoad,
    ];
    const input = buildRealInput(real737Package, real737Bytes, refs, [
      '需要当前机队飞机 Variable/Line Number 与现装 FMC P/N 才能匹配适用性。',
    ]);

    const serializedInput = JSON.stringify(input);
    expect(serializedInput).toContain('atmospheric radiation');
    expect(serializedInput).toContain('0x1009');
    expect(serializedInput).toContain('10-62225-004');
    expect(serializedInput).toContain('10-62225-005');
    expect(serializedInput).toContain('FMC OPS Update 14');
    expect(serializedInput).not.toMatch(/AIMS[ -]?2/iu);
    expect(
      sourceContextRefs(input).filter(
        (value) => typeof (value as { excerpt?: unknown }).excerpt === 'string',
      ),
    ).toHaveLength(real737Package.sourceRefs.length);

    const summary: CanonicalOverallEngineeringSummary = {
      schemaVersion: 'wiselink.3_1.overall_engineering_summary.v1',
      conclusion: statement(
        '737-34-3830 针对 GE FMC 易受大气辐射影响的旧 SRAM 引发空中重启问题，当前建议对适用飞机更换两台旧 FMC 为新构型并完成 FMC operational test。',
        'SOURCE_FACT',
        background,
        actionAndEffectivity,
        materialAndSoftware,
      ),
      whyItMatters: [
        statement(
          '旧 SRAM 的多位错误会触发 0x1009 cold restart，清空 SRAM、丢失 flight plan data，并使重启时间长于 warm restart，直接影响运行可靠性。',
          'SOURCE_FACT',
          background,
        ),
      ],
      applicability: {
        sourceScope: statement(
          '源文件适用于 effectivity 清单内的 737-8、737-8200 non-ETOPS 和 737-9，并针对装有旧 GE FMC 构型的飞机。',
          'SOURCE_FACT',
          actionAndEffectivity,
          detailedEffectivity,
          materialAndSoftware,
        ),
        fleetMatch: statement(
          '当前输入没有本机队 Variable/Line Number 与现装 FMC P/N，因此只能保留为待匹配，不能据此判定具体飞机适用或不适用。',
          'CONDITIONAL_INFERENCE',
          detailedEffectivity,
          materialAndSoftware,
        ),
        requiredFacts: [
          statement(
            '取得每架候选飞机的 Variable/Line Number，并与源文件 effectivity 清单核对。',
            'CONDITIONAL_INFERENCE',
            detailedEffectivity,
          ),
          statement(
            '核实现装 FMC 是否为 10-62225-004 / GE 2907C1 / 176200-01-01。',
            'CONDITIONAL_INFERENCE',
            materialAndSoftware,
          ),
        ],
      },
      implementationImpact: [
        statement(
          '实施前飞机必须已安装 ONS OS 9.1；新 FMC 仅允许 FMC OPS U14 或 U14.1。',
          'SOURCE_FACT',
          background,
          materialAndSoftware,
        ),
        statement(
          'OPS 安装会擦除现有 OFP，之后需恢复 OPC、MEDB、NDB、LDDB、ATN 与 ACARS ADDB；装有 HUD 的飞机还需向 STC holder 确认兼容。',
          'SOURCE_FACT',
          materialAndSoftware,
        ),
        statement(
          '每架需由运营人提供两台新 FMC，无 kit、无特殊工具、无重量和电气负载变化，但 publications 与 flight operations 受影响。',
          'SOURCE_FACT',
          actionAndEffectivity,
          materialAndSoftware,
          weightAndLoad,
        ),
      ],
      dispositionPriority: [
        statement(
          '源文件未给强制 compliance time，且明确为非 AD related；Boeing 建议实施以引入可靠性改进。',
          'SOURCE_FACT',
          background,
          actionAndEffectivity,
        ),
        statement(
          '在完成机队适用性和软件/HUD 前置条件核对后，可按可靠性改进纳入计划维修，而不是按法规时限立即执行。',
          'CONDITIONAL_INFERENCE',
          background,
          actionAndEffectivity,
          materialAndSoftware,
        ),
      ],
      nextActions: [
        statement(
          '批量核对候选飞机的 Variable/Line Number 与现装 FMC P/N，形成适用飞机清单和异常项。',
          'CONDITIONAL_INFERENCE',
          detailedEffectivity,
          materialAndSoftware,
        ),
        statement(
          '对适用飞机确认 ONS OS 9.1，并准备 U14/U14.1 与 OFP 数据恢复包。',
          'CONDITIONAL_INFERENCE',
          background,
          materialAndSoftware,
        ),
        statement(
          '仅对装有 HUD 的适用飞机取得 STC holder 兼容性确认。',
          'CONDITIONAL_INFERENCE',
          materialAndSoftware,
        ),
      ],
    };
    const consumed = consumeOpenClawOverallSynthesisOutput(
      input,
      synthesisOutput(input, summary),
    );

    expect(consumed.engineeringSummary).toEqual(summary);
    expect(JSON.stringify(consumed)).not.toMatch(/AIMS[ -]?2/iu);
    expect(summary.nextActions).toHaveLength(3);
    expect(
      summary.applicability.requiredFacts.map((item) => item.text),
    ).toEqual([
      expect.stringContaining('Variable/Line Number'),
      expect.stringContaining('FMC'),
    ]);
  });

  it('retains AIMS-2 only when the current real 777 FTD SourceRef contains that scenario', () => {
    const applicability = sourceRef(
      real777Package,
      'All 777 models equipped with Airplane Information Management System 2',
    );
    const action = sourceRef(
      real777Package,
      'Implement one of the following three AIMS-2 BP V18 Service Bulletins',
    );
    const input = buildRealInput(
      real777Package,
      real777Bytes,
      [applicability, action],
      [],
      'APPLICABLE',
    );

    expect(JSON.stringify(input)).toContain('AIMS-2');
    expect(input.applicabilityResult).toMatchObject({
      status: 'CANDIDATE_ONLY',
      decision: 'APPLICABLE',
      kleeneResult: true,
      pass: true,
      blockingUnknownCount: 0,
    });
    expect(
      sourceContextRefs(input).filter(
        (value) => typeof (value as { excerpt?: unknown }).excerpt === 'string',
      ),
    ).toHaveLength(real777Package.sourceRefs.length);
    expect(input.unifiedSourceContext.currentDocumentSourceRefIds).toContain(
      applicability.sourceRefId,
    );

    const summary: CanonicalOverallEngineeringSummary = {
      schemaVersion: 'wiselink.3_1.overall_engineering_summary.v1',
      conclusion: statement(
        '该 777 FTD 说明 AIMS-2 BP V18 软件更新及按飞机 ONS 构型选择对应 Service Bulletin 的处置路径。',
        'SOURCE_FACT',
        applicability,
        action,
      ),
      whyItMatters: [
        statement(
          'AIMS-2 BP V18 包含多项运行、通信与认证相关的软件变化。',
          'SOURCE_FACT',
          action,
        ),
      ],
      applicability: {
        sourceScope: statement(
          '源文件适用于装有 AIMS-2 平台的 777。',
          'SOURCE_FACT',
          applicability,
        ),
        fleetMatch: statement(
          'Host 当前受控适用性求值为 APPLICABLE；具体实施时仍按来源中的 ONS 构型选择对应 Service Bulletin。',
          'CONDITIONAL_INFERENCE',
          applicability,
          action,
        ),
        requiredFacts: [],
      },
      implementationImpact: [
        statement(
          '实施路径需根据 ONS 构型在三个 AIMS-2 BP V18 Service Bulletin 中选择。',
          'SOURCE_FACT',
          action,
        ),
      ],
      dispositionPriority: [
        statement(
          '按 Host 已完成的适用性求值进入候选实施规划，最终工程批准仍独立保留。',
          'CONDITIONAL_INFERENCE',
          applicability,
          action,
        ),
      ],
      nextActions: [
        statement(
          '依据受控 ONS 构型选择并准备相应 Service Bulletin。',
          'CONDITIONAL_INFERENCE',
          applicability,
          action,
        ),
      ],
    };
    const consumed = consumeOpenClawOverallSynthesisOutput(
      input,
      synthesisOutput(input, summary),
    );

    expect(JSON.stringify(consumed)).toContain('AIMS-2');
    expect(consumed.applicabilityStatus).toBe('APPLICABLE');
    expect(summary.conclusion.sourceRefIds).toContain(
      applicability.sourceRefId,
    );
    const staleUnknown = JSON.parse(synthesisOutput(input, summary)) as Record<
      string,
      unknown
    >;
    staleUnknown.applicabilityStatus = 'UNKNOWN/WAITING_INPUT';
    expect(() =>
      consumeOpenClawOverallSynthesisOutput(
        input,
        JSON.stringify(staleUnknown),
      ),
    ).toThrow('OVERALL_APPLICABILITY_STATUS_MISMATCH');
  });
});

describe('Overall v2 reading content and actual premises', () => {
  it('uses task-local engineer refs in the model and resolves their adopted citation against the actual Host registry', () => {
    const originalSourceRefId =
      'review-evidence://WI-ENGINEER/1/OVERALL-ENGINEERING-CONTEXT/1';
    const review = {
      sequence: 1,
      criterionId: 'OVERALL-ENGINEERING-CONTEXT',
      affectedCriterionIds: ['OVERALL-ENGINEERING-CONTEXT'],
      baseRuleRevision: 1,
      baseRuleArtifactSha256: BASE_SHA,
      actionType: 'SUPPLEMENT_EVIDENCE' as const,
      decision: 'deferred' as const,
      status: 'NEEDS_REVIEW' as const,
      comment: '构型记录仍不完整。',
      recordedAt: '2026-09-08T00:00:00.000Z',
      evidence: [
        {
          kind: 'AIRCRAFT_FACT' as const,
          statement: '工程师表示构型记录仍不完整。',
          locator: '工程师评审 1',
          sourceRefId: originalSourceRefId,
        },
      ],
      resolvedMissingInputs: [],
      uncertaintyDispositions: [],
      decisionSnapshot: null,
      correctedAnalysisDirection: null,
    };
    const context = {
      revision: 1,
      artifactSha256: 'd'.repeat(64),
      reviewCount: 1,
      history: [review],
      effective: [review],
    };
    const readingEvidence = buildOverallReadingEvidence({
      workItem: readingWorkItem(),
      packageBytes: real737Bytes,
      engineerReviewContext: context,
    });
    const input = buildRealInput(
      real737Package,
      real737Bytes,
      [real737Package.sourceRefs[0]],
      [],
      undefined,
      readingEvidence,
      context,
    );
    const evidenceRef = 'overall-evidence:engineer-review:1:1';
    expect(
      input.engineerReviewContext.effective[0].evidence[0].sourceRefId,
    ).toBe(evidenceRef);
    expect(input.selectiveResynthesis.adoptedEvidenceSourceRefIds).toEqual([
      evidenceRef,
    ]);
    expect(JSON.stringify(input)).not.toContain(originalSourceRefId);
    expect(
      readingEvidence.find((item) => item.evidenceRef === evidenceRef),
    ).toHaveProperty('sourceRefId', originalSourceRefId);
    expect(context.effective[0].evidence[0].sourceRefId).toBe(
      originalSourceRefId,
    );
    const summary = readingFixture().summary;
    summary.claims[0].premises = [
      {
        evidenceRef,
        role: 'LIMITS',
        explanation: '工程师提供的当前构型范围限制。',
        limitation: '尚非受控构型完成记录。',
      },
    ];
    expect(() =>
      consumeOpenClawOverallSynthesisOutput(
        input,
        synthesisOutput(input, summary),
        readingEvidence,
      ),
    ).not.toThrow();
    summary.claims[0].premises = [
      {
        evidenceRef: readingEvidence[0].evidenceRef,
        role: 'SUPPORTS',
        explanation: '来源范围。',
        limitation: null,
      },
    ];
    expect(() =>
      consumeOpenClawOverallSynthesisOutput(
        input,
        synthesisOutput(input, summary),
        readingEvidence,
      ),
    ).toThrow(`OVERALL_ADOPTED_EVIDENCE_NOT_CITED:${evidenceRef}`);
  });

  it('keeps historical v1 readable but requires a reading summary for a new registry task', () => {
    const { input, readingEvidence } = readingFixture();
    const statement = {
      text: '来源问题的候选认识。',
      basis: 'SOURCE_FACT' as const,
      sourceRefIds: [real737Package.sourceRefs[0].sourceRefId],
    };
    const summary: CanonicalOverallEngineeringSummary = {
      schemaVersion: 'wiselink.3_1.overall_engineering_summary.v1',
      conclusion: statement,
      whyItMatters: [statement],
      applicability: {
        sourceScope: statement,
        fleetMatch: statement,
        requiredFacts: [],
      },
      implementationImpact: [statement],
      dispositionPriority: [statement],
      nextActions: [statement],
    };
    expect(() =>
      consumeOpenClawOverallSynthesisOutput(
        input,
        synthesisOutput(input, summary),
        readingEvidence,
      ),
    ).toThrow('OVERALL_READING_SUMMARY_VERSION_REQUIRED');
    const { evidenceRegistry: _registry, ...historicalInput } = input;
    expect(() =>
      consumeOpenClawOverallSynthesisOutput(
        historicalInput,
        synthesisOutput(historicalInput, summary),
      ),
    ).not.toThrow();
  });

  it('omits a decision snapshot WorkItem binding only from the model serialization', () => {
    const snapshot = {
      workItemId: readingWorkItem().workItemId,
      decisionSnapshotRef: 'SNAPSHOT-1',
      revision: 2,
      engineerConfirmationRef: null,
      assessmentAsOf: '2026-09-08T00:00:00.000Z',
      evidenceHorizon: ['SOURCE_DOCUMENT_COMPLETE' as const],
      currentBestJudgment: '当前只能保留候选认识。',
      alternativeJudgments: [],
      decisionMaturity: 'PRELIMINARY' as const,
      decisiveFacts: [],
      assumptions: [],
      residualUncertainties: [],
      uncertaintyDispositions: [],
      controlsAndMitigations: [],
      monitoringPlan: null,
      validUntil: null,
      reviewBy: null,
      reopenTriggers: [],
      whatWouldChangeDecision: [],
      candidateOnly: true as const,
    };
    const review = {
      sequence: 1,
      criterionId: 'OVERALL-ENGINEERING-CONTEXT',
      affectedCriterionIds: ['OVERALL-ENGINEERING-CONTEXT'],
      baseRuleRevision: 1,
      baseRuleArtifactSha256: BASE_SHA,
      actionType: 'REVISE_JUDGMENT' as const,
      decision: 'deferred' as const,
      status: 'NEEDS_REVIEW' as const,
      comment: '保留待核。',
      recordedAt: '2026-09-08T00:00:00.000Z',
      evidence: [],
      resolvedMissingInputs: [],
      uncertaintyDispositions: [],
      decisionSnapshot: snapshot,
      correctedAnalysisDirection: null,
    };
    const context = {
      revision: 1,
      artifactSha256: 'd'.repeat(64),
      reviewCount: 1,
      history: [review],
      effective: [review],
    };
    const input = buildRealInput(
      real737Package,
      real737Bytes,
      [real737Package.sourceRefs[0]],
      [],
      undefined,
      undefined,
      context,
    );
    expect(
      input.engineerReviewContext.history[0].decisionSnapshot,
    ).not.toHaveProperty('workItemId');
    expect(
      input.engineerReviewContext.effective[0].decisionSnapshot,
    ).toMatchObject({
      decisionSnapshotRef: 'SNAPSHOT-1',
      revision: 2,
      currentBestJudgment: snapshot.currentBestJudgment,
    });
    expect(context.history[0].decisionSnapshot.workItemId).toBe(
      readingWorkItem().workItemId,
    );
    expect(JSON.stringify(input)).not.toContain('"workItemId"');
  });

  it('accepts the same registry after the sealed task canonically reorders JSON object keys', () => {
    const { input, readingEvidence, summary } = readingFixture();
    const storedInput = JSON.parse(canonicalJson(input));
    const storedEvidence = JSON.parse(canonicalJson(readingEvidence));
    expect(() =>
      consumeOpenClawOverallSynthesisOutput(
        storedInput,
        synthesisOutput(input, summary),
        storedEvidence,
      ),
    ).not.toThrow();
  });

  it('retains a decisive condition at the end of a long supplied passage', () => {
    const quote = `${'Source context. '.repeat(500)}This does not approve execution for the operator.`;
    const readingEvidence = buildOverallReadingEvidence({
      workItem: readingWorkItem(),
      packageBytes: new TextEncoder().encode(
        JSON.stringify({
          sourceRefs: [
            { sourceRefId: 'LONG-REF', pageStart: 1, pageEnd: 2, quote },
          ],
        }),
      ),
      engineerReviewContext: {
        revision: null,
        artifactSha256: null,
        reviewCount: 0,
        history: [],
        effective: [],
      },
    });
    const input = buildRealInput(
      real737Package,
      real737Bytes,
      [real737Package.sourceRefs[0]],
      [],
      undefined,
      readingEvidence,
    );
    expect(readingEvidence[0].excerpt).toBe(quote);
    expect(input.evidenceRegistry?.[0].excerpt).toBe(quote);
  });

  it('accepts a related-document-only claim without inventing an implementation decision', () => {
    const { input, readingEvidence, summary } = readingFixture();
    const related = readingEvidence.find(
      (item) => item.evidenceRef === 'RELATED-READ-1',
    )!;
    summary.claims[0].premises = [
      {
        evidenceRef: related.evidenceRef,
        role: 'SUPPORTS',
        explanation: '该关联正文独立说明故障机理。',
        limitation: '尚未确定本机队的构型。',
      },
    ];

    const consumed = consumeOpenClawOverallSynthesisOutput(
      input,
      synthesisOutput(input, summary),
      readingEvidence,
    );
    expect(consumed.engineeringSummary).toEqual(summary);
    expect(summary).not.toHaveProperty('nextActions');
    expect(summary).not.toHaveProperty('implementationImpact');
    expect(summary).not.toHaveProperty('dispositionPriority');
    expect(input.evidenceRegistry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidenceRef: 'RELATED-READ-1',
          kind: 'DOCUMENT_PASSAGE',
          excerpt: related.excerpt,
        }),
      ]),
    );
    expect(
      input.evidenceRegistry?.some(
        (item) => 'workItemId' in item || 'sourceRefId' in item,
      ),
    ).toBe(false);
  });

  it('keeps the exact sentence and all premises under the saved Overall identity', () => {
    const { readingEvidence, summary } = readingFixture();
    summary.claims[0].premises.push({
      evidenceRef: 'RELATED-READ-1',
      role: 'LIMITS',
      explanation: '限制适用范围。',
      limitation: '关联文件版本只支持此次问题范围。',
    });
    const result = projectOverallAssessmentReading({
      summary,
      evidenceRegistry: readingEvidence,
      resultRef: 'SAVED-OVERALL-RESULT',
      resultRevision: 3,
      workItemId: 'WI-PRIMARY',
      documentVersionId: 'DV-PRIMARY',
    });

    expect(result).toMatchObject({
      resultRef: 'SAVED-OVERALL-RESULT',
      resultRevision: 3,
      candidateOnly: true,
      content: {
        schemaVersion: 'wiselink.3_1.assessment_reading.v1',
        claims: summary.claims,
      },
    });
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence[1]).toMatchObject({
      workItemId: 'WI-RELATED',
      documentVersionId: 'DV-RELATED',
      sourceRefId: 'RELATED-ORIGINAL-SOURCE',
      locator: 'page 2-2',
      versionLabel: 'R2',
    });
    expect(result.content.claims[0].text).toBe(summary.claims[0].text);
  });

  it('does not promote an available-only source or accept a forged model evidence binding', () => {
    const { input, readingEvidence, summary } = readingFixture();
    summary.claims[0].premises[0].evidenceRef = 'AVAILABLE-BUT-NOT-READ';
    expect(() =>
      consumeOpenClawOverallSynthesisOutput(
        input,
        synthesisOutput(input, summary),
        readingEvidence,
      ),
    ).toThrow('OVERALL_UNKNOWN_EVIDENCE_REF:AVAILABLE-BUT-NOT-READ');
    summary.claims[0].premises[0].evidenceRef = readingEvidence[0].evidenceRef;
    input.evidenceRegistry![0].excerpt = '模型自行添加的内容';
    expect(() =>
      consumeOpenClawOverallSynthesisOutput(
        input,
        synthesisOutput(input, summary),
        readingEvidence,
      ),
    ).toThrow('OVERALL_READING_EVIDENCE_INPUT_MISMATCH');
  });

  it('requires a Host registry and stable, nonduplicated claim identities', () => {
    const { input, readingEvidence, summary } = readingFixture();
    expect(() =>
      consumeOpenClawOverallSynthesisOutput(
        input,
        synthesisOutput(input, summary),
      ),
    ).toThrow('OVERALL_READING_EVIDENCE_REGISTRY_REQUIRED');
    summary.claims.push(structuredClone(summary.claims[0]));
    expect(() =>
      consumeOpenClawOverallSynthesisOutput(
        input,
        synthesisOutput(input, summary),
        readingEvidence,
      ),
    ).toThrow('OVERALL_DUPLICATE_CLAIM_ID');
    summary.claims.pop();
    summary.decisiveClaimIds = ['MISSING-CLAIM'];
    expect(() =>
      consumeOpenClawOverallSynthesisOutput(
        input,
        synthesisOutput(input, summary),
        readingEvidence,
      ),
    ).toThrow('OVERALL_UNKNOWN_DECISIVE_CLAIM_ID:MISSING-CLAIM');
  });

  it('registers effective engineer evidence as a statement from its real ledger, with no invented query or PDF', () => {
    const review = {
      sequence: 2,
      criterionId: 'RULE-1',
      baseRuleRevision: 1,
      baseRuleArtifactSha256: BASE_SHA,
      actionType: 'SUPPLEMENT_EVIDENCE' as const,
      decision: 'deferred' as const,
      status: 'NEEDS_REVIEW' as const,
      comment: '根据记录补充构型事实。',
      recordedAt: '2026-09-08T01:00:00.000Z',
      evidence: [
        {
          kind: 'AIRCRAFT_FACT' as const,
          statement: '工程师表示已核对当前装机记录。',
          locator: '工程师记录 2',
          sourceRefId: 'review-evidence://REAL/2/1',
        },
      ],
      resolvedMissingInputs: [],
      uncertaintyDispositions: [],
      decisionSnapshot: null,
      correctedAnalysisDirection: null,
    };
    const evidence = buildOverallReadingEvidence({
      workItem: readingWorkItem(),
      packageBytes: real737Bytes,
      engineerReviewContext: {
        revision: 3,
        artifactSha256: 'd'.repeat(64),
        reviewCount: 2,
        history: [
          {
            ...review,
            sequence: 1,
            evidence: [{ ...review.evidence[0], sourceRefId: 'SUPERSEDED' }],
          },
          review,
        ],
        effective: [review],
      },
    });
    const statement = evidence.find(
      (item) => item.kind === 'ENGINEER_STATEMENT',
    );
    expect(statement).toMatchObject({
      kind: 'ENGINEER_STATEMENT',
      origin: 'ENGINEER_REVIEW_LEDGER',
      workItemId: readingWorkItem().workItemId,
      reviewRevision: 3,
      sequence: 2,
      sourceRefId: 'review-evidence://REAL/2/1',
      recordedAt: review.recordedAt,
      excerpt: review.evidence[0].statement,
    });
    expect(statement).not.toHaveProperty('documentVersionId');
    expect(statement).not.toHaveProperty('reviewConversationId');
    expect(statement).not.toHaveProperty('artifactSha256');
    expect(evidence.some((item) => item.kind === 'QUERY_RECEIPT')).toBe(false);
    expect(JSON.stringify(evidence)).not.toContain('SUPERSEDED');
  });

  it.each([
    '未批准执行；当前仅有候选认识。',
    '尚未确认该机队适用。',
    '并非已批准执行。',
    'This is not approved for execution.',
    'This has not yet been approved for execution.',
    'The fleet is not confirmed applicable.',
    'Boeing states that the modification is approved; local fleet applicability remains unresolved.',
    '厂家声明：“已批准执行”属于厂家对文件方案的立场；本机队仍需核对。',
  ])('accepts a negation or attributed source position: %s', (narrative) => {
    const { input, readingEvidence, summary } = readingFixture();
    summary.lead = narrative;
    summary.claims[0].text = narrative;
    expect(() =>
      consumeOpenClawOverallSynthesisOutput(
        input,
        synthesisOutput(input, summary),
        readingEvidence,
      ),
    ).not.toThrow();
  });

  it.each([
    '已批准执行。',
    '已确认该机队适用。',
    'The work is approved for execution.',
    'The fleet is confirmed applicable.',
    'It is safe to release.',
    '未批准执行；但本次可以直接实施。',
    'Boeing states that the modification is approved; therefore this work is approved for execution.',
    '厂家声明方案已批准，因此本次可直接实施。',
  ])('still rejects an assertion of Host approval: %s', (narrative) => {
    const { input, readingEvidence, summary } = readingFixture();
    summary.lead = narrative;
    expect(() =>
      consumeOpenClawOverallSynthesisOutput(
        input,
        synthesisOutput(input, summary),
        readingEvidence,
      ),
    ).toThrow('OVERALL_AUTHORITATIVE_NARRATIVE_FORBIDDEN');
  });
});

function readingWorkItem(): CanonicalWorkItemProjection {
  return {
    workItemId: `WI-${legacyId(real737Package, 'wiselink_document_version_id')}`,
    source: {
      documentId: real737Package.document.documentId,
      documentVersionId: legacyId(
        real737Package,
        'wiselink_document_version_id',
      ),
    },
    package: {
      title: '737-34-3830',
      documentIdentity: {
        documentCode: '737-34-3830',
        businessRevision: 'Original',
      },
    },
  } as CanonicalWorkItemProjection;
}

function readingFixture() {
  const readingEvidence = buildOverallReadingEvidence({
    workItem: readingWorkItem(),
    packageBytes: real737Bytes,
    engineerReviewContext: {
      revision: null,
      artifactSha256: null,
      reviewCount: 0,
      history: [],
      effective: [],
    },
    relatedReadingEvidence: [
      {
        evidenceRef: 'RELATED-READ-1',
        kind: 'DOCUMENT_PASSAGE',
        title: '关联故障报告',
        versionLabel: 'R2',
        excerpt: '实际读到的关联材料说明故障机理与限制。',
        workItemId: 'WI-RELATED',
        documentVersionId: 'DV-RELATED',
        sourceRefId: 'RELATED-ORIGINAL-SOURCE',
        locator: 'page 2-2',
      },
    ],
  });
  const input = buildRealInput(
    real737Package,
    real737Bytes,
    [real737Package.sourceRefs[0]],
    [],
    undefined,
    readingEvidence,
  );
  const summary: OverallAssessmentReadingSummary = {
    schemaVersion: 'wiselink.3_1.overall_engineering_summary.v2',
    headline: 'FMC 重启问题的当前认识',
    listBrief: '旧构型存在故障风险，机队构型仍待核对。',
    lead: '已有材料支持故障机理认识，当前尚无实施决定。',
    claims: [
      {
        claimId: 'FMC-MECHANISM',
        text: '现有材料支持故障机理认识；机队构型仍待核对。',
        basis: 'CONDITIONAL_INFERENCE',
        premises: [
          {
            evidenceRef: readingEvidence[0].evidenceRef,
            role: 'SUPPORTS',
            explanation: '提供本次已读问题范围。',
            limitation: '不证明具体飞机适用。',
          },
        ],
      },
    ],
    decisiveClaimIds: ['FMC-MECHANISM'],
  };
  return { input, readingEvidence, summary };
}

function sourceRef(pkg: FrozenPackage, quoteFragment: string): FrozenSourceRef {
  const expected = normalizeWhitespace(quoteFragment).toLowerCase();
  const match = pkg.sourceRefs.find((ref) =>
    normalizeWhitespace(ref.quote).toLowerCase().includes(expected),
  );
  if (!match)
    throw new Error(`REAL_FIXTURE_SOURCE_REF_NOT_FOUND:${quoteFragment}`);
  return match;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function buildRealInput(
  pkg: FrozenPackage,
  packageBytes: Buffer,
  refs: FrozenSourceRef[],
  missingInputs: string[],
  applicabilityDecision?: 'APPLICABLE' | 'NOT_APPLICABLE' | 'UNKNOWN',
  readingEvidence?: AssessmentEvidence[],
  engineerReviewContext?: OpenClawEngineerReviewContext,
): OpenClawOverallSynthesisInput {
  const documentVersionId = legacyId(pkg, 'wiselink_document_version_id');
  const baseOutput = {
    ruleResults: {
      columns: [
        'ruleId',
        'result',
        'factsConsidered',
        'ruleApplication',
        'analysisSummary',
        'conclusion',
        'sourceRefs',
        'missingInputs',
        'humanReviewRequired',
      ],
      rows: [
        [
          'OVERALL-ENGINEERING-CONTEXT',
          missingInputs.length > 0 ? 'UNKNOWN/WAITING_INPUT' : 'PASS',
          refs.map((ref) => ref.quote),
          '按当前文档 SourceRef 归纳技术问题、适用性、实施影响与处置建议。',
          '只将当前文档明确要求的事实列为待补输入。',
          '形成逐结论来源绑定的工程候选。',
          refs.map((ref) => ref.sourceRefId),
          missingInputs,
          true,
        ],
      ],
    },
  };
  const baseRules = {
    status: 'CANDIDATE_ONLY',
    revision: 1,
    sourceResultId: `openclaw-dynamic://${documentVersionId}`,
    criterionSetId: 'REAL-DOCUMENT-OVERALL',
    criterionCount: 1,
    evaluationItemCount: 1,
    unresolvedCount: missingInputs.length > 0 ? 1 : 0,
    sourceBoundCandidateCount: 1,
    artifact: artifact('artifact://real-base', BASE_SHA),
    actionAttemptId: 'ATT-REAL-BASE',
  } satisfies CanonicalBaseRuleCandidateProjection;
  const workItem = {
    workItemId: `WI-${documentVersionId}`,
    requestId: `REQ-${documentVersionId}`,
    revision: 1,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    source: {
      documentId: pkg.document.documentId,
      documentVersionId,
    },
    classification: {
      parserProfileId: 'issuer.boeing.controlled-document',
      normalizedFamily: 'BOEING',
    },
    package: {
      packageId: pkg.packageId,
      contentHash: 'c'.repeat(64),
      contractRevision: pkg.contractRevision,
      contentUnitCount: pkg.contentUnits.length,
      documentIdentity: {
        documentCode: documentCode(pkg),
        businessRevision: 'CURRENT',
      },
      artifact: artifact('artifact://real-package', PACKAGE_SHA),
    },
    applicability: applicabilityDecision
      ? {
          schemaVersion: 'wiselink.3_1.applicability_candidate_projection.v1',
          status:
            applicabilityDecision === 'UNKNOWN'
              ? 'WAITING_INPUT'
              : 'CANDIDATE_ONLY',
          currentness: 'CURRENT',
          staleReason: null,
          sourceResultId: `openclaw-applicability://${documentVersionId}`,
          actionAttemptId: 'ATT-REAL-APPLICABILITY',
          inputRevision: 1,
          documentId: pkg.document.documentId,
          documentVersionId,
          sourcePackageId: pkg.packageId,
          sourcePackageContentHash: 'c'.repeat(64),
          translationActionAttemptId: 'ATT-REAL-TRANSLATION',
          applicabilityContextRef: 'APCTX-REAL',
          applicabilityBindingRevision: 'host-applicability:real',
          aircraftNumber: 'B-1266',
          assessmentAsOf: '2026-09-01',
          fleetSourceSnapshotId: 'FLEET-REAL',
          fleetSourceRevisionKey: 'FLEET-REV-REAL',
          fleetAuthorityRevision: 'FLEET-AUTH-REAL',
          fleetSourceAsOf: '2026-09-01',
          sourceExpressionCount: 1,
          sourceRefCount: refs.length,
          decision: applicabilityDecision,
          kleeneResult:
            applicabilityDecision === 'APPLICABLE'
              ? true
              : applicabilityDecision === 'NOT_APPLICABLE'
                ? false
                : 'unknown',
          pass: applicabilityDecision === 'APPLICABLE',
          blockingUnknownCount: applicabilityDecision === 'UNKNOWN' ? 1 : 0,
          artifact: artifact('artifact://real-applicability', 'f'.repeat(64)),
        }
      : null,
    integratedAssessment: {
      status: 'BASE_RULE_CANDIDATE_READY',
      baseRules,
      overallSynthesis: null,
      overallForAeoConfirmation: null,
      engineerReviews: engineerReviewContext?.revision
        ? {
            status: 'HUMAN_REVIEW_RECORDED',
            revision: engineerReviewContext.revision,
            reviewCount: engineerReviewContext.reviewCount,
            criterionSetId: baseRules.criterionSetId,
            artifact: artifact(
              'artifact://review-ledger',
              engineerReviewContext.artifactSha256!,
            ),
            actionAttemptId: 'ATT-REVIEW',
          }
        : null,
    },
  } as unknown as CanonicalWorkItemProjection;
  return buildOpenClawOverallSynthesisInput({
    workItem,
    baseRules,
    baseArtifactBytes: new TextEncoder().encode(JSON.stringify(baseOutput)),
    packageBytes: new Uint8Array(packageBytes),
    discoveries: [],
    sourceEvidenceCandidates: [],
    engineerReviewContext: engineerReviewContext ?? {
      revision: null,
      artifactSha256: null,
      reviewCount: 0,
      history: [],
      effective: [],
    },
    outputCorrelationRef: `overall://${documentVersionId}`,
    readingEvidence,
    commonContext: projectCommonAssessmentContext(
      workItem,
      {
        context: { status: 'UNAVAILABLE', reason: 'TEST_NO_READER' },
        documentReadingStatus: 'UNAVAILABLE',
        items: [],
        sections: [],
        resourceRefs: [],
      },
      [],
    ),
  });
}

function synthesisOutput(
  input: OpenClawOverallSynthesisInput,
  engineeringSummary:
    | CanonicalOverallEngineeringSummary
    | OverallAssessmentReadingSummary,
): string {
  const legacy =
    engineeringSummary.schemaVersion ===
    'wiselink.3_1.overall_engineering_summary.v1'
      ? engineeringSummary
      : null;
  const candidate = legacy
    ? legacy.conclusion.text
    : (engineeringSummary as OverallAssessmentReadingSummary).lead;
  return JSON.stringify({
    sourceResultId: input.outputCorrelationRef,
    documentVersionId: input.baseRuleResult.documentVersionId,
    packageId: input.baseRuleResult.packageId,
    baseRuleRevision: input.baseRuleResult.revision,
    baseRuleArtifactSha256: input.baseRuleResult.artifactSha256,
    engineerReviewRevision: input.engineerReviewContext.revision,
    engineerReviewArtifactSha256: input.engineerReviewContext.artifactSha256,
    discoveryStatus: 'NO_DISCOVERY',
    gap: null,
    candidateRefCount: 0,
    findingCount: legacy ? 1 : 0,
    unresolvedCount: input.baseRuleResult.unresolvedCount,
    authorityLevel: 'candidate_only',
    externalDiscoveryIsEvidence: false,
    overallCandidate: candidate,
    engineeringSummary,
    findings: legacy
      ? [
          {
            finding: candidate,
            basis: '当前 DocumentVersion 原文依据',
            sourceRefIds: [legacy.conclusion.sourceRefIds[0]],
            assumptions: [],
            uncertainty: '机队适用性由缺失的飞机构型事实约束',
          },
        ]
      : [],
    missingInputs: [],
    applicabilityStatus: expectedOverallApplicabilityStatus(
      input.applicabilityResult,
    ),
    engineeringReviewRequired: true,
    adopted: false,
    usableAsEvidence: false,
    providers: {},
  });
}

function statement(
  text: string,
  basis: CanonicalSourceBoundEngineeringStatement['basis'],
  ...refs: FrozenSourceRef[]
): CanonicalSourceBoundEngineeringStatement {
  return {
    text,
    basis,
    sourceRefIds: [...new Set(refs.map((ref) => ref.sourceRefId))],
  };
}

function sourceContextRefs(
  input: OpenClawOverallSynthesisInput,
): Array<Record<string, unknown>> {
  return input.unifiedSourceContext.sourceRefs as Array<
    Record<string, unknown>
  >;
}

function legacyId(pkg: FrozenPackage, namespace: string): string {
  const value = pkg.source.legacyIdentifiers.find(
    (identifier) => identifier.namespace === namespace,
  )?.value;
  if (!value) throw new Error(`REAL_FIXTURE_LEGACY_ID_NOT_FOUND:${namespace}`);
  return value;
}

function documentCode(pkg: FrozenPackage): string {
  return (
    pkg.document.identifiers.find(
      (identifier) => identifier.scheme === 'oem_document_code',
    )?.value ?? pkg.document.title.value
  );
}

function artifact(ref: string, sha256: string) {
  return {
    storeRole: 'UnifiedArtifactStoreCandidate' as const,
    ref,
    sha256,
    byteLength: 1,
    mediaType: 'application/json' as const,
  };
}
