import { lazy, Suspense, useMemo, useState } from 'react';
import type { TdmsFileServiceRecordReadResponse } from '@shared/tdms-file-service-import.interface';
import { adaptEngineeringExecutionRead, engineeringExecutionDiagnosticReference, engineeringExecutionMonitorScope } from './tdms-engineering-execution-monitor';

// The original table remains readable before this optional diagnostic is opened.
const Monitor = lazy(() => import('@client/src/pages/DocumentParsingPage/runtime-monitor/WiseLinkRuntimeMonitor')
  .then(module => ({ default: module.WiseLinkRuntimeMonitor })));

export function TdmsEngineeringExecutionDiagnostic({ read, scopeKey, onRefresh, onLocate }: {
  read: TdmsFileServiceRecordReadResponse;
  scopeKey?: string;
  onRefresh?: () => void;
  onLocate: (ref: string) => void;
}) {
  const scope = engineeringExecutionMonitorScope(read, scopeKey);
  const [expandedScope, setExpandedScope] = useState<string | null>(null);
  const projection = useMemo(() => {
    try { return { runtime: adaptEngineeringExecutionRead(read, scopeKey), error: null }; }
    catch { return { runtime: null, error: '单机执行运行图与当前来源或读取回执不一致，请重新读取。' }; }
  }, [read, scopeKey]);
  if (projection.error) return <p role="alert">{projection.error}</p>;
  if (!projection.runtime) return null;
  const runtime = projection.runtime;
  return <details aria-label="当前单机来源运行图" open={expandedScope === scope}
    onToggle={event => setExpandedScope(event.currentTarget.open ? scope : null)}>
    <summary>查看单机来源运行图</summary>
    <p>复用本页已读来源。逐项要求、完整目标机队和全局请求集合未知；不计算整份完成率。</p>
    {expandedScope === scope ? <Suspense fallback={<p role="status">正在载入运行图视图…</p>}>
      <Monitor key={scope} runtime={runtime} view="flow" allowVerification={false} onRefresh={onRefresh}
        onNavigate={detail => {
          const ref = engineeringExecutionDiagnosticReference(detail, runtime);
          if (ref) onLocate(ref);
        }} />
    </Suspense> : null}
  </details>;
}
