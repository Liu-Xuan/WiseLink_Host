import type { WlCardTemplate } from '../types';

/* ============================================================
 * WL-CARD-07 · 失败 / 权限卡
 * ============================================================ */

export const wlCard07FailurePermission: WlCardTemplate = {
  id: 'WL-CARD-07',
  businessName: '失败 / 权限',
  feishuTemplateKey: null,
  version: '1.0.0',
  stages: [
    'received',
    'queued',
    'parsing',
    'assessing',
    'waiting_materials',
    'candidate_ready',
    'awaiting_review',
  ],
  channels: ['feishu_chat', 'aily_web'],
  variables: [
    {
      name: 'failureTitle',
      description: '失败/受限标题（如 解析任务失败 / 暂无访问权限）',
      required: true,
    },
    {
      name: 'failureReason',
      description: '原因说明（人话，不暴露内部堆栈）',
      required: true,
    },
    {
      name: 'guidance',
      description: '下一步指引（如 联系管理员申请权限后重试）',
      required: true,
    },
    {
      name: 'workItemId',
      description: '事项 ID（业务 command 与 AppLink 用）',
      required: false,
    },
    {
      name: 'expectedRevision',
      description: '渲染时的事项版本（Host 校验用）',
      required: false,
    },
  ],
  actions: ['RETRY_TASK', 'OPEN_OVERVIEW'],
  json: {
    schema: '2.0',
    config: { update_multi: true },
    header: {
      title: { tag: 'plain_text', content: '${failureTitle}' },
      template: 'red',
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
                { tag: 'markdown', content: '**原因**\n${failureReason}' },
              ],
            },
          ],
        },
        { tag: 'markdown', content: '${guidance}' },
        { tag: 'hr' },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '重试' },
              type: 'primary',
              behaviors: [
                {
                  type: 'callback',
                  value: {
                    action: 'RETRY_TASK',
                    workItemId: '${workItemId}',
                    expectedRevision: '${expectedRevision}',
                  },
                },
              ],
            },
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '打开工作台' },
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
