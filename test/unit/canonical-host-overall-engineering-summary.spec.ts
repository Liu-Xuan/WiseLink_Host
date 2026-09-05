import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type {
  CanonicalBaseRuleCandidateProjection,
  CanonicalOverallEngineeringSummary,
  CanonicalSourceBoundEngineeringStatement,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';

import {
  buildOpenClawOverallSynthesisInput,
  consumeOpenClawOverallSynthesisOutput,
  expectedOverallApplicabilityStatus,
  type OpenClawOverallSynthesisInput,
} from '../../server/modules/canonical-host/openclaw-overall-synthesis.processor';
import { projectCommonAssessmentContext } from '../../server/modules/canonical-host/canonical-host-common-context.service';

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
    const input = buildRealInput(real737Package, real737Bytes, [real737Package.sourceRefs[0]], []);
    expect(input.commonContext).toMatchObject({
      primaryDocument: { documentVersionRef: input.unifiedSourceContext.documentVersionId },
      knowledgeRetrieval: { status: 'NOT_CONNECTED', fragments: [] },
      discussion: { usage: 'DISCUSSION_NOT_ADOPTION' },
    });
    expect(input.adoptedDocumentVersions).toHaveLength(1);
    expect(input.unifiedSourceContext.currentDocumentSourceRefIds).toHaveLength(real737Package.sourceRefs.length);
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
        (value) =>
          typeof (value as { excerpt?: unknown }).excerpt === 'string',
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
        (value) =>
          typeof (value as { excerpt?: unknown }).excerpt === 'string',
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
    const staleUnknown = JSON.parse(
      synthesisOutput(input, summary),
    ) as Record<string, unknown>;
    staleUnknown.applicabilityStatus = 'UNKNOWN/WAITING_INPUT';
    expect(() =>
      consumeOpenClawOverallSynthesisOutput(
        input,
        JSON.stringify(staleUnknown),
      ),
    ).toThrow('OVERALL_APPLICABILITY_STATUS_MISMATCH');
  });
});

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
          schemaVersion:
            'wiselink.3_1.applicability_candidate_projection.v1',
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
    },
  } as unknown as CanonicalWorkItemProjection;
  return buildOpenClawOverallSynthesisInput({
    workItem,
    baseRules,
    baseArtifactBytes: new TextEncoder().encode(JSON.stringify(baseOutput)),
    packageBytes: new Uint8Array(packageBytes),
    discoveries: [],
    sourceEvidenceCandidates: [],
    engineerReviewContext: {
      revision: null,
      artifactSha256: null,
      reviewCount: 0,
      history: [],
      effective: [],
    },
    outputCorrelationRef: `overall://${documentVersionId}`,
    commonContext: projectCommonAssessmentContext(workItem, { context: { status: 'UNAVAILABLE', reason: 'TEST_NO_READER' }, documentReadingStatus: 'UNAVAILABLE', items: [], sections: [], resourceRefs: [] }, []),
  });
}

function synthesisOutput(
  input: OpenClawOverallSynthesisInput,
  engineeringSummary: CanonicalOverallEngineeringSummary,
): string {
  const firstRef = engineeringSummary.conclusion.sourceRefIds[0];
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
    findingCount: 1,
    unresolvedCount: input.baseRuleResult.unresolvedCount,
    authorityLevel: 'candidate_only',
    externalDiscoveryIsEvidence: false,
    overallCandidate: engineeringSummary.conclusion.text,
    engineeringSummary,
    findings: [
      {
        finding: engineeringSummary.conclusion.text,
        basis: '当前 DocumentVersion 原文依据',
        sourceRefIds: [firstRef],
        assumptions: [],
        uncertainty: '机队适用性由缺失的飞机构型事实约束',
      },
    ],
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
