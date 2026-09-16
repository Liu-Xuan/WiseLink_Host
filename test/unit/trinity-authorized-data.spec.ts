import { projectAuthorizedSituation } from '../../client/src/features/trinity/trinity-authorized-data';
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
  it('does not infer analysis or formal execution from a saved work number alone', () => {
    const { data } = projectAuthorizedSituation([{...row, result: null}], 'complete');
    expect(data.matters[0].activeStages).toEqual([]);
    expect(data.matters[0].attention).toBe(false);
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
