import {
  mockCardViewModels,
  mockTaskRunningCard,
} from '../../client/src/features/aily-cards/models/mockFixtures';
import {
  cardTemplateRegistry,
  WISELINK_TEAM_AGENT_ID,
} from '../../client/src/features/aily-cards/registry/templateRegistry';
import { isAilyCardsPreviewEnvironment } from '../../client/src/features/aily-cards/contract/previewAccess';
import {
  renderTemplate,
  toTemplateVariables,
  validateVariables,
} from '../../client/src/features/aily-cards/registry/variableMapper';
import { wlCardTemplates } from '../../client/src/features/aily-cards/templates';
import { wlCardTemplateById } from '../../client/src/features/aily-cards/templates';

/* ============================================================
 * WiseLink 3.1 · Aily 卡片设计系统 spec
 * 校验：注册表完整性、变量映射完整性、渲染后无残留占位符。
 * ============================================================ */

describe('wl card template registry', () => {
  it('registers all 7 templates with unique ids', () => {
    expect(wlCardTemplates).toHaveLength(7);
    const ids = wlCardTemplates.map((t) => t.id);
    expect(new Set(ids).size).toBe(7);
    expect(cardTemplateRegistry.map((t) => t.id)).toEqual(ids);
    expect(WISELINK_TEAM_AGENT_ID).toBe('agent_4km47c77ujwqphg');
    expect(
      cardTemplateRegistry.every(
        (t) => t.targetAgentId === WISELINK_TEAM_AGENT_ID,
      ),
    ).toBe(true);
    expect(
      cardTemplateRegistry.every((t) => t.feishuTemplateKey === null),
    ).toBe(true);
    expect(
      cardTemplateRegistry.every((t) => t.hostingStatus === 'UNCONFIGURED'),
    ).toBe(true);
    expect(
      cardTemplateRegistry.every(
        (t) => t.officialWiringStatus === 'UNCONFIGURED',
      ),
    ).toBe(true);
  });

  it('every template is JSON 2.0 with update_multi enabled', () => {
    for (const template of wlCardTemplates) {
      expect(template.json.schema).toBe('2.0');
      expect(template.json.config?.update_multi).toBe(true);
      expect(Array.isArray(template.json.body.elements)).toBe(true);
    }
  });

  it('declared variables cover every placeholder used in template json', () => {
    for (const template of wlCardTemplates) {
      const declared = new Set(template.variables.map((v) => v.name));
      const used = new Set<string>();
      collectPlaceholders(template.json, used);
      const undeclared = [...used].filter((name) => !declared.has(name));
      expect(undeclared).toEqual([]);
    }
  });
});

describe('preview route access', () => {
  it('allows development and QA, but never the production mode', () => {
    expect(isAilyCardsPreviewEnvironment('development', true)).toBe(true);
    expect(isAilyCardsPreviewEnvironment('qa', false)).toBe(true);
    expect(isAilyCardsPreviewEnvironment('test', false)).toBe(true);
    expect(isAilyCardsPreviewEnvironment('production', false)).toBe(false);
  });
});

describe('variable mapper', () => {
  it('produces valid variables for every mock fixture', () => {
    const fixtures = [
      ...mockCardViewModels,
      mockTaskRunningCard('received'),
      mockTaskRunningCard('queued'),
    ];
    for (const vm of fixtures) {
      const variables = toTemplateVariables(vm);
      const errors = validateVariables(vm.templateId, variables);
      expect(errors).toEqual([]);
    }
  });

  it('renders templates without leftover placeholders', () => {
    const fixtures = [
      ...mockCardViewModels,
      mockTaskRunningCard('received'),
      mockTaskRunningCard('queued'),
    ];
    for (const vm of fixtures) {
      const rendered = renderTemplate(vm.templateId, toTemplateVariables(vm));
      const leftover = new Set<string>();
      collectPlaceholders(rendered, leftover);
      expect([...leftover]).toEqual([]);
    }
  });

  it('propagates mock values into rendered card', () => {
    const vm = mockCardViewModels[0];
    const rendered = renderTemplate(vm.templateId, toTemplateVariables(vm));
    const headerTitle = (rendered.header?.title as { content: string }).content;
    expect(headerTitle).toContain('747-31A2560');
  });

  it('reports missing required variables', () => {
    const errors = validateVariables('WL-CARD-01', {});
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('workItemTitle'))).toBe(true);
  });

  it('does not mutate the source template while rendering', () => {
    const vm = mockCardViewModels[0];
    const before = JSON.stringify(wlCardTemplateById.get(vm.templateId)?.json);
    renderTemplate(vm.templateId, toTemplateVariables(vm));
    expect(JSON.stringify(wlCardTemplateById.get(vm.templateId)?.json)).toBe(
      before,
    );
  });
});

function collectPlaceholders(node: unknown, out: Set<string>): void {
  if (typeof node === 'string') {
    const pattern = /\$\{([a-zA-Z0-9_]+)\}/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(node)) !== null) out.add(match[1]);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectPlaceholders(item, out);
    return;
  }
  if (node == null || typeof node !== 'object') return;
  for (const value of Object.values(node)) collectPlaceholders(value, out);
}
