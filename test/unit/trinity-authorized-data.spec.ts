import { projectAuthorizedSituation } from '../../client/src/features/trinity/trinity-authorized-data';
import { situationMetrics, stageLabel } from '../../client/src/features/trinity/trinity-model';
import { libraryMatterFixture } from './fixtures/library-matter';
import type { EngineeringMatterWorkspaceRead } from '../../client/src/api/engineering-matter';
import type {
  EngineeringMatterCatalogEntry,
  EngineeringMatterDirectoryResponse,
} from '@shared/api.interface';

const row: EngineeringMatterDirectoryResponse['items'][number] = {
  matterId: 'matter-1', title: '授权事项', primaryWorkItemId: null,
  createdAt: '2026-09-16T00:00:00Z', updatedAt: '2026-09-16T08:00:00Z',
  currentMatterRevisionId: 'membership-2', workingRevision: 9,
  result: { resultRef: 'result-8', resultRevision: 8, headline: '旧综合标题', listBrief: '已保存综合摘要', decisiveClaims: [], roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS' },
};

describe('authorized Trinity projection', () => {
  it('keeps directory pagination, fleet, event time and lifecycle unknown', () => {
    const { data } = projectAuthorizedSituation([row, row], 'complete');
    expect(data.matters).toHaveLength(1);
    expect(data.matters[0].activeAssessmentStages).toEqual(['synthesis']);
    expect(data.matters[0].fleet).toBe('机型范围未核实');
    expect(data.availability).toBe('partial');
    expect(data.events).toEqual([]);
    expect(data.meta.asOf).toBe('');
    expect(data.knowledge).toEqual([]);
  });
  it('separates an exhausted matter total from incomplete lifecycle coverage', () => {
    const { data } = projectAuthorizedSituation([row, row], 'complete', null, true);
    expect(data.coverage?.matterTotal).toBe('complete');
    expect(data.coverage?.assessment).toBe('partial');
    expect(situationMetrics(data, data.matters)).toEqual({
      visibleMatters: 1,
      sourceCount: null,
      attention: 1,
      synthesisPending: null,
    });
    expect(stageLabel(data.matters, 'macro', 'synthesis', false, false))
      .toBe('已取得 1 项关联 · 部分范围');
  });
  it('does not infer analysis or formal execution from a saved work number alone', () => {
    const { data } = projectAuthorizedSituation([{...row, result: null}], 'complete');
    expect(data.matters[0].activeAssessmentStages).toEqual([]);
    expect(data.matters[0].attention).toBeNull();
  });
  it('does not turn a missing completion classification into an exact zero attention count', () => {
    const { data } = projectAuthorizedSituation([
      {...row, result: {...row.result!, roundCompletion: undefined}},
    ], 'complete', null, true);
    expect(data.matters[0].attention).toBeNull();
    expect(situationMetrics(data, data.matters).attention).toBeNull();
  });
  it('shows an exact zero only when every exhausted directory row is classified complete', () => {
    const { data } = projectAuthorizedSituation([
      {...row, result: {...row.result!, roundCompletion: 'COMPLETE'}},
    ], 'complete', null, true);
    expect(data.matters[0].attention).toBe(false);
    expect(situationMetrics(data, data.matters).attention).toBe(0);
  });
  it.each(['denied', 'failed', 'loading'] as const)('removes prior content for %s', (status) => {
    const projection = projectAuthorizedSituation([row], status, libraryMatterFixture());
    expect(projection.data.matters).toEqual([]);
    expect(projection.data.knowledge).toEqual([]);
    expect(projection.knowledgeTargets).toEqual({});
  });
  it('uses exact saved work identity for knowledge without claiming known reuse or adoption', () => {
    const focus = libraryMatterFixture();
    const { data, knowledgeTargets } = projectAuthorizedSituation([], 'complete', focus);
    const work = focus.working.current!;
    expect(data.knowledge[0].id).toBe(work.matterWorkRevisionId);
    const target = new URL(knowledgeTargets[work.matterWorkRevisionId], 'https://example.test');
    expect(target.searchParams.get('workRef')).toBe(work.matterWorkRevisionId);
    expect(data.knowledge[0].reuseCountKnown).toBe(false);
    expect(data.matters[0].activeAssessmentStages).toEqual([
      'question', 'analysis', 'synthesis', 'update',
    ]);
    expect(data.matters[0].status).toBe('综合覆盖尚未核实');
  });
  it('does not expose a catalog version explicitly excluded from matter materials', () => {
    const focus = libraryMatterFixture();
    const versionId = 'excluded-version';
    const entry: EngineeringMatterCatalogEntry = {
      workItemId: 'WI-excluded', relationRole: 'RELATED',
      linkedAtWorkItemRevision: 1, currentWorkItemRevision: 1,
      workItemChangedSinceLink: false, workItemStatus: 'ACTIVE',
      document: {
        documentId: 'DOC-excluded', documentVersionId: versionId,
        documentCode: 'SB-EXCLUDED', businessRevision: 'R1',
        normalizedFamily: 'SB-EXCLUDED',
      },
      documentCurrentness: {
        familyId: 'SB-EXCLUDED', currentDocumentVersionId: versionId,
        currentGeneration: 1, selectedVersionIsCurrent: true,
      },
      sourceNavigation: {
        status: 'NOT_PARSED', sourceRefCount: 0, structuredContentPath: null,
      },
    };
    focus.matter.catalog.entries = [entry];
    focus.matter.materials = [{
      kind: 'RELATED', materialId: 'material-excluded', familyId: 'SB-EXCLUDED',
      documentVersionId: versionId, scope: '', contribution: '明确不纳入',
      basis: [], origin: 'ENGINEER', disposition: 'EXCLUDED',
    }];
    const projection = projectAuthorizedSituation([], 'complete', focus);
    expect(projection.data.sources.some((source) =>
      source.id === `document:${versionId}`)).toBe(false);
    expect(projection.sourceTargets[`document:${versionId}`]).toBeUndefined();
  });
  it('uses included native materials as exact document sources without a legacy catalog', () => {
    const focus = libraryMatterFixture();
    const current = focus.working.current!;
    focus.matter.catalog = { scope: 'MATTER_MATERIALS', entries: [] };
    focus.matter.materials = [
      {
        kind: 'MEMBER', materialId: 'member-1', familyId: 'family-1',
        documentVersionId: 'version-member', scope: '适用范围',
        contribution: '界定当前事项主题。', basis: [], origin: 'DOCUMENT',
        disposition: 'INCLUDED',
      },
      {
        kind: 'RELATED', materialId: 'related-1', familyId: 'family-2',
        documentVersionId: 'version-related', scope: '参考范围',
        contribution: '补充相关条件。', basis: [], origin: 'ENGINEER',
        disposition: 'INCLUDED',
      },
      {
        kind: 'RELATED', materialId: 'related-duplicate', familyId: 'family-2',
        documentVersionId: 'version-related', scope: '重复登记',
        contribution: '不得生成第二个来源。', basis: [], origin: 'ENGINEER',
        disposition: 'INCLUDED',
      },
      {
        kind: 'RELATED', materialId: 'excluded-1', familyId: 'family-3',
        documentVersionId: 'version-excluded', scope: '',
        contribution: '明确不纳入。', basis: [], origin: 'ENGINEER',
        disposition: 'EXCLUDED',
      },
      {
        kind: 'RELATED', materialId: 'included-conflict', familyId: 'family-4',
        documentVersionId: 'version-conflict', scope: '',
        contribution: '较早纳入。', basis: [], origin: 'ENGINEER',
        disposition: 'INCLUDED',
      },
      {
        kind: 'RELATED', materialId: 'excluded-conflict', familyId: 'family-4',
        documentVersionId: 'version-conflict', scope: '',
        contribution: '同版明确排除。', basis: [], origin: 'ENGINEER',
        disposition: 'EXCLUDED',
      },
      {
        kind: 'EXPECTED', materialId: 'expected-1', familyId: null,
        documentVersionId: null, scope: '', contribution: '等待取得。',
        basis: [], origin: 'ENGINEER', disposition: 'INCLUDED',
        expected: {
          issuer: null, documentNumber: null, description: '后续文件',
          expectedContribution: '补充验证', expectedDate: null,
          sourceAsOf: '2026-09-20', publicationStatus: 'PLANNED',
          acquisitionStatus: 'NOT_ACQUIRED', fulfilledBy: [],
        },
      },
    ];

    const projection = projectAuthorizedSituation([], 'complete', focus);
    expect(projection.data.sources.filter((source) =>
      source.category === 'documents')).toEqual([
      {
        id: 'document:version-member', matter: focus.matter.matterId,
        category: 'documents', title: 'version-member',
        version: '业务版本未取得', contribution: '界定当前事项主题。',
      },
      {
        id: 'document:version-related', matter: focus.matter.matterId,
        category: 'documents', title: 'version-related',
        version: '业务版本未取得', contribution: '不得生成第二个来源。',
      },
    ]);
    for (const versionId of ['version-member', 'version-related']) {
      const target = new URL(
        projection.sourceTargets[`document:${versionId}`],
        'https://example.test',
      );
      expect(target.pathname).toBe(`/document-versions/${versionId}`);
      expect(target.searchParams.get('returnMatterId')).toBe(focus.matter.matterId);
      expect(target.searchParams.get('returnMatterWorkRef')).toBe(
        current.matterWorkRevisionId,
      );
    }
    expect(projection.sourceTargets['document:version-excluded']).toBeUndefined();
    expect(projection.sourceTargets['document:version-conflict']).toBeUndefined();
  });
  it('projects every saved review condition bound to the exact work revision only when current saved work exists', () => {
    const base = libraryMatterFixture();
    const current = base.working.current!;
    const focus: EngineeringMatterWorkspaceRead = {
      ...base,
      working: {
        ...base.working,
        current: {
          ...current,
          state: {
            ...current.state,
            reviewConditions: [
              { itemId: 'rc-due', text: '到期复看条件。', basisRefs: ['basis-1', 'basis-2'],
                when: { kind: 'DUE_AT', at: '2026-12-31' } },
              { itemId: 'rc-changed', text: '原文变化后复看。', basisRefs: [],
                when: { kind: 'ORIGINAL_CHANGED', inputId: 'input-9', afterParseRunId: null } },
            ],
          },
        },
      },
    };
    const { data } = projectAuthorizedSituation([], 'complete', focus);
    expect(data.reviewConditions).toEqual([
      { itemId: 'rc-due', text: '到期复看条件。', basisRefs: ['basis-1', 'basis-2'],
        when: { kind: 'DUE_AT', at: '2026-12-31' },
        matterId: base.matter.matterId, matterWorkRevisionId: current.matterWorkRevisionId,
        workingRevision: current.workingRevision },
      { itemId: 'rc-changed', text: '原文变化后复看。', basisRefs: [],
        when: { kind: 'ORIGINAL_CHANGED', inputId: 'input-9', afterParseRunId: null },
        matterId: base.matter.matterId, matterWorkRevisionId: current.matterWorkRevisionId,
        workingRevision: current.workingRevision },
    ]);
    expect(data.matters[0].activeAssessmentStages).toEqual([
      'question', 'analysis', 'synthesis', 'update',
    ]);
    expect(data.events).toEqual([]);
  });
  it('separates a missing current saved work from an empty saved condition list', () => {
    const base = libraryMatterFixture();
    const withoutCurrent: EngineeringMatterWorkspaceRead =
      { ...base, working: { ...base.working, current: null } };
    expect(projectAuthorizedSituation([], 'complete', withoutCurrent).data.reviewConditions).toBeNull();
    const current = base.working.current!;
    const emptyConditions: EngineeringMatterWorkspaceRead = {
      ...base,
      working: {
        ...base.working,
        current: { ...current, state: { ...current.state, reviewConditions: [] } },
      },
    };
    expect(projectAuthorizedSituation([], 'complete', emptyConditions).data.reviewConditions).toEqual([]);
  });
  it('does not project review conditions without a focused saved work', () => {
    expect(projectAuthorizedSituation([row], 'complete').data.reviewConditions).toBeUndefined();
  });
});
