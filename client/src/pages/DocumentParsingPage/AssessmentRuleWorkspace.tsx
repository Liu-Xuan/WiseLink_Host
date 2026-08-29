import { useMemo, useState } from 'react';
import {
  BookOpenText,
  ChevronDown,
  CircleAlert,
  FileQuestion,
  ListFilter,
  MinusCircle,
} from 'lucide-react';

import type { CanonicalEngineerReviewPageItem } from '@shared/api.interface';

import {
  buildAssessmentRulePresentations,
  type AssessmentRuleCategory,
  type AssessmentRulePresentation,
} from './assessment-rule-presentation';
import './assessment-rule-workspace.css';

interface AssessmentRuleWorkspaceProps {
  items: CanonicalEngineerReviewPageItem[];
  selectedCriterionId: string;
  preferSelectedOnLoad: boolean;
  onSelectCriterion: (criterionId: string) => void;
  onLocateSourceRef: (sourceRefId: string) => void;
}

interface CategoryOption {
  key: AssessmentRuleCategory | 'all';
  label: string;
}

const CATEGORY_OPTIONS: CategoryOption[] = [
  { key: 'attention', label: '建议关注' },
  { key: 'concluded', label: '已有判断' },
  { key: 'unavailable', label: '暂无法判断' },
  { key: 'not-applicable', label: '不适用' },
  { key: 'all', label: '全部规则' },
];
const RULE_PAGE_SIZE = 40;

function initialCategory(
  items: AssessmentRulePresentation[],
  selectedCriterionId: string,
  preferSelectedOnLoad: boolean,
): AssessmentRuleCategory | 'all' {
  const selected: AssessmentRulePresentation | undefined = items.find(
    (item: AssessmentRulePresentation) =>
      item.item.criterionId === selectedCriterionId,
  );
  if (selected && preferSelectedOnLoad) return selected.category;
  if (
    items.some(
      (item: AssessmentRulePresentation) => item.category === 'attention',
    )
  ) {
    return 'attention';
  }
  if (
    items.some(
      (item: AssessmentRulePresentation) => item.category === 'concluded',
    )
  ) {
    return 'concluded';
  }
  return 'unavailable';
}

function categoryLabel(category: AssessmentRuleCategory): string {
  return (
    CATEGORY_OPTIONS.find((option: CategoryOption) => option.key === category)
      ?.label ?? '当前判断'
  );
}

function CategoryIcon({ category }: { category: AssessmentRuleCategory }) {
  if (category === 'attention') return <CircleAlert aria-hidden="true" />;
  if (category === 'unavailable') return <FileQuestion aria-hidden="true" />;
  if (category === 'not-applicable') return <MinusCircle aria-hidden="true" />;
  return <BookOpenText aria-hidden="true" />;
}

