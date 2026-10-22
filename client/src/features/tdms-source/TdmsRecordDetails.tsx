import { Link } from 'react-router-dom';
import type { TdmsPerson, TdmsRelationAssertion, TdmsExactEndpoint, TdmsRelationReadResponse } from '@shared/tdms-source.interface';
import type { TdmsFileServiceRecordReadResponse } from '@shared/tdms-file-service-import.interface';
import { tdmsFileTypeNote, tdmsJsonText, tdmsRawCodeLabel, tdmsRecordKindLabel, tdmsRevisionRuleNeedsVerification, tdmsSourceVersionLabel } from './tdms-source-presentation';
import { TdmsOwnedSourceContent } from './TdmsOwnedSourceContent';
import { TdmsEngineeringExecution } from './TdmsEngineeringExecution';
import { canReadTdmsSourceBody } from '@shared/tdms-source-body-policy';

const person = (value: TdmsPerson | null): string => value
  ? [value.name, value.sourcePersonId, value.role].filter(Boolean).join(' · ') || '作者信息未取得' : '作者信息未取得';
const people = (values: TdmsPerson[] | undefined): string => values?.length ? values.map(person).join('；') : '未取得';
const lines = (values: string[] | undefined) => values?.length
  ? <ul>{values.map((line, index) => <li key={index}>{line}</li>)}</ul> : <p>未取得</p>;

function isApprovedCurrentObjectObservation(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const collection = value as Record<string, unknown>;
  return collection.schemaVersion === 'wiselink.tdms-opinion-collection.v1' &&
    collection.mode === 'ESTIMATED_OPINION' &&
    collection.reason === 'APPROVED_CURRENT_OBJECT_OBSERVATION';
}

