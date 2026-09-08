import { currentRouteWorkItemId } from '../../client/src/app/providers/CurrentObjectContextProvider';
import {
  countQuicklookDerivedArtifacts,
  buildLibraryEngineeringQuicklook,
  buildLibraryObjectContext,
  quicklookMarkdown,
  type EngineeringQuicklookView,
} from '../../client/src/features/navigation/contextual-navigation';
import type {
  CanonicalRelatedDocumentRelation,
  CanonicalRelatedDocumentRelationRole,
} from '../../shared/api.interface';
import {
  libraryDocument,
  libraryQuicklook,
  libraryStatement,
} from './fixtures/canonical-library';

describe('R05.9 contextual navigation', () => {
  it('publishes registered identity and review routes without asserting a successful source read', () => {
    const document = {
      ...libraryDocument('WI-737/34'),
      selectedVersionIsCurrent: false,
    };
    const context = buildLibraryObjectContext(document, 'DOCUMENT');
    expect(context.routeWorkItemId).toBe('WI-737/34');
    expect(context.displayCode).toBe('737-34-3830');
    expect(context.statusLabel).toBe('历史登记版本 · 原文未核验');
    expect(context.routes.review).toBe(
      '/work-items/WI-737%2F34/documents?node=review&tab=review',
    );
    expect(context.routes.family).toBe(
      '/work-items/WI-737%2F34/documents?node=document&tab=source',
    );
  });

  it('maps saved engineering statements, source links, and gaps independently of original-file readability', () => {
    const quicklook = buildLibraryEngineeringQuicklook(
      libraryQuicklook('WI-SAVED'),
    );
    expect(quicklook).toMatchObject({
      authorityLabel: '已保存候选意见',
      freshnessLabel: '原文未在本次核验',
      currentJudgment: '需结合当前构型评估维修计划。',
      applicabilitySummary: '适用于资料列出的构型。 当前机队匹配尚待核对。',
      recommendedActions: ['核对飞机号与部件号。'],
      sourceCount: 3,
      derivedArtifactCount: null,
    });
    expect(quicklook.resultIdentity).toEqual({
      resultRef: 'result-2',
      revision: 2,
      workItemId: 'WI-SAVED',
      documentVersionId: 'DV-WI-SAVED',
    });
    expect(quicklook.keyEvidence[0]).toEqual({
      label: '需结合当前构型评估维修计划。',
      sourceRefIds: ['source-1'],
    });
    expect(quicklook.unresolvedQuestions).toEqual([
      '尚需当前机队构型',
      '尚需当前机队构型',
    ]);
    const markdown = quicklookMarkdown('737-34-3830', quicklook);
    expect(markdown).toContain('本次未读取原文或解析包');
    expect(markdown).not.toContain('source-1');
    expect(markdown).not.toContain('当前有效');
  });

  it('keeps staleness and the stored plain candidate when an older saved result has no engineeringSummary', () => {
    const response = libraryQuicklook('WI-STALE');
    if (!response.result) throw new Error('fixture result missing');
    response.result = {
      ...response.result,
      engineeringSummary: null,
      status: 'STALE',
      staleReason: 'ENGINEER_REVIEW_CHANGED',
      gap: '仍需核对维修窗口',
    };
    const quicklook = buildLibraryEngineeringQuicklook(response);
    expect(quicklook.currentJudgment).toBe('既有候选意见');
    expect(quicklook.freshnessLabel).toBe('结论需更新');
    expect(quicklook.unresolvedQuestions).toEqual([
      '尚需当前机队构型',
      '仍需核对维修窗口',
      '工程师复核已更新',
    ]);
    expect(quicklook.keyEvidence).toEqual([]);
  });

  it('does not invent a saved candidate or derived count from a registered package', () => {
    const response = { ...libraryQuicklook('WI-NO-RESULT'), result: null };
    const quicklook = buildLibraryEngineeringQuicklook(response);
    expect(response.document.packageRegistered).toBe(true);
    expect(quicklook.authorityLabel).toBe('尚无候选意见');
    expect(quicklook.currentJudgment).toContain('尚无已保存的工程摘要');
    expect(quicklook.sourceCount).toBeUndefined();
    expect(quicklook.derivedArtifactCount).toBeNull();
  });

  it('preserves different claims sharing a premise and every source reference', () => {
    const response = libraryQuicklook('WI-EVIDENCE');
    if (!response.result?.engineeringSummary)
      throw new Error('fixture summary missing');
    response.result.engineeringSummary.implementationImpact = [
      libraryStatement('同一来源的影响说明', ['source-1', 'source-3']),
    ];
    expect(
      buildLibraryEngineeringQuicklook(response).keyEvidence.filter((item) =>
        item.sourceRefIds.includes('source-1'),
      ),
    ).toEqual([
      { label: '需结合当前构型评估维修计划。', sourceRefIds: ['source-1'] },
      { label: '同一来源的影响说明', sourceRefIds: ['source-1', 'source-3'] },
    ]);
  });

  it('restores the current object identity from workbench and library preview routes', () => {
    expect(
      currentRouteWorkItemId(
        '/work-items/WI-737%2F34/documents',
        '?node=reader',
      ),
    ).toBe('WI-737/34');
    expect(
      currentRouteWorkItemId(
        '/library',
        '?mode=document&workItemId=WI-737-34-3830',
      ),
    ).toBe('WI-737-34-3830');
    expect(currentRouteWorkItemId('/library', '?mode=matter')).toBe('');
    expect(
      currentRouteWorkItemId('/external-discovery', '?workItemId=WI-X'),
    ).toBe('');
  });

  it('copies an engineering-facing quicklook without transport identifiers', () => {
    const quicklook: EngineeringQuicklookView = {
      readingResult: null,
      resultIdentity: null,
      authorityLabel: '候选意见',
      freshnessLabel: '当前有效',
      currentJudgment: '当前资料支持继续执行计划维修。',
      applicabilitySummary: '适用于受控清单内飞机。',
      whyItMatters: '旧构型可能触发空中重启。',
      keyEvidence: [
        {
          label: '原文说明需要更换旧构型部件。',
          sourceRefIds: ['urn:internal:source-ref'],
        },
      ],
      unresolvedQuestions: ['还需核对当前机队构型。'],
      recommendedActions: ['核对飞机号与部件号。'],
      sourceCount: 1,
      currentVersionLabel: 'Original Issue',
      derivedArtifactCount: 3,
    };

    const markdown = quicklookMarkdown('737-34-3830', quicklook);

    expect(markdown).toContain('当前资料支持继续执行计划维修');
    expect(markdown).toContain('还需核对当前机队构型');
    expect(markdown).toContain('内容仅用于工程辅助，不代表批准或放行');
    expect(markdown).not.toContain('urn:internal:source-ref');
    expect(markdown).not.toContain('workItemId');
  });

  it('excludes current-version and reader edges from derived artifacts', () => {
    const roles: CanonicalRelatedDocumentRelationRole[] = [
      'SELECTED_DOCUMENT_VERSION',
      'PRODUCED_PARSED_PACKAGE',
      'HAS_READER_RESULTS',
      'HAS_DYNAMIC_EVALUATION',
      'HAS_OVERALL_SYNTHESIS',
    ];
    const relations: CanonicalRelatedDocumentRelation[] = roles.map(
      (relationRole: CanonicalRelatedDocumentRelationRole, index: number) => ({
        id: `relation-${index}`,
        fromNodeId: `from-${index}`,
        toNodeId: `to-${index}`,
        relationRole,
        label: relationRole,
        sourceLocator: `source-${index}`,
        resolution: 'RESOLVED',
        authority:
          relationRole === 'SELECTED_DOCUMENT_VERSION'
            ? 'EXPLICIT_WORKITEM_BINDING'
            : 'DERIVED_FROM_CURRENT_PROJECTION',
      }),
    );

    expect(countQuicklookDerivedArtifacts(relations)).toBe(3);
  });
});
