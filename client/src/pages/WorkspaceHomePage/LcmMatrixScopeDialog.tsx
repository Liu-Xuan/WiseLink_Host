import { useEffect, useRef, useState } from 'react';
import { Button } from '@client/src/components/ui/button';
import { Checkbox } from '@client/src/components/ui/checkbox';
import { Input } from '@client/src/components/ui/input';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@client/src/components/ui/dialog';

export function LcmMatrixScopeDialog({ kind, options, selected, selectedDate, onClose, onApply }: {
  kind: 'aircraft' | 'snapshots' | null;
  options: Array<{ value: string; label: string; hint?: string; date?: string | null }>;
  selected: string[]; selectedDate: string | null; onClose(): void; onApply(values: string[], date?: string): void;
}) {
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [date, setDate] = useState('');
  const triggerRef = useRef<HTMLElement | null>(null);
  function commonDate(values: Set<string>): string {
    const dates = [...new Set([...values].map(value => options.find(option => option.value === value)?.date))];
    return dates.length === 1 && dates[0] ? dates[0] : '';
  }
  useEffect(() => { if (kind) {
    setDraft(new Set(kind === 'snapshots' && selectedDate && !selected.length
      ? options.filter(option => option.date === selectedDate).map(option => option.value) : selected));
    setDate(selectedDate ?? commonDate(new Set(selected)));
  } }, [kind]);
  const maximum = kind === 'snapshots' ? 20 : 2000;
  const list = <div className="mx-scope-list">{options.map(option => <label key={option.value}>
    <Checkbox checked={draft.has(option.value)} aria-label={option.label}
      onCheckedChange={checked => {
        const next = new Set(draft); if (checked === true) next.add(option.value); else next.delete(option.value);
        setDraft(next); if (kind === 'snapshots') setDate(commonDate(next));
      }} /><span>{option.label}{option.hint ? <small>{option.hint}</small> : null}</span>
  </label>)}</div>;
  return <Dialog open={Boolean(kind)} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="mx-dialog" onOpenAutoFocus={() => {
      triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }} onCloseAutoFocus={event => {
      const target = triggerRef.current?.isConnected ? triggerRef.current
        : document.querySelector<HTMLElement>('[aria-label="搜索 LCM 软件名称或完整件号"]');
      if (target) { event.preventDefault(); target.focus(); }
      }}><DialogTitle>{kind === 'aircraft' ? '所选飞机范围' : '选择快照状态日'}</DialogTitle>
      <DialogDescription className="sr-only">{kind === 'aircraft' ? '选择飞机。' : '选择日期或原文件。'}</DialogDescription>
      {kind === 'snapshots' ? <>
        <label className="mx-state-date">快照状态日<Input type="date" aria-label="快照状态日" value={date}
          onChange={event => {
            const value = event.target.value; setDate(value);
            setDraft(new Set(options.filter(option => value && option.date === value).map(option => option.value)));
          }} /></label>
        <p role="status">已选 {draft.size} 个快照</p>
        <details className="mx-snapshot-details"><summary>快照与原文件</summary>{list}</details>
      </> : list}
      {draft.size > maximum ? <p role="alert">本次最多选择 {maximum} 项。</p> : null}
      <div className="mx-pagination"><Button variant="outline" onClick={() => { setDraft(new Set()); setDate(''); }}>清除选择</Button>
        <Button variant="outline" onClick={() => {
          const next = new Set(options.map(option => option.value)); setDraft(next); setDate(commonDate(next));
        }}
          disabled={options.length > maximum}>全部选择</Button>
        <Button disabled={draft.size > maximum || (kind === 'snapshots' && !draft.size && !date)}
          onClick={() => onApply([...draft], kind === 'snapshots' ? date : undefined)}>应用范围</Button></div>
    </DialogContent>
  </Dialog>;
}
