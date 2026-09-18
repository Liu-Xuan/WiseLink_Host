/**
 * WikiPageAdapter - 事项 Wiki 页面适配器
 */

import React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { WikiPage } from '../pages/WikiPage';

export function WikiPageAdapter() {
  const navigate = useNavigate();
  const { matterId } = useParams<{ matterId: string }>();
  const [searchParams] = useSearchParams();

  const tab = searchParams.get('tab') || 'current';

  if (!matterId) {
    return (
      <div className="error-container">
        <p>事项 ID 缺失</p>
        <button onClick={() => navigate('/library')}>返回资料库</button>
      </div>
    );
  }

  const handleNavigateToDoc = (docId: string) => {
    navigate(`/document-versions/${docId}`);
  };

  const handleNavigateToTimeline = (matterId: string) => {
    navigate(`/timeline?matter=${matterId}`);
  };

  const handleNavigateToGraph = (matterId: string) => {
    navigate(`/graph?matter=${matterId}`);
  };

  return (
    <WikiPage
      matterId={matterId}
      tab={tab}
      onNavigateToDoc={handleNavigateToDoc}
      onNavigateToTimeline={handleNavigateToTimeline}
      onNavigateToGraph={handleNavigateToGraph}
    />
  );
}
