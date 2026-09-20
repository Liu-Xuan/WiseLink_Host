/**
 * KnowledgePage - 工程知识页面
 *
 * 基于 Suite 1.1 设计的双栏布局
 * 左侧：已有解释列表
 * 右侧：完整正文
 */

import React, { useState, useMemo, useEffect } from 'react';
import { KnowledgeHeader } from './KnowledgeHeader';
import { KnowledgeList } from './KnowledgeList';
import { KnowledgeDetail } from './KnowledgeDetail';
import './knowledge.css';

export type KnowledgeViewKind = 'works' | 'sources';
export type KnowledgeVersionScope = 'current' | 'all' | 'historical';

export interface KnowledgeWork {
  id: string;
  matterId: string;
  issueId?: string;
  title: string;
  summary: string;
  scope: string;
  body: Array<{
    id: string;
    title: string;
    paragraphs: string[];
    sources: string[];
    sourceRefs: string[];
  }>;
  current: boolean;
  version: string;
  created: string;
  ata?: string;
  fleet?: string;
}

export interface KnowledgeSource {
  id: string;
  title: string;
  type: string;
  version: string;
  brief: string;
}

interface KnowledgePageProps {
  initialQuery?: string;
  onNavigateToWiki?: (matterId: string, tab?: string) => void;
  onNavigateToGraph?: (matterId: string) => void;
  onNavigateToDoc?: (docId: string) => void;
}

