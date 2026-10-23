import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import {
  JOBAID_PROBLEM_WORK_SCHEMA,
  jobAidReadingResult,
} from '@shared/jobaid-problem-assessment.interface';
import { collectEvidenceUses } from '@shared/jobaid-evidence-uses';
import {
  JOBAID_METHOD_BINDING,
  JOBAID_METHOD_EVIDENCE,
} from '@server/modules/canonical-host/jobaid-method-pack';
import { materializeJobAidWork } from '@server/modules/canonical-host/jobaid-problem-work';
import { materializeMatterJobAidCommand } from '@server/modules/canonical-host/matter-jobaid-save';
import {
  materializeEngineeringMatterWorkingState,
  parseEngineeringMatterWorkingState,
} from '@server/modules/canonical-host/engineering-matter-working-state';
import {
  overallModelEvidenceRegistry,
  readStoredOverallEvidence,
} from '@server/modules/canonical-host/overall-assessment-reading';

type MethodEvidence = Extract<AssessmentEvidence, { kind: 'METHOD_CLAUSE' }>;
const method = JOBAID_METHOD_EVIDENCE.find(
  (item: AssessmentEvidence): item is MethodEvidence =>
    item.kind === 'METHOD_CLAUSE' && item.evidenceRef === 'method:severity-definitions',
)!;
const source: AssessmentEvidence = {
  kind: 'DOCUMENT_PASSAGE', evidenceRef: 'DOCUMENT_ORIGINAL:DV-synthetic:PR-synthetic:consequence',
  documentVersionId: 'DV-synthetic', workItemId: null, sourceRefId: 'consequence',
  locator: 'synthetic page 1', title: 'Synthetic consequence and exposure report', versionLabel: 'synthetic R1',
  excerpt: '',
};
const history = {
  required: false, priorAssessmentRefs: [], engineeringDocumentRefs: [],
  coverage: 'NOT_REQUIRED' as const, limitation: null,
};
const cases: Array<[string, string, number, number]> = [
  ['轻微', '合成失效仅轻微降低安全裕度，机组在其能力范围内能够正常完成飞行操作。', 21, 2],
  ['重要', '合成失效显著降低安全裕度，增加机组工作负担并影响工作效率。', 35, 3],
  ['严重', '合成失效导致乘客受伤，未发生所列六类重要事件。', 49, 4],
  ['灾难', '合成失效影响安全飞行和安全落地，可导致机组和乘客人员伤亡及飞机损伤。', 70, 5],
];

function fixture(label: string, consequence: string) {
  const definition = method.classificationDefinitions!.find(
    (item: NonNullable<MethodEvidence['classificationDefinitions']>[number]) => item.label === label,
  )!;
  const business: AssessmentEvidence = {
    ...source,
    excerpt: `${consequence} 合成暴露记录表明单机不太可能发生，但机队可发生多次。`,
  };
  const evidence: AssessmentEvidence[] = [business, ...structuredClone(JOBAID_METHOD_EVIDENCE)];
  const body = `${consequence} 单机和机队暴露对应不大可能。`;
  const raw = {
    schemaVersion: JOBAID_PROBLEM_WORK_SCHEMA, headline: `合成${label}后果`,
    listBrief: consequence, overview: body,
    roundCompletion: 'COMPLETE', completionReason: '已用合成后果及暴露材料对应定义。',
    changeSummary: '保存合成方法匹配，不代表真实工程判断。',
    issues: [{
      issueKey: 'synthetic-consequence', question: '合成后果如何对应严重性定义？',
      body: `${body} [[${business.evidenceRef}]] [[method:severity-definitions]] [[method:risk]]`,
      riskScenarios: [{
        scenario: consequence, method: 'JA_AC_R01', conditions: ['仅合成情景'],
        severity: {
          label, reason: `${consequence} 对应所引定义。`, basisRefs: [business.evidenceRef],
          definitionMatch: { methodRef: method.evidenceRef, definitionQuote: definition.definitionQuote },
        },
        likelihood: {
          label: '不大可能', reason: '合成暴露记录与单机及机队两部分定义对应。',
          basisRefs: [business.evidenceRef], definitionMatch: {
            methodRef: 'method:risk', definitionQuote: '单机不太可能但机队可多次',
          },
        },
        limitations: ['仅检验方法上下文与保存链，不使用真实业务材料。'],
        controlComparison: '尚未提出或实施控制，不据此降低风险。',
      }],
      requirementHandling: [method.evidenceRef, 'method:risk'].map((methodRef: string) => ({
        methodRef, requirement: '实际后果及暴露对应已交付定义', conditions: ['仅合成情景'],
        treatment: 'ADDRESSED', bodyQuote: body, basisRefs: [business.evidenceRef],
        explanation: '正文说明合成后果及暴露与定义的对应关系。',
      })),
      openQuestions: [],
    }],
  };
  const context = {
    matterId: 'MAT-synthetic', previous: null, contentValidationVersion: 'jobaid-semantic.v1' as const,
    methodBinding: JOBAID_METHOD_BINDING, evidence,
    readSourceRefs: evidence.map((item: AssessmentEvidence) => item.evidenceRef),
    capabilities: [], history,
  };
  return { raw, context };
}