export function TdmsRecordDetails({ read, openDocument, monitorScopeKey, onRefresh }: {
  read: TdmsFileServiceRecordReadResponse;
  openDocument?: (documentVersionId: string) => void;
  monitorScopeKey?: string;
  onRefresh?: () => void;
}) {
  const record = read.record;
  if (!canReadTdmsSourceBody(read)) return <article className="tdms-record-details" aria-label="TDMS 来源元数据">
    <h3>{record.title}</h3>
    <p>{tdmsRecordKindLabel(record.recordKind)} · 原始状态 {tdmsRawCodeLabel(record.state)}</p>
    <p className="tdms-source-eligibility-notice">{record.state?.rawName === 'Estimated'
      ? '本条正文的读取准入尚未确认，仅显示元数据。'
      : '本条仅显示元数据；评估意见须本评估单批准后增量取得。'}
      父处理单或其他专业的批准不能替代本条来源的正文准入。</p>
    <dl className="tdms-source-fields">
      <dt>原生记录</dt><dd>{record.sourceRecordId}</dd>
      <dt>TDMS 系统修订</dt><dd>{tdmsSourceVersionLabel(record.sourceVersion)}</dd>
      <dt>业务文件版本</dt><dd>{record.businessVersion ? tdmsSourceVersionLabel(record.businessVersion, '业务文件') : '未取得'}</dd>
      <dt>源作者或评估人</dt><dd>{people(record.authors)}</dd>
      <dt>源修改时间</dt><dd>{record.sourceModifiedAt ?? '未取得'}</dd>
      <dt>来源观察时间</dt><dd>{record.observedAt}</dd>
      <dt>最近接收时间</dt><dd>{record.capturedAt}</dd>
      <dt>实际目标版本</dt><dd>{record.relatedDocumentVersionIds.join(' · ') || '目标待绑定，不归入最新版本'}</dd>
      <dt>Host 来源修订</dt><dd>{record.sourceRevisionRef}</dd>
    </dl>
  </article>;
  const content = record.content;
  const typeNote = tdmsFileTypeNote(record.fileType);
  const approvedCurrentObjectObservation = isApprovedCurrentObjectObservation(record.rawFields.opinionCollection);
  const sourceModifiedRaw = record.rawFields.sourceModifiedRaw;
  return <article className="tdms-record-details" aria-label="TDMS 准确来源全文">
    <h3>{record.title}</h3>
    <p>{tdmsRecordKindLabel(record.recordKind)} · {tdmsSourceVersionLabel(record.sourceVersion)}</p>
    <p>原生记录 {record.sourceRecordId} · Host 快照修订 {record.sourceRevisionRef}</p>
    {approvedCurrentObjectObservation ? <p className="tdms-source-notice">正文来自当前页面观察，来源修订未取得</p> : null}
    <p>{record.selectedHead ? '库内选定观察' : '历史观察'}</p>
    <dl className="tdms-source-fields">
      <dt>业务文件版本</dt><dd>{record.businessVersion ? tdmsSourceVersionLabel(record.businessVersion, '业务文件') : '未取得'}</dd>
      <dt>原始文件类型</dt><dd>{tdmsRawCodeLabel(record.fileType)}{record.fileType?.controlledMapping ? `（受控分类：${record.fileType.controlledMapping}）` : ''}</dd>
      <dt>源处理状态</dt><dd>{tdmsRawCodeLabel(record.state)}</dd>
      <dt>源作者或评估人</dt><dd>{people(record.authors)}</dd>
      <dt>源批准人</dt><dd>{people(content.approvers)}</dd>
      <dt>源修改时间</dt><dd>{record.sourceModifiedAt ?? '未取得'}</dd>
      {typeof sourceModifiedRaw === 'string' ? <><dt>源修改时间（原始显示）</dt><dd>{sourceModifiedRaw}</dd></> : null}
      <dt>观察时间</dt><dd>{record.observedAt}</dd>
      <dt>Host 取得时间</dt><dd>{record.capturedAt}</dd>
      <dt>实际目标文档版本</dt><dd>{record.relatedDocumentVersionIds.length
        ? record.relatedDocumentVersionIds.join(' · ') : '目标待绑定，不归入最新版本'}</dd>
      <dt>本次准确读取</dt><dd>{read.receipt.readAt} · 回执 {read.receipt.receiptRef}</dd>
    </dl>
    <TdmsOwnedSourceContent read={read} />
    <TdmsEngineeringExecution read={read} monitorScopeKey={monitorScopeKey} onRefresh={onRefresh} />
    {typeNote ? <p className="tdms-source-notice">{typeNote}</p> : null}
    <section><h4>明确条件与保留事项</h4>{lines(content.conditions)}</section>
    <section><h4>源要求或措施</h4>{lines(content.requiredActions)}</section>
    <section><h4>意见全文</h4>
      {content.opinions?.length ? content.opinions.map((opinion, index) => <section className="tdms-source-opinion" key={index}>
        <p>作者 {person(opinion.author)} · 意见状态 {tdmsRawCodeLabel(opinion.state)}</p>
        <p className="tdms-source-full-text">{opinion.text}</p>
        <h5>该意见的条件</h5>{lines(opinion.conditions)}
        <h5>该意见的要求</h5>{lines(opinion.requiredActions)}
        <p className="tdms-source-locator">来源定位 {opinion.sourceSelector}</p>
      </section>) : <p>未取得独立意见字段。</p>}
    </section>
    {content.executionDeclaration ? <section><h4>源执行声明</h4>
      <dl className="tdms-source-fields">
        <dt>对象</dt><dd>{tdmsRawCodeLabel(content.executionDeclaration.target)}</dd>
        <dt>对象范围</dt><dd><pre>{tdmsJsonText(content.executionDeclaration.target.scope)}</pre></dd>
        <dt>频次</dt><dd>{tdmsRawCodeLabel(content.executionDeclaration.frequency)}</dd>
        <dt>完成认可</dt><dd>{tdmsRawCodeLabel(content.executionDeclaration.completionRecognition)}<pre>{tdmsJsonText(content.executionDeclaration.completionRecognition.details)}</pre></dd>
      </dl>
      {content.executionDeclaration.frequency.rarePeriodicExtension &&
        <section><h5>源明确记录的周期性扩展</h5><pre>{tdmsJsonText(content.executionDeclaration.frequency.rarePeriodicExtension)}</pre></section>}
    </section> : record.recordKind === 'ENGINEERING_FILE' ? <p>对象、频次与完成认可声明未取得。</p> : null}
    <section><h4>附件与准确工程文件版本</h4>
      {record.artifacts.length ? record.artifacts.map(artifact => <div key={artifact.memberId} className="tdms-source-artifact">
        <p>{artifact.fileName} · {artifact.mediaType} · {artifact.byteLength} 字节</p>
        <p>不可变原件 {artifact.sourceArtifactId} · 取得记录 {artifact.acquisitionId}</p>
        <p>SHA256 {artifact.sha256}</p>
        {artifact.documentVersionId ? <p>
          {openDocument ? <button type="button" onClick={() => openDocument(artifact.documentVersionId!)}>阅读准确文件版本 {artifact.documentVersionId}</button>
            : <Link to={`/document-versions/${encodeURIComponent(artifact.documentVersionId)}`}>阅读准确文件版本 {artifact.documentVersionId}</Link>}
        </p> : <p>附件尚无可打开的正式文件版本{artifact.registrationGap ? `：${artifact.registrationGap}` : ''}</p>}
      </div>) : <p>{read.attachmentAcquisitions?.length
        ? '此修订原记录未登记附件原件绑定；Host 后续字节取得事实另列。'
        : '此修订暂无已取得的附件。'}</p>}
    </section>
    {record.unreadAttachments.length ? <section><h4>源观察时的未读附件清单（仅元数据）</h4>
      {record.unreadAttachments.map(attachment => <div key={attachment.sourceAttachmentId} className="tdms-source-artifact">
        <p>{attachment.fileName} · {attachment.mediaType ?? '媒体类型未取得'} · {attachment.byteLength === null ? '字节数未取得' : `${attachment.byteLength} 字节（源元数据）`}</p>
        <p>源附件 {attachment.sourceAttachmentId} · 源附件版本 {attachment.sourceAttachmentVersion ?? '未取得'}</p>
        <p>来源在 {record.observedAt} {attachment.readStatus === 'FAILED' ? '读取失败' : '未取得附件字节'}：{attachment.gap}</p>
        <p>来源定位 {attachment.selector}</p>
      </div>)}
    </section> : null}
    {read.attachmentAcquisitions?.length ? <section aria-label="附件来源观察与 Host 字节取得事实">
      <h4>附件的来源观察与 Host 字节取得</h4>
      {read.attachmentAcquisitions.map(fact => <div
        key={`${fact.memberId}:${fact.sourceAttachmentId}:${fact.sourceAttachmentVersion ?? ''}:${fact.acquisitionId}`} className="tdms-source-artifact">
        <p>附件成员 {fact.memberId} · 源附件 {fact.sourceAttachmentId} · 源附件版本 {fact.sourceAttachmentVersion ?? '未取得'}</p>
        <p>来源在 {fact.sourceObservedAtDeclared} {fact.sourceReadStatusAtObservation === 'NOT_READ'
          ? '未取得附件字节' : fact.sourceReadStatusAtObservation === 'FAILED' ? '读取失败' : '的附件读取状态未取得'}
          · 源观察修订 {fact.sourceObservationRevisionRef ?? '未取得'}</p>
        <p>Host 在 {fact.hostBytesVerifiedAt} 已取得并核验字节 · 取得记录 {fact.acquisitionId}</p>
      </div>)}
    </section> : null}
    <section><h4>来源事件</h4>
      {content.sourceEvents?.length ? <ol>{content.sourceEvents.map((event, index) => <li key={index}>
        <p>{event.rawKind} · 源事件时间 {event.occurredAt ?? '未取得'} · {person(event.actor)}</p>
        <p>来源定位 {event.selector} · 本修订观察时间 {record.observedAt}</p>
      </li>)}</ol> : <p>未取得来源事件。</p>}
    </section>
    {content.futureLcmLinks?.length ? <section><h4>LCM 相关来源</h4>
      <p>本记录与 LCM 构型的准确绑定尚未确认。</p>
      <Link to="/library?mode=lcm">阅读已接收的软件构型快照</Link>
      {content.futureLcmLinks.map((link, index) => <pre key={index}>{tdmsJsonText(link)}</pre>)}
    </section> : null}
    <details><summary>原始字段与字段来源</summary>
      <dl className="tdms-source-fields">{Object.entries(record.rawFields).map(([key, value]) => <div key={key}><dt>{key}</dt><dd><pre>{tdmsJsonText(value)}</pre></dd></div>)}</dl>
      {record.fieldProvenance.length ? <ul>{record.fieldProvenance.map((field, index) => <li key={index}>
        {field.fieldPath} · {field.selector} · 观察 {field.observationRef} · 源修改时间 {field.sourceModifiedAt ?? '未取得'}
      </li>)}</ul> : <p>字段级来源未取得。</p>}
    </details>
    {read.limitations.length ? lines(read.limitations) : null}
  </article>;
}

