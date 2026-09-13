import type { ReactNode } from 'react';
import type {
  TranslationReadingElementV2,
  TranslationSourceAnchorV2,
} from '@shared/canonical-translation-v2.interface';

function records(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown, index: number) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? [{ value: entry as Record<string, unknown>, index }]
      : [],
  );
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : -1;
}

/** Both native V2 and the official-parser original use explicit zero-based cell positions. */
function cellStart(cell: Record<string, unknown>): number {
  if (
    cell.columnStart !== undefined &&
    cell.columnIndex !== undefined &&
    cell.columnStart !== cell.columnIndex
  )
    return -1;
  return numeric(cell.columnStart ?? cell.columnIndex);
}
function sourceColumnCount(payload: Record<string, unknown>): number {
  if (payload.columnCount !== undefined) return numeric(payload.columnCount);
  if (payload.layout !== 'grid') return -1;
  const cells = records(payload.rowGroups).flatMap((group) =>
    records(group.value.rows).flatMap((row) => records(row.value.cells)),
  );
  if (
    !cells.length ||
    cells.some(
      (cell) => cellStart(cell.value) < 0 || numeric(cell.value.colSpan) < 1,
    )
  )
    return -1;
  // Derive the extent from actual occupied columns, never from text or a guessed header row.
  return cells.reduce(
    (extent, cell) =>
      Math.max(extent, cellStart(cell.value) + numeric(cell.value.colSpan)),
    0,
  );
}

/** Row, column, continuation and footnote ownership come only from source payload. */
export function SemanticSourceGrid({
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
  const columnCount: number = sourceColumnCount(payload);
  const groups = records(payload.rowGroups).sort(
    (a, b) => numeric(a.value.order) - numeric(b.value.order),
  );
  if (columnCount < 1 || !groups.length)
    return (
      <p className="wl-bilingual-unresolved">
        原表结构暂无法显示，请查看原文。
      </p>
    );
  const renderedGroups: ReactNode[] = [];
  for (const group of groups) {
    const occupied: number[] = Array.from({ length: columnCount }, () => 0);
    const rows: ReactNode[] = [];
    for (const row of records(group.value.rows).sort(
      (a, b) => numeric(a.value.order) - numeric(b.value.order),
    )) {
      const cells: ReactNode[] = [];
      let cursor: number = 0;
      for (const cell of records(row.value.cells).sort(
        (a, b) => cellStart(a.value) - cellStart(b.value),
      )) {
        const start: number = cellStart(cell.value);
        const colSpan: number = numeric(cell.value.colSpan);
        const rowSpan: number = numeric(cell.value.rowSpan);
        if (
          start < cursor ||
          colSpan < 1 ||
          rowSpan < 1 ||
          start + colSpan > columnCount ||
          occupied.slice(start, start + colSpan).some((value) => value > 0)
        ) {
          return (
            <p className="wl-bilingual-unresolved">
              原表行列关系需核对，请查看原文。
            </p>
          );
        }
        while (cursor < start) {
          if (occupied[cursor] === 0)
            cells.push(
              <td key={`blank-${cursor}`} aria-label="原表空白位置" />,
            );
          cursor += 1;
        }
        const prefix: string = `/payload/rowGroups/${group.index}/rows/${row.index}/cells/${cell.index}/inlineContent/`;
        const cellAnchors = anchors.filter(
          (anchor) =>
            anchor.sourceUnitId === sourceUnitId &&
            anchor.payloadPath.startsWith(prefix),
        );
        const ids: string[] = cellAnchors.map((anchor) => anchor.anchorId);
        const text: string = elements
          ? elements
              .filter((element) =>
                element.anchorIds.some((id) => ids.includes(id)),
              )
              .map((element) => element.translatedText)
              .join('\n')
          : cellAnchors.map((anchor) => anchor.sourceText).join('\n');
        const Cell =
          cell.value.role === 'header' ||
          cell.value.isHeader === true ||
          group.value.kind === 'thead'
            ? 'th'
            : 'td';
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
              <button
                type="button"
                onClick={() => onFocus(ids)}
                title="查看该单元格的全部来源"
              >
                {text || '【此单元未返回可读译文】'}
              </button>
            ) : null}
          </Cell>,
        );
        for (let col: number = start; col < start + colSpan; col += 1)
          occupied[col] = rowSpan;
        cursor = start + colSpan;
      }
      while (cursor < columnCount) {
        if (occupied[cursor] === 0)
          cells.push(<td key={`blank-${cursor}`} aria-label="原表空白位置" />);
        cursor += 1;
      }
      for (let col: number = 0; col < columnCount; col += 1)
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
    <div
      className="wl-bilingual-grid"
      tabIndex={0}
      aria-label="原表行列与脚注结构"
    >
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
