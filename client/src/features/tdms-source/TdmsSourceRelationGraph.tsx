import { useMemo, useState } from 'react';
import type {
  TdmsExactEndpoint,
  TdmsRecordSummary,
  TdmsRelationAssertion,
  TdmsRelationReadResponse,
} from '@shared/tdms-source.interface';
import RelationGraphCanvas from '@client/src/pages/RelationGraphPage/RelationGraphCanvas';
import {
  tdmsJsonText,
  tdmsRawCodeLabel,
  tdmsRevisionRuleNeedsVerification,
  tdmsSourceVersionLabel,
} from './tdms-source-presentation';
import {
  buildTdmsRelationGraph,
  tdmsGraphEndpointLabel,
} from './tdms-relation-graph';
import './tdms-relation-graph.css';

export interface TdmsSourceRelationGraphProps {
  reading: TdmsRelationReadResponse;
  rootRecord?: TdmsRecordSummary;
  onOpenEndpoint?: (endpoint: TdmsExactEndpoint) => void;
  onClose?: () => void;
}

function AssertionDetails({ assertion }: { assertion: TdmsRelationAssertion }) {
  return (
    <section aria-label="准确关系断言">
      <h5>{assertion.rawKind}</h5>
      <p>
        {assertion.authority === 'SOURCE_EXPLICIT'
          ? '源明确关系'
          : '候选关系，尚未核实'}
      </p>
      <dl>
        <dt>原始关系标识</dt>
        <dd>{assertion.sourceRelationId}</dd>
        <dt>Host 关系</dt>
        <dd>{assertion.relationRef}</dd>
        <dt>准确断言</dt>
        <dd>{assertion.assertionRef}</dd>
        <dt>关系观察位置</dt>
        <dd>
          {assertion.selectedHead === true
            ? '库内选定关系观察'
            : assertion.selectedHead === false
              ? '准确历史关系观察'
              : '未取得当前/历史关系位置'}
        </dd>
        <dt>来源取得记录</dt>
        <dd>{assertion.captureRef}</dd>
        <dt>来源定位 / evidence</dt>
        <dd>{assertion.selector}</dd>
        <dt>关系观察时间</dt>
        <dd>{assertion.observedAt}</dd>
        <dt>受控关系分类</dt>
        <dd>{assertion.controlledKind ?? '未取得映射'}</dd>
        <dt>准确起点</dt>
        <dd>{tdmsGraphEndpointLabel(assertion.from)}</dd>
        <dt>准确终点</dt>
        <dd>{tdmsGraphEndpointLabel(assertion.to)}</dd>
        <dt>改版声明</dt>
        <dd>
          {tdmsRevisionRuleNeedsVerification(assertion) &&
          assertion.changeClass !== 'UNSPECIFIED'
            ? `待核字段 ${assertion.changeClass}，尚未核实；不形成实施结论`
            : assertion.changeClass === 'EQUIVALENT'
              ? '源明确等效'
              : assertion.changeClass === 'REPLACES'
                ? '源明确取代'
                : '未明确'}
        </dd>
        <dt>完成认可声明</dt>
        <dd>
          {tdmsRevisionRuleNeedsVerification(assertion) &&
          assertion.completionEffect !== 'UNSPECIFIED'
            ? `待核字段 ${assertion.completionEffect}，尚未核实；不形成完成认可或重做要求`
            : assertion.completionEffect === 'OLD_COMPLETION_RECOGNIZED'
              ? '源明确认可此精确范围旧版完成'
              : assertion.completionEffect === 'REEXECUTE_NEW_VERSION'
                ? '源明确要求此精确范围按新版重做'
                : '未明确，不推定旧版认可或新版重做'}
        </dd>
        <dt>取得覆盖 / 读回</dt>
        <dd>
          {assertion.coverage.status} / {assertion.coverage.readback}
        </dd>
      </dl>
      <details>
        <summary>此关系的精确范围与原始字段</summary>
        <h6>关系范围</h6>
        <pre>{tdmsJsonText(assertion.scope)}</pre>
        <h6>关系原始字段</h6>
        <pre>{tdmsJsonText(assertion.rawFields)}</pre>
      </details>
      {assertion.coverage.gaps.length ? (
        <ul>
          {assertion.coverage.gaps.map((gap, index) => (
            <li key={index}>{gap}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** The owning reader clears this component on identity/permission changes; this view never fetches or caches bodies. */
export default function TdmsSourceRelationGraph({
  reading,
  rootRecord,
  onOpenEndpoint,
  onClose,
}: TdmsSourceRelationGraphProps) {
  const projection = useMemo(
    () => buildTdmsRelationGraph(reading, rootRecord),
    [reading, rootRecord],
  );
  const [selection, setSelection] = useState<{
    receiptRef: string;
    id: string;
    kind: 'node' | 'edge';
  } | null>(null);
  const selected =
    selection?.receiptRef === reading.receipt.receiptRef ? selection : null;
  const node =
    selected?.kind === 'node'
      ? projection.nodes.find((item) => item.id === selected.id)
      : undefined;
  const edge =
    selected?.kind === 'edge'
      ? projection.edges.find((item) => item.id === selected.id)
      : undefined;
  const assertion = edge
    ? projection.assertions.find(
        (item) => item.assertionRef === edge.assertionRef,
      )
    : undefined;
  const explicitCount = projection.edges.filter(
    (item) => item.tdmsAuthority === 'SOURCE_EXPLICIT',
  ).length;
  const candidateCount = projection.edges.length - explicitCount;
  const unresolvedCount = projection.nodes.filter(
    (item) => item.kind === 'TDMS_UNRESOLVED',
  ).length;
  function select(id: string, kind: 'node' | 'edge') {
    setSelection({ receiptRef: reading.receipt.receiptRef, id, kind });
  }
  if (!projection.nodes.length)
    return <p role="alert">此关系读回缺少匹配的准确授权回执，图谱未显示。</p>;
  return (
    <section className="tdms-relation-graph" aria-label="TDMS 准确来源关系图谱">
      <header>
        <h4>此准确修订的来源关系概览</h4>
        {onClose ? (
          <button type="button" onClick={onClose}>
            返回同一来源全文
          </button>
        ) : null}
      </header>
      <p>
        本次获准读回 {projection.nodes.length} 个节点 · {explicitCount}{' '}
        条源明确关系 · {candidateCount} 条候选关系
        {unresolvedCount ? ` · ${unresolvedCount} 个未解析端点` : ''}
      </p>
      <div className="tdms-graph-layout">
        <div className="tdms-graph-stage">
          <RelationGraphCanvas
            key={reading.receipt.receiptRef}
            elements={projection.elements}
            onNodeOpen={(item) => select(item.id, 'node')}
            selectedNodeId={node?.id}
          />
          <details>
            <summary>可访问的节点与关系列表</summary>
            <ul>
              {projection.nodes.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => select(item.id, 'node')}>
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
            <ul>
              {projection.edges.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => select(item.id, 'edge')}>
                    {item.label} · {item.assertionRef}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </div>
        <aside className="tdms-graph-inspector" aria-label="来源关系按需详情">
          {assertion ? (
            <AssertionDetails assertion={assertion} />
          ) : node ? (
            <>
              <h5>{tdmsGraphEndpointLabel(node.endpoint)}</h5>
              {node.endpoint.kind === 'UNRESOLVED' ? (
                <p role="status">
                  {node.endpoint.versionGap}；尚无合法确切映射，不能展开。
                </p>
              ) : (
                <>
                  {node.endpoint.kind === 'NATIVE_RECORD_REVISION' &&
                  rootRecord?.sourceRevisionRef ===
                    node.endpoint.sourceRevisionRef ? (
                    <>
                      <p>
                        {rootRecord.title} · 技术对象{' '}
                        {tdmsSourceVersionLabel(rootRecord.sourceVersion)} ·
                        原始类型 {tdmsRawCodeLabel(rootRecord.fileType)}
                      </p>
                      <p>
                        业务版次{' '}
                        {rootRecord.businessVersion
                          ? tdmsSourceVersionLabel(
                              rootRecord.businessVersion,
                              '业务文件',
                            )
                          : '未取得，不从技术对象版次推算'}
                      </p>
                    </>
                  ) : (
                    <p>
                      这里只取得准确端点标识，正文、标题与源版次尚需单独授权读取。
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={!onOpenEndpoint}
                    onClick={() => onOpenEndpoint?.(node.endpoint)}
                  >
                    授权展开此准确端点
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <h5>选择节点或关系核对出处</h5>
              <p>
                概览不复制全文。选择关系可查看准确断言、原始关系与来源定位；选择确切端点后可按需读取。
              </p>
              {!projection.edges.length ? (
                <p>暂无已取得的关系。</p>
              ) : null}
            </>
          )}
        </aside>
      </div>
      <small>
        准确来源修订 {reading.sourceRevisionRef} · 关系读取回执{' '}
        {reading.receipt.receiptRef} · {reading.receipt.readAt}
      </small>
      {reading.limitations.length ? (
        <details>
          <summary>本次读取限制</summary>
          <ul>
            {reading.limitations.map((limitation, index) => (
              <li key={index}>{limitation}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
