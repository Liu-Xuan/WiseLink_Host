import { canonicalJson } from '../../../server/modules/action-attempt/action-attempt-envelope';
import type { JobAidProgramMaterialsRead } from '@shared/jobaid-problem-assessment.interface';

export function programMaterialsFixture(
  workItemId = 'WI-material',
  attemptId = 'ATT-material',
  content = '准确旧版条款：除非构型已确认，否则不得认定适用。\n表格：件号 | 单位 | 期限\nA-1 | 次 | 90日\n脚注：不包含已按例外批准的对象。',
): JobAidProgramMaterialsRead {
  const modelInput = {
    taskAndScope: {
      question: '核对当前文件的条件与措施',
      primaryDocument: {
        documentCode: 'SYNTHETIC-AD',
        documentVersionId: 'DV-historic',
        businessRevision: 'R-old',
      },
    },
    continuousOriginal: {
      binding: {
        documentVersionId: 'DV-historic',
        parseRunId: 'PR-historic',
        parseRevision: 4,
      },
      content,
      spans: [
        {
          start: 0,
          end: content.length,
          sourceRefIds: ['source-historic'],
          evidenceRefs: ['DOCUMENT_ORIGINAL:historic'],
        },
      ],
      coverage: { status: 'COMPLETE' },
    },
    objectAndCompanyFacts: {
      evidence: [
        { title: '当时已取得的公司意见', excerpt: '批准意见限定于构型A。' },
      ],
    },
    relevantMethods: {
      methodBinding: { version: 'METHOD-R1' },
      evidence: [
        { title: '本轮相关方法', excerpt: '核对成立条件与例外，不推测频率。' },
      ],
    },
    previousUnderstandingAndChanges: {
      previousWork: {
        workRevision: 3,
        content: { understanding: '旧工作已保留，当前安装件号待核。' },
      },
      discussion: ['补充核对该期限。'],
    },
  };
  return {
    schemaVersion: 'wiselink.program-assessment-materials-read.v1',
    workItemId,
    attemptId,
    attemptRef: `AQ-${attemptId}`,
    executionMode: 'PROGRAM_CONTROLLED_V1',
    executionModel: {
      modelRef: 'miaoda/glm-5.3',
      displayName: 'GLM 5.3',
      providerKind: 'BUILT_IN',
      settingsRevision: 0,
      selectedAt: '2026-10-24T00:00:00Z',
    },
    preparedAt: '2026-10-24T00:01:00Z',
    submissionEvidence: 'PREPARED_NOT_CONFIRMED_SENT',
    snapshot: {
      materials: {
        version: 1,
        originalInput: { latestText: 'LATEST_MUST_NOT_REPLACE_HISTORIC_INPUT' },
        modelInput,
        sourceReads: [],
        previousWorkRead: null,
        deliveredEvidenceRefs: ['DOCUMENT_ORIGINAL:historic'],
      },
      modelRequest: {
        version: 1,
        body: JSON.stringify({
          model: 'openclaw/fixture',
          messages: [
            { role: 'system', content: 'Synthetic fixed-step instruction' },
            { role: 'user', content: JSON.stringify(modelInput) },
          ],
          stream: false,
        }),
        executionModel: { modelRef: 'miaoda/glm-5.3' },
        materialCheckpoint: 'program-materials',
      },
    },
  };
}

/** Synthetic v2 snapshot: its directory is not a model source-read receipt. */
export function programAgentMaterialsFixture(): JobAidProgramMaterialsRead {
  const read = programMaterialsFixture();
  const binding = {documentVersionId: 'DV-historic', parseRunId: 'PR-historic', parseRevision: 4,
    sourceArtifactId: 'ART-historic', sourceSha256: 'a'.repeat(64), sourceByteLength: 123};
  const originalInput = {executionMode: 'PROGRAM_AGENT_V1', previousWork: null,
    programOriginal: {binding, units: [{unitId: 'u1', kind: 'paragraph', sourceRefIds: ['SR-historic'],
      payload: {text: '私有原文完整保留：例外条件尚未核实。'}}], sourceLocators: [{sourceRefId: 'SR-historic'}],
      coverage: {knownPageCount: 1, readPageIndexes: [0], unresolvedRanges: []}, findings: []},
    availableSources: [{ref: 'DOCUMENT_ORIGINAL:DV-historic:PR-historic:SR-historic', kind: 'DOCUMENT_PASSAGE',
      versionLabel: 'PR-historic', locator: 'page 1'}], deliveredEvidence: []};
  const directory = {schemaVersion: 'wiselink.program-agent-directory.v1', originalBinding: binding,
    sources: originalInput.availableSources, originalUnits: [{unitId: 'u1', sourceRefIds: ['SR-historic']}],
    previousWorkRevisionRef: null};
  const executionModel = {...read.executionModel, schemaVersion: 'wiselink.3_1.execution_model_selection.v2' as const,
    maxOutputTokens: 131072, settingsRevision: 4};
  const agentPolicy = {schemaVersion: 'wiselink.program-agent-policy.v1', maxModelRequests: null,
    maxOutputTokens: 131072, maxToolCalls: null, timeoutSeconds: 3600};
  return {...read, executionMode: 'PROGRAM_AGENT_V1', executionModel, snapshot: {
    materials: {version: 2, originalInput, directory, previousWorkRead: null,
      modelInput: {previousUnderstandingAndChanges: {previousWork: null}}, deliveredEvidenceRefs: []},
    modelRequest: {version: 2, executionModel, materialCheckpoint: 'program-agent-materials', agentPolicy,
      body: JSON.stringify({messages: [{role: 'system', content: 'Synthetic read-only tools'},
        {role: 'user', content: canonicalJson(directory)}]})},
  }};
}
