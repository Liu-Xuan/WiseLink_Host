/**
 * LibraryPageAdapter - 资料库页面适配器
 *
 * 将 Suite 1.1 LibraryPage 适配到现有数据结构
 */

import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LibraryPage } from '../pages/LibraryPage';
import type { DocumentItem, MatterItem } from '../pages/LibraryPage';
import { fetchDocumentReadingsPreview } from '../api/document-reading.api';

export interface DocumentReadingBatchPreviewItem {
  documentVersionId: string;
  parseRunId: string | null;
  semanticRevision: number | null;
  headline: string | null;
  briefSummary: string | null;
  status: 'AVAILABLE' | 'SOURCE_CHANGED' | 'NOT_GENERATED' | 'UNAUTHORIZED';
}

/**
 * 使用真实数据
 * 从后端 API 获取文档和事项列表
 */
function useLibraryData() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [matters, setMatters] = useState<MatterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      try {
        // TODO: 替换为真实的 API 调用
        // 目前使用模拟数据演示集成

        // 1. 获取文档列表（模拟）
        const mockDocuments = await fetchMockDocuments();

        if (!mounted) return;

        // 2. 批量获取文档解读
        const documentIds = mockDocuments.map(d => d.id);
        const readings = await fetchDocumentReadingsPreview(documentIds);

        if (!mounted) return;

        // 3. 合并数据
        const enrichedDocuments = mockDocuments.map(doc => {
          const reading = readings.find(r => r.documentVersionId === doc.id);
          return {
            ...doc,
            brief: reading?.briefSummary || '解读准备中…',
          };
        });

        // 4. 获取事项列表（模拟）
        const mockMatters = await fetchMockMatters();

        if (!mounted) return;

        setDocuments(enrichedDocuments);
        setMatters(mockMatters);
        setLoading(false);
      } catch (err) {
        console.error('Failed to load library data:', err);
        if (mounted) {
          setError(err instanceof Error ? err.message : '加载失败');
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, []);

  return { documents, matters, loading, error };
}

/**
 * 临时：模拟文档列表
 * TODO: 替换为真实 API 调用
 */
async function fetchMockDocuments(): Promise<Omit<DocumentItem, 'brief'>[]> {
  // 模拟网络延迟
  await new Promise(resolve => setTimeout(resolve, 300));

  return [
    {
      id: 'doc-1',
      familyId: 'fam-1',
      title: 'A320 Landing Gear System Maintenance Manual',
      type: 'AMM',
      version: 'R1',
      ata: '32',
      fleet: 'A320',
      current: true,
      effective: '2024-03',
      attachmentIds: [],
      matterId: 'matter-1',
    },
    {
      id: 'doc-2',
      familyId: 'fam-2',
      title: 'A320 Hydraulic System Troubleshooting',
      type: 'TSM',
      version: 'R2',
      ata: '29',
      fleet: 'A320',
      current: true,
      effective: '2024-05',
      attachmentIds: ['doc-3'],
      matterId: 'matter-2',
    },
    {
      id: 'doc-3',
      familyId: 'fam-2',
      title: 'Hydraulic System Diagram',
      type: '附件',
      version: 'R2',
      ata: '29',
      fleet: 'A320',
      current: true,
      effective: '2024-05',
      attachmentIds: [],
    },
  ];
}

/**
 * 临时：模拟事项列表
 * TODO: 替换为真实 API 调用
 */
async function fetchMockMatters(): Promise<MatterItem[]> {
  await new Promise(resolve => setTimeout(resolve, 200));

  return [
    {
      id: 'matter-1',
      code: 'WL-M001',
      title: '起落架收放异常分析',
      fleet: 'A320',
      ata: '32',
      overview: '当前工作',
      summary: '限定该机型特定构型的检查要求；临时措施可用，最终方案需确认改装工具。',
      overallCovered: true,
      responsible: true,
      revision: 'v3',
    },
    {
      id: 'matter-2',
      code: 'WL-M002',
      title: '液压系统压力波动问题',
      fleet: 'A320',
      ata: '29',
      overview: '问题分析',
      summary: '识别压力波动的根本原因；已排除泵故障，怀疑是管路老化导致。',
      overallCovered: false,
      responsible: false,
      revision: 'v1',
    },
  ];
}

export function LibraryPageAdapter() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { documents, matters, loading, error } = useLibraryData();

  // 从 URL 参数获取视图模式
  const mode = searchParams.get('view') === 'matters' ? 'matters' : 'documents';

  const handleNavigateToDoc = (docId: string) => {
    navigate(`/document-versions/${docId}`);
  };

  const handleNavigateToWiki = (matterId: string) => {
    navigate(`/matters/${matterId}`);
  };

  const handleNavigateToGraph = (matterId: string) => {
    navigate(`/graph?matter=${matterId}`);
  };

  const handleOpenIntake = () => {
    // 打开上传资料对话框
    // TODO: implement intake dialog
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner" />
        <p>加载资料库...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container">
        <p className="error-message">加载失败: {error}</p>
        <button onClick={() => window.location.reload()}>重试</button>
      </div>
    );
  }

  return (
    <LibraryPage
      mode={mode}
      documents={documents}
      matters={matters}
      onNavigateToDoc={handleNavigateToDoc}
      onNavigateToWiki={handleNavigateToWiki}
      onNavigateToGraph={handleNavigateToGraph}
      onOpenIntake={handleOpenIntake}
    />
  );
}
