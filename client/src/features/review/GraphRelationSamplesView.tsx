import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { CanonicalLibraryIndexReadResponse } from '@shared/api.interface';
import { Button } from '@client/src/components/ui/button';
import RelationGraphPage from '@client/src/pages/RelationGraphPage/RelationGraphPage';
import type { RelationGraphNodeData } from '@client/src/pages/RelationGraphPage/relation-graph-data';
import { matterDocumentRoute } from '@client/src/features/matter/matter-navigation';
import {
  CHRONOLOGY_CLAIM_KIND_LABEL,
  CHRONOLOGY_PRECISION_LABEL,
} from '@client/src/features/review/chronology-samples';
import type { ChronologyClaimSample } from '@client/src/features/review/chronology-samples';
import type {
  GraphRelationSampleEntry,
  GraphRelationSampleRelation,
} from './graph-samples';
import {
  GRAPH_RELATION_NARROW_READ_MISSING_FIELDS,
  GRAPH_RELATION_SAMPLE_MATTER_ID,
  GRAPH_RELATION_SAMPLE_WORK_ITEM_ID,
} from './graph-samples';

export interface GraphRelationSamplesViewProps {
  projection: CanonicalLibraryIndexReadResponse;
  entries: GraphRelationSampleEntry[];
}

const RELATION_STATUS_LABEL: Record<
  GraphRelationSampleRelation['status'],
  string
> = {
  REAL_CONTRACT_PENDING: '真实合同待交付',
  SOURCE_ONLY: '仅来源节点',
};

/**
 * T2 图谱联动隔离样例交互视图：条目选择、关联定位、来源打开及返回。
 * 样例数据与假 ID 不进入生产读取；来源仅展示生产路由构造的 QA 目标，不导航真实 Reader。
 */
export function claimKey(claim: ChronologyClaimSample): string {
  return JSON.stringify([
    claim.sourceRef.documentVersionId,
    claim.sourceRef.locator,
    claim.claimKind,
    claim.precision,
    claim.rawValue,
  ]);
}

