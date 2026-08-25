import type { WlCardTemplate } from '../types';

/* ============================================================
 * WL-CARD-05 · 复核建议卡
 * ============================================================ */

export const wlCard05ReviewSuggestion: WlCardTemplate = {
  id: 'WL-CARD-05',
  businessName: '复核建议',
  feishuTemplateKey: null,
  version: '1.0.0',
  stages: ['candidate_ready', 'awaiting_review'],
  channels: ['feishu_chat', 'aily_web'],
  variables: [
    { name: 'workItemTitle', description: '事项标题', required: true },
    { name: 'reviewSummary', description: '复核要点一句话', required: true },
    {
      name: 'recommendationList',
      description: '建议动作清单（markdown 列表）',
      required: true,
    },
    { name: 'riskHint', description: '不复核的风险提示', required: false },
    {
      name: 'workItemId',
      description: '事项 ID（业务 command 与 AppLink 用）',
      required: true,
    },
    {
      name: 'expectedRevision',
      description: '渲染时的事项版本（Host 校验用）',
      required: true,
    },
  ],
  actions: ['ACKNOWLEDGE_REVIEW', 'OPEN_OVERVIEW', 'REQUEST_RESYNTHESIS'],
  json: {
    schema: '2.0',
    config: { update_multi: true },
    header: {
      title: { tag: 'plain_text', content: '${workItemTitle} · 建议复核' },
      subtitle: { tag: 'plain_text', content: '${reviewSummary}' },
      template: 'violet',
    },
    body: {
      elements: [
        { tag: 'markdown', content: '**建议动作**\n${recommendationList}' },
        { tag: 'markdown', content: '${riskHint}' },
        { tag: 'hr' },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '已阅，安排复核' },
              type: 'primary',
              behaviors: [
                {
                  type: 'callback',
                  value: {
                    action: 'ACKNOWLEDGE_REVIEW',
                    workItemId: '${workItemId}',
                    expectedRevision: '${expectedRevision}',
                  },
                },
              ],
            },
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '打开综合评估' },
              type: 'default',
              behaviors: [
                {
                  type: 'callback',
                  value: {
                    action: 'OPEN_OVERVIEW',
                    workItemId: '${workItemId}',
                    expectedRevision: '${expectedRevision}',
                  },
                },
              ],
            },
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '重新评估' },
              type: 'text',
              behaviors: [
                {
                  type: 'callback',
                  value: {
                    action: 'REQUEST_RESYNTHESIS',
                    workItemId: '${workItemId}',
                    expectedRevision: '${expectedRevision}',
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  },
};
