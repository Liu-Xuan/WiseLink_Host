import type { DocumentOriginalResult } from '@shared/document-original.interface';
import { DocumentOriginalPreview } from '../WorkspaceHomePage/DocumentOriginalPreview';

/** Uses saved source units and explicit page precision; never invents highlight boxes. */
export function DocumentOriginalReader({ original }: { original: DocumentOriginalResult }) {
  const { coverage } = original;
  return <section aria-label="已保存原文">
    <p role="status">已读取 {coverage.readPageIndexes.length}{coverage.knownPageCount === null ? '' : ` / ${coverage.knownPageCount}`} 页文本。
      {coverage.unresolvedRanges.length > 0 ? '以下范围仍有限制。' : '文本范围已清点；不代表工程结论已采用。'}</p>
    {coverage.unresolvedRanges.length > 0 && <ul aria-label="原文覆盖与定位限制">
      {coverage.unresolvedRanges.map((range, index) => <li key={index}>
        {range.pageIndexes.length ? `第 ${range.pageIndexes.map(page => page + 1).join('、')} 页：` : ''}{range.message}
        {range.pageIndexes.map(page => <span key={page}> 原件第 {page + 1} 页：
          <DocumentOriginalPreview documentVersionId={original.binding.documentVersionId} page={page + 1}>查看原件第 {page + 1} 页</DocumentOriginalPreview>
        </span>)}
      </li>)}
    </ul>}
    {original.source.units.map(unit => {
      const pageIndexes = [...new Set(original.locations.filter(location => unit.sourceRefIds.includes(location.sourceRefId))
        .map(location => location.pageIndex).filter((page): page is number => page !== null))];
      return <article key={unit.unitId} id={unit.unitId}>
        {unit.kind === 'table' ? <OriginalTable payload={unit.payload} /> : unit.kind === 'heading'
          ? <h3>{String(unit.payload.text ?? '')}</h3>
          : <p style={{ whiteSpace: 'pre-wrap' }}>{String(unit.payload.text ?? '')}</p>}
        <nav aria-label="此段原件位置">{pageIndexes.map(page =>
          <DocumentOriginalPreview key={page} documentVersionId={original.binding.documentVersionId} page={page + 1}>
            原件第 {page + 1} 页（页级定位）
          </DocumentOriginalPreview>)}</nav>
      </article>;
    })}
  </section>;
}

function OriginalTable({ payload }: { payload: Record<string, unknown> }) {
  const groups = payload.rowGroups as Array<{ rows: Array<{ rowId: string; cells: Array<{
    cellId: string; isHeader?: boolean; rowSpan: number; colSpan: number; inlineContent: Array<{ text: string }>;
  }> }> }>;
  return <div style={{ overflowX: 'auto' }}><table>{typeof payload.caption === 'string' && payload.caption ? <caption>{payload.caption}</caption> : null}<tbody>{groups.flatMap(group => group.rows).map(row =>
    <tr key={row.rowId}>{row.cells.map(cell => { const Cell = cell.isHeader ? 'th' : 'td'; return <Cell key={cell.cellId} rowSpan={cell.rowSpan} colSpan={cell.colSpan}>
      {cell.inlineContent.map(item => item.text).join('')}
    </Cell>; })}</tr>)}</tbody></table></div>;
}
