import type { DerivedSummaryScopeSelection } from '@shared/derived-summary.interface';
import { useState } from 'react';
import { Input } from '@client/src/components/ui/input';
import { Textarea } from '@client/src/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@client/src/components/ui/select';

export default function SummaryScopeFields({ scope, onChange, disabled }: {
  scope: DerivedSummaryScopeSelection; onChange: (scope: DerivedSummaryScopeSelection) => void; disabled: boolean;
}) {
  const [modelText, setModelText] = useState(scope.fleetModelIds.join(', '));
  const patch = (value: Partial<DerivedSummaryScopeSelection>) => onChange({ ...scope, ...value });
  return <fieldset disabled={disabled} className="grid gap-4 md:grid-cols-2">
    <legend className="mb-3 text-lg font-semibold">本次选定范围</legend>
    <label className="space-y-1 text-sm">范围类型<Select disabled={disabled} value={scope.kind} onValueChange={value => {
      const kind = value as DerivedSummaryScopeSelection['kind'];
      patch({ kind, ata2: kind === 'FLEET' ? null : scope.ata2, ata4: kind === 'ATA4' ? scope.ata4 : null });
    }}><SelectTrigger aria-label="范围类型"><SelectValue /></SelectTrigger><SelectContent>
      <SelectItem value="ATA4">ATA4 章节</SelectItem><SelectItem value="ATA2">ATA2 章节</SelectItem><SelectItem value="FLEET">机型范围</SelectItem>
    </SelectContent></Select></label>
    <label className="space-y-1 text-sm">范围标题<Input value={scope.title} maxLength={240} onChange={event => patch({ title: event.target.value })} /></label>
    <label className="space-y-1 text-sm">父机型（当前目录标识）<Input value={scope.fleetFamilyId} maxLength={96} onChange={event => patch({ fleetFamilyId: event.target.value })} /></label>
    <label className="space-y-1 text-sm">实际选取的子机型（逗号分隔，可留空）<Input value={modelText} maxLength={1000} onChange={event => {
      setModelText(event.target.value); patch({ fleetModelIds: [...new Set(event.target.value.split(/[,，]/u).map(value => value.trim()).filter(Boolean))] });
    }} /></label>
    {scope.kind !== 'FLEET' ? <label className="space-y-1 text-sm">ATA2<Input value={scope.ata2 ?? ''} maxLength={2} onChange={event => patch({ ata2: event.target.value })} /></label> : null}
    {scope.kind === 'ATA4' ? <label className="space-y-1 text-sm">ATA4<Input value={scope.ata4 ?? ''} maxLength={5} onChange={event => patch({ ata4: event.target.value })} /></label> : null}
    <label className="space-y-1 text-sm md:col-span-2">选取理由与未纳入范围<Textarea value={scope.selectionReason} maxLength={4000} onChange={event => patch({ selectionReason: event.target.value })} placeholder="说明为何选取这些资料，以及其他 ATA4、版本或问题未纳入的范围。" /></label>
  </fieldset>;
}
