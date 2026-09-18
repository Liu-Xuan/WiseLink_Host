/**
 * WikiPage - 事项 Wiki 页面
 *
 * 基于静态演示页面的设计语言
 * 单列内容页布局，使用 .page-hero、.section-title、.grid、.card
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
      {/* 页面英雄区 */}
      <div className="page-hero">
        <div>
          <h1>{matter.title}</h1>
          <p>{matter.summary}</p>
        </div>
        <div className="hero-tags">
          <span className="pill">{matter.fleet} · ATA {matter.ata}</span>
          <span className="pill">{matter.overview}</span>
          <span className="pill">{matter.code} · {matter.revision}</span>
        </div>
      </div>

      {/* 正文章节 */}
      {matter.body.map((section) => (
        <React.Fragment key={section.id}>
          <div className="section-title">
            <h2>{section.title}</h2>
          </div>
          <div className="grid g1">
            <div className="content-card" id={`section-${section.id}`}>
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
            </div>
          </div>
        </React.Fragment>
      ))}

      {/* 继续关注 */}
      {matter.open && matter.open.length > 0 && (
        <>
          <div className="section-title">
            <h2>继续关注</h2>
            <p>{matter.open.length} 项待确认</p>
          </div>
          <div className="grid g1">
            <div className="card open-items-card">
              {matter.open.map((item, index) => (
                <p key={index}>{item}</p>
              ))}
            </div>
          </div>
        </>
      )}

      {/* 关联事项 */}
      {matter.relatedMatters && matter.relatedMatters.length > 0 && (
        <>
          <div className="section-title">
            <h2>关联事项</h2>
            <p>{matter.relatedMatters.length} 个相关事项</p>
          </div>
          <div className="grid g3">
            {matter.relatedMatters.map((related) => (
              <div
                key={related.id}
                className={`related-card relationship-${related.relationship}`}
                onClick={() => onNavigateToMatter?.(related.id)}
              >
                <span className="relationship-badge">
                  {related.relationship === 'related' && 'Related'}
                  {related.relationship === 'depends' && 'Depends'}
                  {related.relationship === 'blocks' && 'Blocks'}
                  {related.relationship === 'supersedes' && 'Supersedes'}
                </span>
                <span className="related-title">{related.title}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 认识历史 */}
      {matter.workHistory && matter.workHistory.length > 0 && (
        <>
          <div className="section-title">
            <h2>认识历史</h2>
            <p>{matter.workHistory.length} 个版本</p>
          </div>
          <div className="grid g1">
            <div className="card">
              {matter.workHistory.map((entry, index) => (
                <div key={index} className="stat">
                  <span>{entry.version} · {entry.date}</span>
                  <span style={{ fontSize: '10px', color: 'var(--ink)' }}>{entry.summary}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
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
