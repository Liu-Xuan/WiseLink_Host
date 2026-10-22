import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { HierarchicalWikiStatus } from '@shared/hierarchical-wiki.interface';
import { WiseLinkRuntimeMonitor } from '@client/src/pages/DocumentParsingPage/runtime-monitor/WiseLinkRuntimeMonitor';
import { adaptHierarchicalWikiStatus, wikiDiagnosticRoute } from './adapt-hierarchical-wiki-status';

interface Props {
  wiki: HierarchicalWikiStatus;
  session: number;
  observedAt: string;
  refreshing: boolean;
  onRefresh: () => void;
}

/** Reuses the directory read and refresh; opening the diagnostic never fetches. */
export default function HierarchicalWikiRuntimeDiagnostic({ wiki, session, observedAt, refreshing, onRefresh }: Props) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const scopeKey = `${session}:wiki:${wiki.summaryId}`;
  const runtime = useMemo(() => adaptHierarchicalWikiStatus(wiki, wiki.summaryId, {
    scopeKey, observedAt, label: wiki.scope.title, mode: 'live',
    environment: '当前 Host 目录读取 · 观察时间为客户端目录读回时间',
    readState: refreshing ? 'refreshing' : 'current',
  }), [wiki, scopeKey, observedAt, refreshing]);
  return <details onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary className="cursor-pointer">查看本范围运行诊断</summary>
    {expanded ? <section className="space-y-3" aria-label={`${wiki.scope.title}运行诊断`}>
    <p className="text-sm">仅显示本范围的更新、等待和已覆盖成员。执行开始、首次保存、就绪及 ACK 时间和资源占用未提供。</p>
    <Link className="underline" to={`/summaries/${encodeURIComponent(wiki.summaryId)}`}>打开本范围已保存正文</Link>
    <WiseLinkRuntimeMonitor key={scopeKey} runtime={runtime} view="flow" allowVerification={false}
      onRefresh={onRefresh} onNavigate={detail => {
        const route = wikiDiagnosticRoute(detail, runtime, wiki);
        if (route) navigate(route);
      }} />
    </section> : null}
  </details>;
}
