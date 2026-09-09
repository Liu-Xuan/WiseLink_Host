import type {
  TranslationBlockRevisionV2,
  TranslationSourceAnchorV2,
  TranslationWorkspaceReadingV2,
} from '@shared/canonical-translation-v2.interface';
import type { JobAidWorkingReadModel } from '@shared/jobaid-problem-assessment.interface';

export function sourceAnchor(
  id: string,
  text: string,
  page: number | null = 3,
  payloadPath = '/payload/text',
): TranslationSourceAnchorV2 {
  return {
    anchorId: id,
    sourceUnitId: `unit-${id}`,
    payloadPath,
    sourceText: text,
    sourceRefIds: [`ref-${id}`],
    sourceLocators: [
      {
        sourceRefId: `ref-${id}`,
        kind: 'pdf',
        artifactId: null,
        pageStart: page,
        pageEnd: page,
        charStart: null,
        charEnd: null,
        charOffsetUnit: null,
        normalizedPath: null,
        xpath: null,
        elementId: null,
        quote: text,
        bbox: null,
      },
    ],
  };
}

export function semanticReadingFixture(): TranslationWorkspaceReadingV2 {
  const anchors = [
    sourceAnchor('a1', 'Only for the upper bracket.'),
    sourceAnchor('a2', 'Do not use on the lower bracket.'),
    sourceAnchor('a3', 'Verify configuration first.', 4),
  ];
  const revision: TranslationBlockRevisionV2 = {
    blockRevisionId: 'body-checked-2',
    workspaceId: 'workspace-test',
    blockId: 'paragraph-test',
    planRevision: 1,
    contentRevision: 2,
    rowVersion: 7,
    candidate: {
      blockId: 'paragraph-test',
      elements: [
        {
          elementId: 'whole-paragraph',
          kind: 'paragraph',
          translatedText: '仅适用于上支架，不得用于下支架；应先核实构型。',
          anchorIds: anchors.map((anchor) => anchor.anchorId),
        },
      ],
    },
    dependencies: {
      planRevision: 1,
      contextRevision: 1,
      sourceAnchorIds: anchors.map((anchor) => anchor.anchorId),
      contextAnchorIds: [],
      methodVersion: 'test-method',
    },
    provenance: {
      authorKind: 'MODEL',
      authorUserId: '',
      executionModel: null,
      modelVersion: 'test-model',
      skillVersion: null,
      promptVersion: null,
      generationRequestRef: 'generation-test',
      originAttemptId: null,
      providerRequestId: null,
      usage: { inputTokens: null, outputTokens: null },
    },
    generatedAt: null,
    savedAt: '2026-09-09T00:00:00Z',
    check: {
      schemaVersion: 'wiselink.3_1.translation_block_check.v2',
      checkVersion: 'test-check',
      issues: [],
      semanticCheck: 'COMPLETED',
      semanticReview: null,
    },
    checkedAt: '2026-09-09T00:01:00Z',
    selectedForReading: true,
  };
  const first: TranslationWorkspaceReadingV2['blocks'][number] = {
    source: {
      blockId: 'paragraph-test',
      order: 0,
      kind: 'prose',
      moduleId: 'module-test',
      sourceUnitIds: anchors.map((anchor) => anchor.sourceUnitId),
      anchorIds: anchors.map((anchor) => anchor.anchorId),
      sourceStructure: [],
      contextBlockIds: [],
      requiredTogetherBlockIds: [],
      sourceCharacterCount: 100,
      sourceIssues: [],
      organization: 'ADJACENT_PROSE_CONTEXT',
    },
    readingStatus: 'READABLE',
    selected: revision,
    issues: [],
  };
  return {
    schemaVersion: 'wiselink.3_1.translation_workspace_reading.v2',
    workspaceId: 'workspace-test',
    rowVersion: 10,
    completeness: 'PARTIAL',
    candidateOnly: true,
    source: {
      documentVersionId: 'document-test',
      packageId: 'package-test',
      parsedArtifact: {
        storeRole: 'UnifiedArtifactStoreCandidate',
        ref: 'artifact://test',
        sha256: 'test-only',
        byteLength: 10,
        mediaType: 'application/json',
      },
    },
    coverage: {
      registeredSourceCharacters: 1000,
      savedSourceCharacters: 800,
      readableSourceCharacters: 100,
      sourceUnitCount: 5,
      unresolvedSourceUnitCount: 2,
      missingBlockCount: 1,
      pendingCheckBlockCount: 1,
      blockedBlockCount: 0,
    },
    anchors,
    blocks: [
      first,
      {
        ...first,
        source: {
          ...first.source,
          blockId: 'pending-test',
          order: 1,
          sourceCharacterCount: 700,
          anchorIds: [],
          sourceUnitIds: [],
        },
        readingStatus: 'PENDING_CHECK',
        selected: null,
      },
      {
        ...first,
        source: {
          ...first.source,
          blockId: 'missing-test',
          order: 2,
          sourceCharacterCount: 200,
          anchorIds: [],
          sourceUnitIds: [],
        },
        readingStatus: 'MISSING',
        selected: null,
      },
    ],
    finalCandidate: null,
  };
}

