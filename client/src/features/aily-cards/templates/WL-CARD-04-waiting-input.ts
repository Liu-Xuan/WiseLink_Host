import type { WlCardTemplate } from '../types';

/* ============================================================
 * WL-CARD-04 · 等待输入卡（等待资料）
 * ============================================================ */

export const wlCard04WaitingInput: WlCardTemplate = {
  id: 'WL-CARD-04',
  businessName: '等待输入',
  feishuTemplateKey: null,
  version: '1.0.0',
  stages: ['waiting_materials'],
  channels: ['feishu_chat', 'aily_web'],
  variables: [
    { name: 'workItemTitle', description: '事项标题', required: true },
    { name: 'waitingReason', description: '等待原因一句话', required: true },
    {
      name: 'missingInputsList',
      description: '待补资料清单（markdown 列表）',
      required: true,
    },
    { name: 'impactHint', description: '缺少资料的影响提示', required: false },
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
  actions: ['SUPPLY_MATERIALS', 'OPEN_OVERVIEW'],
  json: {
    schema: '2.0',
    config: { update_multi: true },
    header: {
      title: { tag: 'plain_text', content: '${workItemTitle} · 等待资料' },
      subtitle: { tag: 'plain_text', content: '${waitingReason}' },
      template: 'orange',
    },
    body: {
      elements: [
        { tag: 'markdown', content: '**待补资料**\n${missingInputsList}' },
        { tag: 'markdown', content: '${impactHint}' },
        { tag: 'hr' },
        {
          tag: 'note',
          elements: [
            {
              tag: 'plain_text',
              content: '补充资料后系统将自动重新评估受影响判断项',
            },
          ],
        },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '补充资料' },
              type: 'primary',
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
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '查看综合评估' },
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
          ],
        },
      ],
    },
  },
};
