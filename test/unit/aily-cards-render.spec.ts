import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

import {
  mockCardViewModels,
  mockTaskRunningCard,
} from '../../client/src/features/aily-cards/models/mockFixtures';
import {
  renderTemplate,
  toTemplateVariables,
} from '../../client/src/features/aily-cards/registry/variableMapper';
import { WlCardPreview } from '../../client/src/features/aily-cards/WlCardPreview';

/* ============================================================
 * WiseLink 3.1 · WlCardPreview 渲染器冒烟测试
 * 预览页整页 HTML 验证被既有 server DI 错误挡住，此处用
 * renderToString 验证渲染器对所有 mock 卡片可真实渲染。
 * ============================================================ */

describe('WlCardPreview renderer smoke', () => {
  it('renders every mock card to html with card shell, header and buttons', () => {
    const fixtures = [
      ...mockCardViewModels,
      mockTaskRunningCard('received'),
      mockTaskRunningCard('queued'),
    ];
    for (const vm of fixtures) {
      const card = renderTemplate(vm.templateId, toTemplateVariables(vm));
      const html = renderToString(createElement(WlCardPreview, { card }));
      expect(html).toContain('wl-preview-card');
      expect(html).toContain('wl-preview-header__title');
      expect(html).toContain('wl-preview-button');
      expect(html).not.toContain('${');
    }
  });

  it('propagates mock judgment text into the current-focus card html', () => {
    const vm = mockCardViewModels[0];
    const card = renderTemplate(vm.templateId, toTemplateVariables(vm));
    const html = renderToString(createElement(WlCardPreview, { card }));
    expect(html).toContain('747-31A2560');
    expect(html).toContain('适用于部分747飞机');
    expect(html).toContain('打开综合评估');
  });

  it('renders column_set and note elements for the overall assessment card', () => {
    const vm = mockCardViewModels[1];
    const card = renderTemplate(vm.templateId, toTemplateVariables(vm));
    const html = renderToString(createElement(WlCardPreview, { card }));
    expect(html).toContain('wl-preview-columns');
    expect(html).toContain('wl-preview-note');
    expect(html).toContain('主要依据');
    expect(html).toContain('未解决问题');
    expect(html).toContain('建议复核动作');
  });
});
