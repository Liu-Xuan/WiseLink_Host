import { useCallback, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { CanonicalLibraryDirectoryNode, CanonicalLibraryDirectoryRequest } from '@shared/library-directory.interface';
import { getCanonicalLibraryDirectory } from '@client/src/api/canonical-host';
import { Button } from '@client/src/components/ui/button';
import { useTdmsReadResource } from '@client/src/features/tdms-source/useTdmsReadResource';
import { ataDirectoryLabel, type AtaTitleScheme } from './library-ata-directory';
import type { LibraryCatalogFilters } from './library-classification';
import { libraryAircraftModelsQuery } from '@shared/library-aircraft-mentions';

interface LibraryDirectoryNavigationProps {
  search: string;
  filters: LibraryCatalogFilters;
  sessionGeneration: number;
  authenticationRequired: boolean;
  refreshRevision: number;
  scheme: AtaTitleScheme;
  onFilterChange: (filters: LibraryCatalogFilters) => void;
}

function directoryNodeLabel(node: CanonicalLibraryDirectoryNode, scheme: AtaTitleScheme): string {
  if (node.value === '__UNKNOWN__') return node.level === 'AIRCRAFT_MODEL' ? '机型未分类' : 'ATA 未分类';
  if (node.value === '__RAW__') return '原始 ATA 标注（含义待核）';
  return node.level === 'AIRCRAFT_MODEL' ? node.value : ataDirectoryLabel(node.value, scheme);
}

export function LibrarySourceDirectory(props: LibraryDirectoryNavigationProps) {
  const { filters, search, sessionGeneration, authenticationRequired, refreshRevision } = props;
  const base: CanonicalLibraryDirectoryRequest = {
    layout: 'ATA',
    ...(search ? { search } : {}),
    ...(filters.normalizedFamily ? { normalizedFamily: filters.normalizedFamily } : {}),
    ...(filters.fleetFamily ? { fleetFamily: filters.fleetFamily } : {}),
    ...(filters.fleetModel ? { fleetModel: filters.fleetModel } : {}),
    ...(filters.aircraftModel ? { aircraftModel: filters.aircraftModel } : {}),
  };
  const modelQuery = filters.aircraftModels;
  let modelError = '';
  try { if (modelQuery) libraryAircraftModelsQuery(modelQuery); }
  catch (error: unknown) { modelError = error instanceof Error && error.message === 'LIBRARY_AIRCRAFT_MODELS_TOO_LONG'
    ? '机型筛选超过请求长度，请缩小型号范围。' : '机型筛选参数无效，请重新选择。'; }
  const baseKey: string = JSON.stringify(base);
  const key: string = JSON.stringify([baseKey, modelQuery, sessionGeneration, refreshRevision]);
  const [deniedKey, setDeniedKey] = useState<string | null>(null);
  const [retry, setRetry] = useState<number>(0);
  const onDenied = useCallback((): void => setDeniedKey(key), [key]);
  const load = useCallback(async (signal: AbortSignal) => getCanonicalLibraryDirectory({ ...base,
    ...(modelQuery ? { aircraftModels: libraryAircraftModelsQuery(modelQuery) } : {}) }, signal), [baseKey, modelQuery]);
  const active: boolean = !authenticationRequired && deniedKey !== key;
  const directory = useTdmsReadResource(`${key}:${retry}`, active, load, onDenied);
  return <nav className="library-source-directory" aria-label="ATA2 与 ATA4 目录">
    {authenticationRequired ? <p role="status">请先登录，再读取资料目录。</p>
      : deniedKey === key ? <p role="alert">当前账户无法读取资料目录，原目录已清除。</p>
        : <>
          {directory.loading ? <p role="status">正在读取 ATA 目录…</p> : null}
          {directory.error ? <p role="alert">目录读取失败：{modelError || directory.error}</p> : null}
          {directory.value ? <>
            {directory.value.nodes.filter(node => /^\d{2}$/u.test(node.value)).map(node => <LibrarySourceDirectoryNode key={`${key}:${node.value}`}
              node={node} request={{ ...base, ...(modelQuery ? { aircraftModels: libraryAircraftModelsQuery(modelQuery) } : {}) }} props={props} active={active} onAccessRejected={onDenied} />)}
            {directory.value.nodes.some(node => !/^\d{2}$/u.test(node.value)) ? <details className="library-directory-anomalies"><summary>未分类与待核</summary>
              {directory.value.nodes.filter(node => !/^\d{2}$/u.test(node.value)).map(node => <LibrarySourceDirectoryNode key={`${key}:${node.value}`}
                node={node} request={base} props={props} active={active} onAccessRejected={onDenied} />)}</details> : null}
            {!directory.value.nodes.length ? <p role="status">当前目录范围没有正式文档。</p> : null}
          </> : null}
        </>}
    {directory.error || deniedKey === key ? <Button type="button" variant="outline" size="sm"
      onClick={() => { setDeniedKey(null); setRetry((value: number) => value + 1); }}>重试目录</Button> : null}
  </nav>;
}

function LibrarySourceDirectoryNode({ node, request, props, active, onAccessRejected }: {
  node: CanonicalLibraryDirectoryNode;
  request: CanonicalLibraryDirectoryRequest;
  props: LibraryDirectoryNavigationProps;
  active: boolean;
  onAccessRejected: () => void;
}) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const [retry, setRetry] = useState<number>(0);
  const { filters, scheme, sessionGeneration, refreshRevision } = props;
  const selectedPath: boolean = node.level === 'ATA2' ? filters.ata2 === node.value
    : filters.ata2 === request.ata2 && filters.ata4 === node.value;
  const open: boolean = manualOpen ?? selectedPath;
  const childRequest: CanonicalLibraryDirectoryRequest = { ...request, ata2: node.value };
  const childKey: string = JSON.stringify([childRequest, sessionGeneration, refreshRevision, retry]);
  const load = useCallback((signal: AbortSignal) => getCanonicalLibraryDirectory(childRequest, signal), [childKey]);
  const children = useTdmsReadResource(childKey, active && open && node.hasChildren && node.level !== 'ATA4', load, onAccessRejected);
  const selected: boolean = selectedPath && (node.level === 'ATA4' ||
    (node.level === 'ATA2' ? !filters.ata4 : !filters.ata2 && !filters.ata4));

  function selectNode(): void {
    props.onFilterChange({ ...filters, ata: '',
      ata2: node.level === 'ATA2' ? node.value : node.level === 'ATA4' ? request.ata2 : '',
      ata4: node.level === 'ATA4' ? node.value : '',
    });
  }

  return <div className="library-source-directory-node" data-directory-level={node.level}>
    <div className="library-source-directory-row">
      {node.hasChildren && node.level !== 'ATA4' ? <Button type="button" variant="ghost" size="icon"
        className="library-directory-expand" aria-expanded={open} aria-label={`${open ? '收起' : '展开'}${directoryNodeLabel(node, scheme)}`}
        onClick={() => setManualOpen(!open)}>{open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}</Button> : null}
      <button type="button" className={`suite-folder-row${selected ? ' active' : ''}`} aria-pressed={selected}
        onClick={selectNode}>
        <span>{directoryNodeLabel(node, scheme)}</span><small>{node.documentCount}</small>
      </button>
    </div>
    {node.level === 'ATA2' && /^\d{2}$/u.test(node.value) && node.directDocumentCount ? <button type="button"
      className={`suite-folder-row library-directory-direct${selectedPath && filters.ata4 === '__DIRECT__' ? ' active' : ''}`}
      aria-pressed={selectedPath && filters.ata4 === '__DIRECT__'}
      onClick={() => props.onFilterChange({ ...filters, ata: '',
        ata2: node.value, ata4: '__DIRECT__' })}>
      <span>本级资料</span><small>{node.directDocumentCount}</small>
    </button> : null}
    {open ? <div className="library-source-directory-children">
      {children.loading ? <p role="status">正在读取下一层目录…</p> : null}
      {children.error ? <p role="alert">{children.error}<Button type="button" variant="outline" size="sm"
        onClick={() => setRetry((value: number) => value + 1)}>重试此节点</Button></p> : null}
      {children.value?.nodes.map(child => <LibrarySourceDirectoryNode key={`${childKey}:${child.value}`}
        node={child} request={childRequest} props={props} active={active} onAccessRejected={onAccessRejected} />)}
    </div> : null}
  </div>;
}
