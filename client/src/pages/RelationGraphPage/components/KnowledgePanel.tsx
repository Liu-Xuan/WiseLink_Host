// Knowledge Panel component - placeholder for Phase 2
import React from 'react';

interface KnowledgePanelProps {
  selectedNodeId: string | null;
}

export function KnowledgePanel({ selectedNodeId }: KnowledgePanelProps) {
  return (
    <div className="knowledge-panel">
      <div className="knowledge-header">
        <h3>知识面板</h3>
      </div>
      <div className="knowledge-content">
        {selectedNodeId ? (
          <>
            <div className="knowledge-section">
              <h4>节点信息</h4>
              <div className="knowledge-item">
                <span className="label">ID:</span>
                <span className="value">{selectedNodeId}</span>
              </div>
            </div>
            <div className="knowledge-section">
              <h4>相关知识</h4>
              <div className="knowledge-placeholder">
                知识点将在 Phase 2 实现
              </div>
            </div>
            <div className="knowledge-section">
              <h4>关联文档</h4>
              <div className="knowledge-placeholder">
                关联文档列表将在 Phase 2 实现
              </div>
            </div>
          </>
        ) : (
          <div className="knowledge-empty">
            <p>点击图谱中的节点查看详细信息</p>
          </div>
        )}
      </div>
    </div>
  );
}
