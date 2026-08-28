import type { WlCardTemplate } from '../types';

/* ============================================================
 * WL-CARD-02 · 综合评估意见卡（Aily 最重要的卡片）
 * 顺序固定：工程结论 → 适用范围 → 来源约束的理解/影响 → 待确认事实 → 下一步 → 打开工作台。
 * ============================================================ */

export const wlCard02OverallAssessment: WlCardTemplate = {
  id: 'WL-CARD-02',
  businessName: '综合评估',
  feishuTemplateKey: null,
  version: '1.0.0',
  stages: ['candidate_ready', 'awaiting_review'],
  channels: ['feishu_chat', 'aily_web'],
  variables: [
    {
      name: 'synthesisTitle',
      description: '当前 Host WorkItem 的综合评估卡片主标题',
      required: true,
    },
    { name: 'currentJudgment', description: '当前结论', required: true },
    { name: 'applicabilitySummary', description: '适用范围', required: true },
    {
      name: 'keyEvidenceList',
      description: '主要依据（markdown 列表）',
      required: true,
    },
    {
      name: 'unresolvedQuestionsList',
      description: '未解决问题（markdown 列表）',
      required: false,
    },
    {
      name: 'reviewRecommendationsList',
      description: '建议复核动作（markdown 列表）',
      required: true,
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
      title: { tag: 'plain_text', content: '${synthesisTitle}' },
      subtitle: { tag: 'plain_text', content: '工程候选 · 待最终批准' },
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
                  content: '**工程结论**\n${currentJudgment}',
                },
              ],
            },
          ],
        },
        { tag: 'markdown', content: '**适用范围**\n${applicabilitySummary}' },
        {
          tag: 'markdown',
          content: '**为什么重要与实施影响**\n${keyEvidenceList}',
        },
        {
          tag: 'markdown',
          content: '**待确认的适用性事实**\n${unresolvedQuestionsList}',
        },
        {
          tag: 'markdown',
          content: '**下一步动作**\n${reviewRecommendationsList}',
        },
        { tag: 'hr' },
        {
          tag: 'note',
          elements: [
            {
              tag: 'plain_text',
              content: '以上为来源约束的工程候选，异常项处理后仍需最终工程批准',
            },
          ],
        },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '打开完整工作台' },
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
