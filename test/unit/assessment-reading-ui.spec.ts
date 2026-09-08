import { Children, createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type {
  AssessmentClaimEvidenceReadModel,
  AssessmentEvidence,
  AssessmentReadingResult,
} from '@shared/assessment-reading.interface';

jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }), {
  virtual: true,
});

import AssessmentEvidenceContext from '../../client/src/features/matter/AssessmentEvidenceContext';
import AssessmentReadingBrief from '../../client/src/features/matter/AssessmentReadingBrief';
import {
  assessmentClaimGroups,
  validateAssessmentClaimReadback,
  type AssessmentClaimSelection,
} from '../../client/src/features/matter/assessment-reading';

const documentEvidence: AssessmentEvidence = {
  evidenceRef: 'host-document-binding-2',
  kind: 'DOCUMENT_PASSAGE',
  title: '相关文档的适用范围',
  versionLabel: '修订 2',
  excerpt: '仅适用于构型 B。',
  workItemId: 'member-work-item-2',
  documentVersionId: 'member-document-version-2',
  sourceRefId: 'member-original-source-ref',
  locator: '适用范围，第 3 段',
};

const result: AssessmentReadingResult = {
  resultRef: 'saved-matter-result',
  resultRevision: 4,
  scope: { kind: 'ENGINEERING_MATTER', matterId: 'matter-1' },
  candidateOnly: true,
  content: {
    schemaVersion: 'wiselink.3_1.assessment_reading.v1',
    headline: '值得继续核查，尚无实施决定',
    listBrief: '已确认故障机理；构型是否匹配仍待核实，不可据此认定必须实施。',
    lead: '当前材料支持继续核对构型，不代表已批准实施。',
    decisiveClaimIds: ['condition'],
    claims: [
      {
        claimId: 'mechanism',
        text: '故障机理已在来源中描述。',
        basis: 'SOURCE_FACT',
        premises: [
          {
            evidenceRef: documentEvidence.evidenceRef,
            role: 'SUPPORTS',
            explanation: '来源明确描述故障机理。',
            limitation: null,
          },
        ],
      },
      {
        claimId: 'condition',
        text: '尚未确认构型匹配；不得将此判断理解为实施决定。',
        basis: 'CONDITIONAL_INFERENCE',
        premises: [
          {
            evidenceRef: documentEvidence.evidenceRef,
            role: 'LIMITS',
            explanation: '该段限定适用构型。',
            limitation: '仅覆盖构型 B。',
          },
          {
            evidenceRef: 'query-1',
            role: 'CONTEXT',
            explanation: '只核对了当前可见构型记录。',
            limitation: '未覆盖其他机队记录。',
          },
        ],
      },
    ],
  },
  evidence: [
    documentEvidence,
    {
      evidenceRef: 'query-1',
      kind: 'QUERY_RECEIPT',
      title: '当前可见构型核查',
      versionLabel: null,
      excerpt: '所查范围未命中。',
      receiptRef: 'receipt-1',
      checkedScope: '机队 A 的当前可见构型记录',
      queriedAt: '2026-09-08T02:00:00Z',
      coverage: 'PARTIAL',
    },
  ],
};

describe('saved assessment reading UI', () => {
  it('uses the same saved identity and unchanged text at all reading depths', () => {
    for (const depth of ['list', 'brief', 'full'] as const) {
      const html: string = renderToStaticMarkup(
        createElement(AssessmentReadingBrief, { result, depth }),
      );
      expect(html).toContain('data-result-ref="saved-matter-result"');
      expect(html).toContain('data-result-revision="4"');
      expect(html).toContain(result.content.headline);
      expect(html).toContain(
        depth === 'list' ? result.content.listBrief : result.content.lead,
      );
    }
  });

  it('keeps decisive negations outside collapsed details and preserves shared-carrier claims', () => {
    const groups = assessmentClaimGroups(result);
    expect(groups.decisive.map((claim) => claim.claimId)).toEqual([
      'condition',
    ]);
    expect(groups.supporting.map((claim) => claim.claimId)).toEqual([
      'mechanism',
    ]);
    const html: string = renderToStaticMarkup(
      createElement(AssessmentReadingBrief, { result }),
    );
    expect(html.indexOf(result.content.claims[1].text)).toBeLessThan(
      html.indexOf('<details'),
    );
    expect(html).toContain('核对 2 项前提');
    expect(html).toContain(result.content.claims[0].text);
  });

  it('rejects different results, revisions, claims and incomplete premise reads', () => {
    const selection: AssessmentClaimSelection = {
      resultRef: result.resultRef,
      resultRevision: 4,
      claimId: 'condition',
    };
    const readback: AssessmentClaimEvidenceReadModel = {
      resultRef: result.resultRef,
      resultRevision: 4,
      claim: result.content.claims[1],
      evidence: result.evidence,
    };
    expect(() =>
      validateAssessmentClaimReadback(selection, readback),
    ).not.toThrow();
    for (const other of [
      { ...readback, resultRef: 'unrelated-result' },
      { ...readback, resultRevision: 5 },
      { ...readback, claim: result.content.claims[0] },
    ])
      expect(() => validateAssessmentClaimReadback(selection, other)).toThrow(
        '版本不一致',
      );
    expect(() =>
      validateAssessmentClaimReadback(selection, {
        ...readback,
        evidence: [documentEvidence],
      }),
    ).toThrow('部分前提未能读回');
  });

  it('shows actual query scope and its limitation without inventing a document link', () => {
    const html: string = renderToStaticMarkup(
      createElement(AssessmentEvidenceContext, {
        evidence: result.evidence[1],
        onLocateDocument: jest.fn(),
      }),
    );
    expect(html).toContain('机队 A 的当前可见构型记录');
    expect(html).toContain('仅部分核查');
    expect(html).toContain('不代表其他范围不存在');
    expect(html).not.toContain('前往这份文档的原文');
  });

  it('navigates with the original member WorkItem, version and SourceRef together', () => {
    const onLocateDocument = jest.fn();
    const element = createElement(AssessmentEvidenceContext, {
      evidence: documentEvidence,
      onLocateDocument,
    });
    const rendered = AssessmentEvidenceContext(element.props);
    const visit = (node: ReactNode): void => {
      if (!isValidElement<{ onClick?: () => void; children?: ReactNode }>(node))
        return;
      if (node.props.onClick) node.props.onClick();
      Children.forEach(node.props.children, visit);
    };
    visit(rendered as ReactNode);
    expect(onLocateDocument).toHaveBeenCalledWith(documentEvidence);
  });
});
