import { useMemo, useState } from 'react';
import {
  Boxes,
  BrainCircuit,
  ChevronRight,
  FileCheck2,
  FileText,
  FolderTree,
  PackageCheck,
  Search,
} from 'lucide-react';

import { Input } from '@client/src/components/ui/input';
import type {
  CanonicalDocumentParsingPageResponse,
  CanonicalLibraryIndexNode,
} from '@shared/api.interface';

type WorkbenchNode =
  | 'document'
  | 'package'
  | 'reader'
  | 'assessment'
  | 'review'
  | 'overall'
  | 'aeo';

interface WorkItemContextTreeProps {
  data: CanonicalDocumentParsingPageResponse;
  activeNode: WorkbenchNode;
  onNodeSelect: (node: WorkbenchNode, target: string) => void;
}

interface ContextNode {
  id: string;
  label: string;
  detail: string;
  level: number;
  target: string;
  deepLinkNode: WorkbenchNode;
  state: 'ready' | 'waiting' | 'attention';
  icon: typeof FileText;
}

export function WorkItemContextTree({
  data,
  activeNode,
  onNodeSelect,
}: WorkItemContextTreeProps) {
  const [filter, setFilter] = useState<string>('');
  const nodes: ContextNode[] = useMemo(() => buildNodes(data), [data]);
  const visibleNodes: ContextNode[] = useMemo(() => {
    const query: string = filter.trim().toLowerCase();
    if (!query) return nodes;
    return nodes.filter((node: ContextNode) =>
      `${node.label} ${node.detail}`.toLowerCase().includes(query),
    );
  }, [filter, nodes]);

  return (
    <aside className="workitem-tree" aria-label="资料目录树">
      <header>
        <div>
          <span>WORKITEM CONTENT</span>
          <strong>资料目录</strong>
          <small>族群 · 文档 · 修订</small>
        </div>
        <FolderTree aria-hidden="true" />
      </header>
      <label className="workitem-tree-search">
        <Search aria-hidden="true" />
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="筛选当前资料"
          aria-label="筛选当前资料树"
        />
      </label>
      <div className="workitem-tree-nodes">
        {visibleNodes.map((node: ContextNode) => (
          <button
            type="button"
            key={node.id}
            className={`workitem-tree-node level-${node.level}${
              activeNode === node.deepLinkNode ? ' is-active' : ''
            }`}
            aria-current={
              activeNode === node.deepLinkNode ? 'location' : undefined
            }
            onClick={() => onNodeSelect(node.deepLinkNode, node.target)}
          >
            <ChevronRight aria-hidden="true" />
            <node.icon aria-hidden="true" />
            <span>
              <strong>{node.label}</strong>
              <small title={node.detail}>{node.detail}</small>
            </span>
            <i
              className={`workitem-tree-state is-${node.state}`}
              title={node.state}
              aria-label={node.state}
            />
          </button>
        ))}
        {visibleNodes.length === 0 ? <p>当前筛选没有匹配节点。</p> : null}
      </div>
      <footer>
        <span>{nodes.length} 个上下文节点</span>
        <small>目录随当前工程事项的最新资料更新。</small>
      </footer>
    </aside>
  );
}

function buildNodes(data: CanonicalDocumentParsingPageResponse): ContextNode[] {
  const lookup = new Map<string, CanonicalLibraryIndexNode>(
    data.libraryIndex.nodes.map((node: CanonicalLibraryIndexNode) => [
      node.id,
      node,
    ]),
  );
  return data.libraryIndex.nodes.map((node: CanonicalLibraryIndexNode) => {
    const level = depthFor(node, lookup);
    return {
      id: node.id,
      label: node.label,
      detail: node.detail,
      level,
      target: targetByNode(node.targetNode),
      deepLinkNode: node.targetNode,
      state: stateFor(node),
      icon: iconForNode(node.kind),
    } satisfies ContextNode;
  });
}

function depthFor(
  node: CanonicalLibraryIndexNode,
  lookup: Map<string, CanonicalLibraryIndexNode>,
): number {
  let depth = 0;
  let parentId = node.parentId;
  while (parentId) {
    const parent = lookup.get(parentId);
    if (!parent) break;
    depth += 1;
    parentId = parent.parentId;
  }
  return depth;
}

function targetByNode(value: CanonicalLibraryIndexNode['targetNode']): string {
  if (value === 'document') return 'workspace-document';
  if (value === 'package') return 'workspace-package';
  if (value === 'reader') return 'workspace-reader';
  if (value === 'assessment') return 'workspace-assessment';
  if (value === 'overall') return 'workspace-reasoning';
  return 'workspace-aeo';
}

function stateFor(
  node: CanonicalLibraryIndexNode,
): 'ready' | 'waiting' | 'attention' {
  if (node.state.includes('STALE') || node.state.includes('FAILED')) {
    return 'attention';
  }
  if (node.kind === 'AEO_CANDIDATE' && node.state === 'WAITING') {
    return 'waiting';
  }
  if (node.state.includes('WAIT')) {
    return 'waiting';
  }
  return 'ready';
}

function iconForNode(kind: CanonicalLibraryIndexNode['kind']): typeof FileText {
  if (kind === 'WORK_ITEM') return Boxes;
  if (kind === 'DOCUMENT') return FileText;
  if (kind === 'DOCUMENT_VERSION') return FileCheck2;
  if (kind === 'PARSED_PACKAGE') return PackageCheck;
  if (kind === 'READER_QUERY') return Search;
  if (kind === 'DYNAMIC_EVALUATION' || kind === 'OVERALL_SYNTHESIS') {
    return BrainCircuit;
  }
  return FileCheck2;
}

export type { WorkbenchNode };
