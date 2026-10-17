import {
  useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type UIEvent,
} from 'react';
import { ChevronDown, ChevronRight, ArrowDownWideNarrow } from 'lucide-react';
import type {
  LcmMatrixResponse, LcmMatrixSoftwareIndex, LcmMatrixSummaryCell, LcmMatrixPartCell,
} from '@shared/lcm-matrix.interface';
import { Button } from '@client/src/components/ui/button';
import { lcmModelNames, lcmSnapshotStateDate } from './lcm-source-presentation';
import { lcmMatrixRows, lcmRowWindow, lcmWindowForRows, lcmPreserveScrollAnchor,
  type LcmGridWindow, type LcmMatrixRow } from './lcm-matrix-layout';

export interface LcmMatrixSelection { softwareRef: string; aircraftRef?: string; partNumber?: string | null }
interface LcmMatrixGridProps {
  index: LcmMatrixResponse;
  windowData: LcmMatrixResponse | null;
  expanded: Set<string>;
  initialScroll: { x: number; y: number };
  savedSelection?: LcmMatrixSelection | null;
  onWindow(value: LcmGridWindow): void;
  onScrollPosition(x: number, y: number): void;
  onExpand(ref: string): void;
  onSort(ref: string | null): void;
  onSelect(selection: LcmMatrixSelection): void;
  onAircraft(ref: string): void;
  isSourceBlank?(selection: LcmMatrixSelection): boolean;
}

const cellLabels: Record<LcmMatrixPartCell['state'], string> = {
  INSTALLED: '明确实装', PARTIAL_INSTALLED: '明确实装，另有未知记录', ALLOWED_ONLY: '仅允装',
  UNKNOWN: '未知', NO_RECORD: '无对应记录', CONFLICT: '来源冲突待核对',
};
const cellSymbols: Record<LcmMatrixPartCell['state'], string> = {
  INSTALLED: '1', PARTIAL_INSTALLED: '1', ALLOWED_ONLY: '2', UNKNOWN: '？', NO_RECORD: '—', CONFLICT: '△',
};

export function lcmSummaryLabel(cell: LcmMatrixSummaryCell, sourceBlank = false): string {
  if (cell.qualification === 'CONFLICT') return '待核对';
  if (cell.qualification === 'NO_RECORD') return '—';
  const parts = cell.installedPartNumbers.join('、');
  return parts || (sourceBlank ? '无' : '—');
}

