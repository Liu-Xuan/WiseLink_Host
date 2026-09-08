import { useState, type ReactNode } from 'react';
import { Copy, Download, Languages } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import type {
  CanonicalReaderTranslationProjection,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import type {
  TranslationReadingElementV2,
  TranslationSourceAnchorV2,
  TranslationWorkspaceReadingV2,
} from '@shared/canonical-translation-v2.interface';
import { TranslationRevisionEditor } from './TranslationRevisionEditor';
import InitialAnalysisContinueButton from '@client/src/features/review/InitialAnalysisContinueButton';
import './semantic-bilingual-reader.css';

interface Props {
  translation: CanonicalReaderTranslationProjection;
  onSourceRefSelect: (unitId: string, sourceRef: string) => void;
  workItem?: Pick<CanonicalWorkItemProjection, 'workItemId' | 'revision'>;
  canRequestBlockTranslation?: boolean;
  onContinuationRequested?: () => void;
}
const statusLabels = {
  MISSING: '待生成',
  PENDING_CHECK: '已保存，待检查',
  READABLE: '可读候选',
  BLOCKED: '需处理',
} as const;

export function SemanticBilingualReader({
  translation,
  onSourceRefSelect,
  workItem,
  canRequestBlockTranslation,
  onContinuationRequested,
}: Props) {
  const [selectedAnchors, setSelectedAnchors] = useState<string[]>([]);
  const [feedback, setFeedback] = useState('');
  const [revisedReading, setRevisedReading] =
    useState<TranslationWorkspaceReadingV2 | null>(null);
  if (translation.status !== 'SEMANTIC_READING_AID_AVAILABLE') {
    if (
      translation.status === 'BILINGUAL_READING_AID_AVAILABLE' &&
      translation.units?.length
    )
      return (
        <div className="wl-bilingual-reader">
          <p className="wl-bilingual-scope">历史译文候选 · 原文与译文对照</p>
          {translation.units.map((unit) => (
            <article className="wl-bilingual-block" key={unit.unitId}>
              <div className="wl-bilingual-columns">
                <div lang="en">{unit.sourceText}</div>
                <div lang="zh-CN">{unit.translatedText}</div>
              </div>
              <footer>
                {unit.sourceRefIds.map((ref, index) => (
                  <button
                    type="button"
                    key={ref}
                    onClick={() => onSourceRefSelect(unit.unitId, ref)}
                  >
                    来源 {index + 1}
                  </button>
                ))}
              </footer>
            </article>
          ))}
        </div>
      );
    return (
      <div className="parse-reader-missing-state">
        <Languages aria-hidden="true" />
        <div>
          <strong>中英文对照暂不可用</strong>
          <p>原文仍可阅读；生成并完成检查后，译文将在这里显示。</p>
        </div>
      </div>
    );
  }
  const reading =
    revisedReading?.workspaceId === translation.reading.workspaceId &&
    revisedReading.rowVersion >= translation.reading.rowVersion
      ? revisedReading
      : translation.reading;
  const anchors = new Map(
    reading.anchors.map((anchor) => [anchor.anchorId, anchor]),
  );
  const readableCount = reading.blocks.filter((block) => block.selected).length;
  const scope =
    reading.completeness === 'PARTIAL'
      ? '部分译文候选'
      : reading.completeness === 'COMPLETE_WITH_ISSUES'
        ? '完整译文候选 · 有待复核项'
        : '完整译文候选';
  const focus = (ids: string[]) => setSelectedAnchors(ids);
  async function copyReading() {
    try {
      await navigator.clipboard.writeText(readableText(reading));
      setFeedback('已复制可读范围，包含完成范围和缺项说明。');
    } catch {
      setFeedback('复制未成功，请使用导出或手动选择文字。');
    }
  }
  function exportReading() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            schemaVersion: 'wiselink.3_1.bilingual_reading_export.v2',
            exportedAt: new Date().toISOString(),
            candidateOnly: true,
            scope: reading.completeness,
            source: reading.source,
            coverage: reading.coverage,
            anchors: reading.anchors,
            blocks: reading.blocks,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `双语候选-${reading.completeness}-${reading.source.documentVersionId}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setFeedback('已导出当前双语数据，保留原表结构、来源和缺项。');
  }
  return (
    <div className="wl-bilingual-reader">
      <header className="wl-bilingual-toolbar">
        <div>
          <strong>{scope}</strong>
          <p>
            {readableCount} / {reading.blocks.length}{' '}
            块可读。译文仅供阅读与评估参考。
          </p>
        </div>
        <div className="wl-bilingual-actions">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void copyReading()}
            disabled={!readableCount}
          >
            <Copy aria-hidden="true" />
            复制可读范围
          </Button>
          <Button variant="outline" size="sm" onClick={exportReading}>
            <Download aria-hidden="true" />
            导出双语数据
          </Button>
        </div>
      </header>
      {feedback ? (
        <p role="status" className="wl-bilingual-scope">
          {feedback}
        </p>
      ) : null}
      <p className="wl-bilingual-scope">
        已登记原文{' '}
        {reading.coverage.registeredSourceCharacters.toLocaleString('zh-CN')}{' '}
        字符；已保存范围{' '}
        {reading.coverage.savedSourceCharacters.toLocaleString('zh-CN')}
        ；可读范围{' '}
        {reading.coverage.readableSourceCharacters.toLocaleString('zh-CN')}
        。点击译文可查看其全部来源片段。
      </p>
      {reading.blocks.map((block) => {
        const sourceAnchors = block.source.anchorIds
          .map((id) => anchors.get(id)!)
          .filter(Boolean);
        const elements = block.selected?.candidate.elements ?? [];
        const isTable =
          block.source.kind === 'table' &&
          block.source.sourceStructure.some(
            (unit) => unit.payload.layout === 'grid',
          );
        const selected = sourceAnchors.some((anchor) =>
          selectedAnchors.includes(anchor.anchorId),
        );
        return (
          <article
            className={`wl-bilingual-block${selected ? ' is-selected' : ''}`}
            key={block.source.blockId}
          >
            <header>
              <span>{statusLabels[block.readingStatus]}</span>
              {block.selected ? (
                <small>
                  {block.selected.provenance.authorKind === 'ENGINEER'
                    ? '工程师修订'
                    : (block.selected.provenance.executionModel?.displayName ??
                      block.selected.provenance.modelVersion)}{' '}
                  · 版本 {block.selected.contentRevision}
                </small>
              ) : null}
            </header>
            <div className="wl-bilingual-columns">
              <div lang="en">
                <span className="wl-bilingual-column-label">原文</span>
                {isTable ? (
                  block.source.sourceStructure.map((unit) =>
                    unit.payload.layout === 'grid' ? (
                      <SourceGrid
                        key={unit.sourceUnitId}
                        payload={unit.payload}
                        sourceUnitId={unit.sourceUnitId}
                        anchors={sourceAnchors}
                        selectedAnchors={selectedAnchors}
                        onFocus={focus}
                      />
                    ) : null,
                  )
                ) : sourceAnchors.length ? (
                  sourceAnchors.map((anchor) => (
                    <p
                      key={anchor.anchorId}
                      className={
                        selectedAnchors.includes(anchor.anchorId)
                          ? 'is-highlighted'
                          : ''
                      }
                    >
                      {anchor.sourceText}
                    </p>
                  ))
                ) : (
                  <p className="wl-bilingual-scope">
                    该来源块没有已提取文字，请查看原文图示或引用。
                  </p>
                )}
              </div>
              <div lang="zh-CN">
                <span className="wl-bilingual-column-label">译文候选</span>
                {block.selected ? (
                  isTable ? (
                    block.source.sourceStructure.map((unit) =>
                      unit.payload.layout === 'grid' ? (
                        <SourceGrid
                          key={unit.sourceUnitId}
                          payload={unit.payload}
                          sourceUnitId={unit.sourceUnitId}
                          anchors={sourceAnchors}
                          elements={elements}
                          selectedAnchors={selectedAnchors}
                          onFocus={focus}
                        />
                      ) : null,
                    )
                  ) : elements.length ? (
                    elements.map((element) => (
                      <p
                        key={element.elementId}
                        className={`wl-bilingual-element kind-${element.kind}${element.anchorIds.some((id) => selectedAnchors.includes(id)) ? ' is-highlighted' : ''}`}
                      >
                        <button
                          type="button"
                          onClick={() => focus(element.anchorIds)}
                          title="显示这段译文的全部来源"
                        >
                          {element.translatedText}
                        </button>
                      </p>
                    ))
                  ) : (
                    <p className="wl-bilingual-scope">
                      原有结构或引用，无需另译文字。
                    </p>
                  )
                ) : (
                  <p className="wl-bilingual-unresolved">
                    {block.readingStatus === 'PENDING_CHECK'
                      ? '内容已保存，检查完成后显示译文。'
                      : block.readingStatus === 'BLOCKED'
                        ? '此处尚不能作为可读译文；原因见下方。'
                        : '此处尚未生成译文。'}
                  </p>
                )}
              </div>
            </div>
            {block.issues.length ? (
              <ul className="wl-bilingual-issues">
                {block.issues.map((issue, index) => (
                  <li
                    key={`${issue.code}-${index}`}
                    data-severity={issue.severity}
                  >
                    <strong>
                      {issue.origin === 'SOURCE' ? '原文' : '译文'} ·{' '}
                      {issue.severity === 'BLOCK'
                        ? '需处理'
                        : issue.severity === 'REVIEW'
                          ? '待复核'
                          : '提示'}
                      ：
                    </strong>
                    {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}
            {workItem ? (
              <TranslationRevisionEditor
                workItem={workItem}
                workspaceId={reading.workspaceId}
                blockId={block.source.blockId}
                onSaved={setRevisedReading}
              />
            ) : null}
            {workItem &&
            canRequestBlockTranslation &&
            !block.source.sourceIssues.some(
              (issue) => issue.severity === 'BLOCK',
            ) ? (
              <InitialAnalysisContinueButton
                workItemId={workItem.workItemId}
                expectedRevision={workItem.revision}
                operation="TRANSLATE"
                blockIds={[block.source.blockId]}
                label="重新翻译此完整块"
                onQueued={() => {
                  setFeedback(
                    '局部翻译请求已保存，原可读版本保留到新候选检查通过。',
                  );
                  onContinuationRequested?.();
                }}
              />
            ) : null}
            <footer>
              {sourceLinks(sourceAnchors).map(({ anchor, ref, label }) => (
                <button
                  type="button"
                  key={ref}
                  onClick={() => {
                    focus([anchor.anchorId]);
                    onSourceRefSelect(anchor.sourceUnitId, ref);
                  }}
                >
                  {label}
                </button>
              ))}
              {block.selected ? (
                <details>
                  <summary>版本来源</summary>
                  <p>
                    {block.selected.provenance.authorKind === 'ENGINEER'
                      ? '工程师修订候选'
                      : `模型：${block.selected.provenance.modelVersion}`}
                    <br />
                    保存：
                    {new Date(block.selected.savedAt).toLocaleString('zh-CN')}
                    <br />
                    检查：
                    {block.selected.checkedAt
                      ? new Date(block.selected.checkedAt).toLocaleString(
                          'zh-CN',
                        )
                      : '待检查'}
                  </p>
                </details>
              ) : null}
            </footer>
          </article>
        );
      })}
    </div>
  );
}

function sourceLinks(anchors: TranslationSourceAnchorV2[]) {
  const result = new Map<
    string,
    { anchor: TranslationSourceAnchorV2; ref: string; label: string }
  >();
  for (const anchor of anchors)
    for (const ref of anchor.sourceRefIds) {
      if (result.has(ref)) continue;
      const locator = anchor.sourceLocators.find(
        (entry) => entry.sourceRefId === ref,
      );
      const label =
        locator?.pageStart != null
          ? `第 ${locator.pageStart}${locator.pageEnd != null && locator.pageEnd !== locator.pageStart ? '–' + locator.pageEnd : ''} 页`
          : `来源 ${result.size + 1}`;
      result.set(ref, { anchor, ref, label });
    }
  return [...result.values()];
}

function readableText(reading: TranslationWorkspaceReadingV2) {
  const lines = [
    `双语阅读候选 · ${reading.completeness === 'PARTIAL' ? '部分范围' : reading.completeness === 'COMPLETE_WITH_ISSUES' ? '完整范围，有待复核项' : '完整范围'}`,
    `可读原文范围 ${reading.coverage.readableSourceCharacters}/${reading.coverage.registeredSourceCharacters} 字符；未覆盖来源单元 ${reading.coverage.unresolvedSourceUnitCount}。`,
    '本次复制仅含可读译文，不表示正式采用。',
    '',
  ];
  for (const [index, block] of reading.blocks.entries()) {
    const anchors = reading.anchors.filter((anchor) =>
      block.source.anchorIds.includes(anchor.anchorId),
    );
    lines.push(
      `${index + 1}. ${sourceLinks(anchors)
        .map((entry) => entry.label)
        .join('、')} · ${statusLabels[block.readingStatus]}`,
    );
    if (block.selected)
      lines.push(
        ...block.selected.candidate.elements.map(
          (element) => element.translatedText,
        ),
      );
    else lines.push('【此范围无可读译文】');
    lines.push(
      ...block.issues.map(
        (issue) =>
          `${issue.origin === 'SOURCE' ? '原文' : '译文'}提示：${issue.message}`,
      ),
      '',
    );
  }
  return lines.join('\n');
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function records(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item, index) => ({ value: record(item), index }))
        .filter(
          (item): item is { value: Record<string, unknown>; index: number } =>
            Boolean(item.value),
        )
    : [];
}
function numeric(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : -1;
}

function SourceGrid({
  payload,
  sourceUnitId,
  anchors,
  elements,
  selectedAnchors,
  onFocus,
}: {
  payload: Record<string, unknown>;
  sourceUnitId: string;
  anchors: TranslationSourceAnchorV2[];
  elements?: TranslationReadingElementV2[];
  selectedAnchors: string[];
  onFocus: (ids: string[]) => void;
}) {
  const columnCount = numeric(payload.columnCount);
  const groups = records(payload.rowGroups).sort(
    (a, b) => numeric(a.value.order) - numeric(b.value.order),
  );
  if (columnCount < 1 || !groups.length)
    return (
      <p className="wl-bilingual-unresolved">
        原表结构暂无法显示，请查看原文。
      </p>
    );
  const translationText = (ids: string[]) =>
    elements
      ?.filter((element) => element.anchorIds.some((id) => ids.includes(id)))
      .map((element) => element.translatedText)
      .join('\n');
  const sourceText = (ids: string[]) =>
    anchors
      .filter((anchor) => ids.includes(anchor.anchorId))
      .map((anchor) => anchor.sourceText)
      .join('\n');
  const extraAnchors = anchors.filter(
    (anchor) =>
      anchor.sourceUnitId === sourceUnitId &&
      !anchor.payloadPath.startsWith('/payload/rowGroups/'),
  );
  const renderedGroups: ReactNode[] = [];
  for (const group of groups) {
    const occupied = Array.from({ length: columnCount }, () => 0);
    const rows: ReactNode[] = [];
    for (const row of records(group.value.rows).sort(
      (a, b) => numeric(a.value.order) - numeric(b.value.order),
    )) {
      const cells: ReactNode[] = [];
      let cursor = 0;
      const sourceCells = records(row.value.cells).sort(
        (a, b) => numeric(a.value.columnStart) - numeric(b.value.columnStart),
      );
      for (const cell of sourceCells) {
        const start = numeric(cell.value.columnStart);
        const colSpan = numeric(cell.value.colSpan);
        const rowSpan = numeric(cell.value.rowSpan);
        if (
          start < 0 ||
          colSpan < 1 ||
          rowSpan < 1 ||
          start + colSpan > columnCount ||
          occupied.slice(start, start + colSpan).some((value) => value > 0)
        )
          return (
            <p className="wl-bilingual-unresolved">
              原表行列关系需核对，请查看原文。
            </p>
          );
        while (cursor < start) {
          if (occupied[cursor] === 0)
            cells.push(
              <td key={`blank-${cursor}`} aria-label="原表空白位置" />,
            );
          cursor += 1;
        }
        const prefix = `/payload/rowGroups/${group.index}/rows/${row.index}/cells/${cell.index}/inlineContent/`;
        const ids = anchors
          .filter(
            (anchor) =>
              anchor.sourceUnitId === sourceUnitId &&
              anchor.payloadPath.startsWith(prefix),
          )
          .map((anchor) => anchor.anchorId);
        const text = elements ? translationText(ids) : sourceText(ids);
        const Cell = cell.value.role === 'header' ? 'th' : 'td';
        const column = records(payload.columns).find(
          (item) => numeric(item.value.order) === start,
        )?.value;
        const align =
          column?.align === 'right' ||
          column?.align === 'center' ||
          column?.align === 'left'
            ? column.align
            : undefined;
        cells.push(
          <Cell
            key={String(cell.value.cellId ?? cell.index)}
            colSpan={colSpan}
            rowSpan={rowSpan}
            style={{ textAlign: align }}
            className={
              ids.some((id) => selectedAnchors.includes(id))
                ? 'is-highlighted'
                : ''
            }
          >
            {ids.length ? (
              <button type="button" onClick={() => onFocus(ids)}>
                {text}
              </button>
            ) : null}
          </Cell>,
        );
        for (let col = start; col < start + colSpan; col += 1)
          occupied[col] = rowSpan;
        cursor = start + colSpan;
      }
      while (cursor < columnCount) {
        if (occupied[cursor] === 0)
          cells.push(<td key={`blank-${cursor}`} aria-label="原表空白位置" />);
        cursor += 1;
      }
      for (let col = 0; col < columnCount; col += 1)
        occupied[col] = Math.max(0, occupied[col] - 1);
      rows.push(<tr key={String(row.value.rowId ?? row.index)}>{cells}</tr>);
    }
    const Group =
      group.value.kind === 'thead'
        ? 'thead'
        : group.value.kind === 'tfoot'
          ? 'tfoot'
          : 'tbody';
    renderedGroups.push(
      <Group key={String(group.value.rowGroupId ?? group.index)}>{rows}</Group>,
    );
  }
  return (
    <div className="wl-bilingual-grid">
      {extraAnchors.map((anchor) => (
        <p key={anchor.anchorId}>
          {elements ? translationText([anchor.anchorId]) : anchor.sourceText}
        </p>
      ))}
      <table>
        <colgroup>
          {records(payload.columns)
            .sort((a, b) => numeric(a.value.order) - numeric(b.value.order))
            .map((column) => (
              <col
                key={String(column.value.columnId ?? column.index)}
                style={{
                  width:
                    typeof column.value.width === 'string' &&
                    /^(?:\d+(?:\.\d+)?)(?:%|px|em|rem)$/u.test(
                      column.value.width,
                    )
                      ? column.value.width
                      : undefined,
                }}
              />
            ))}
        </colgroup>
        {renderedGroups}
      </table>
    </div>
  );
}
