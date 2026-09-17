import { useMemo, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { DocumentOriginalBinding, DocumentOriginalResult } from '@shared/document-original.interface';
import { originalReadingGroups, originalUnitPages, sameOriginalBinding } from './original-reading';

/**
 * Continuous reading projection of the saved source units. Page furniture is hidden
 * in the display only; saved units, identities and locations stay untouched.
 */
export function DocumentOriginalReader({
  original,
  onUnitLocate,
}: {
  original: DocumentOriginalResult;
  onUnitLocate?: (page: number, unitId: string) => void;
}) {
  const groups = useMemo(() => originalReadingGroups(original), [original]);
  const [notice, setNotice] = useState<string | null>(null);
  const [pageChoice, setPageChoice] = useState<{ unitId: string; pages: number[]; binding: DocumentOriginalBinding } | null>(null);
  const { coverage } = original;

  // Synchronously re-validate the recorded choice against the current original:
  // a rerender to a new parse run / page set must make the old choice invisible
  // and un-clickable without waiting for an effect, and a click may only pass a
  // page from the current binding's page set. No async cleanup is involved.
  const currentChoicePages = pageChoice ? originalUnitPages(original, pageChoice.unitId) : [];
  const choice = pageChoice
    && sameOriginalBinding(pageChoice.binding, original.binding)
    && pageChoice.pages.length === currentChoicePages.length
    && pageChoice.pages.every((page, index) => page === currentChoicePages[index])
    ? pageChoice : null;

  function locate(unitId: string): void {
    const pages = originalUnitPages(original, unitId);
    if (pages.length === 0 || !onUnitLocate) {
      setNotice('此段在当前解析版本中没有可用的物理页定位，未跳转原件。');
      return;
    }
    setNotice(null);
    // A unit spanning multiple pages never guesses a page: the reader offers the
    // real saved pages and locates only the page the user picks.
    if (pages.length > 1) { setPageChoice({ unitId, pages, binding: original.binding }); return; }
    setPageChoice(null);
    onUnitLocate(pages[0], unitId);
  }

  function activate(event: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>, unitId: string): void {
    if (event.type === 'keydown') event.preventDefault();
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && String(selection).trim().length > 0) return;
    locate(unitId);
  }

  function locatableProps(unitId: string, block = false) {
    return {
      'data-unit-id': unitId,
      className: block ? 'original-locatable original-locatable-block' : 'original-locatable',
      tabIndex: 0,
      role: 'button',
      onClick: (event: ReactMouseEvent<HTMLElement>) => {
        const target = (event.target as HTMLElement).closest('[data-unit-id]');
        activate(event, target?.getAttribute('data-unit-id') ?? unitId);
      },
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        activate(event, unitId);
      },
    };
  }

  return <section className="document-original-reader" aria-label="已保存原文">
    {coverage.unresolvedRanges.length > 0 && <ul className="document-original-reading-limits" aria-label="原文覆盖与定位限制">
      {coverage.unresolvedRanges.map((range, index) => <li key={index}>
        {range.pageIndexes.length ? `第 ${range.pageIndexes.map(page => page + 1).join('、')} 页：` : ''}{range.message}
      </li>)}
    </ul>}
    {notice && <p role="status" className="document-original-notice">{notice}</p>}
    {choice && <div className="document-original-page-choice" role="group" aria-label="此段跨越多页，选择要定位的原件页">
      <span>此段跨越多页，选择定位页：</span>
      {choice.pages.map(page => <button key={page} type="button" onClick={() => {
        const target = choice.unitId;
        setPageChoice(null);
        onUnitLocate?.(page, target);
      }}>第 {page} 页</button>)}
      <button type="button" onClick={() => setPageChoice(null)}>取消</button>
    </div>}
    {groups.map(group => {
      const unit = group[0];
      return <article key={unit.unitId}>
        {unit.kind === 'heading' ? <h3 id={unit.unitId}>{String(unit.payload.text ?? '')}</h3>
          : unit.kind === 'table' ? <div id={unit.unitId} {...locatableProps(unit.unitId, true)}><OriginalTable payload={unit.payload} /></div>
          : <p style={{ whiteSpace: 'pre-wrap' }}>
            {group.map((member, index) => <span key={member.unitId} id={member.unitId} {...locatableProps(member.unitId)}>
              {index ? ' ' : ''}{String(member.payload.text ?? '')}
            </span>)}
          </p>}
      </article>;
    })}
  </section>;
}

function OriginalTable({ payload }: { payload: Record<string, unknown> }) {
  const groups = payload.rowGroups as Array<{ rows: Array<{ rowId: string; cells: Array<{
    cellId: string; isHeader?: boolean; rowSpan: number; colSpan: number; inlineContent: Array<{ text: string }>;
  }> }> }>;
  return <div style={{ overflowX: 'auto' }}><table>{typeof payload.caption === 'string' && payload.caption ? <caption>{payload.caption}</caption> : null}<tbody>{groups.flatMap(group => group.rows).map(row =>
    <tr key={row.rowId} id={row.rowId}>{row.cells.map(cell => { const Cell = cell.isHeader ? 'th' : 'td'; return <Cell key={cell.cellId} id={cell.cellId} rowSpan={cell.rowSpan} colSpan={cell.colSpan}>
      {cell.inlineContent.map(item => item.text).join(' ')}
    </Cell>; })}</tr>)}</tbody></table></div>;
}
