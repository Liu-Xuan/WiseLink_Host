import type { WlCardTemplate } from '../types';

/* ============================================================
 * WL-CARD-01 · 当前焦点卡
 * 用户进入单聊或点击“继续最近事项”后显示。
 * ============================================================ */

export const wlCard01CurrentFocus: WlCardTemplate = {
  id: 'WL-CARD-01',
  businessName: '当前焦点',
  feishuTemplateKey: null,
  version: '1.0.0',
  stages: ['candidate_ready', 'awaiting_review'],
  channels: ['feishu_chat', 'aily_web'],
  variables: [
    {
      name: 'workItemTitle',
      description: '当前 Host WorkItem 的事项标题',
      required: true,
    },
    {
      name: 'focusLine',
      description: '状态一句话（如 候选评估已形成，等待复核）',
      required: true,
    },
    { name: 'currentJudgment', description: '当前结论', required: true },
    {
      name: 'impactSummary',
      description: '影响范围（候选/已确认/待核实计数）',
      required: true,
    },
    {
      name: 'pendingItems',
      description: '待确认清单（markdown 列表）',
      required: false,
    },
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
  actions: ['OPEN_OVERVIEW', 'OPEN_SOURCE', 'SUPPLY_MATERIALS'],
  json: {
    schema: '2.0',
    config: { update_multi: true },
    header: {
      title: { tag: 'plain_text', content: '${workItemTitle} · 综合评估' },
      subtitle: { tag: 'plain_text', content: '${focusLine}' },
      template: 'blue',
    },
    body: {
      elements: [
        {
          tag: 'column_set',
          flex_mode: 'bisect',
          background_style: 'grey',
          columns: [
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'markdown',
                  content: '**当前结论**\n${currentJudgment}',
                },
              ],
            },
          ],
        },
        { tag: 'markdown', content: '**影响范围**\n${impactSummary}' },
        { tag: 'markdown', content: '**待确认**\n${pendingItems}' },
        { tag: 'hr' },
        {
          tag: 'note',
          elements: [
            {
              tag: 'plain_text',
              content: '候选结论仅供预览，工程师复核前不得用于正式工作',
            },
          ],
        },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '打开综合评估' },
              type: 'primary',
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
              text: { tag: 'plain_text', content: '查看原文' },
              type: 'default',
              behaviors: [
                {
                  type: 'callback',
                  value: {
                    action: 'OPEN_SOURCE',
                    workItemId: '${workItemId}',
                    expectedRevision: '${expectedRevision}',
                  },
                },
              ],
            },
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '补充资料' },
              type: 'default',
              behaviors: [
                {
                  type: 'callback',
                  value: {
                    action: 'SUPPLY_MATERIALS',
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