export default function AssessmentRuleWorkspace({
  items,
  selectedCriterionId,
  preferSelectedOnLoad,
  onSelectCriterion,
  onLocateSourceRef,
}: AssessmentRuleWorkspaceProps) {
  const presentations: AssessmentRulePresentation[] = useMemo(
    () => buildAssessmentRulePresentations(items),
    [items],
  );
  const [category, setCategory] = useState<AssessmentRuleCategory | 'all'>(() =>
    initialCategory(presentations, selectedCriterionId, preferSelectedOnLoad),
  );
  const [visibleCount, setVisibleCount] = useState<number>(RULE_PAGE_SIZE);

  const counts: Record<AssessmentRuleCategory, number> = useMemo(
    () => ({
      attention: presentations.filter(
        (item: AssessmentRulePresentation) => item.category === 'attention',
      ).length,
      concluded: presentations.filter(
        (item: AssessmentRulePresentation) => item.category === 'concluded',
      ).length,
      unavailable: presentations.filter(
        (item: AssessmentRulePresentation) => item.category === 'unavailable',
      ).length,
      'not-applicable': presentations.filter(
        (item: AssessmentRulePresentation) =>
          item.category === 'not-applicable',
      ).length,
    }),
    [presentations],
  );
  const filtered: AssessmentRulePresentation[] = useMemo(
    () =>
      category === 'all'
        ? presentations
        : presentations.filter(
            (item: AssessmentRulePresentation) => item.category === category,
          ),
    [category, presentations],
  );
  const selected: AssessmentRulePresentation | undefined =
    filtered.find(
      (item: AssessmentRulePresentation) =>
        item.item.criterionId === selectedCriterionId,
    ) ??
    filtered[0] ??
    presentations[0];
  const visible: AssessmentRulePresentation[] = filtered.slice(0, visibleCount);

  if (!selected) {
    return (
      <section className="assessment-rule-workspace is-empty">
        <p>当前资料尚未形成可读的规则判断。</p>
      </section>
    );
  }

  const originalRuleAvailable: boolean = Boolean(
    selected.evaluationQuestion ||
    selected.decisionRule ||
    selected.appliesWhen,
  );

  return (
    <section
      className="assessment-rule-workspace"
      id="workspace-review"
      aria-label="规则判断工作区"
    >
      <header className="assessment-rule-header">
        <div>
          <span>Job Aid · 工程判断辅助</span>
          <h3>先看规则原文，再看系统判断</h3>
          <p>
            优先呈现已有结论和需要关注的项目；缺少受控输入的项目统一归档，不要求逐项确认。
          </p>
        </div>
        <strong>{presentations.length} 项规则</strong>
      </header>

      <nav className="assessment-rule-filters" aria-label="规则判断分类">
        <ListFilter aria-hidden="true" />
        {CATEGORY_OPTIONS.map((option: CategoryOption) => {
          const count: number =
            option.key === 'all' ? presentations.length : counts[option.key];
          return (
            <button
              type="button"
              key={option.key}
              className={`is-${option.key}`}
              aria-pressed={category === option.key}
              onClick={() => {
                setCategory(option.key);
                setVisibleCount(RULE_PAGE_SIZE);
              }}
            >
              {option.label} <span>{count}</span>
            </button>
          );
        })}
      </nav>

      <div className="assessment-rule-layout">
        <div className="assessment-rule-list" aria-label="判断规则列表">
          {visible.length > 0 ? (
            visible.map((rule: AssessmentRulePresentation) => {
              const isSelected: boolean =
                rule.item.criterionId === selected.item.criterionId;
              return (
                <button
                  type="button"
                  className={`assessment-rule-list-item is-${rule.category}${
                    isSelected ? ' is-selected' : ''
                  }`}
                  key={rule.item.criterionId}
                  aria-current={isSelected ? 'true' : undefined}
                  aria-label={`规则 ${rule.sequence}，${rule.criterionName}，${rule.conclusion}`}
                  onClick={() => onSelectCriterion(rule.item.criterionId)}
                >
                  <CategoryIcon category={rule.category} />
                  <span>
                    <small>
                      规则 {rule.sequence} · {categoryLabel(rule.category)}
                    </small>
                    <strong title={rule.criterionName}>
                      {rule.criterionName}
                    </strong>
                    <em title={rule.conclusion}>{rule.conclusion}</em>
                  </span>
                </button>
              );
            })
          ) : (
            <p className="assessment-rule-list-empty">当前分类没有规则。</p>
          )}
          {filtered.length > visible.length ? (
            <button
              type="button"
              className="assessment-rule-more"
              onClick={() =>
                setVisibleCount((count: number) => count + RULE_PAGE_SIZE)
              }
            >
              再显示{' '}
              {Math.min(RULE_PAGE_SIZE, filtered.length - visible.length)} 项
            </button>
          ) : null}
        </div>

        <article
          className={`assessment-rule-reading is-${selected.category}`}
          aria-live="polite"
        >
          <div className="assessment-rule-source">
            <header>
              <span>判断规则原文</span>
              <small>规则 {selected.sequence}</small>
            </header>
            <h4>{selected.criterionName}</h4>
            {originalRuleAvailable ? (
              <>
                {selected.evaluationQuestion ? (
                  <blockquote>{selected.evaluationQuestion}</blockquote>
                ) : null}
                {selected.appliesWhen ? (
                  <p>
                    <strong>适用条件</strong>
                    {selected.appliesWhen}
                  </p>
                ) : null}
                {selected.decisionRule ? (
                  <p>
                    <strong>判定规则</strong>
                    {selected.decisionRule}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="assessment-rule-source-missing">
                当前 Host
                尚未提供这条规则的受控原文；系统不会用分析结果反向伪造规则。
              </p>
            )}
          </div>

          <div className="assessment-rule-conclusion">
            <span>{categoryLabel(selected.category)}</span>
            <h4>当前判断</h4>
            <p>{selected.conclusion}</p>
            {selected.category === 'unavailable' &&
            selected.item.missingInputs?.length ? (
              <small>尚缺：{selected.item.missingInputs.join('；')}</small>
            ) : null}
          </div>

          <details className="assessment-rule-details">
            <summary>
              <span>展开判断细节</span>
              <ChevronDown aria-hidden="true" />
            </summary>
            <dl>
              <div>
                <dt>采用的事实</dt>
                <dd>
                  {selected.item.factsConsidered?.join('；') ||
                    '当前没有可引用的受控事实'}
                </dd>
              </div>
              <div>
                <dt>规则如何作用</dt>
                <dd>
                  {selected.item.ruleApplication ||
                    '当前尚未形成可解释的规则应用'}
                </dd>
              </div>
              <div>
                <dt>分析与工程影响</dt>
                <dd>
                  {selected.item.analysisSummary ||
                    '当前尚未形成可解释的工程分析'}
                </dd>
              </div>
              <div>
                <dt>尚缺的输入</dt>
                <dd>
                  {selected.item.missingInputs?.join('；') || '当前无明确缺口'}
                </dd>
              </div>
            </dl>
            {selected.item.sourceRefs?.length ? (
              <div className="assessment-rule-sources">
                <span>回到原文依据</span>
                {selected.item.sourceRefs.map(
                  (sourceRef: string, index: number) => (
                    <button
                      type="button"
                      key={sourceRef}
                      onClick={() => onLocateSourceRef(sourceRef)}
                    >
                      原文依据 {index + 1}
                    </button>
                  ),
                )}
              </div>
            ) : null}
          </details>
        </article>
      </div>
    </section>
  );
}
