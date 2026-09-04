import { currentRouteWorkItemId } from '../../client/src/app/providers/CurrentObjectContextProvider';
import {
  countQuicklookDerivedArtifacts,
  quicklookMarkdown,
  type EngineeringQuicklookView,
} from '../../client/src/features/navigation/contextual-navigation';
import type {
  CanonicalRelatedDocumentRelation,
  CanonicalRelatedDocumentRelationRole,
} from '../../shared/api.interface';

describe('R05.9 contextual navigation', () => {
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
      authorityLabel: '候选意见',
      freshnessLabel: '当前有效',
      currentJudgment: '当前资料支持继续执行计划维修。',
      applicabilitySummary: '适用于受控清单内飞机。',
      whyItMatters: '旧构型可能触发空中重启。',
      keyEvidence: [
        {
          label: '原文说明需要更换旧构型部件。',
          sourceRefId: 'urn:internal:source-ref',
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
