import { useMemo, useState } from 'react';

import './aily-cards.css';

import {
  renderTemplate,
  toTemplateVariables,
  validateVariables,
} from '@client/src/features/aily-cards/registry/variableMapper';
import { WlCardPreview } from '@client/src/features/aily-cards/WlCardPreview';
import { wlCardTemplates } from '@client/src/features/aily-cards/templates';
import type {
  WlCardBusinessCommand,
  WlCardTemplateId,
} from '@client/src/features/aily-cards/types';
import { buildAppLink } from '@client/src/features/aily-cards/contract/appLinkBuilder';
import {
  mockCardViewModels,
  mockTaskRunningCard,
} from '@client/src/features/aily-cards/models/mockFixtures';
import type { WlCardViewModel } from '@client/src/features/aily-cards/models/cardViewModels';

/* ============================================================
 * WiseLink 3.1 · Aily 卡片预览页（/aily-cards）
 * 7 类卡片 × 状态演进阶段的视觉验收，mock 数据驱动。
 * ============================================================ */

interface PreviewEntry {
  key: string;
  label: string;
  templateId: WlCardTemplateId;
  vm: WlCardViewModel;
}

function buildEntries(): PreviewEntry[] {
  const entries: PreviewEntry[] = mockCardViewModels.map((vm, index) => ({
    key: `${vm.templateId}-${index}`,
    label: `${vm.templateId} · ${labelOf(vm)}`,
    templateId: vm.templateId,
    vm,
  }));
  // 补任务运行卡的 received / queued 两个阶段
  for (const stage of ['received', 'queued', 'waiting_materials'] as const) {
    const vm = mockTaskRunningCard(stage);
    entries.push({
      key: `WL-CARD-03-${stage}`,
      label: `WL-CARD-03 · 任务运行 · ${vm.stageLabel}`,
      templateId: vm.templateId,
      vm,
    });
  }
  return entries;
}

function labelOf(vm: WlCardViewModel): string {
  switch (vm.templateId) {
    case 'WL-CARD-01':
      return '当前焦点';
    case 'WL-CARD-02':
      return '综合评估';
    case 'WL-CARD-03':
      return vm.stageLabel;
    case 'WL-CARD-04':
      return '等待输入';
    case 'WL-CARD-05':
      return '复核建议';
    case 'WL-CARD-06':
      return 'STALE / 冲突';
    case 'WL-CARD-07':
      return vm.failureTitle;
  }
}

const entries = buildEntries();

export default function AilyCardsPreviewPage() {
  const [selectedKey, setSelectedKey] = useState(entries[0].key);
  const [businessCommand, setBusinessCommand] =
    useState<WlCardBusinessCommand | null>(null);

  const selected = entries.find((e) => e.key === selectedKey) ?? entries[0];

  const { variables, rendered, errors, appLink } = useMemo(() => {
    const vars = toTemplateVariables(selected.vm);
    const validation = validateVariables(selected.templateId, vars);
    const card =
      validation.length === 0
        ? renderTemplate(selected.templateId, vars)
        : null;
    return {
      variables: vars,
      rendered: card,
      errors: validation,
      appLink: buildAppLink(
        { kind: 'overview', workItemId: selected.vm.workItemId },
        'https://example.feishu.cn/wiki/wl',
      ),
    };
  }, [selected]);

  return (
    <main className="aily-cards-page">
      <header className="aily-cards-masthead">
        <p className="aily-cards-eyebrow">WISELINK 3.1 · AILY CARDS</p>
        <h1>Aily 卡片设计系统预览</h1>
        <p className="aily-cards-lede">
          7 类卡片模板（飞书卡片 JSON 2.0）× 状态演进阶段的视觉验收。数据为
          DEV/QA mock（747-31A2560 示例）。所有模板尚未托管，官方
          CardKit、消息和事件回调也尚未接线。
        </p>
      </header>

      <div className="aily-cards-layout">
        <nav className="aily-cards-nav" aria-label="卡片模板选择">
          <p className="aily-cards-nav__title">模板 · 状态</p>
          {wlCardTemplates.map((template) => (
            <div key={template.id} className="aily-cards-nav__group">
              <p className="aily-cards-nav__group-label">
                {template.id} · {template.businessName}
              </p>
              {entries
                .filter((entry) => entry.templateId === template.id)
                .map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    className={`aily-cards-nav__item${entry.key === selectedKey ? ' is-selected' : ''}`}
                    onClick={() => {
                      setSelectedKey(entry.key);
                      setBusinessCommand(null);
                    }}
                  >
                    {entry.label}
                  </button>
                ))}
            </div>
          ))}
        </nav>

        <section className="aily-cards-stage">
          {errors.length > 0 ? (
            <div className="aily-cards-error" role="alert">
              {errors.map((error) => (
                <p key={error}>{error}</p>
              ))}
            </div>
          ) : rendered ? (
            <WlCardPreview
              card={rendered}
              context={{
                onActionClick: (value) =>
                  setBusinessCommand({
                    action: value.action as WlCardBusinessCommand['action'],
                    workItemId: String(value.workItemId ?? ''),
                    expectedRevision: Number(value.expectedRevision ?? 0),
                  }),
              }}
            />
          ) : null}

          <div className="aily-cards-inspector">
            <details className="aily-cards-details" open>
              <summary>业务 command shape（仅 DEV，不是官方回调）</summary>
              <pre>{JSON.stringify(businessCommand, null, 2)}</pre>
            </details>
            <details className="aily-cards-details">
              <summary>模板变量 dict</summary>
              <pre>{JSON.stringify(variables, null, 2)}</pre>
            </details>
            <details className="aily-cards-details">
              <summary>AppLink（打开综合评估 · 示例）</summary>
              <code className="aily-cards-applink">{appLink}</code>
            </details>
          </div>
        </section>
      </div>
    </main>
  );
}
