import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ComparisonHeader from './ComparisonHeader';
import ComparisonOverview from './ComparisonOverview';
import ComparisonGrid from './ComparisonGrid';
import './version-comparison.css';

interface DocumentVersion {
  id: string;
  familyId: string;
  version: string;
  title: string;
  current: boolean;
  previousId?: string;
  binding: {
    parseRunId: string;
    parseRevision: string;
    documentVersionId: string;
  };
  blocks: ComparisonBlock[];
}

export interface ComparisonBlock {
  id: string;
  kind: 'heading' | 'paragraph' | 'table' | 'list';
  role: string;
  page: number;
  title: string;
  zhTitle: string;
  en: string;
  zh: string;
}

interface RevisionComparison {
  newer: DocumentVersion;
  older: DocumentVersion | null;
}

export default function VersionComparisonPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();

  const [comparison, setComparison] = useState<RevisionComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [availableFamilies, setAvailableFamilies] = useState<
    Array<{ id: string; familyId: string; title: string }>
  >([]);

  // 加载文档比较数据
  useEffect(() => {
    if (!documentId) return;

    setLoading(true);
    setError(null);

    // TODO: 替换为真实的 API 调用
    setTimeout(() => {
      // Mock 数据
      const newerDoc: DocumentVersion = {
        id: documentId,
        familyId: 'AMM-25-11-00',
        version: 'Rev 45',
        title: 'Flight Control System',
        current: true,
        previousId: 'doc-older-id',
        binding: {
          parseRunId: 'parse-456',
          parseRevision: 'r6',
          documentVersionId: 'v-456',
        },
        blocks: [
          {
            id: 'block-1',
            kind: 'heading',
            role: 'background',
            page: 0,
            title: 'General',
            zhTitle: '概述',
            en: 'This section describes the flight control system architecture and enhanced components.',
            zh: '本节描述飞行控制系统的架构和增强组件。',
          },
          {
            id: 'block-2',
            kind: 'paragraph',
            role: 'scope',
            page: 0,
            title: 'Scope',
            zhTitle: '适用范围',
            en: 'The flight control system applies to all aircraft series.',
            zh: '飞行控制系统适用于所有飞机系列。',
          },
          {
            id: 'block-revision',
            kind: 'paragraph',
            role: 'revision',
            page: 1,
            title: 'Revision',
            zhTitle: '本版修订',
            en: 'Rev 45 updates component specifications and adds new safety requirements.',
            zh: 'Rev 45 更新了组件规格并增加了新的安全要求。',
          },
        ],
      };

      const olderDoc: DocumentVersion = {
        id: 'doc-older-id',
        familyId: 'AMM-25-11-00',
        version: 'Rev 44',
        title: 'Flight Control System',
        current: false,
        binding: {
          parseRunId: 'parse-123',
          parseRevision: 'r5',
          documentVersionId: 'v-123',
        },
        blocks: [
          {
            id: 'block-1',
            kind: 'heading',
            role: 'background',
            page: 0,
            title: 'General',
            zhTitle: '概述',
            en: 'This section describes the flight control system architecture and components.',
            zh: '本节描述飞行控制系统的架构和组件。',
          },
          {
            id: 'block-2',
            kind: 'paragraph',
            role: 'scope',
            page: 0,
            title: 'Scope',
            zhTitle: '适用范围',
            en: 'The flight control system applies to all aircraft series.',
            zh: '飞行控制系统适用于所有飞机系列。',
          },
        ],
      };

      setComparison({ newer: newerDoc, older: olderDoc });
      setAvailableFamilies([
        { id: documentId, familyId: 'AMM-25-11-00', title: 'Flight Control System' },
        { id: 'doc-2', familyId: 'AMM-27-10-00', title: 'Hydraulic System' },
      ]);
      setLoading(false);
    }, 300);
  }, [documentId]);

  const handleFamilyChange = (newDocumentId: string) => {
    navigate(`/version-comparison/${newDocumentId}`);
  };

  const handleOpenReader = (docId: string) => {
    navigate(`/reader/${docId}`);
  };

  if (loading) {
    return (
      <div className="version-comparison-page loading">
        <div className="loading-spinner">加载中...</div>
      </div>
    );
  }

  if (error || !comparison) {
    return (
      <div className="version-comparison-page error">
        <div className="error-message">
          <h2>加载失败</h2>
          <p>{error || '无法加载文档比较'}</p>
          <button onClick={() => navigate(-1)}>返回</button>
        </div>
      </div>
    );
  }

  return (
    <div className="version-comparison-page">
      <ComparisonHeader
        currentFamilyId={comparison.newer.familyId}
        availableFamilies={availableFamilies}
        onFamilyChange={handleFamilyChange}
        onBack={() => navigate(-1)}
      />

      {comparison.older ? (
        <>
          <ComparisonOverview
            newer={comparison.newer}
            older={comparison.older}
          />

          <ComparisonGrid
            newer={comparison.newer}
            older={comparison.older}
            onOpenReader={handleOpenReader}
          />
        </>
      ) : (
        <div className="comparison-empty panel">
          <div className="empty-state">
            <h3>当前文档族尚无可比较的历史版本</h3>
            <p>可以选择另一个文档族，或直接阅读当前版本。</p>
            <button
              className="btn"
              onClick={() => handleOpenReader(comparison.newer.id)}
            >
              阅读原文
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
