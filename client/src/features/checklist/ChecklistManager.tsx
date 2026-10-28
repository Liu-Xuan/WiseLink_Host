import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button } from '@client/src/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@client/src/components/ui/dialog';
import { getCanonicalHostClientSessionGeneration, subscribeCanonicalHostClientSession,
  readChecklistDefinition } from '@client/src/api/canonical-host';
import type { JobAidChecklistDefinitionRead } from '@shared/jobaid-checklist.interface';
import { ChecklistDefinitionPanel } from './ChecklistPanel';

/** One library entry. Opening/refreshing only reads the actual Host release. */
export default function ChecklistManager() {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button variant="outline">检查单</Button></DialogTrigger>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader><DialogTitle>检查单管理 · 定义查看</DialogTitle>
        <DialogDescription>当前 Host 内置版与具体任务封存版分别显示，浏览不会发起评估或修改工作。</DialogDescription>
      </DialogHeader>
      {open ? <CurrentDefinition /> : null}
    </DialogContent>
  </Dialog>;
}

export function CurrentDefinition() {
  const session: number = useSyncExternalStore(subscribeCanonicalHostClientSession,
    getCanonicalHostClientSessionGeneration, getCanonicalHostClientSessionGeneration);
  const [state, setState] = useState<{
    session: number; read: JobAidChecklistDefinitionRead | null; error: string | null; refreshing: boolean;
  }>({ session, read: null, error: null, refreshing: true });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState(previous => ({ session, read: previous.session === session ? previous.read : null,
      error: null, refreshing: true }));
    void readChecklistDefinition(controller.signal).then(value => {
      if (!controller.signal.aborted) setState({ session, read: value, error: null, refreshing: false });
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        setState({ session, read: null, refreshing: false,
          error: cause instanceof Error ? cause.message : '检查单定义读取失败' });
      }
    });
    return () => controller.abort();
  }, [retry, session]);
  const read = state.session === session ? state.read : null;
  const error = state.session === session ? state.error : null;
  return <div className="space-y-4">
    <p>在线编辑、保存新版本和启用尚未提供。当前定义随 Host 版本维护；这里不提供模拟保存或启用操作。</p>
    <p>任务的选择、验收范围和逐项结果请在资料库评估工作台或准确历史工作中查看，不能用此处版本替换其依据。</p>
    <Button variant="outline" onClick={() => setRetry(value => value + 1)}>重新读取定义</Button>
    {read && state.refreshing ? <p role="status">正在重新读取定义，暂保留本账号上次读回的内容。</p> : null}
    {error ? <p role="alert">{error}。未展示先前缓存的定义。</p>
      : read ? <><h3 className="font-medium">本次 Host 读回的内置定义</h3>
        <ChecklistDefinitionPanel definition={read.current} /></>
        : <p role="status">正在读取当前 Host 内置定义…</p>}
  </div>;
}
