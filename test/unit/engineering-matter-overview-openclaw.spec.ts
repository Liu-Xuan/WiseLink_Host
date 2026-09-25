import { assertOpenClawOverviewCorrectionProposal } from '../../server/modules/canonical-host/matter-action-attempt.service';

const purpose = {
  kind: 'ENGINEERING_OVERVIEW_CORRECTION' as const,
  expectedWorkRef: 'MWR-16',
  correctionReason: '核对问题更正后的总体认识',
  evidenceRefs: ['EV-SB', 'EV-FTD'],
};
const previous = { matterWorkRevisionId: 'MWR-16',
  state: { problemWork: { roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS' } } };
const proposal = { schemaVersion: 'wiselink.jobaid-problem-work.v3', issues: [],
  overview: '在 SB 条件下保留限制 [[EV-SB]]；FTD 仅作为相关参考 [[EV-FTD]]。',
  roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS',
  completionReason: '尚有目标构型待核对 [[EV-SB]]。',
  changeSummary: '核对并更新综合及完成说明。' };

describe('OpenClaw scoped overview save', () => {
  it('accepts a cited overview-only update on the exact work', () => {
    expect(() => assertOpenClawOverviewCorrectionProposal(proposal, purpose, previous)).not.toThrow();
  });

  it('rejects issue rewrites, additional fields and unsupported sources', () => {
    for (const changed of [
      { ...proposal, issues: [{ issueKey: 'SB-effectivity', body: 'new claim' }] },
      { ...proposal, headline: 'unrequested summary rewrite' },
      { ...proposal, roundCompletion: 'COMPLETE' },
      { ...proposal, overview: '未经交付的来源 [[EV-OTHER]]。' },
      { ...proposal, overview: '没有可核对的来源。', completionReason: '没有来源。' },
    ]) expect(() => assertOpenClawOverviewCorrectionProposal(changed, purpose, previous)).toThrow();
    expect(() => assertOpenClawOverviewCorrectionProposal(proposal, purpose,
      { ...previous, matterWorkRevisionId: 'MWR-older' })).toThrow();
  });
});
