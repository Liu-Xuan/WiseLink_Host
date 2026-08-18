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
import type { CanonicalDocumentParsingPageResponse } from '@shared/api.interface';

type WorkbenchNode =
  | 'document'
  | 'package'
  | 'reader'
  | 'assessment'
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
        <small>由服务端 fresh-read 生成，不维护浏览器目录真源。</small>
      </footer>
    </aside>
  );
}

function buildNodes(data: CanonicalDocumentParsingPageResponse): ContextNode[] {
  const pkg = data.workItem.package;
  const integrated = data.workItem.integratedAssessment ?? null;
  const overall = integrated?.overallSynthesis ?? null;
  const documentCode: string =
    pkg?.documentIdentity?.documentCode ?? pkg?.title ?? '受控文档';
  const revision: string =
    pkg?.documentIdentity?.businessRevision ?? '当前修订';
  return [
    {
      id: 'family',
      label: data.workItem.classification.normalizedFamily,
      detail: data.workItem.classification.parserProfileId,
      level: 0,
      target: 'workspace-document',
      deepLinkNode: 'document',
      state: 'ready',
      icon: Boxes,
    },
    {
      id: 'document',
      label: documentCode,
      detail: data.workItem.source.documentVersionId,
      level: 1,
      target: 'workspace-document',
      deepLinkNode: 'document',
      state: 'ready',
      icon: FileText,
    },
    {
      id: 'revision',
      label: revision,
      detail: `${data.workItem.source.sourceByteLength.toLocaleString()} bytes`,
      level: 2,
      target: 'workspace-document',
      deepLinkNode: 'document',
      state: 'ready',
      icon: FileCheck2,
    },
    {
      id: 'source',
      label: '原件与来源身份',
      detail: data.workItem.source.sourceArtifactId,
      level: 3,
      target: 'workspace-document',
      deepLinkNode: 'document',
      state: 'ready',
      icon: FileText,
    },
    {
      id: 'package',
      label: 'Unified Parsed Package',
      detail: pkg?.contractRevision ?? '尚未生成',
      level: 3,
      target: 'workspace-package',
      deepLinkNode: 'package',
      state: pkg ? 'ready' : 'waiting',
      icon: PackageCheck,
    },
    {
      id: 'reader',
      label: 'Reader 来源定位',
      detail: `${data.queryResults.length} 个当前查询结果`,
      level: 3,
      target: 'workspace-reader',
      deepLinkNode: 'reader',
      state: pkg ? 'ready' : 'waiting',
      icon: Search,
    },
    {
      id: 'reasoning',
      label: '查阅与候选形成记录',
      detail: integrated
        ? '动态规则 · 整体候选 · 人工动作'
        : '等待受控评估产物',
      level: 3,
      target: 'workspace-reasoning',
      deepLinkNode: 'overall',
      state: overall?.staleReason ? 'attention' : integrated ? 'ready' : 'waiting',
      icon: BrainCircuit,
    },
    {
      id: 'assessment',
      label: 'OpenClaw 动态 N',
      detail: integrated?.baseRules.status ?? '尚未生成',
      level: 3,
      target: 'workspace-assessment',
      deepLinkNode: 'assessment',
      state: integrated?.baseRules ? 'ready' : 'waiting',
      icon: BrainCircuit,
    },
    {
      id: 'aeo',
      label: 'AEO 候选编写',
      detail: data.workItem.aeo?.status ?? '等待人工确认',
      level: 3,
      target: data.workItem.aeo ? 'workspace-aeo' : 'workspace-assessment',
      deepLinkNode: 'aeo',
      state: data.workItem.aeo ? 'ready' : 'waiting',
      icon: FileCheck2,
    },
  ];
}

export type { WorkbenchNode };
