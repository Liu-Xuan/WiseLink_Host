import { useMemo, useState } from 'react';
import type { LcmMatrixResponse, LcmMatrixQuery } from '@shared/lcm-matrix.interface';
import { lcmNativeAircraftRows, type LcmNativeIndex, type LcmNativeAircraftRow } from '@shared/lcm-native-matrix-core';
import { Button } from '@client/src/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@client/src/components/ui/table';
import { lcmBindingKey } from './lcm-matrix-route';
import { lcmModelNames, lcmRawBlank, lcmRawStateLabel, lcmSnapshotStateDate } from './lcm-source-presentation';
import type { LcmMatrixSelection } from './LcmMatrixGrid';

const factLabel = (value: boolean | null): string => value === true ? '是' : value === false ? '否' : '—';
const PAGE_SIZE: number = 100;

export function LcmAircraftTable({ query, matrix, nativeIndex, aircraftRef, onBack, onSelect }: {
  query: LcmMatrixQuery; matrix: LcmMatrixResponse; nativeIndex: LcmNativeIndex; aircraftRef: string;
  onBack(): void; onSelect(selection: LcmMatrixSelection): void;
}) {
  const aircraft = matrix.aircraftIndex.find(value => value.aircraftRef === aircraftRef);
  const key: string = JSON.stringify([lcmBindingKey(matrix.binding), query, aircraftRef]);
  const [page, setPage] = useState<{ key: string; offset: number }>({ key: '', offset: 0 });
  const offset: number = page.key === key ? page.offset : 0;
  const rows: LcmNativeAircraftRow[] = useMemo(() => lcmNativeAircraftRows(nativeIndex, query, aircraftRef),
    [nativeIndex, query, aircraftRef]);
  return <section className="mx-panel mx-aircraft-table" aria-label="单机构型"
    data-readset-ref={matrix.binding.readSetRef} data-order-ref={matrix.binding.orderRef}>
    <header className="mx-panel-heading"><Button variant="outline" size="sm" onClick={onBack}>返回矩阵</Button>
      <h2>{aircraft?.tailNumber}</h2><span>{lcmModelNames(aircraft?.models ?? [])}</span>
      <span>当前快照日：{[...new Set(matrix.snapshots.map(snapshot =>
        lcmSnapshotStateDate(snapshot) ?? '未识别'))].sort().join(' / ')}</span>
    </header>
    <Table><TableHeader><TableRow>{['LCM 软件名称', '软件件号', 'FIN / 位置', '原值', '实装', '允装', '来源']
      .map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{rows.slice(offset, offset + PAGE_SIZE).map((entry: LcmNativeAircraftRow) => <TableRow key={entry.key}>
        <TableCell>{entry.lcmSoftwareName ?? '—'}</TableCell>
        <TableCell className="mx-pn">{entry.partNumber ?? '—'}</TableCell>
        <TableCell className="mx-pn">{entry.fin ?? '—'}</TableCell>
        <TableCell data-native-value={entry.rawValue === null ? '' : String(entry.rawValue)}>
          {lcmRawStateLabel(entry.rawValue)}</TableCell>
        <TableCell>{lcmRawBlank(entry.rawValue) ? '无' : factLabel(entry.installed)}</TableCell>
        <TableCell>{lcmRawBlank(entry.rawValue) ? '无' : factLabel(entry.allowed)}</TableCell>
        <TableCell><Button variant="ghost" size="sm" onClick={() => onSelect({
          softwareRef: entry.softwareRef, aircraftRef, partNumber: entry.partNumber,
        })}>源记录</Button></TableCell>
      </TableRow>)}</TableBody>
    </Table>
    {!rows.length ? <p role="status">当前筛选没有匹配记录。</p> : null}
    <div className="mx-pagination"><span>{rows.length} 源行</span>
      {offset > 0 ? <Button variant="outline" size="sm" onClick={() =>
        setPage({ key, offset: Math.max(0, offset - PAGE_SIZE) })}>上一页</Button> : null}
      {offset + PAGE_SIZE < rows.length ? <Button variant="outline" size="sm" onClick={() =>
        setPage({ key, offset: offset + PAGE_SIZE })}>下一页</Button> : null}
    </div>
  </section>;
}
