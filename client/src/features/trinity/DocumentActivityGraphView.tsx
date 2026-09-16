import { useEffect, useMemo, useRef } from 'react';
import cytoscape, { type Core } from 'cytoscape';
import { Button } from '@client/src/components/ui/button';
import type { DocumentActivityReadingResponse } from '@shared/document-activity.interface';
import { activityGraphNodeId, buildActivityGraphElements, selectionForGraphNode } from './document-activity-graph';
import './document-activity-graph.css';

export interface DocumentActivityGraphViewProps {
  reading: DocumentActivityReadingResponse;
  selectedStatementId: string | null;
  selectedAnchorId: string | null;
  onSelectLocation: (statementId: string | null, anchorId: string | null) => void;
  onReturnTimeline: () => void;
}

export default function DocumentActivityGraphView({ reading, selectedStatementId, selectedAnchorId, onSelectLocation, onReturnTimeline }: DocumentActivityGraphViewProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const onSelectLocationRef = useRef(onSelectLocation);
  onSelectLocationRef.current = onSelectLocation;
  const elements = useMemo(() => buildActivityGraphElements(reading), [reading]);
  useEffect(() => {
    if (!host.current) return undefined;
    const cy = cytoscape({ container: host.current, elements, style: [
      { selector: 'node', style: { label: 'data(label)', 'background-color': '#e8f0ed', color: '#27292c', 'font-size': '11px', 'text-wrap': 'wrap', 'text-max-width': '130px', width: 42, height: 42 } },
      { selector: 'node[kind="statement"]', style: { 'background-color': '#d9e5e0', shape: 'round-rectangle', width: 100, height: 48 } },
      { selector: 'node[kind="quote"]', style: { 'background-color': '#f2eddf', shape: 'round-rectangle', width: 94, height: 42 } },
      { selector: 'node[kind="sourceRef"]', style: { 'background-color': '#e5e7e9', shape: 'ellipse' } },
      { selector: 'edge', style: { width: 1.4, 'line-color': '#a4c1b7', 'target-arrow-color': '#6b7177', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier' } },
      { selector: '.selected', style: { 'border-width': 3, 'border-color': '#6b7177' } },
    ], layout: { name: 'cose', animate: false, fit: true, padding: 30 } });
    cy.on('tap', 'node', (event) => {
      const data = event.target.data();
      const selection = selectionForGraphNode(reading, data);
      if (selection) onSelectLocationRef.current(selection.statementId, selection.anchorId);
    });
    cyRef.current = cy;
    return () => { cy.destroy(); cyRef.current = null; };
  }, [elements, reading]);
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().removeClass('selected');
    cy.nodes().filter((node) => (selectedStatementId && node.data('statementId') === selectedStatementId) || (selectedAnchorId && node.data('anchorId') === selectedAnchorId)).addClass('selected');
  }, [selectedStatementId, selectedAnchorId, elements]);
  if (!reading.candidate) return <section className="activity-graph-empty" role="status">当前准确来源没有已保存候选，无法生成关系图。</section>;
  const candidate = reading.candidate;
  return <section className="activity-graph" data-testid="activity-graph">
    <header><div><div className="activity-graph-eyebrow">仅该保存候选的引文关系</div><h2>活动关系图</h2><p>图形只表达声明、逐条引用、实际锚点与 SourceRef 的保存关系，不推断跨版本事件、风险或因果。</p></div><Button variant="outline" size="sm" onClick={onReturnTimeline}>返回时间轴</Button></header>
    <div className="activity-graph-layout"><div className="activity-graph-canvas" ref={host} aria-label="活动引文关系图" /><aside className="activity-graph-table"><h3>关系明细</h3>{candidate.statements.map((statement) => <div className="activity-graph-row" key={statement.statementId}><button type="button" className="activity-graph-statement" onClick={() => onSelectLocation(statement.statementId, null)}><strong>{statement.label}</strong><small>声明 {statement.statementId} · {statement.quotes.length} 条保存引用</small></button>{statement.quotes.map((quote, quoteIndex) => { const anchor = candidate.sourceAnchors.find((item) => item.anchorId === quote.anchorId); return <button type="button" className="activity-graph-quote" key={`${quote.anchorId}:${quote.start}:${quote.end}:${quoteIndex}`} onClick={() => onSelectLocation(statement.statementId, quote.anchorId)}><span>“{quote.text}”</span><small>锚点 {quote.anchorId}{anchor ? ` · ${anchor.sourceRefIds.length} 个 SourceRef` : ' · 未取得对应锚点'}</small></button>; })}</div>)}<h3 className="activity-graph-anchor-heading">候选来源锚点</h3>{candidate.sourceAnchors.map((anchor) => <button type="button" className="activity-graph-anchor-row" key={anchor.anchorId} onClick={() => onSelectLocation(null, anchor.anchorId)}><strong>{anchor.anchorId}</strong><small>{anchor.sourceRefIds.length ? anchor.sourceRefIds.join(' · ') : '未记录 SourceRef'}</small></button>)}</aside></div>
  </section>;
}
