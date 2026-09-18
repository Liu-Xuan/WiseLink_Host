/**
 * WikiPage - 事项 Wiki 页面
 *
 * 匹配 WiseLink_Frontend_Suite_20260917 的两列布局
 * 左侧：主文区（.article-panel + .engineering-article）
 * 右侧：侧边栏（.wiki-aside）- 阅读目录、继续关注、关键依据、认识的历史
 */

import React, { useState, useEffect } from 'react';
import type { WikiMatter, WikiPageProps } from './types';
import '../../styles/design-tokens.css';
import './wiki.css';

export type { WikiMatter } from './types';

export function WikiPage({
  matterId,
  tab = 'current',
  onNavigateToDoc,
  onNavigateToTimeline,
  onNavigateToGraph,
  onNavigateToMatter,
}: WikiPageProps) {
  const [matter, setMatter] = useState<WikiMatter | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 加载事项数据
  useEffect(() => {
    loadMatter();
  }, [matterId]);

  async function loadMatter() {
    setLoading(true);
    setError(null);
    try {
      // TODO: 替换为真实 API 调用
      await new Promise(resolve => setTimeout(resolve, 300));
      setMatter(getMockMatter(matterId));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner" />
        <p>加载事项 Wiki...</p>
      </div>
    );
  }

  if (error || !matter) {
    return (
      <div className="error-container">
        <p className="error-message">{error || '事项不存在'}</p>
        <button onClick={() => window.history.back()}>返回</button>
      </div>
    );
  }

  return (
    <div className="wiki-layout">
      {/* 左侧：主文面板 */}
      <section className="panel article-panel scroll-region">
        {/* 工具栏 */}
        <div className="article-tools">
          <span className="badge">{matter.fleet} · ATA {matter.ata}</span>
          <span className="badge">{matter.overview}</span>
          <div className="push" />
          <button className="btn" onClick={() => onNavigateToDoc?.(matter.primaryDocId)}>
            <svg className="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4h8l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z" />
            </svg>
            主要来源
          </button>
          <button className="btn">复制</button>
        </div>

        {/* 工程文章主体 */}
        <article className="engineering-article">
          <div className="article-kicker">{matter.code} · {matter.revision}</div>
          <h1>{matter.title}</h1>
          <p className="article-lead">{matter.summary}</p>

          {/* 正文章节 */}
          {matter.body.map((section) => (
            <section key={section.id} id={`issue-${section.id}`}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((para, index) => (
                <p key={index}>{para}</p>
              ))}

              {/* 来源链接 */}
              {section.sourceRefs.length > 0 && (
                <div className="source-links">
                  <small>依据：</small>
                  {section.sourceRefs.map((ref, index) => (
                    <button
                      key={index}
                      className="source-link"
                      onClick={() => {
                        const docId = section.sources[index];
                        onNavigateToDoc?.(docId);
                      }}
                    >
                      {ref}
                    </button>
                  ))}
                </div>
              )}
            </section>
          ))}
        </article>
      </section>

      {/* 右侧：侧边栏 */}
      <aside className="wiki-aside">
        {/* 阅读目录 */}
        <section className="panel">
          <div className="panel-head">
            <h3>阅读目录</h3>
          </div>
          <div className="outline-links">
            {matter.body.map((section) => (
              <button
                key={section.id}
                onClick={() => {
                  document.getElementById(`issue-${section.id}`)?.scrollIntoView({
                    block: 'start',
                    behavior: 'smooth'
                  });
                }}
              >
                {section.title}
              </button>
            ))}
          </div>
        </section>

        {/* 继续关注 */}
        {matter.open && matter.open.length > 0 && (
          <section className="panel">
            <div className="panel-head">
              <h3>继续关注</h3>
            </div>
            <div className="aside-body">
              {matter.open.map((item, index) => (
                <p key={index} className="bullet">{item}</p>
              ))}
              <button className="btn" onClick={() => onNavigateToTimeline?.(matter.id)}>
                <svg className="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="10" cy="10" r="7" />
                  <path d="M10 6v4l3 2" />
                </svg>
                变化与时间轴
              </button>
            </div>
          </section>
        )}

        {/* 关键依据 */}
        {matter.evidenceDocIds && matter.evidenceDocIds.length > 0 && (
          <section className="panel">
            <div className="panel-head">
              <h3>关键依据</h3>
            </div>
            <div className="aside-body">
              {matter.evidenceDocIds.map((docId) => (
                <button
                  key={docId}
                  className="related-file"
                  onClick={() => onNavigateToDoc?.(docId)}
                >
                  <svg className="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M4 4h8l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z" />
                  </svg>
                  <span>{docId}</span>
                </button>
              ))}
              <button className="btn" onClick={() => onNavigateToGraph?.(matter.id)}>
                <svg className="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="10" cy="5" r="2" />
                  <circle cx="5" cy="15" r="2" />
                  <circle cx="15" cy="15" r="2" />
                  <path d="M10 7v3M7 13l3-3M13 13l-3-3" />
                </svg>
                查看实际关系
              </button>
            </div>
          </section>
        )}

        {/* 认识的历史 */}
        {matter.workHistory && matter.workHistory.length > 0 && (
          <section className="panel">
            <div className="panel-head">
              <h3>认识的历史</h3>
            </div>
            <div className="aside-body">
              {matter.workHistory.map((entry) => (
                <div key={entry.version} className="history-entry">
                  <small>{entry.date} · {entry.version}</small>
                  <p>{entry.summary}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}

// 临时：模拟事项数据
function getMockMatter(matterId: string): WikiMatter {
  return {
    id: matterId,
    title: '起落架收放异常分析',
    code: 'WL-M001',
    ata: '32',
    fleet: 'A320',
    overview: '当前工作',
    revision: 'v3',
    summary: '限定该机型特定构型的检查要求；临时措施可用，最终方案需确认改装工具。',

    body: [
      {
        id: 'section-1',
        title: '问题概述',
        paragraphs: [
          'A320 特定构型的起落架收放系统在例行检查中发现异常。主要表现为收放速度变慢，且伴有轻微异响。',
          '该问题影响范围限定于 MSN 5000-5200 区间的特定改装构型，其他批次未发现类似现象。',
          '当前判断为液压作动系统老化所致，需进行深入分析以确定根本原因。',
        ],
        sources: ['doc-1'],
        sourceRefs: ['AMM 32-11-00'],
      },
      {
        id: 'section-2',
        title: '当前认识',
        paragraphs: [
          '经过初步排查和测试，已明确以下几点认识：',
          '1. 液压系统压力正常，排除了液压泵故障的可能性。',
          '2. 起落架作动筒密封件存在轻微老化迹象，但尚未达到更换标准。',
          '3. 位置传感器信号正常，排除电气系统故障。',
          '临时措施：增加润滑频次至每 500 飞行小时一次，密切监控收放时间和异响情况。',
          '最终方案：待工具到位后，实施作动筒密封件预防性更换，并对液压管路进行全面检查。',
        ],
        sources: ['doc-1', 'doc-2'],
        sourceRefs: ['AMM 32-11-00', 'SB 32-1234'],
      },
      {
        id: 'section-3',
        title: '关键条件与限制',
        paragraphs: [
          '以下条件和限制需要特别注意：',
          '• 本分析限定于 A320 MSN 5000-5200 区间的特定改装构型',
          '• 临时措施有效期为 6 个月或直至最终改装完成',
          '• 密封件更换需使用专用工具（目前尚未到货）',
          '• 不适用于 A321 和 A319 机型，即使症状类似也需单独分析',
        ],
        sources: ['doc-2'],
        sourceRefs: ['SB 32-1234'],
      },
      {
        id: 'section-4',
        title: '相关技术资料',
        paragraphs: [
          '以下技术资料为本次分析的重要依据：',
          '• AMM 32-11-00: 起落架系统维护手册，规定了标准检查程序',
          '• SB 32-1234: 服务通告，描述了密封件改进方案',
          '• TSM 32-21-00: 故障排除手册，提供了诊断流程',
        ],
        sources: ['doc-1', 'doc-2', 'doc-3'],
        sourceRefs: ['AMM 32-11-00', 'SB 32-1234', 'TSM 32-21-00'],
      },
    ],

    open: [
      '专用工具到货时间确认（预计 2024-06）',
      '密封件库存数量核查',
      'MSN 5200 以后批次是否需要预防性检查',
    ],

    evidenceDocIds: ['doc-1', 'doc-2', 'doc-3'],
    primaryDocId: 'doc-1',

    workHistory: [
      {
        version: 'v3',
        date: '2024-03-15',
        summary: '明确临时措施和最终方案；确认工具依赖关系。',
      },
      {
        version: 'v2',
        date: '2024-02-20',
        summary: '完成初步排查；排除液压泵和电气系统故障。',
      },
      {
        version: 'v1',
        date: '2024-01-10',
        summary: '建立问题档案；定义分析范围。',
      },
    ],

    // 关联事项（借鉴 LLM Wiki 的交叉引用）
    relatedMatters: [
      {
        id: 'WL-M015',
        title: '液压系统老化趋势分析',
        relationship: 'related',
      },
      {
        id: 'WL-M042',
        title: '作动筒密封件改进项目',
        relationship: 'depends',
      },
      {
        id: 'WL-M008',
        title: '起落架收放异常（旧版分析）',
        relationship: 'supersedes',
      },
    ],
  };
}
