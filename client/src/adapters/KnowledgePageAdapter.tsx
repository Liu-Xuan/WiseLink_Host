/**
 * KnowledgePageAdapter - 工程知识页面适配器
 */

import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { KnowledgePage } from '../pages/KnowledgePage';

export function KnowledgePageAdapter() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const initialQuery = searchParams.get('q') || '';

  const handleNavigateToWiki = (matterId: string, tab?: string) => {
    const path = `/matters/${matterId}`;
    const search = tab ? `?tab=${tab}` : '';
    navigate(path + search);
  };

  const handleNavigateToGraph = (matterId: string) => {
    navigate(`/graph?matter=${matterId}`);
  };

  const handleNavigateToDoc = (docId: string) => {
    navigate(`/document-versions/${docId}`);
  };

  return (
    <KnowledgePage
      initialQuery={initialQuery}
      onNavigateToWiki={handleNavigateToWiki}
      onNavigateToGraph={handleNavigateToGraph}
      onNavigateToDoc={handleNavigateToDoc}
    />
  );
}
