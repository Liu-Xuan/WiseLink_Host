import { useMemo, useState } from 'react';
import type { LcmMatrixResponse } from '@shared/lcm-matrix.interface';
import type { LcmNativeMatrixResponse } from '@shared/lcm-native-matrix.interface';
import { WiseLinkRuntimeMonitor } from '../DocumentParsingPage/runtime-monitor/WiseLinkRuntimeMonitor';
import { adaptLcmNativeRead, lcmDiagnosticCanOpenReading } from './adapt-lcm-native-read';
import { lcmSnapshotTimeFacts } from './lcm-source-presentation';

interface Props {
  read: LcmNativeMatrixResponse;
  matrix: LcmMatrixResponse;
  scopeKey: string;
  aircraftRef: string | null;
  observedAt: string;
  onRefresh: () => void;
  onOpenReading: () => void;
}

/** No extra read or model request; all source data belongs to the parent's current authorized read. */
export function LcmRuntimeDiagnostic({ read, matrix, scopeKey, aircraftRef, observedAt, onRefresh, onOpenReading }: Props) {
  const [expanded, setExpanded] = useState(false);
  const runtime = useMemo(() => adaptLcmNativeRead(read, matrix, aircraftRef, {
    scopeKey, observedAt, mode: 'live', readState: 'current', label: '当前 LCM 构型读取范围',
    environment: '当前 Host 快照读取 · 非外部系统实时状态；读取时间为客户端成功读回时间',
  }), [read, matrix, scopeKey, aircraftRef, observedAt]);
  return <details onToggle={event => setExpanded(event.currentTarget.open)} aria-label="LCM 运行诊断">
    <summary className="cursor-pointer">查看本范围运行诊断</summary>
    {expanded ? <section className="space-y-3">
      <p>仅显示当前已获权快照到本页阅读的关系；请求、执行时序和资源占用未提供。</p>
      <WiseLinkRuntimeMonitor runtime={runtime} view="flow" allowVerification={false} onRefresh={onRefresh}
        onNavigate={detail => {
          if (lcmDiagnosticCanOpenReading(detail, runtime, read, scopeKey)) onOpenReading();
        }} />
      <details>
        <summary className="cursor-pointer">已读取快照与来源时间</summary>
        <ul>{read.snapshots.map(snapshot => <li key={snapshot.snapshotId}>
          <p>{snapshot.originalFileName} · {snapshot.snapshotId}</p>
          <dl>{lcmSnapshotTimeFacts(snapshot).map(fact => <div key={fact.label}>
            <dt>{fact.label}</dt><dd>{fact.value}</dd>
          </div>)}</dl>
        </li>)}</ul>
      </details>
    </section> : null}
  </details>;
}
