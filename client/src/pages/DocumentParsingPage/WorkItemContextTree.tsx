import { useMemo, useState } from 'react';
import {
  Boxes,
  BrainCircuit,
  ChevronDown,
  FileCheck2,
  FileText,
  FolderTree,
  PackageCheck,
  Search,
} from 'lucide-react';

import type { CanonicalDocumentParsingPageResponse } from '@shared/api.interface';

interface WorkItemContextTreeProps {
  data: CanonicalDocumentParsingPageResponse;
}

interface ContextNode {
  id: string;
  label: string;
  detail: string;
  level: number;
  target: string;
  icon: typeof FileText;
}

export function WorkItemContextTree({ data }: WorkItemContextTreeProps) {
  const [filter, setFilter] = useState('');
  const nodes = useMemo(() => buildNodes(data), [data]);
  const visibleNodes = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return nodes;
    return nodes.filter((node) =>
      `${node.label} ${node.detail}`.toLowerCase().includes(query),
    );
  }, [filter, nodes]);

  return (
    <aside className="workitem-tree" aria-label="资料目录树">
      <header>
        <div>
          <span>资料目录</span>
          <strong>族群 · 文档 · 修订</strong>
        </div>
        <FolderTree aria-hidden="true" />
      </header>
      <label className="workitem-tree-search">
        <Search aria-hidden="true" />
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="筛选当前资料"
          aria-label="筛选当前资料树"
        />
      </label>
      <div className="workitem-tree-nodes">
        {visibleNodes.map((node) => (
          <button
            type="button"
            key={node.id}
            className={`workitem-tree-node level-${node.level}`}
            onClick={() =>
              document.getElementById(node.target)?.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
              })
            }
          >
            {node.level < 3 ? <ChevronDown aria-hidden="true" /> : <span />}
            <node.icon aria-hidden="true" />
            <span>
              <strong>{node.label}</strong>
              <small>{node.detail}</small>
            </span>
          </button>
        ))}
        {visibleNodes.length === 0 ? <p>当前筛选没有匹配节点。</p> : null}
      </div>
      <footer>
        <span>{nodes.length} 个当前上下文节点</span>
        <small>只展示服务端 fresh-read，不在浏览器维护目录真源。</small>
      </footer>
    </aside>
  );
}

function buildNodes(data: CanonicalDocumentParsingPageResponse): ContextNode[] {
  const pkg = data.workItem.package;
  const documentCode =
    pkg?.documentIdentity?.documentCode ?? pkg?.title ?? '受控文档';
  const revision = pkg?.documentIdentity?.businessRevision ?? '当前修订';
  return [
    {
      id: 'family',
      label: data.workItem.classification.normalizedFamily,
      detail: data.workItem.classification.parserProfileId,
      level: 0,
      target: 'workspace-document',
      icon: Boxes,
    },
    {
      id: 'document',
      label: documentCode,
      detail: data.workItem.source.documentVersionId,
      level: 1,
      target: 'workspace-document',
      icon: FileText,
    },
    {
      id: 'revision',
      label: revision,
      detail: `${data.workItem.source.sourceByteLength.toLocaleString()} bytes`,
      level: 2,
      target: 'workspace-document',
      icon: FileCheck2,
    },
    {
      id: 'source',
      label: '原件与来源身份',
      detail: data.workItem.source.sourceArtifactId,
      level: 3,
      target: 'workspace-document',
      icon: FileText,
    },
    {
      id: 'package',
      label: 'Unified Parsed Package',
      detail: pkg?.contractRevision ?? '尚未生成',
      level: 3,
      target: 'workspace-package',
      icon: PackageCheck,
    },
    {
      id: 'reader',
      label: 'Reader 来源定位',
      detail: `${data.queryResults.length} 个当前查询结果`,
      level: 3,
      target: 'workspace-reader',
      icon: Search,
    },
    {
      id: 'reasoning',
      label: '方法与依据',
      detail: data.workItem.integratedAssessment
        ? '动态规则 · 整体候选 · 人工动作'
        : '等待受控评估产物',
      level: 3,
      target: 'workspace-reasoning',
      icon: BrainCircuit,
    },
    {
      id: 'assessment',
      label: 'OpenClaw 动态 N 与整体候选',
      detail: data.workItem.integratedAssessment?.status ?? '尚未生成',
      level: 3,
      target: 'workspace-assessment',
      icon: BrainCircuit,
    },
    {
      id: 'aeo',
      label: 'AEO 候选编写',
      detail: data.workItem.aeo?.status ?? '等待人工确认',
      level: 3,
      target: data.workItem.aeo ? 'workspace-aeo' : 'workspace-assessment',
      icon: FileCheck2,
    },
  ];
}
