import { useEffect, useRef, useState } from 'react';
import type { LcmExcelImportRequest, LcmExcelImportResponse } from '@shared/lcm-personal-import.interface';
import { getCanonicalHostClientSessionGeneration, importLcmExcel, resolveLcmExcelUpload } from '@client/src/api/canonical-host';
import { uploadFile } from '@client/src/components/business-ui/api/files/service';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { lcmFilenameStateDate } from './lcm-source-presentation';

interface SelectedExcel {
  file: File; model: string; requestId: string;
  selection?: LcmExcelImportRequest['selection'];
  result?: LcmExcelImportResponse;
}

/** The same upload/import operation is used again after a failed or unknown response. */
export function LcmExcelImport({ sessionGeneration, disabled, onImported }: {
  sessionGeneration: number; disabled: boolean; onImported(results: LcmExcelImportResponse[]): void;
}) {
  const [entries, setEntries] = useState<SelectedExcel[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const inFlight = useRef(false), generation = useRef(sessionGeneration), mounted = useRef(true);
  generation.current = sessionGeneration;
  useEffect(() => {
    setEntries([]); setMessage(''); setError(''); setBusy(false); inFlight.current = false;
  }, [sessionGeneration]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function submit(): Promise<void> {
    if (disabled || inFlight.current || !entries.length || entries.some(entry => !entry.model.trim())) return;
    const session = getCanonicalHostClientSessionGeneration(), scope = generation.current;
    const current = (): boolean => mounted.current && scope === generation.current &&
      session === getCanonicalHostClientSessionGeneration();
    inFlight.current = true; setBusy(true); setError('');
    const completed: LcmExcelImportResponse[] = [];
    try {
      for (const entry of entries) {
        if (!current()) return;
        if (entry.result) { completed.push(entry.result); continue; }
        setMessage(`正在导入 ${entry.file.name}…`);
        if (!entry.selection) {
          const name: string = entry.file.name.replace(/[^\p{L}\p{N}._-]/gu, '_').slice(-150);
          const filePath: string = `wiselink/lcm/uploads/${entry.requestId}/${name}`;
          // Resolve first on retries: a previous upload may have committed before its response was lost.
          const existing = await resolveLcmExcelUpload({ filePath });
          if (!current()) return;
          if (existing.selection) entry.selection = existing.selection;
          else {
            try {
              const uploaded = await uploadFile(entry.file, { filePath,
                contentType: entry.file.name.toLowerCase().endsWith('.xlsx')
                  ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/vnd.ms-excel',
                upsert: false });
              entry.selection = { bucketId: uploaded.bucketId, filePath: uploaded.filePath,
                expectedProviderObjectId: uploaded.id };
            } catch (uploadError: unknown) {
              // Only an actual owned metadata read can recover the write. Missing/failed reads
              // preserve the original failure and the same request/path for a deliberate retry.
              const recovered = await resolveLcmExcelUpload({ filePath }).catch(() => null);
              if (!recovered?.selection) throw uploadError;
              entry.selection = recovered.selection;
            }
          }
          if (!current()) return;
          setEntries([...entries]);
        }
        const result = await importLcmExcel({ requestId: entry.requestId,
          aircraftModel: entry.model.trim(), selection: entry.selection });
        if (!current()) return;
        entry.result = result; completed.push(result); setEntries([...entries]);
      }
      if (current()) setMessage(`已保存 ${completed.length} 份 Excel，可直接查看构型。`);
    } catch (reason: unknown) {
      if (current()) {
        setMessage('');
        const status: number = reason && typeof reason === 'object' && 'statusCode' in reason
          ? Number(reason.statusCode) : 0;
        setError(status >= 500 ? '导入失败，请重试。'
          : `导入尚未完成：${reason instanceof Error ? reason.message : '请求失败'}。可重试同一导入。`);
      }
    } finally {
      if (current()) {
        inFlight.current = false; setBusy(false);
        if (completed.length) onImported(completed);
      }
    }
  }

  return <details className="mx-excel-import">
    <summary>导入 Excel</summary>
    <div className="space-y-3 py-3">
      <Input type="file" multiple accept=".xls,.xlsx" aria-label="选择 LCM Excel" disabled={disabled || busy}
        onChange={event => {
          const files: File[] = Array.from(event.target.files ?? []);
          setError(''); setMessage('');
          if (files.length > 20 || files.some(file => !/\.xlsx?$/iu.test(file.name) ||
              file.size < 1 || file.size > 50 * 1024 * 1024)) {
            setEntries([]); setError('请选择最多 20 份非空 XLS/XLSX，每份不超过 50 MB。'); return;
          }
          setEntries(files.map((file: File) => ({ file,
            model: /^构型统计_(.+)_\d+\.xlsx?$/iu.exec(file.name)?.[1] ?? '', requestId: `lcm-${crypto.randomUUID()}` })));
        }} />
      {entries.map((entry: SelectedExcel, index: number) => <label key={entry.requestId} className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 truncate" title={entry.file.name}>{entry.file.name}</span>
        <span className="mx-import-counts">状态日 {lcmFilenameStateDate(entry.file.name) ?? '未识别'}</span>
        <Input aria-label={`确认 ${entry.file.name} 的机型`} placeholder="确认机型" value={entry.model}
          disabled={busy || Boolean(entry.selection)} maxLength={128} className="max-w-48"
          onChange={event => setEntries(entries.map((item: SelectedExcel, itemIndex: number) =>
            itemIndex === index ? { ...item, model: event.target.value } : item))} />
        {entry.result ? <span className="mx-import-counts">{entry.result.sourceRowCount} 源行 ·
          {' '}{entry.result.aircraftColumnCount} 飞机列 · {entry.result.stateCellCount.toLocaleString()} 状态格</span> : null}
      </label>)}
      <Button variant="outline" size="sm" disabled={disabled || busy || !entries.length || entries.some(entry => !entry.model.trim())}
        onClick={() => void submit()}>{busy ? '正在保存…' : '确认机型并导入'}</Button>
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  </details>;
}