describe('generic JA-AC severity definitions with synthetic consequences', () => {
  test.each(cases)('%s saves its definition match and preserves the saved reading and Overall registry',
    (label: string, consequence: string, score: number, riskGrade: number) => {
      const f = fixture(label, consequence);
      const validated = materializeJobAidWork(f.raw, f.context);
      const command = materializeMatterJobAidCommand({
        ...f.context, matterRevisionId: 'MR-synthetic', attemptRef: 'AQ-synthetic',
        requestId: 'REQ-synthetic', expectedWorkRevision: 0,
        inputs: [{
          kind: 'DOCUMENT_VERSION', inputId: 'I-synthetic', familyId: 'F-synthetic',
          workItemId: null, workItemRevision: null, resultRef: null, resultRevision: null,
          documentVersionId: 'DV-synthetic', original: {
            parseRunId: 'PR-synthetic', parseRevision: 1,
            semantic: { revision: 1, profileRef: 'synthetic' },
          },
        }],
        proposal: f.raw,
      });
      const state = materializeEngineeringMatterWorkingState({
        matterId: 'MAT-synthetic', current: null, command,
      }).state;
      const saved = parseEngineeringMatterWorkingState(JSON.stringify(state), 'MAT-synthetic').problemWork!;
      expect(saved.issues).toEqual(validated.issues);
      expect(saved.issues[0].riskScenarios[0]).toMatchObject({ score, riskGrade, importantEvent: null });
      expect(collectEvidenceUses(saved)).toContainEqual(expect.objectContaining({
        evidenceRef: method.evidenceRef, role: 'METHOD',
      }));
      const reading = jobAidReadingResult({
        workRevisionRef: 'WR-synthetic', workItemId: 'WI-synthetic', workRevision: 1,
        previousWorkRevisionRef: null, requestId: 'REQ-synthetic', actionAttemptId: 'AQ-synthetic',
        basedOnWorkItemRevision: 1, documentVersionId: 'DV-synthetic',
        createdAt: '2026-10-23T00:00:00Z', content: saved,
      });
      const retained = readStoredOverallEvidence(JSON.parse(JSON.stringify(reading.evidence)));
      const registry = overallModelEvidenceRegistry(retained);
      expect(retained.find((item: AssessmentEvidence) => item.evidenceRef === method.evidenceRef)).toEqual(method);
      expect(registry.find((item) => item.evidenceRef === method.evidenceRef)?.classificationDefinitions)
        .toEqual(method.classificationDefinitions);
      expect(reading.content.issueArticles?.[0].body).toBe(saved.issues[0].body);
      expect(saved.issues[0].requirementHandling).toEqual(validated.issues[0].requirementHandling);
      expect(saved.methodBinding.sources.find((item) => item.sourceIdentity === 'JA-AC'))
        .toMatchObject({ documentVersionId: null, status: 'VERSION_UNCONFIRMED' });
    });

  test('a delivered definition does not supply the missing business consequence', () => {
    const f = fixture('严重', cases[2][1]);
    f.raw.issues[0].riskScenarios[0].severity.basisRefs = [method.evidenceRef];
    expect(() => materializeJobAidWork(f.raw, f.context)).toThrow('SEVERITY_BUSINESS_BASIS_REQUIRED');
  });

  test('a catalog entry alone is not a delivered definition', () => {
    const f = fixture('轻微', cases[0][1]);
    f.context.readSourceRefs = f.context.readSourceRefs.filter((ref: string) => ref !== method.evidenceRef);
    expect(() => materializeJobAidWork(f.raw, f.context)).toThrow('SOURCE_NOT_DELIVERED');
  });

  test('absent consequence and exposure facts retain unknown dimensions despite the available definitions', () => {
    const evidence: AssessmentEvidence[] = structuredClone(JOBAID_METHOD_EVIDENCE);
    const work = materializeJobAidWork({
      schemaVersion: JOBAID_PROBLEM_WORK_SCHEMA, headline: '合成后果资料缺失', listBrief: '后果和暴露仍未知。',
      roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS', completionReason: '定义已取得，业务事实待补。',
      changeSummary: '保留后果与暴露缺口。', issues: [{
        issueKey: 'missing-consequence', question: '失效的实际后果为何？',
        body: '方法给出四级定义，但未取得实际后果及暴露记录。 [[method:severity-definitions]]',
        riskScenarios: [{ scenario: '实际后果未确认', method: 'JA_AC_R01', severity: null, likelihood: null,
          conditions: [], limitations: ['缺实际后果和暴露事实'], controlComparison: '控制效果未知。' }],
        requirementHandling: [{ methodRef: method.evidenceRef, requirement: '实际后果对应定义', conditions: [],
          treatment: 'CONDITIONS_UNCONFIRMED', bodyQuote: '未取得实际后果及暴露记录。', basisRefs: [],
          explanation: '方法条款不能代替业务事实。' }],
        openQuestions: [{ question: '实际后果及暴露如何？', affects: '两维分类及风险等级',
          nextEvidence: '功能、失效后果及暴露记录', reason: '业务资料未取得。' }],
      }],
    }, { ...fixture('轻微', cases[0][1]).context, evidence,
      readSourceRefs: evidence.map((item: AssessmentEvidence) => item.evidenceRef) });
    expect(work.issues[0].riskScenarios[0]).toMatchObject({
      severity: null, likelihood: null, score: null, riskGrade: null,
    });
  });
});
