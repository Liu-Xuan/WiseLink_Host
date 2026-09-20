// DocumentListPanel - Floating panel showing documents in a group
import React, { useState } from 'react';

export interface DocumentItem {
  id: string;
  title: string;
  version?: string;
  type?: string;
}

export interface DocumentListPanelProps {
  groupTitle: string;
  documents: DocumentItem[];
  totalCount: number;
  initialShowCount?: number;
  onDocumentClick: (docId: string) => void;
  onClose: () => void;
}

export function DocumentListPanel({
  groupTitle,
  documents,
  totalCount,
  initialShowCount = 3,
  onDocumentClick,
  onClose
}: DocumentListPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const displayDocs = expanded ? documents : documents.slice(0, initialShowCount);
  const remainingCount = totalCount - initialShowCount;

  return (
    <div className="document-list-panel">
      <div className="panel-header">
        <h3>{groupTitle}</h3>
        <span className="panel-badge">{totalCount}篇</span>
        <button
          className="panel-close-btn"
          onClick={onClose}
          title="关闭"
        >
          ✕
        </button>
      </div>

      <div className="panel-body">
        {displayDocs.map(doc => (
          <div
            key={doc.id}
            className="panel-doc-item"
            onClick={() => onDocumentClick(doc.id)}
          >
            <div className="doc-item-title">{doc.title}</div>
            {doc.version && (
              <div className="doc-item-version">{doc.version}</div>
            )}
          </div>
        ))}

        {!expanded && remainingCount > 0 && (
          <button
            className="panel-more-button"
            onClick={() => setExpanded(true)}
          >
            + {remainingCount} more
          </button>
        )}
      </div>
    </div>
  );
}
