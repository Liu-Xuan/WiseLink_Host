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
      { selector: 'edge', style: { width: 1.2, 'line-color': '#a4c1b7', 'target-arrow-color': '#6b7177', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', label: 'data(label)', color: '#70777d', 'font-size': '8px', 'text-background-color': '#ffffff', 'text-background-opacity': .88, 'text-background-padding': '2px' } },
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
  const selectedStatement = candidate.statements.find((statement) => statement.statementId === selectedStatementId) ?? null;
  const selectedAnchor = candidate.sourceAnchors.find((anchor) => anchor.anchorId === selectedAnchorId)
    ?? (selectedStatement ? candidate.sourceAnchors.find((anchor) => anchor.anchorId === selectedStatement.quotes[0]?.anchorId) : null)
    ?? null;
  const nodeCount = elements.filter((element) => !element.data.source).length;
  const edgeCount = elements.length - nodeCount;
  return <section className="activity-graph" data-testid="activity-graph">
    <div className="activity-graph-toolbar">
      <div className="activity-graph-scope" role="group" aria-label="图谱范围">
        <button type="button" className="active">保存候选</button>
        <button type="button" disabled title="当前读取合同没有事项级关系">工程事项</button>
        <button type="button" disabled title="当前读取合同没有技术领域关系">技术领域</button>
        <button type="button" disabled title="当前读取合同没有全景关系">全景</button>
      </div>
      <details className="activity-graph-relations"><summary>关系列表</summary><div>
        {candidate.statements.map((statement) => <section className="activity-graph-row" key={statement.statementId}>
          <button type="button" className="activity-graph-statement" onClick={() => onSelectLocation(statement.statementId, null)}><strong>{statement.label}</strong><small>声明 {statement.statementId} · {statement.quotes.length} 条保存引用</small></button>
          {statement.quotes.map((quote, quoteIndex) => { const anchor = candidate.sourceAnchors.find((item) => item.anchorId === quote.anchorId); return <button type="button" className="activity-graph-quote" key={`${quote.anchorId}:${quote.start}:${quote.end}:${quoteIndex}`} onClick={() => onSelectLocation(statement.statementId, quote.anchorId)}><span>“{quote.text}”</span><small>锚点 {quote.anchorId}{anchor ? ` · ${anchor.sourceRefIds.length} 个 SourceRef` : ' · 未取得对应锚点'}</small></button>; })}
        </section>)}
      </div></details>
    </div>
    <div className="activity-graph-layout">
      <div className="activity-graph-stage">
        <div className="activity-graph-canvas" ref={host} aria-label="活动引文关系图" />
        <footer className="activity-graph-legend"><span><i className="statement" />声明</span><span><i className="quote" />逐条引文</span><span><i className="anchor" />来源锚点</span><span><i className="source" />SourceRef</span><b>{nodeCount} 节点 · {edgeCount} 关系</b></footer>
      </div>
      <aside className="activity-graph-inspector" aria-label="当前关系对象">
        <div className="activity-graph-eyebrow">仅该保存候选的引文关系</div>
        {selectedStatement ? <>
          <h2>{selectedStatement.label}</h2>
          <p className="activity-graph-lead">{selectedStatement.time?.raw ?? '当前声明没有已保存的时间原词。'}</p>
          <dl><dt>声明标识</dt><dd>{selectedStatement.statementId}</dd><dt>时间性质</dt><dd>{selectedStatement.time?.role ?? 'UNKNOWN'}</dd><dt>状态原词</dt><dd>{selectedStatement.statusRaw ?? '未提供'}</dd><dt>准确来源</dt><dd>{reading.binding.documentVersionId}<br />{reading.binding.parseRunId}</dd></dl>
          {selectedStatement.limitations.length ? <div className="activity-graph-limitations"><strong>限制</strong>{selectedStatement.limitations.map((item) => <p key={item}>{item}</p>)}</div> : null}
          <section className="activity-graph-inspector-section"><h3>保存的引文关系</h3>{selectedStatement.quotes.length ? selectedStatement.quotes.map((quote, index) => <button type="button" className={selectedAnchorId === quote.anchorId ? 'selected' : ''} key={`${quote.anchorId}:${index}`} onClick={() => onSelectLocation(selectedStatement.statementId, quote.anchorId)}><span>“{quote.text}”</span><small>锚点 {quote.anchorId}</small></button>) : <p>该声明没有保存逐条引用。</p>}</section>
          <Button size="sm" onClick={onReturnTimeline}>查看同一声明历程</Button>
        </> : selectedAnchor ? <>
          <h2>来源锚点 {selectedAnchor.anchorId}</h2><p className="activity-graph-lead">{selectedAnchor.sourceText}</p>
          <dl><dt>来源单元</dt><dd>{selectedAnchor.sourceUnitId}</dd><dt>载荷路径</dt><dd>{selectedAnchor.payloadPath}</dd><dt>SourceRef</dt><dd>{selectedAnchor.sourceRefIds.length ? selectedAnchor.sourceRefIds.join(' · ') : '未记录'}</dd></dl>
          <Button size="sm" onClick={onReturnTimeline}>返回同一时间位置</Button>
        </> : <><h2>选择一个关系对象</h2><p className="activity-graph-lead">选择声明、逐条引文或锚点后，在这里核对保存身份与准确来源。</p><dl><dt>候选</dt><dd>{candidate.runRef} / r{candidate.candidateRevision}</dd><dt>保存时间</dt><dd>{candidate.savedAt}</dd></dl><Button size="sm" variant="outline" onClick={onReturnTimeline}>返回时间轴</Button></>}
        <p className="activity-graph-boundary">图形只表达声明、逐条引用、实际锚点与 SourceRef 的保存关系；不推断跨版本事件、归属、风险或因果。</p>
      </aside>
    </div>
  </section>;
}
