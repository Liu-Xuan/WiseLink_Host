import type { WlCardTemplate } from '../types';

/* ============================================================
 * WL-CARD-06 · STALE / 冲突卡（已失效结果）
 * ============================================================ */

export const wlCard06StaleConflict: WlCardTemplate = {
  id: 'WL-CARD-06',
  businessName: 'STALE / 冲突',
  feishuTemplateKey: null,
  version: '1.0.0',
  stages: ['awaiting_review'],
  channels: ['feishu_chat', 'aily_web'],
  variables: [
    { name: 'workItemTitle', description: '事项标题', required: true },
    {
      name: 'staleReason',
      description: '失效原因（如 底层文件已更新至 Rev.C）',
      required: true,
    },
    { name: 'affectedScope', description: '受影响范围说明', required: true },
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
  actions: ['REQUEST_RESYNTHESIS', 'VIEW_LATEST', 'OPEN_OVERVIEW'],
  json: {
    schema: '2.0',
    config: { update_multi: true },
    header: {
      title: { tag: 'plain_text', content: '${workItemTitle} · 结果已失效' },
      subtitle: { tag: 'plain_text', content: '${staleReason}' },
      template: 'orange',
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
                  content: '**受影响范围**\n${affectedScope}',
                },
              ],
            },
          ],
        },
        { tag: 'hr' },
        {
          tag: 'note',
          elements: [
            {
              tag: 'plain_text',
              content: '失效结果不再用于后续判断，请以重新评估后的候选意见为准',
            },
          ],
        },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '重新评估' },
              type: 'primary',
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
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '查看最新结果' },
              type: 'default',
              behaviors: [
                {
                  type: 'callback',
                  value: {
                    action: 'VIEW_LATEST',
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
          ],
        },
      ],
    },
  },
};
