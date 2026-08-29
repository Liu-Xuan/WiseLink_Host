import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { CanonicalDocumentParsingPageResponse } from '@shared/api.interface';

jest.mock(
  '../../client/src/features/workitem/workitem-overview.css',
  () => ({}),
  { virtual: true },
);
jest.mock(
  '@client/src/services/viewModelMappers',
  () => jest.requireActual('../../client/src/services/viewModelMappers'),
  { virtual: true },
);

import OverallAssessmentHero from '../../client/src/features/workitem/OverallAssessmentHero';
import { toWorkItemView } from '../../client/src/services/viewModelMappers';

const SOURCE_REF = 'urn:techpub:source-ref:v1:sha256:source-bound-current';

describe('OverallAssessmentHero user-visible technical details', () => {
  it('renders engineering semantics without internal ids, enums, runtime names, or revisions', () => {
    const html = renderToStaticMarkup(
      createElement(OverallAssessmentHero, {
        view: toWorkItemView(pageWithInternalTransportDetails()),
        onOpenWorkbench: () => undefined,
        onViewEvidence: () => undefined,
      }),
    );
    const upperHtml = html.toUpperCase();

    expect(html).toContain('工程结论');
    expect(html).toContain('ORIGINAL ISSUE');
    expect(html).toContain('当前有效');
    expect(html).toContain('150/150');
    expect(html).toContain('原文依据 / 待补事实');
    expect(html).toContain('1 条 / 1 项');

    expect(upperHtml).not.toContain('WI-INTERNAL');
    expect(upperHtml).not.toContain('DOCUMENT_VERSION_');
    expect(upperHtml).not.toContain('CANDIDATE_ONLY');
    expect(upperHtml).not.toContain('OPENCLAW');
    expect(upperHtml).not.toContain('GPT-5.6-SOL');
    expect(html).not.toContain('987654321');
    expect(html).not.toContain('876543210');
    expect(html).not.toContain(SOURCE_REF);
  });

  it('uses a neutral label instead of falling back to a DocumentVersion id', () => {
    const html = renderToStaticMarkup(
      createElement(OverallAssessmentHero, {
        view: toWorkItemView(pageWithInternalTransportDetails(null)),
        onOpenWorkbench: () => undefined,
      }),
    );

    expect(html).toContain('版本未标注');
    expect(html.toUpperCase()).not.toContain('DOCUMENT_VERSION_');
  });

  it('turns the structure-missing CTA into a real regeneration action', () => {
    const page = pageWithInternalTransportDetails();
    if (page.workItem.integratedAssessment?.overallSynthesis) {
      page.workItem.integratedAssessment.overallSynthesis.engineeringSummary =
        undefined;
    }
    const html = renderToStaticMarkup(
      createElement(OverallAssessmentHero, {
        view: toWorkItemView(page),
        onOpenWorkbench: () => undefined,
        regeneration: {
          label: '重新生成工程摘要',
          message: '正在结合当前原文依据生成工程摘要…',
          tone: 'progress',
          busy: true,
          disabled: true,
          retryMode: 'none',
          run: () => undefined,
        },
      }),
    );

    expect(html).toContain('重新生成工程摘要');
    expect(html).toContain('正在结合当前原文依据生成工程摘要');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('查看详情并重新生成');
  });
});

function pageWithInternalTransportDetails(
  businessRevision: string | null = 'ORIGINAL ISSUE',
): CanonicalDocumentParsingPageResponse {
  const statement = (text: string, basis = 'SOURCE_FACT') => ({
    text,
    basis,
    sourceRefIds: [SOURCE_REF],
  });

  return {
    workItem: {
      workItemId: 'WI-INTERNAL-737',
      requestId: 'OPENCLAW-INTERNAL-REQUEST',
      revision: 987654321,
      source: {
        documentId: 'internal-document',
        documentVersionId: 'document_version_internal_secret',
      },
      classification: {
        parserProfileId: 'issuer.boeing.controlled-document',
        normalizedFamily: 'BOEING 737',
      },
      package: {
        title: '737-34-3830',
        documentIdentity: {
          documentCode: '737-34-3830',
          ...(businessRevision ? { businessRevision } : {}),
        },
      },
      translation: {
        translatedUnitCount: 150,
        sourceUnitCount: 150,
      },
      integratedAssessment: {
        baseRules: {
          evaluationItemCount: 150,
          criterionCount: 150,
        },
        overallSynthesis: {
          status: 'CANDIDATE_ONLY',
          authorityLevel: 'candidate_only',
          revision: 876543210,
          staleReason: null,
          findingCount: 4,
          unresolvedCount: 1,
          modelVersion: 'gpt-5.6-sol',
          promptVersion: 'OPENCLAW-R09',
          skillVersion: 'wiselink-openclaw-r09',
          engineeringSummary: {
            schemaVersion: 'wiselink.3_1.overall_engineering_summary.v1',
            conclusion: statement(
              '更换两台旧构型 FMC 并完成 operational test。',
            ),
            whyItMatters: [statement('旧 SRAM 多位错误会触发空中重启。')],
            applicability: {
              sourceScope: statement('适用于源文件 effectivity 清单内飞机。'),
              fleetMatch: statement(
                '当前机队尚待匹配。',
                'CONDITIONAL_INFERENCE',
              ),
              requiredFacts: [
                statement(
                  '核对 Variable/Line Number。',
                  'CONDITIONAL_INFERENCE',
                ),
              ],
            },
            implementationImpact: [statement('实施前确认 ONS OS 9.1。')],
            dispositionPriority: [statement('按可靠性改进安排计划维修。')],
            nextActions: [
              statement('批量核对 Variable/Line Number 与 FMC P/N。'),
            ],
          },
        },
        overallForAeoConfirmation: null,
      },
    },
    timeline: { events: [] },
  } as unknown as CanonicalDocumentParsingPageResponse;
}
