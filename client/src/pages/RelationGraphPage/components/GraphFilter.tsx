// Graph Filter - Phase 3.3: Multi-dimensional filtering
import React, { useState, useRef, useEffect } from 'react';
import type { NodeType, PerspectiveType } from '../types';

export interface FilterConfig {
  nodeTypes: Set<NodeType>;
  perspectives: Set<PerspectiveType>;
  showEdges: boolean;
  minConnections?: number;
  maxConnections?: number;
}

interface GraphFilterProps {
  filterConfig: FilterConfig;
  onFilterChange: (config: FilterConfig) => void;
  totalNodes: number;
  filteredNodes: number;
}

const NODE_TYPE_LABELS: Record<NodeType, string> = {
  matterHub: '中心节点',
  cluster: '集群',
  documentGroup: '文档组',
  compact: '文档',
  more: '更多'
};

const PERSPECTIVE_LABELS: Record<PerspectiveType, string> = {
  document: '文档视角',
  knowledge: '知识视角',
  timeline: '时间视角',
  people: '人员视角'
};

/**
 * Multi-dimensional filter popup for graph nodes
 *
 * Features:
 * - Node type filtering (checkbox list)
 * - Perspective filtering
 * - Edge visibility toggle
 * - Connection count range
 * - Real-time filter count display
 * - Reset all filters
 */
export function GraphFilter({
  filterConfig,
  onFilterChange,
  totalNodes,
  filteredNodes
}: GraphFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Toggle node type
  const toggleNodeType = (type: NodeType) => {
    const newTypes = new Set(filterConfig.nodeTypes);
    if (newTypes.has(type)) {
      newTypes.delete(type);
    } else {
      newTypes.add(type);
    }
    onFilterChange({ ...filterConfig, nodeTypes: newTypes });
  };

  // Toggle perspective
  const togglePerspective = (perspective: PerspectiveType) => {
    const newPerspectives = new Set(filterConfig.perspectives);
    if (newPerspectives.has(perspective)) {
      newPerspectives.delete(perspective);
    } else {
      newPerspectives.add(perspective);
    }
    onFilterChange({ ...filterConfig, perspectives: newPerspectives });
  };

  // Toggle edge visibility
  const toggleEdges = () => {
    onFilterChange({ ...filterConfig, showEdges: !filterConfig.showEdges });
  };

  // Update connection range
  const updateMinConnections = (value: number) => {
    onFilterChange({ ...filterConfig, minConnections: value || undefined });
  };

  const updateMaxConnections = (value: number) => {
    onFilterChange({ ...filterConfig, maxConnections: value || undefined });
  };

  // Reset all filters
  const resetFilters = () => {
    onFilterChange({
      nodeTypes: new Set(['matterHub', 'cluster', 'documentGroup', 'compact', 'more']),
      perspectives: new Set(['document', 'knowledge', 'timeline', 'people']),
      showEdges: true,
      minConnections: undefined,
      maxConnections: undefined
    });
  };

  // Check if any filter is active
  const hasActiveFilters =
    filterConfig.nodeTypes.size < 5 ||
    filterConfig.perspectives.size < 4 ||
    !filterConfig.showEdges ||
    filterConfig.minConnections !== undefined ||
    filterConfig.maxConnections !== undefined;

  const filteredCount = totalNodes - filteredNodes;

  return (
    <div className="graph-filter" ref={dropdownRef}>
      <button
        className={`filter-toggle ${hasActiveFilters ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title="过滤器"
      >
        <span className="filter-icon">🔽</span>
        <span className="filter-label">过滤</span>
        {hasActiveFilters && (
          <span className="filter-badge">{filteredCount}</span>
        )}
      </button>

      {isOpen && (
        <div className="filter-dropdown">
          <div className="filter-header">
            <h4>图谱过滤器</h4>
            <button
              className="filter-reset"
              onClick={resetFilters}
              disabled={!hasActiveFilters}
            >
              重置
            </button>
          </div>

          <div className="filter-section">
            <h5 className="filter-section-title">节点类型</h5>
            <div className="filter-options">
              {(Object.keys(NODE_TYPE_LABELS) as NodeType[]).map(type => (
                <label key={type} className="filter-checkbox">
                  <input
                    type="checkbox"
                    checked={filterConfig.nodeTypes.has(type)}
                    onChange={() => toggleNodeType(type)}
                  />
                  <span className="checkbox-label">{NODE_TYPE_LABELS[type]}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <h5 className="filter-section-title">视角</h5>
            <div className="filter-options">
              {(Object.keys(PERSPECTIVE_LABELS) as PerspectiveType[]).map(perspective => (
                <label key={perspective} className="filter-checkbox">
                  <input
                    type="checkbox"
                    checked={filterConfig.perspectives.has(perspective)}
                    onChange={() => togglePerspective(perspective)}
                  />
                  <span className="checkbox-label">{PERSPECTIVE_LABELS[perspective]}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <h5 className="filter-section-title">显示选项</h5>
            <div className="filter-options">
              <label className="filter-checkbox">
                <input
                  type="checkbox"
                  checked={filterConfig.showEdges}
                  onChange={toggleEdges}
                />
                <span className="checkbox-label">显示连接线</span>
              </label>
            </div>
          </div>

          <div className="filter-section">
            <h5 className="filter-section-title">连接数范围</h5>
            <div className="filter-range">
              <div className="range-input">
                <label>最小</label>
                <input
                  type="number"
                  min="0"
                  value={filterConfig.minConnections ?? ''}
                  onChange={(e) => updateMinConnections(parseInt(e.target.value))}
                  placeholder="0"
                />
              </div>
              <div className="range-separator">—</div>
              <div className="range-input">
                <label>最大</label>
                <input
                  type="number"
                  min="0"
                  value={filterConfig.maxConnections ?? ''}
                  onChange={(e) => updateMaxConnections(parseInt(e.target.value))}
                  placeholder="∞"
                />
              </div>
            </div>
          </div>

          <div className="filter-footer">
            <div className="filter-stats">
              显示 <strong>{filteredNodes}</strong> / {totalNodes} 节点
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
