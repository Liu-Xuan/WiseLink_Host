/**
 * WikiPage 相关类型定义
 */

export interface WikiMatter {
  id: string;
  title: string;
  code: string;
  ata: string;
  fleet: string;
  overview: string;
  revision: string;
  summary: string;

  body: Array<{
    id: string;
    title: string;
    paragraphs: string[];
    sources: string[];
    sourceRefs: string[];
  }>;

  open: string[];  // 继续关注项
  evidenceDocIds: string[];  // 关键依据文档ID
  primaryDocId?: string;  // 主要来源文档

  workHistory: Array<{
    version: string;
    date: string;
    summary: string;
  }>;

  // 新增：关联事项
  relatedMatters?: Array<{
    id: string;
    title: string;
    relationship: 'related' | 'depends' | 'blocks' | 'supersedes';
  }>;
}

export interface WikiPageProps {
  matterId: string;
  tab?: string;
  onNavigateToDoc?: (docId: string) => void;
  onNavigateToTimeline?: (matterId: string) => void;
  onNavigateToGraph?: (matterId: string) => void;
  onNavigateToMatter?: (matterId: string) => void;
}

export interface TocItem {
  id: string;
  title: string;
  level: number;
  anchor: string;
}