export default function GraphRelationSamplesView({
  projection,
  entries,
}: GraphRelationSamplesViewProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedEntry =
    entries.find((item) => item.entryKey === searchParams.get('entry')) ??
    entries[0] ??
    null;
  const selectedClaim =
    selectedEntry?.claims.find(
      (claim) => claimKey(claim) === searchParams.get('claim'),
    ) ??
    selectedEntry?.claims[0] ??
    null;
  const freeNode = projection.libraryIndex.nodes.find(
    (node) => node.id === searchParams.get('node'),
  );
  const sourceOpen = searchParams.get('view') === 'source' && !!selectedClaim;

  // URL is the selection authority, including history traversal and a fresh mount.
  useEffect(() => {
    if (!selectedEntry || !selectedClaim) return;
    if (
      searchParams.get('entry') === selectedEntry.entryKey &&
      searchParams.get('claim') === claimKey(selectedClaim)
    )
      return;
    const next = new URLSearchParams(searchParams);
    next.set('entry', selectedEntry.entryKey);
    next.set('claim', claimKey(selectedClaim));
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, selectedEntry, selectedClaim]);

  function selectEntry(
    entry: GraphRelationSampleEntry,
    claim = entry.claims[0],
    source = false,
  ): void {
    const next = new URLSearchParams(searchParams);
    next.set('entry', entry.entryKey);
    if (claim) next.set('claim', claimKey(claim));
    else next.delete('claim');
    next.delete('node');
    if (source) next.set('view', 'source');
    else next.delete('view');
    setSearchParams(next);
  }

  function handleNodeSelect(node: RelationGraphNodeData): void {
    if (selectedEntry?.nodeId === node.id) {
      selectEntry(selectedEntry, selectedClaim ?? undefined);
      return;
    }
    const bound = entries.find((item) => item.nodeId === node.id);
    if (bound) {
      selectEntry(bound);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set('node', node.id);
    next.delete('view');
    setSearchParams(next);
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        隔离样例：来源仅在本页示意，不向真实阅读器发送假 ID。
        真实阅读与返回合同尚未接通；本页不代表真实业务验收。
      </section>
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-2">
          <h2 className="text-sm font-medium text-foreground">样例条目</h2>
          {entries.map((entry: GraphRelationSampleEntry) => (
            <button
              key={entry.entryKey}
              type="button"
              aria-pressed={entry.entryKey === selectedEntry?.entryKey}
              onClick={() => selectEntry(entry)}
              className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                entry.entryKey === selectedEntry?.entryKey
                  ? 'border-foreground/40 bg-muted text-foreground'
                  : 'border-border text-muted-foreground hover:bg-muted/50'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </aside>
        <div className="space-y-4">
          {sourceOpen && selectedEntry && selectedClaim ? (
            <section
              aria-label="隔离来源示意"
              className="rounded-lg border border-border p-4 space-y-2"
            >
              <h2 className="font-medium">来源示意（隔离，非真实阅读器）</h2>
              <p>
                {selectedEntry.label} · {selectedClaim.rawValue}
              </p>
              <p>
                {selectedClaim.sourceRef.sourceLabel} ·{' '}
                {selectedClaim.sourceRef.locator}
              </p>
              <p className="text-sm text-muted-foreground">
                仅展示样例来源标识，无真实文档正文；真实阅读合同尚未接通。
              </p>
              <code className="block break-all text-xs">
                {matterDocumentRoute(GRAPH_RELATION_SAMPLE_MATTER_ID, {
                  workItemId: GRAPH_RELATION_SAMPLE_WORK_ITEM_ID,
                  documentVersionId: selectedClaim.sourceRef.documentVersionId,
                  sourceRefId: selectedClaim.sourceRef.locator,
                })}
              </code>
              <Button onClick={() => selectEntry(selectedEntry, selectedClaim)}>
                返回所选条目与声明
              </Button>
            </section>
          ) : (
            <RelationGraphPage
              injectedProjection={projection}
              onNodeSelect={handleNodeSelect}
              highlightedNodeId={freeNode?.id ?? selectedEntry?.nodeId}
            />
          )}
          {selectedEntry ? (
            <EntryDetailPanel
              entry={selectedEntry}
              selectedClaim={selectedClaim}
              onSelectClaim={(claim) => selectEntry(selectedEntry, claim)}
              onOpenSource={(claim) => selectEntry(selectedEntry, claim, true)}
            />
          ) : null}
          {freeNode ? <FreeNodePanel node={freeNode} /> : null}
        </div>
      </div>
      <section className="rounded-lg border border-border p-4">
        <h2 className="text-sm font-medium text-foreground">
          窄读取缺失字段（待主控交付，未造数）
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {GRAPH_RELATION_NARROW_READ_MISSING_FIELDS.map((field: string) => (
            <li key={field}>{field}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

interface EntryDetailPanelProps {
  entry: GraphRelationSampleEntry;
  selectedClaim: ChronologyClaimSample | null;
  onSelectClaim: (claim: ChronologyClaimSample) => void;
  onOpenSource: (claim: ChronologyClaimSample) => void;
}

function EntryDetailPanel({
  entry,
  selectedClaim,
  onSelectClaim,
  onOpenSource,
}: EntryDetailPanelProps) {
  return (
    <section className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-foreground">{entry.label}</h2>
        <span className="text-xs text-muted-foreground">
          稳定身份：{entry.entryKey}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{entry.scenarioNote}</p>
      <div className="mt-3 space-y-2">
        {entry.claims.map((claim: ChronologyClaimSample) => (
          <div
            key={`${claim.sourceRef.documentVersionId}-${claim.sourceRef.locator}`}
            className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
          >
            <Button
              variant="outline"
              aria-pressed={claim === selectedClaim}
              onClick={() => onSelectClaim(claim)}
            >
              选择声明 {claim.rawValue}
            </Button>
            <span className="text-foreground">
              {CHRONOLOGY_CLAIM_KIND_LABEL[claim.claimKind]} ·{' '}
              {CHRONOLOGY_PRECISION_LABEL[claim.precision]}
            </span>
            <span className="text-muted-foreground">{claim.rawValue}</span>
            <span className="text-xs text-muted-foreground">
              来源：{claim.sourceRef.sourceLabel}（{claim.sourceRef.locator}）
            </span>
            <Button
              size="sm"
              variant="outline"
              data-ai-section-type="button"
              onClick={() => onOpenSource(claim)}
            >
              打开来源
            </Button>
          </div>
        ))}
      </div>
      <div className="mt-3 space-y-2">
        <h3 className="text-sm font-medium text-foreground">关系条目</h3>
        {entry.relations.map((relation: GraphRelationSampleRelation) => (
          <div
            key={relation.relationKey}
            className="rounded-md border border-border px-3 py-2 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-foreground">{relation.label}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {RELATION_STATUS_LABEL[relation.status]}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {relation.note}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

interface FreeNodePanelProps {
  node: Pick<RelationGraphNodeData, 'label' | 'detail'>;
}

function FreeNodePanel({ node }: FreeNodePanelProps) {
  return (
    <section className="rounded-lg border border-border p-4 text-sm">
      <h2 className="font-medium text-foreground">图谱节点：{node.label}</h2>
      <p className="mt-1 text-muted-foreground">{node.detail}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        该节点无绑定样例条目；真实关系读取合同交付前，这里只呈现节点自身信息。
      </p>
    </section>
  );
}
