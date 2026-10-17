import { useRef, useEffect } from 'react';
import { Check, Maximize, Minimize, Search } from 'lucide-react';
import type { LcmMatrixQuery, LcmMatrixResponse } from '@shared/lcm-matrix.interface';
import type { LcmSnapshotSummary } from '@shared/lcm-source-reading.interface';
import { lcmQueryModels } from '@shared/lcm-matrix-core';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Checkbox } from '@client/src/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@client/src/components/ui/select';
import { lcmModelChoices, lcmSnapshotStateDate } from './lcm-source-presentation';

interface LcmMatrixToolbarProps {
  query: LcmMatrixQuery;
  snapshots: LcmSnapshotSummary[];
  readSetSnapshots: LcmSnapshotSummary[];
  matrix: LcmMatrixResponse | null;
  search: string;
  fullscreen: boolean;
  stateDate: string | null;
  loading: boolean;
  onSearch(value: string): void;
  onModel(model: string | null): void;
  onField(key: string, value: string | null): void;
  onExpand(all: boolean): void;
  onAircraftScope(): void;
  onReadSet(): void;
  onFullscreen(): void;
}

export function LcmMatrixToolbar(props: LcmMatrixToolbarProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      const target = event.target;
      if (event.key !== '/' || (target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target.tagName)))) return;
      event.preventDefault(); searchRef.current?.focus();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const models = lcmModelChoices(props.snapshots.flatMap(snapshot => snapshot.coveredAircraftModels));
  const selectedModels = lcmQueryModels(props.query);
  const ata = [...new Set(props.matrix?.softwareIndex.flatMap(software => software.ata) ?? [])].sort();
  const currentSources = props.matrix ? props.matrix.snapshots.length ? props.matrix.snapshots : props.readSetSnapshots : [];
  const dates = [...new Set(currentSources.map(snapshot => lcmSnapshotStateDate(snapshot) ?? '未识别'))].sort();
  const empty = props.matrix && (!props.matrix.aircraftOrder.length || !props.matrix.softwareIndex.length);
  const displayedDate = props.matrix ? (dates.join(' / ') || props.stateDate || '未识别') + (empty ? '（0 结果）' : '')
    : props.query.snapshotIds.length ? (props.stateDate ? props.stateDate + ' · ' : '') + (props.loading ? '读取中' : '未读取')
      : props.stateDate ? props.stateDate + '（0 结果）' : '未选择';
  return <div className="mx-toolbar" aria-label="构型筛选与显示">
    <div className="mx-models" role="group" aria-label="LCM 机型">
      <span>机型</span><Button variant="outline" size="sm"
        aria-pressed={!selectedModels.length} onClick={() => props.onModel(null)}>
        {!selectedModels.length ? <Check size={14} aria-hidden="true" /> : null}全部机型</Button>
      {models.map(model => <Button key={model.value} variant="outline" size="sm" title={model.value}
        data-model-value={model.value} aria-pressed={selectedModels.includes(model.value)} onClick={() => props.onModel(model.value)}>
        {selectedModels.includes(model.value) ? <Check size={14} aria-hidden="true" /> : null}{model.label}</Button>)}
    </div>
    <span className="mx-current-date" role="status">当前快照日：{displayedDate}</span>
    <Button variant="outline" size="sm" onClick={props.onReadSet}>选择状态日</Button>
    <label className="mx-search"><Search size={16} aria-hidden="true" />
      <Input ref={searchRef} aria-label="搜索 LCM 软件名称或完整件号" placeholder="软件名称 / 完整件号"
        value={props.search} maxLength={256} onChange={event => props.onSearch(event.target.value)} />
    </label>
    <Select value={props.query.ata ?? 'all'} onValueChange={value => props.onField('ata', value === 'all' ? null : value)}>
      <SelectTrigger aria-label="ATA 筛选"><SelectValue /></SelectTrigger><SelectContent>
        <SelectItem value="all">全部 ATA</SelectItem>
        {ata.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}
      </SelectContent>
    </Select>
    <label className="mx-toggle"><Checkbox aria-label="仅看差异" checked={Boolean(props.query.differencesOnly)}
      onCheckedChange={value => props.onField('differencesOnly', value === true ? '1' : null)} />仅看差异</label>
    <Button variant="outline" size="sm" onClick={props.onAircraftScope} disabled={!props.matrix}>飞机范围</Button>
    <Button variant="outline" size="sm" onClick={() => props.onExpand(true)} disabled={!props.matrix}>全部展开</Button>
    <Button variant="outline" size="sm" onClick={() => props.onExpand(false)} disabled={!props.matrix}>全部折叠</Button>
    <Button variant="ghost" size="icon" aria-label={props.fullscreen ? '退出工作区全屏' : '工作区全屏'}
      aria-pressed={props.fullscreen} onClick={props.onFullscreen}>
      {props.fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
    </Button>
  </div>;
}