/** One scroll container, shared row/column model, and a bounded DOM on both axes. */
export function LcmMatrixGrid(props: LcmMatrixGridProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const [viewport, setViewport] = useState({ x: props.initialScroll.x, y: props.initialScroll.y, width: 1000, height: 500 });
  const rows = useMemo(() => lcmMatrixRows(props.index.softwareIndex, props.expanded),
    [props.index.softwareIndex, props.expanded]);
  const priorRows = useRef<LcmMatrixRow[]>(rows);
  const [active, setActive] = useState<{ rowKey: string; aircraftRef: string } | null>(() =>
    props.savedSelection?.aircraftRef ? {
      rowKey: props.savedSelection.partNumber === undefined ? props.savedSelection.softwareRef
        : JSON.stringify([props.savedSelection.softwareRef, props.savedSelection.partNumber]),
      aircraftRef: props.savedSelection.aircraftRef,
    } : null);
  const identityWidth = viewport.width < 640 ? 172 : 280;
  const countWidth = viewport.width < 640 ? 56 : 72;
  const fixedWidth = identityWidth + countWidth;
  const columnWidth = 180;
  const headerHeight = 64;
  const [rowStart, rowEnd] = lcmRowWindow(rows, Math.max(0, viewport.y - headerHeight), viewport.height);
  const columnStart = Math.min(Math.max(0, props.index.aircraftOrder.length - 1),
    Math.max(0, Math.floor(viewport.x / columnWidth) - 1));
  const columnEnd = Math.min(props.index.aircraftOrder.length,
    Math.ceil((viewport.x + Math.max(0, viewport.width - fixedWidth)) / columnWidth) + 2);
  const visibleColumns = props.index.aircraftOrder.slice(columnStart, columnEnd);
  const aircraft = useMemo(() => new Map(props.index.aircraftIndex.map(plane => [plane.aircraftRef, plane])),
    [props.index.aircraftIndex]);
  const windows = useMemo(() => new Map(props.windowData?.softwareGroups.map(group => [group.softwareRef, {
    summaries: new Map(group.summaryCells.map(cell => [cell.aircraftRef, cell])),
    parts: new Map(group.partRows.map(part => [part.partNumber, new Map(part.cells.map(cell => [cell.aircraftRef, cell]))])),
  }]) ?? []), [props.windowData]);
  const totalHeight = (rows.at(-1)?.top ?? 0) + (rows.at(-1)?.height ?? 0) + headerHeight;
  const totalWidth = fixedWidth + props.index.aircraftOrder.length * columnWidth;
  const anchor = props.index.softwareIndex.find(group => group.softwareRef === props.index.anchorSoftwareRef);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    element.scrollLeft = props.initialScroll.x; element.scrollTop = props.initialScroll.y;
    setViewport(value => ({ ...value, x: element.scrollLeft, y: element.scrollTop }));
    const observer = new ResizeObserver(() => setViewport(value => ({ ...value,
      width: element.clientWidth, height: element.clientHeight })));
    observer.observe(element);
    return () => { observer.disconnect(); if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, []); // Position is restored only when this exact matrix view mounts.

  useLayoutEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTop = lcmPreserveScrollAnchor(priorRows.current, rows,
      Math.max(0, element.scrollTop - headerHeight)) + (element.scrollTop >= headerHeight ? headerHeight : 0);
    priorRows.current = rows;
  }, [rows]);

  useEffect(() => {
    props.onWindow(lcmWindowForRows(rows, rowStart, rowEnd, columnStart, columnEnd - columnStart));
  }, [rows, rowStart, rowEnd, columnStart, columnEnd, props.onWindow]);

  function onScroll(event: UIEvent<HTMLDivElement>): void {
    const element = event.currentTarget;
    props.onScrollPosition(element.scrollLeft, element.scrollTop);
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setViewport(value => ({ ...value, x: element.scrollLeft, y: element.scrollTop }));
    });
  }

  function cellId(row: LcmMatrixRow, aircraftRef: string): string {
    return 'mx-cell-' + encodeURIComponent(JSON.stringify([row.key, aircraftRef]));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.target !== event.currentTarget &&
      (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'gridcell')) return;
    if (!rows.length || !props.index.aircraftOrder.length) return;
    let rowIndex = Math.max(0, rows.findIndex(row => row.key === active?.rowKey));
    let columnIndex = Math.max(0, props.index.aircraftOrder.indexOf(active?.aircraftRef ?? ''));
    if (event.key === 'Enter') {
      const row = rows[rowIndex];
      props.onSelect({ softwareRef: row.software.softwareRef, aircraftRef: props.index.aircraftOrder[columnIndex],
        ...(row.partNumber === undefined ? {} : { partNumber: row.partNumber }) });
      event.preventDefault(); return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'ArrowLeft') columnIndex--;
    if (event.key === 'ArrowRight') columnIndex++;
    if (event.key === 'ArrowUp') rowIndex--;
    if (event.key === 'ArrowDown') rowIndex++;
    if (event.key === 'Home') { columnIndex = 0; if (event.ctrlKey || event.metaKey) rowIndex = 0; }
    if (event.key === 'End') {
      columnIndex = props.index.aircraftOrder.length - 1;
      if (event.ctrlKey || event.metaKey) rowIndex = rows.length - 1;
    }
    rowIndex = Math.min(rows.length - 1, Math.max(0, rowIndex));
    columnIndex = Math.min(props.index.aircraftOrder.length - 1, Math.max(0, columnIndex));
    const row = rows[rowIndex], element = scroller.current;
    setActive({ rowKey: row.key, aircraftRef: props.index.aircraftOrder[columnIndex] });
    if (!element) return;
    if (row.top < element.scrollTop) element.scrollTop = row.top;
    if (row.top + row.height + headerHeight > element.scrollTop + element.clientHeight)
      element.scrollTop = row.top + row.height + headerHeight - element.clientHeight;
    if (columnIndex * columnWidth < element.scrollLeft) element.scrollLeft = columnIndex * columnWidth;
    if ((columnIndex + 1) * columnWidth > element.scrollLeft + element.clientWidth - fixedWidth)
      element.scrollLeft = (columnIndex + 1) * columnWidth - element.clientWidth + fixedWidth;
    element.focus();
  }

  function content(row: LcmMatrixRow, ref: string): {
    label: string; node: React.ReactNode; conflict: boolean; tone?: number;
  } {
    const group = windows.get(row.software.softwareRef);
    if (row.partNumber !== undefined) {
      const cell = group?.parts.get(row.partNumber)?.get(ref);
      if (cell?.state === 'UNKNOWN' && props.isSourceBlank?.({ softwareRef: row.software.softwareRef,
        aircraftRef: ref, partNumber: row.partNumber })) return { label: '无', node: '无', conflict: false };
      return { label: cell ? cellLabels[cell.state] : '正在读取',
        node: cell ? cellSymbols[cell.state] : '…', conflict: cell?.state === 'CONFLICT' };
    }
    const cell = group?.summaries.get(ref);
    if (!cell) return { label: '正在读取', node: '…', conflict: false };
    const label = lcmSummaryLabel(cell, cell.qualification === 'UNCONFIRMED' && Boolean(props.isSourceBlank?.({
      softwareRef: row.software.softwareRef, aircraftRef: ref,
    })));
    const parts = cell.installedPartNumbers;
    const signature = JSON.stringify(parts);
    let category = 0;
    for (const character of signature) category = (category * 31 + character.charCodeAt(0)) >>> 0;
    return { label, conflict: cell.qualification === 'CONFLICT', tone: parts.length ? category % 6 : undefined,
      node: cell.qualification === 'CONFLICT' || !parts.length ? label : <>
        {parts.slice(0, 2).map(part => <span className="mx-pn" key={part}>{part}</span>)}
        {parts.length > 2 ? <small>另 {parts.length - 2} 件号 · 查看完整</small> : null}
      </> };
  }

  const activeRow = rows.find(row => row.key === active?.rowKey);
  const activeVisible = activeRow && active && rows.indexOf(activeRow) >= rowStart &&
    rows.indexOf(activeRow) < rowEnd && visibleColumns.includes(active.aircraftRef);
  return <section className="mx-panel" aria-label="构型矩阵">
    <div className="mx-panel-heading"><strong>构型矩阵</strong>
      {anchor ? <span>飞机列按 {anchor.lcmSoftwareName} 实装件号分组
        <Button variant="ghost" size="sm" onClick={() => props.onSort(null)}>恢复飞机号</Button></span>
        : <span>飞机号自然顺序</span>}
      <span className="mx-legend">1 实装 · 2 允装 · 空白＝无 · ？ 未知 · △ 待核对</span>
    </div>
    <div ref={scroller} className="mx-scroll" role="treegrid" aria-label="LCM 软件名称、件号与飞机矩阵"
      data-readset-ref={props.index.binding.readSetRef} data-order-ref={props.index.binding.orderRef}
      aria-rowcount={rows.length + 1} aria-colcount={props.index.aircraftOrder.length + 2}
      aria-activedescendant={activeVisible ? cellId(activeRow!, active!.aircraftRef) : undefined}
      tabIndex={0} onScroll={onScroll} onKeyDown={onKeyDown}
      style={{ '--mx-name-width': identityWidth + 'px', '--mx-count-width': countWidth + 'px' } as React.CSSProperties}>
      <div className="mx-canvas" style={{ width: totalWidth, height: totalHeight }}>
        <div className="mx-grid-head" role="row" aria-rowindex={1} style={{ width: totalWidth, height: headerHeight }}>
          <div className="mx-identity" role="columnheader" aria-colindex={1}>LCM 软件名称 / 件号</div>
          <div className="mx-count" role="columnheader" aria-colindex={2}>实装架数</div>
          {visibleColumns.map((ref, offset) => {
            const columnIndex = columnStart + offset;
            const group = props.index.orderGroups.find(value => value.startIndex <= columnIndex &&
              value.endIndexExclusive > columnIndex);
            const groupLabel = group?.kind === 'UNCONFIRMED_BUCKET' ? '未取得实装件号'
              : group?.kind === 'CONFLICT_BUCKET' ? '待核对'
                : group ? '组 ' + (props.index.orderGroups.indexOf(group) + 1) : '';
            return <div role="columnheader" aria-colindex={columnIndex + 3} className="mx-plane-head" key={ref}
              style={{ left: fixedWidth + columnIndex * columnWidth, width: columnWidth }}
              title={group?.installedPartNumbers.join('、')}>
              <small>{group?.startIndex === columnIndex || offset === 0 ? groupLabel : ''}</small>
              <Button variant="ghost" size="sm" title={lcmModelNames(aircraft.get(ref)?.models ?? [])}
                onClick={() => props.onAircraft(ref)}>
                {aircraft.get(ref)?.tailNumber} ↗</Button>
            </div>;
          })}
        </div>
        {rows.slice(rowStart, rowEnd).map((row, offset) => {
          const software: LcmMatrixSoftwareIndex = row.software;
          const isParent = row.partNumber === undefined;
          const name = software.lcmSoftwareName ?? '软件名称未取得';
          const count = software.parts.find(part => part.partNumber === row.partNumber);
          return <div role="row" key={row.key} aria-rowindex={rowStart + offset + 2} aria-level={isParent ? 1 : 2}
            aria-selected={props.savedSelection?.softwareRef === software.softwareRef &&
              props.savedSelection.partNumber === row.partNumber}
            aria-expanded={isParent ? props.expanded.has(software.softwareRef) : undefined}
            className={'mx-grid-row ' + (isParent ? 'mx-parent' : 'mx-child')}
            style={{ top: headerHeight + row.top, height: row.height, width: totalWidth }}>
            <div className="mx-identity" role="rowheader" aria-colindex={1}>
              {isParent ? <>
                <Button variant="ghost" size="icon" aria-expanded={props.expanded.has(software.softwareRef)}
                  aria-label={(props.expanded.has(software.softwareRef) ? '折叠 ' : '展开 ') + name}
                  onClick={() => props.onExpand(software.softwareRef)}>
                  {props.expanded.has(software.softwareRef) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </Button>
                <button type="button" className="mx-name" aria-label={'查看 ' + name + ' 详情'}
                  onClick={() => props.onSelect({ softwareRef: software.softwareRef })}>
                  <strong>{name}</strong><small>ATA {software.ata.join(' / ') || '未知'}</small></button>
                <Button variant="ghost" size="icon" aria-label={'按 ' + name + ' 实装件号排列飞机列'}
                  aria-pressed={props.index.anchorSoftwareRef === software.softwareRef}
                  onClick={() => props.onSort(software.softwareRef)}><ArrowDownWideNarrow size={15} /></Button>
              </> : <button className="mx-name mx-pn" type="button" aria-label={row.partNumber ?? '件号未取得'}
                onClick={() => props.onSelect({ softwareRef: software.softwareRef, partNumber: row.partNumber })}>
                {row.partNumber ?? '件号未取得'}</button>}
            </div>
            <div className="mx-count" role="gridcell" aria-colindex={2}>
              {count ? <span aria-label={String(count.confirmedInstalledAircraftCount) + ' 架实装'}>
                {count.confirmedInstalledAircraftCount}<small>架</small>
              </span> : null}
            </div>
            {visibleColumns.map((ref, columnOffset) => {
              const value = content(row, ref);
              return <button type="button" role="gridcell" tabIndex={-1} id={cellId(row, ref)} key={ref}
                aria-colindex={columnStart + columnOffset + 3}
                aria-label={name + '，' + (aircraft.get(ref)?.tailNumber ?? ref) + '，' +
                  (isParent ? '' : (row.partNumber ?? '件号未取得') + '，') + value.label}
                className={'mx-data-cell' + (value.tone === undefined ? '' : ' mx-tone-' + value.tone) +
                  (value.conflict ? ' mx-conflict' : '') +
                  (active?.rowKey === row.key && active.aircraftRef === ref ? ' mx-active' : '')}
                style={{ left: fixedWidth + (columnStart + columnOffset) * columnWidth, width: columnWidth }}
                onClick={() => {
                  setActive({ rowKey: row.key, aircraftRef: ref });
                  props.onSelect({ softwareRef: software.softwareRef, aircraftRef: ref,
                    ...(isParent ? {} : { partNumber: row.partNumber }) });
                }}>{value.node}</button>;
            })}
          </div>;
        })}
      </div>
    </div>
    <footer className="mx-footer">{props.index.softwareIndex.length} 个软件 · {props.index.aircraftOrder.length} 架飞机
      <span>状态日 {[...new Set(props.index.snapshots.map(snapshot =>
        lcmSnapshotStateDate(snapshot) ?? '未识别'))].sort().join(' / ')}</span></footer>
  </section>;
}
