import { projectAuthorizedSituation } from '../../client/src/features/trinity/trinity-authorized-data';
import { situationMetrics, stageLabel } from '../../client/src/features/trinity/trinity-model';
import { libraryMatterFixture } from './fixtures/library-matter';
import type { EngineeringMatterDirectoryResponse } from '@shared/api.interface';

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
    expect(data.matters[0].activeStages).toEqual(['assess']);
    expect(data.matters[0].fleet).toBe('机型范围未核实');
    expect(data.availability).toBe('partial');
    expect(data.events).toEqual([]);
    expect(data.meta.asOf).toBe('');
    expect(data.knowledge).toEqual([]);
  });
  it('separates an exhausted matter total from incomplete lifecycle coverage', () => {
    const { data } = projectAuthorizedSituation([row, row], 'complete', null, true);
    expect(data.coverage?.matterTotal).toBe('complete');
    expect(data.coverage?.lifecycle).toBe('partial');
    expect(situationMetrics(data, data.matters)).toEqual({
      visibleMatters: 1,
      attention: 1,
      knowledgeWorks: null,
      effectWatch: null,
    });
    expect(stageLabel(data.matters, 'macro', 'assess', false, false))
      .toBe('已取得 1 项关联 · 部分范围');
  });
  it('does not infer analysis or formal execution from a saved work number alone', () => {
    const { data } = projectAuthorizedSituation([{...row, result: null}], 'complete');
    expect(data.matters[0].activeStages).toEqual([]);
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
    expect(data.matters[0].activeStages).toEqual(['assess']);
    expect(data.matters[0].status).toBe('综合覆盖尚未核实');
  });
});
