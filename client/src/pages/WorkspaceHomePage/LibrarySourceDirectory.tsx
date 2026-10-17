import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { CanonicalLibraryDirectoryNode, CanonicalLibraryDirectoryRequest } from '@shared/library-directory.interface';
import { getCanonicalLibraryDirectory } from '@client/src/api/canonical-host';
import { Button } from '@client/src/components/ui/button';
import { useTdmsReadResource } from '@client/src/features/tdms-source/useTdmsReadResource';
import { ataDirectoryLabel, type AtaTitleScheme } from './library-ata-directory';
import type { LibraryCatalogFilters } from './library-classification';
import { libraryAircraftModelsQuery } from '@shared/library-aircraft-mentions';

interface LibraryDirectoryReadingState {
  expandedNodes: Readonly<Record<string, boolean>>;
  onNodeChange: (node: string, open: boolean) => void;
  onReadyChange: (ready: boolean) => void;
  onAccessRejected: () => void;
}

export interface LibraryDirectoryNavigationProps {
  search: string;
  filters: LibraryCatalogFilters;
  sessionGeneration: number;
  authenticationRequired: boolean;
  refreshRevision: number;
  scheme: AtaTitleScheme;
  onFilterChange: (filters: LibraryCatalogFilters) => void;
  navigation?: LibraryDirectoryReadingState;
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
  const navigation = useRef(props.navigation);
  navigation.current = props.navigation;
  const onDenied = useCallback((): void => {
    setDeniedKey(key);
    navigation.current?.onAccessRejected();
  }, [key]);
  const [childReadiness, setChildReadiness] = useState<{ key: string; nodes: Record<string, boolean> }>({ key, nodes: {} });
  const onChildReady = useCallback((node: string, ready: boolean): void => {
    setChildReadiness(prior => prior.key === key && prior.nodes[node] === ready ? prior
      : { key, nodes: { ...(prior.key === key ? prior.nodes : {}), [node]: ready } });
  }, [key]);
  const load = useCallback(async (signal: AbortSignal) => getCanonicalLibraryDirectory({ ...base,
    ...(modelQuery ? { aircraftModels: libraryAircraftModelsQuery(modelQuery) } : {}) }, signal), [baseKey, modelQuery]);
  const active: boolean = !authenticationRequired && deniedKey !== key;
  const directory = useTdmsReadResource(`${key}:${retry}`, active, load, onDenied);
  const expanded: CanonicalLibraryDirectoryNode[] = directory.value?.nodes.filter(node =>
    node.hasChildren && node.level === 'ATA2' &&
    (props.navigation?.expandedNodes[node.value] ?? filters.ata2 === node.value)) ?? [];
  const ready: boolean = active && !directory.loading && Boolean(directory.value) &&
    expanded.every(node => childReadiness.key === key && childReadiness.nodes[node.value]);
  useEffect(() => { props.navigation?.onReadyChange(ready); }, [props.navigation?.onReadyChange, ready]);
  return <nav className="library-source-directory" aria-label="ATA2 与 ATA4 目录">
    {authenticationRequired ? <p role="status">请先登录，再读取资料目录。</p>
      : deniedKey === key ? <p role="alert">当前账户无法读取资料目录，原目录已清除。</p>
        : <>
          {directory.loading ? <p role="status">正在读取 ATA 目录…</p> : null}
          {directory.error ? <p role="alert">目录读取失败：{modelError || directory.error}</p> : null}
          {directory.value ? <>
            {directory.value.nodes.filter(node => /^\d{2}$/u.test(node.value)).map(node => <LibrarySourceDirectoryNode key={`${key}:${node.value}`}
              node={node} request={{ ...base, ...(modelQuery ? { aircraftModels: libraryAircraftModelsQuery(modelQuery) } : {}) }} props={props} active={active} onAccessRejected={onDenied} onReadReady={onChildReady} />)}
            {directory.value.nodes.some(node => !/^\d{2}$/u.test(node.value)) ? <details className="library-directory-anomalies"
              open={props.navigation?.expandedNodes.__ANOMALIES__}
              onToggle={event => {
                const open: boolean = event.currentTarget.open;
                if (props.navigation && open !== Boolean(props.navigation.expandedNodes.__ANOMALIES__))
                  props.navigation.onNodeChange('__ANOMALIES__', open);
              }}><summary>未分类与待核</summary>
              {directory.value.nodes.filter(node => !/^\d{2}$/u.test(node.value)).map(node => <LibrarySourceDirectoryNode key={`${key}:${node.value}`}
                node={node} request={base} props={props} active={active} onAccessRejected={onDenied} onReadReady={onChildReady} />)}</details> : null}
            {!directory.value.nodes.length ? <p role="status">当前目录范围没有正式文档。</p> : null}
          </> : null}
        </>}
    {directory.error || deniedKey === key ? <Button type="button" variant="outline" size="sm"
      onClick={() => { setDeniedKey(null); setRetry((value: number) => value + 1); }}>重试目录</Button> : null}
  </nav>;
}

function LibrarySourceDirectoryNode({ node, request, props, active, onAccessRejected, onReadReady }: {
  node: CanonicalLibraryDirectoryNode;
  request: CanonicalLibraryDirectoryRequest;
  props: LibraryDirectoryNavigationProps;
  active: boolean;
  onAccessRejected: () => void;
  onReadReady: (node: string, ready: boolean) => void;
}) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const [retry, setRetry] = useState<number>(0);
  const { filters, scheme, sessionGeneration, refreshRevision } = props;
  const selectedPath: boolean = node.level === 'ATA2' ? filters.ata2 === node.value
    : filters.ata2 === request.ata2 && filters.ata4 === node.value;
  const open: boolean = props.navigation?.expandedNodes[node.value] ?? manualOpen ?? selectedPath;
  const [visited, setVisited] = useState<boolean>(open);
  useEffect(() => {
    if (open) setVisited(true);
  }, [open]);
  // Keep this mounted node's read when collapsed. The parent key already changes
  // with filters, session and refresh; access rejection still clears the tree.
  const retainChildren: boolean = open || visited;
  const childRequest: CanonicalLibraryDirectoryRequest = { ...request, ata2: node.value };
  const childKey: string = JSON.stringify([childRequest, sessionGeneration, refreshRevision, retry]);
  const load = useCallback((signal: AbortSignal) => getCanonicalLibraryDirectory(childRequest, signal), [childKey]);
  const children = useTdmsReadResource(childKey, active && retainChildren && node.hasChildren && node.level !== 'ATA4', load, onAccessRejected);
  useEffect(() => {
    if (node.level === 'ATA2') onReadReady(node.value, !children.loading);
  }, [node.level, node.value, children.loading, onReadReady]);
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
        onClick={() => props.navigation ? props.navigation.onNodeChange(node.value, !open)
          : setManualOpen(!open)}>{open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}</Button> : null}
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
    {retainChildren ? <div className="library-source-directory-children" hidden={!open}>
      {children.loading ? <p role="status">正在读取下一层目录…</p> : null}
      {children.error ? <p role="alert">{children.error}<Button type="button" variant="outline" size="sm"
        onClick={() => setRetry((value: number) => value + 1)}>重试此节点</Button></p> : null}
      {children.value?.nodes.map(child => <LibrarySourceDirectoryNode key={`${childKey}:${child.value}`}
        node={child} request={childRequest} props={props} active={active} onAccessRejected={onAccessRejected} onReadReady={onReadReady} />)}
    </div> : null}
  </div>;
}
