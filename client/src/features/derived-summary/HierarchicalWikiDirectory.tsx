import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import type { HierarchicalWikiStatus } from '@shared/hierarchical-wiki.interface';
import {
  getCanonicalLibraryDocuments,
  getCanonicalLibraryFleetCatalog,
} from '@client/src/api/canonical-host';
import {
  classifyHierarchicalWiki,
  delegateHierarchicalWikiMatter,
  enableHierarchicalWiki,
  listHierarchicalWiki,
  updateHierarchicalWiki,
} from '@client/src/api/hierarchical-wiki';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { useSummaryResource } from './useSummaryResource';
import { useTaskModelOptions } from '@client/src/features/review/TaskModelPicker';
import SavedWorkSelector from './SavedWorkSelector';
import { wikiStatusLabels } from './hierarchical-wiki-presentation';

export { wikiStatusLabels } from './hierarchical-wiki-presentation';

export default function HierarchicalWikiDirectory({
  session,
}: {
  session: number;
}) {
  const [classificationCursor, setClassificationCursor] = useState<
    string | undefined
  >();
  const [documentCursor, setDocumentCursor] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const load = useCallback(
    (signal: AbortSignal) => listHierarchicalWiki(signal, classificationCursor),
    [classificationCursor],
  );
  const loadCatalog = useCallback(
    (signal: AbortSignal) => getCanonicalLibraryFleetCatalog(signal),
    [],
  );
  const loadDocuments = useCallback(
    (signal: AbortSignal) =>
      getCanonicalLibraryDocuments(
        { limit: 50, cursor: documentCursor, search },
        signal,
      ),
    [documentCursor, search],
  );
  const data = useSummaryResource(
    `hierarchical-wiki-directory:${classificationCursor ?? ''}`,
    session,
    load,
    { preserveWhileLoading: true, pollIntervalMs: 15_000 },
  );
  const catalog = useSummaryResource(
    'wiki-fleet-catalog',
    session,
    loadCatalog,
  );
  const documents = useSummaryResource(
    `wiki-documents:${documentCursor ?? ''}:${search}`,
    session,
    loadDocuments,
  );
  const models = useTaskModelOptions();
  const [family, setFamily] = useState('');
  const [model, setModel] = useState('');
  const [selectedRoot, setSelectedRoot] = useState('');
  const [selectedDocument, setSelectedDocument] = useState('');
  const [ata, setAta] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const perform = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await operation();
      data.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '更新未完成。');
    } finally {
      setBusy(false);
    }
  };
  const roots =
    data.data?.items.filter((item) => item.scope.kind === 'FLEET') ?? [];
  const chosenFamily = catalog.data?.families.find(
    (item) => item.fleetFamily === family,
  );
  const validAta = !ata || /^\d{2}(?:-\d{2})?$/u.test(ata);
  const configuredModel = models.data?.options.find(
    (item) => item.available && item.modelRef === models.data?.defaultModelRef,
  );
  return (
    <section
      className="space-y-4 border border-border p-4"
      aria-label="本机型分层Wiki"
      id="hierarchical-wiki"
    >
      <h2 className="text-xl font-semibold">本机型分层 Wiki</h2>
      {data.error || error || catalog.error || documents.error ? (
        <p role="alert">
          {error || data.error || catalog.error || documents.error}
        </p>
      ) : null}
      <fieldset
        disabled={busy || data.loading}
        className="grid gap-3 md:grid-cols-3"
      >
        <legend>建立本人机型 Wiki</legend>
        <label>
          父机型
          <select
            aria-label="Wiki父机型"
            className="w-full rounded border p-2"
            value={family}
            onChange={(event) => {
              setFamily(event.target.value);
              setModel('');
            }}
          >
            <option value="">选择父机型</option>
            {catalog.data?.families.map((item) => (
              <option key={item.fleetFamily}>{item.fleetFamily}</option>
            ))}
          </select>
        </label>
        <label>
          具体范围
          <select
            aria-label="Wiki子机型"
            className="w-full rounded border p-2"
            value={model}
            onChange={(event) => setModel(event.target.value)}
          >
            <option value="">父机型综合（保留子机型差异）</option>
            {chosenFamily?.models.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <div>
          <p>自动综合模型：{configuredModel?.displayName ?? '正在读取配置'}</p>
          {models.error ? <p role="alert">{models.error}<Button variant="ghost" onClick={() => void models.refresh()}>刷新模型</Button></p> : null}
        </div>
        <Button
          disabled={!family || busy || !models.ready || !configuredModel}
          onClick={() =>
            void perform(() =>
              enableHierarchicalWiki({
                fleetFamilyId: family,
                fleetModelId: model || null,
              }),
            )
          }
        >
          建立并启用自动更新
        </Button>
      </fieldset>
      <fieldset disabled={busy} className="grid gap-3 md:grid-cols-3">
        <legend>资料归类</legend>
        <label>
          目标机型 Wiki
          <select
            aria-label="归类目标Wiki"
            className="w-full rounded border p-2"
            value={selectedRoot}
            onChange={(event) => setSelectedRoot(event.target.value)}
          >
            <option value="">选择已建立的机型 Wiki</option>
            {roots.map((root) => (
              <option value={root.summaryId} key={root.summaryId}>
                {root.scope.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          查找文档
          <Input
            aria-label="查找归类文档"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setDocumentCursor(undefined);
              setSelectedDocument('');
            }}
            placeholder="文档号或名称"
          />
        </label>
        <label>
          文档
          <select
            aria-label="归类文档"
            className="w-full rounded border p-2"
            value={selectedDocument}
            onChange={(event) => setSelectedDocument(event.target.value)}
          >
            <option value="">选择本人可读文档</option>
            {documents.data?.items.map((document) => (
              <option value={document.familyId} key={document.familyId}>
                {document.documentCode ||
                  document.versions[0]?.originalFilename}
              </option>
            ))}
          </select>
        </label>
        {documents.data?.nextCursor ? (
          <Button
            variant="outline"
            onClick={() => {
              setDocumentCursor(documents.data!.nextCursor!);
              setSelectedDocument('');
            }}
          >
            下一页文档
          </Button>
        ) : null}
        {documentCursor ? (
          <Button
            variant="ghost"
            onClick={() => {
              setDocumentCursor(undefined);
              setSelectedDocument('');
            }}
          >
            文档首页
          </Button>
        ) : null}
        <label>
          ATA 章节
          <Input
            aria-label="归类ATA"
            value={ata}
            onChange={(event) => setAta(event.target.value)}
            placeholder="46-00 / 46；留空为未分类"
            maxLength={5}
          />
        </label>
        <Button
          disabled={!selectedRoot || !selectedDocument || !validAta}
          onClick={() =>
            void perform(() =>
              classifyHierarchicalWiki(selectedRoot, {
                sourceKind: 'DOCUMENT',
                sourceId: selectedDocument,
                ata: ata || null,
                included: true,
              }),
            )
          }
        >
          纳入该 Wiki
        </Button>
      </fieldset>
      {selectedRoot && validAta ? (
        <details>
          <summary className="cursor-pointer">将已有工程事项纳入该范围</summary>
          <SavedWorkSelector
            session={session}
            candidateVersionIds={[]}
            onAdd={(item) => {
              if (item.member.kind !== 'MATTER_WORK') {
                setError('请在此选择工程事项；文档可从上方目录归类。');
                return;
              }
              const sourceId = item.member.matterId;
              void perform(() =>
                classifyHierarchicalWiki(selectedRoot, {
                  sourceKind: 'MATTER',
                  sourceId,
                  ata: ata || null,
                  included: true,
                }),
              );
            }}
          />
        </details>
      ) : null}
      <details>
        <summary className="cursor-pointer">
          资料归属与归类建议（本页最多 100 项）
        </summary>
        <p className="text-sm">
          启用事项自动续评将另行委托本机型的关联事项随来源变化形成工程分析候选，使用事项的既有任务模型。
        </p>
        <ul>
          {data.data?.classifications.map((entry) => (
            <li
              className="flex flex-wrap items-center gap-3 p-2"
              key={`${entry.summaryId}:${entry.memberKey}`}
            >
              <span>
                {entry.title} ·{' '}
                {
                  data.data?.items.find(
                    (item) => item.summaryId === entry.summaryId,
                  )?.scope.title
                }{' '}
                ·
                {entry.status === 'CANDIDATE'
                  ? '建议待核对'
                  : entry.status === 'EXCLUDED'
                    ? '已移出'
                    : '已归类'}
              </span>
              {entry.documentVersionId ? (
                <Link
                  className="underline"
                  to={`/document-versions/${encodeURIComponent(entry.documentVersionId)}`}
                >
                  查看文档
                </Link>
              ) : null}
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void perform(() =>
                    classifyHierarchicalWiki(entry.summaryId, {
                      sourceKind: entry.sourceKind,
                      sourceId: entry.sourceId,
                      ata: entry.ata,
                      included: entry.status !== 'CONFIRMED',
                    }),
                  )
                }
              >
                {entry.status === 'CONFIRMED' ? '移出此范围' : '核对后纳入'}
              </Button>
              {entry.sourceKind === 'MATTER' && entry.status === 'CONFIRMED' ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void perform(() =>
                      delegateHierarchicalWikiMatter(entry.summaryId, {
                        matterId: entry.sourceId,
                        enabled: !entry.automaticMatterUpdates,
                      }),
                    )
                  }
                >
                  {entry.automaticMatterUpdates
                    ? '暂停事项自动续评'
                    : '委托事项自动续评'}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {data.data?.nextClassificationCursor ? (
          <Button
            variant="outline"
            onClick={() =>
              setClassificationCursor(data.data!.nextClassificationCursor!)
            }
          >
            下一页归属
          </Button>
        ) : null}
        {classificationCursor ? (
          <Button
            variant="ghost"
            onClick={() => setClassificationCursor(undefined)}
          >
            归属首页
          </Button>
        ) : null}
      </details>
      <ul className="space-y-2">
        {orderedWikiDirectory(data.data?.items ?? []).map((item) => (
          <li
            className={`space-y-1 border-l-2 border-border p-3 ${item.scope.kind === 'ATA4' ? 'ml-8' : item.scope.kind === 'ATA2' ? 'ml-4' : ''}`}
            key={item.summaryId}
          >
            <Link
              className="font-semibold underline"
              to={`/summaries/${encodeURIComponent(item.summaryId)}`}
            >
              {item.scope.title}
            </Link>
            <p>
              {wikiStatusLabels[item.state]} ·{' '}
              {item.enabled ? '自动更新已启用' : '自动更新已暂停'}
            </p>
            {item.waiting.length ? (
              <p className="text-sm">
                {item.waiting.length}项下层更新待汇总
              </p>
            ) : null}
            {!item.inventoryComplete ? (
              <p className="text-sm">
                资料盘点进行中
              </p>
            ) : null}
            {item.errorCode ? (
              <p role="alert">更新未完成（{item.errorCode}）。</p>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                void perform(() =>
                  updateHierarchicalWiki(item.summaryId, { immediately: true }),
                )
              }
            >
              尽快更新
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() =>
                void perform(() =>
                  updateHierarchicalWiki(item.summaryId, {
                    enabled: !item.enabled,
                  }),
                )
              }
            >
              {item.enabled ? '暂停自动更新' : '恢复自动更新'}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function orderedWikiDirectory(
  items: HierarchicalWikiStatus[],
): HierarchicalWikiStatus[] {
  const ordered: HierarchicalWikiStatus[] = [];
  const visited = new Set<string>();
  const sorted = [...items].sort((a, b) =>
    a.scope.title.localeCompare(b.scope.title, 'zh-CN'),
  );
  const visit = (item: HierarchicalWikiStatus) => {
    if (visited.has(item.summaryId)) return;
    visited.add(item.summaryId);
    ordered.push(item);
    for (const child of sorted.filter(
      (row) => row.parentSummaryId === item.summaryId,
    ))
      visit(child);
  };
  for (const root of sorted.filter((item) => item.parentSummaryId === null))
    visit(root);
  for (const item of sorted) visit(item);
  return ordered;
}
