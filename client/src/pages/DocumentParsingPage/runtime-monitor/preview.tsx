import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { JobAidWorkingReadModel } from '@shared/jobaid-problem-assessment.interface';
import WorkItemRuntimeDiagnostic from './WorkItemRuntimeDiagnostic';
import { adaptJobAidWorkingRead } from './adapt-jobaid-working-read';

/** Local-only manual harness: no fixture, credentials, fetching or business mutations. */
function Preview() {
  const [data, setData] = useState<JobAidWorkingReadModel | null>(null);
  const [message, setMessage] = useState('选择本地 JobAid 读回 JSON；也接受 body 为 JSON 字符串的工具回执。');
  const [observedAt, setObservedAt] = useState<string | null>(null);
  return <main style={{ maxWidth: 1280, margin: '24px auto', fontFamily: 'sans-serif' }}>
    <h1>运行诊断 · 本地回放</h1>
    <p>只使用所选文件，不请求 Host。导入时间不是来源事件时间或真实运行验收。</p>
    <input aria-label="导入本地读回" type="file" accept="application/json,.json" onChange={async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        let value: unknown = JSON.parse(await file.text());
        if (value && typeof value === 'object' && 'body' in value && typeof value.body === 'string') value = JSON.parse(value.body);
        if (!value || typeof value !== 'object' || !('schemaVersion' in value) || value.schemaVersion !== 'wiselink.jobaid-working-read.v2') throw new Error('需要 JobAidWorkingReadModel v2 读回');
        const read = value as JobAidWorkingReadModel;
        // The read-model payload has no observation timestamp. Importing it must
        // not fabricate the time of the original Host read.
        adaptJobAidWorkingRead(read, { observedAt: '', environment: '本地回放', scopeKey: `1:${read.workItemId}`, label: read.workItemId, mode: 'snapshot' });
        setData(read); setObservedAt(null); setMessage('已导入本地回放；未访问 Host。文件未提供原读回观察时间。');
      } catch (error) { setData(null); setMessage(error instanceof Error ? error.message : '导入失败'); }
    }} />
    <p role="status">{message}</p>
    {data ? <WorkItemRuntimeDiagnostic
      workItemId={data.workItemId} sessionGeneration={1} observationMode="snapshot"
      read={{ data, observedAt, error: null, isRefreshing: false, temporaryError: false, baseFallbackAllowed: true, refresh: () => undefined }}
      onRefresh={() => setMessage('回放刷新不会联网；请重新选择更新后的本地 JSON。')}
      onOpenPanel={(panel) => setMessage(`真实入口将打开 ${panel} 面板；本地回放保留当前页面，不冒充已定位具体尝试。`)}
      onOpenWorkRevision={(ref) => setMessage(`真实入口将读取准确工作 ${ref}；本地回放未访问 Host，不替换为当前工作。`)}
    /> : null}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