export function jobAidReadingFixture(): JobAidWorkingReadModel {
  return {
    schemaVersion: 'wiselink.jobaid-working-read.v2',
    enabled: true,
    workItemId: 'work-item-test',
    executionStatus: 'FAILED',
    currentInputChanged: false,
    overallStatus: 'STALE',
    overallBasedOnWorkRevisionRef: 'work-before-test',
    current: {
      workRevisionRef: 'work-current-test',
      workItemId: 'work-item-test',
      workRevision: 3,
      previousWorkRevisionRef: 'work-before-test',
      requestId: 'request-test',
      actionAttemptId: 'attempt-test',
      basedOnWorkItemRevision: 5,
      documentVersionId: 'document-test',
      createdAt: '2026-09-09T00:00:00Z',
      content: {
        schemaVersion: 'wiselink.jobaid-problem-work.v2',
        headline: '应先核实构型，再评估措施可行性',
        listBrief: '构型尚未核实；当前不是实施决定。',
        understanding: '当前依据支持继续分析，不能推定措施已经实施。',
        decisiveIssueKeys: ['issue-test'],
        roundCompletion: 'IN_PROGRESS',
        completionReason: '还需核对构型与历史记录。',
        changeSummary: '补充了适用条件。',
        unchangedExplanation: '',
        methodBinding: {
          packRef: 'method-test',
          version: 'R01',
          sources: [
            {
              sourceIdentity: 'JA-AC',
              versionLabel: 'R01',
              documentVersionId: null,
              status: 'CONFIRMED',
            },
          ],
          attachment5: 'R00_CONTENT_REPORTED_R01_LINK_UNCONFIRMED',
        },
        issues: [
          {
            issueKey: 'issue-test',
            issueRef: 'issue-ref-test',
            question: '措施是否对当前构型有效？',
            understanding: '仅当构型匹配时才有判断基础。',
            statements: [
              {
                claimId: 'claim-test',
                text: '尚未确认构型，不得认定必须实施。',
                basis: 'CONDITIONAL_INFERENCE',
                premises: [
                  {
                    evidenceRef: 'evidence-test',
                    role: 'LIMITS',
                    explanation: '原文明确限定构型。',
                    limitation: '尚未查证当前设备。',
                  },
                ],
              },
            ],
            riskScenarios: [
              {
                scenario: '使用不匹配的措施后发生失效',
                conditions: ['未按要求核实构型'],
                method: 'JA_AC_R01',
                severity: null,
                likelihood: null,
                score: null,
                riskGrade: null,
                gradeMeaning: null,
                importantEvent: null,
                limitations: ['当前没有可确认的发生频次'],
                controlComparison: '所提措施未验证，不能视为已控制风险。',
              },
            ],
            measures: [
              {
                text: '补充构型核查',
                addresses: '明确适用范围',
                limitations: ['不能替代有效性验证'],
                status: 'PROPOSED',
                basisRefs: ['evidence-test'],
              },
            ],
            otherClassifications: [
              {
                method: 'EO_ATTRIBUTE',
                value: '来源报告的 EO 分类',
                reason: '只描述文件属性，不换算风险等级。',
                basisRefs: ['evidence-test'],
              },
            ],
            openQuestions: [
              {
                question: '当前构型是什么？',
                affects: '措施是否适用',
                nextEvidence: '受控构型记录',
                reason: '来源有适用条件',
              },
            ],
            requirementHandling: [
              {
                methodRef: 'method-test',
                requirement: '来源规定应在 30 天内完成核查',
                conditions: ['仅对构型 A'],
                treatment: 'CONDITIONS_UNCONFIRMED',
                basisRefs: ['evidence-test'],
                explanation: '条件未确认；不得把期限扩展到其他构型。',
              },
            ],
            sourceDependencies: ['evidence-test'],
            premiseRefs: [],
          },
        ],
        evidence: [
          {
            evidenceRef: 'evidence-test',
            kind: 'DOCUMENT_PASSAGE',
            title: '原文适用条件',
            versionLabel: '修订 1',
            excerpt: '仅适用于构型 A。',
            workItemId: 'work-item-test',
            documentVersionId: 'document-test',
            sourceRefId: 'source-ref-test',
            locator: '第 3 页',
          },
        ],
        readSourceRefs: ['source-ref-test'],
        capabilities: [
          {
            capability: 'history',
            status: 'PARTIAL',
            impact: '只覆盖当前可见历史记录。',
          },
        ],
        historyReview: {
          required: true,
          priorAssessmentRefs: [],
          engineeringDocumentRefs: [],
          coverage: 'PARTIAL',
          limitation: '可见历史范围有限。',
        },
      },
    },
  };
}