function Endpoint({ endpoint, onOpen, openDocument }: {
  endpoint: TdmsExactEndpoint;
  onOpen: (revision: string) => void;
  openDocument?: (documentVersionId: string) => void;
}) {
  if (endpoint.kind === 'NATIVE_RECORD_REVISION') return <button type="button"
    onClick={() => onOpen(endpoint.sourceRevisionRef)}>展开准确来源 {endpoint.sourceRevisionRef}</button>;
  if (endpoint.kind === 'DOCUMENT_VERSION') return openDocument
    ? <button type="button" onClick={() => openDocument(endpoint.documentVersionId)}>阅读准确文档 {endpoint.documentVersionId}</button>
    : <Link to={`/document-versions/${encodeURIComponent(endpoint.documentVersionId)}`}>阅读准确文档 {endpoint.documentVersionId}</Link>;
  return <span>端点未核：{endpoint.rawIdentity} · {endpoint.versionGap}</span>;
}

export function TdmsSourceRelations({ read, onOpen, openDocument }: {
  read: TdmsRelationReadResponse;
  onOpen: (revision: string) => void;
  openDocument?: (documentVersionId: string) => void;
}) {
  return <section aria-label="TDMS 已读取来源关系"><h4>源关系与改版声明</h4>
    {read.relations.length ? read.relations.map((relation: TdmsRelationAssertion) => <section key={relation.assertionRef} className="tdms-source-relation">
      <p>{relation.rawKind} · {relation.authority === 'SOURCE_EXPLICIT' ? '源明确关系' : '候选关系，尚未核实'}</p>
      <p><Endpoint endpoint={relation.from} onOpen={onOpen} openDocument={openDocument} /> → <Endpoint endpoint={relation.to} onOpen={onOpen} openDocument={openDocument} /></p>
      <p>{relation.selectedHead === false ? '历史来源断言' : relation.selectedHead === true ? '当前选定来源断言' : '关系当前性未取得'}</p>
      <p>准确断言 {relation.assertionRef} · 观察 {relation.observedAt} · 来源定位 {relation.selector}</p>
      <p>改版关系：{tdmsRevisionRuleNeedsVerification(relation) && relation.changeClass !== 'UNSPECIFIED'
        ? `待核字段 ${relation.changeClass}，尚未核实`
        : relation.changeClass === 'EQUIVALENT' ? '源明确等效' : relation.changeClass === 'REPLACES' ? '源明确取代' : '未明确'}</p>
      <p>完成认可：{tdmsRevisionRuleNeedsVerification(relation) && relation.completionEffect !== 'UNSPECIFIED'
        ? `待核字段 ${relation.completionEffect}，尚未核实`
        : relation.completionEffect === 'OLD_COMPLETION_RECOGNIZED' ? '源明确认可此范围旧版完成' : relation.completionEffect === 'REEXECUTE_NEW_VERSION' ? '源明确要求此范围按新版重做' : '未明确'}</p>
      <h5>关系适用范围</h5><pre>{tdmsJsonText(relation.scope)}</pre>
      <details><summary>关系原始字段</summary><pre>{tdmsJsonText(relation.rawFields)}</pre></details>
      {relation.coverage.gaps.length ? lines(relation.coverage.gaps) : null}
    </section>) : <p>此修订暂无已取得的关系。</p>}
    {read.limitations.length ? lines(read.limitations) : null}
  </section>;
}