export function KnowledgePage({
  initialQuery = '',
  onNavigateToWiki,
  onNavigateToGraph,
  onNavigateToDoc,
}: KnowledgePageProps) {
  // 状态管理
  const [kind, setKind] = useState<KnowledgeViewKind>('works');
  const [version, setVersion] = useState<KnowledgeVersionScope>('current');
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState<string | null>(null);
  const [works, setWorks] = useState<KnowledgeWork[]>([]);
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [loading, setLoading] = useState(true);

  // 加载数据
  useEffect(() => {
    loadKnowledgeData();
  }, [query, kind, version]);

  async function loadKnowledgeData() {
    setLoading(true);
    try {
      // TODO: 替换为真实 API 调用
      await new Promise(resolve => setTimeout(resolve, 300));

      if (kind === 'works') {
        setWorks(getMockWorks());
      } else {
        setSources(getMockSources());
      }
    } finally {
      setLoading(false);
    }
  }

  // 过滤工作内容
  const filteredWorks = useMemo(() => {
    let filtered = works;

    // 版本过滤
    if (version === 'current') {
      filtered = filtered.filter(w => w.current);
    } else if (version === 'historical') {
      filtered = filtered.filter(w => !w.current);
    }

    // 关键词过滤
    if (query) {
      const q = query.toLowerCase();
      filtered = filtered.filter(w =>
        w.title.toLowerCase().includes(q) ||
        w.summary.toLowerCase().includes(q) ||
        w.scope.toLowerCase().includes(q)
      );
    }

    return filtered;
  }, [works, version, query]);

  // 过滤来源资料
  const filteredSources = useMemo(() => {
    if (!query) return sources;
    const q = query.toLowerCase();
    return sources.filter(s =>
      s.title.toLowerCase().includes(q) ||
      s.brief.toLowerCase().includes(q)
    );
  }, [sources, query]);

  // 当前选中项
  const selectedWork = filteredWorks.find(w => w.id === selected) || filteredWorks[0];

  // 初始选择
  useEffect(() => {
    if (filteredWorks.length > 0 && !selected) {
      setSelected(filteredWorks[0].id);
    }
  }, [filteredWorks, selected]);

  return (
    <>
      {/* 页面标题 */}
      <div className="page-heading">
        <div>
          <h1>工程知识</h1>
          <p>先找到已有解释，再核对它的条件、来源和确切工作范围。</p>
        </div>
        <span className="badge">直接读取已保存工作</span>
      </div>

      {/* 工具栏 */}
      <KnowledgeHeader
        kind={kind}
        version={version}
        query={query}
        onKindChange={setKind}
        onVersionChange={setVersion}
        onQueryChange={setQuery}
      />

      {/* 主内容区 */}
      {kind === 'works' ? (
        <div className="knowledge-layout">
          {/* 左侧：工作列表 */}
          <KnowledgeList
            works={filteredWorks}
            selected={selected}
            loading={loading}
            onSelect={setSelected}
          />

          {/* 右侧：详细内容 */}
          <KnowledgeDetail
            work={selectedWork}
            onNavigateToWiki={onNavigateToWiki}
            onNavigateToGraph={onNavigateToGraph}
          />
        </div>
      ) : (
        // 来源资料列表
        <section className="panel scroll-region">
          <div className="panel-head">
            <h3>资料标题与已保存解读</h3>
          </div>
          <div className="all-source-list">
            {filteredSources.map(source => (
              <button
                key={source.id}
                onClick={() => onNavigateToDoc?.(source.id)}
              >
                <span>
                  <span className="badge">
                    {source.type} · {source.version}
                  </span>
                  <b>{source.title}</b>
                  <p>{source.brief}</p>
                </span>
                <span>精读 →</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

// 临时：模拟工作数据
function getMockWorks(): KnowledgeWork[] {
  return [
    {
      id: 'work-1',
      matterId: 'matter-1',
      issueId: 'issue-1',
      title: '起落架收放系统检查周期',
      summary: '限定A320系列特定构型的检查要求；临时措施可用，最终方案需确认改装工具。',
      scope: 'A320 · ATA 32',
      body: [
        {
          id: 'section-1',
          title: '阅读范围与限制',
          paragraphs: [
            '本工作限定A320系列特定构型的起落架收放系统。不包括A321和A319的非标配置。',
            '临时措施适用于当前维护周期；最终改装方案需等待工具兼容性确认。',
          ],
          sources: ['doc-1'],
          sourceRefs: ['AMM 32-11-00'],
        },
        {
          id: 'section-2',
          title: '当前认识',
          paragraphs: [
            '检查周期已明确：每1000飞行小时或12个月，以先到为准。',
            '关键检查点包括：液压管路连接、作动筒密封性、位置传感器校准。',
          ],
          sources: ['doc-1', 'doc-2'],
          sourceRefs: ['AMM 32-11-00', 'SB 32-1234'],
        },
      ],
      current: true,
      version: 'v3',
      created: '2024-03-15',
      ata: '32',
      fleet: 'A320',
    },
    {
      id: 'work-2',
      matterId: 'matter-2',
      title: '液压系统压力波动分析',
      summary: '识别压力波动的根本原因；已排除泵故障，怀疑是管路老化导致。',
      scope: 'A320 · ATA 29',
      body: [
        {
          id: 'section-1',
          title: '问题现象',
          paragraphs: [
            '系统压力在正常工作时出现±5%的波动，超出标准允许范围。',
            '波动主要发生在起飞和降落阶段，巡航阶段较为稳定。',
          ],
          sources: ['doc-3'],
          sourceRefs: ['TSM 29-21-00'],
        },
        {
          id: 'section-2',
          title: '当前分析',
          paragraphs: [
            '已通过测试排除液压泵故障的可能性。',
            '怀疑是管路老化导致弹性变化，需进一步检查管路状态。',
          ],
          sources: ['doc-3'],
          sourceRefs: ['TSM 29-21-00'],
        },
      ],
      current: true,
      version: 'v1',
      created: '2024-05-20',
      ata: '29',
      fleet: 'A320',
    },
  ];
}

// 临时：模拟来源数据
function getMockSources(): KnowledgeSource[] {
  return [
    {
      id: 'doc-1',
      title: 'A320 Landing Gear System Maintenance Manual',
      type: 'AMM',
      version: 'R1',
      brief: '规定A320系列特定构型的起落架收放系统检查周期；临时措施已明确。',
    },
    {
      id: 'doc-2',
      title: 'Service Bulletin 32-1234',
      type: 'SB',
      version: 'R0',
      brief: '起落架系统改装说明，需确认工具兼容性。',
    },
    {
      id: 'doc-3',
      title: 'A320 Hydraulic System Troubleshooting',
      type: 'TSM',
      version: 'R2',
      brief: '液压系统故障诊断手册，包含压力波动分析方法。',
    },
  ];
}
