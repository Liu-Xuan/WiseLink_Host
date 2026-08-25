import type { WlCardTemplate } from '../types';

/* ============================================================
 * WL-CARD-03 · 任务运行卡（后台任务进度）
 * 状态演进：已受理→排队中→正在解析→正在评估→等待资料→候选已形成→等待复核
 * 每个重要阶段更新一次卡片，不使用伪动画。
 * ============================================================ */

export const wlCard03TaskRunning: WlCardTemplate = {
  id: 'WL-CARD-03',
  businessName: '任务运行',
  feishuTemplateKey: null,
  version: '1.0.0',
  stages: ['received', 'queued', 'parsing', 'assessing', 'waiting_materials'],
  channels: ['feishu_chat', 'aily_web'],
  variables: [
    {
      name: 'taskTitle',
      description: '任务名（如 正在重新分析受影响判断项）',
      required: true,
    },
    {
      name: 'stageLabel',
      description: '当前阶段（人话，如 核对适用范围）',
      required: true,
    },
    {
      name: 'progressText',
      description: '进度文本（如 43 / 150 项）',
      required: false,
    },
    { name: 'etaText', description: '预计时间（如 约8分钟）', required: false },
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
  actions: ['OPEN_TASK', 'REQUEST_RESYNTHESIS'],
  json: {
    schema: '2.0',
    config: { update_multi: true },
    header: {
      title: { tag: 'plain_text', content: '${taskTitle}' },
      subtitle: { tag: 'plain_text', content: '进行中' },
      template: 'turquoise',
    },
    body: {
      elements: [
        {
          tag: 'column_set',
          flex_mode: 'trisect',
          background_style: 'grey',
          columns: [
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                { tag: 'markdown', content: '**当前阶段**\n${stageLabel}' },
              ],
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                { tag: 'markdown', content: '**进度**\n${progressText}' },
              ],
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [{ tag: 'markdown', content: '**预计**\n${etaText}' }],
            },
          ],
        },
        {
          tag: 'note',
          elements: [
            {
              tag: 'plain_text',
              content: '任务执行期间，你仍可继续询问或处理其他事项',
            },
          ],
        },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '查看任务' },
              type: 'default',
              behaviors: [
                {
                  type: 'callback',
                  value: {
                    action: 'OPEN_TASK',
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
