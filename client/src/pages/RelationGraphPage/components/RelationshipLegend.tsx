// RelationshipLegend - Phase 3.5: Visual legend for edge types and strengths
import React from 'react';
import type { RelationshipTypeStats, StrengthDistributionStats } from '../hooks/useEdgeStyles';

interface RelationshipLegendProps {
  relationshipTypes: RelationshipTypeStats[];
  strengthDistribution: StrengthDistributionStats;
  onClose: () => void;
}

/**
 * Legend panel showing edge types and strength distribution
 *
 * Features:
 * - Color-coded relationship types with counts
 * - Strength distribution visualization
 * - Collapsible sections
 * - Draggable positioning (future)
 *
 * @example
 * ```tsx
 * <RelationshipLegend
 *   relationshipTypes={[
 *     { type: 'contains', count: 45, color: '#38BDF8', label: '包含' }
 *   ]}
 *   strengthDistribution={{ weak: 10, medium: 30, strong: 15 }}
 *   onClose={() => setLegendVisible(false)}
 * />
 * ```
 */
export function RelationshipLegend({
  relationshipTypes,
  strengthDistribution,
  onClose
}: RelationshipLegendProps) {
  const totalEdges = relationshipTypes.reduce((sum, type) => sum + type.count, 0);
  const totalByStrength = strengthDistribution.weak + strengthDistribution.medium + strengthDistribution.strong;

  return (
    <div className="relationship-legend">
      <div className="legend-header">
        <h3>关系图例</h3>
        <button
          className="legend-close"
          onClick={onClose}
          title="关闭"
        >
          ✕
        </button>
      </div>

      <div className="legend-content">
        {/* Relationship Types Section */}
        <div className="legend-section">
          <h4 className="legend-section-title">
            关系类型
            <span className="legend-count">({totalEdges})</span>
          </h4>
          <div className="legend-items">
            {relationshipTypes.map(type => (
              <div key={type.type} className="legend-item">
                <div className="legend-item-indicator">
                  <div
                    className="legend-line"
                    style={{ backgroundColor: type.color }}
                  />
                </div>
                <div className="legend-item-content">
                  <span className="legend-item-label">{type.label}</span>
                  <span className="legend-item-count">{type.count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Strength Distribution Section */}
        <div className="legend-section">
          <h4 className="legend-section-title">
            关系强度
            <span className="legend-count">({totalByStrength})</span>
          </h4>
          <div className="legend-items">
            <div className="legend-item">
              <div className="legend-item-indicator">
                <div
                  className="legend-line legend-line-weak"
                  style={{ width: '20px', height: '1px', opacity: 0.3 }}
                />
              </div>
              <div className="legend-item-content">
                <span className="legend-item-label">弱关系</span>
                <span className="legend-item-count">{strengthDistribution.weak}</span>
              </div>
            </div>

            <div className="legend-item">
              <div className="legend-item-indicator">
                <div
                  className="legend-line legend-line-medium"
                  style={{ width: '20px', height: '2px', opacity: 0.6 }}
                />
              </div>
              <div className="legend-item-content">
                <span className="legend-item-label">中等关系</span>
                <span className="legend-item-count">{strengthDistribution.medium}</span>
              </div>
            </div>

            <div className="legend-item">
              <div className="legend-item-indicator">
                <div
                  className="legend-line legend-line-strong"
                  style={{ width: '20px', height: '3px', opacity: 0.9 }}
                />
              </div>
              <div className="legend-item-content">
                <span className="legend-item-label">强关系</span>
                <span className="legend-item-count">{strengthDistribution.strong}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Visual Indicators Explanation */}
        <div className="legend-section legend-section-help">
          <div className="legend-help-text">
            <p className="legend-help-item">
              <strong>粗细:</strong> 表示关系强度
            </p>
            <p className="legend-help-item">
              <strong>颜色:</strong> 区分关系类型
            </p>
            <p className="legend-help-item">
              <strong>动画:</strong> 标记强关系
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
