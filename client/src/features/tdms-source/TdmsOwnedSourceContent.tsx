import type { TdmsCompleteOwnedField, TdmsCompleteOwnedValueState } from '@shared/tdms-source.interface';
import type { TdmsFileServiceRecordReadResponse } from '@shared/tdms-file-service-import.interface';
import { canReadTdmsSourceBody } from '@shared/tdms-source-body-policy';
import { tdmsJsonText } from './tdms-source-presentation';

const VALUE_LABELS: Record<TdmsCompleteOwnedValueState, string> = {
  VALUE: '已取得原始值', BLANK: '来源留空', ABSENT: '来源字段不存在',
  NOT_APPLICABLE: '来源标明不适用', NOT_LOADED: '未加载', NOT_READ: '未读取',
  TRUNCATED: '仅取得部分内容', ACCESS_DENIED: '来源拒绝读取',
};

/** Native labels and business literals remain source material, including nonterminal opinions. */
export function TdmsOwnedSourceContent({ read }: { read: TdmsFileServiceRecordReadResponse }) {
  if (!canReadTdmsSourceBody(read)) return null;
  const content = read.record.content;
  const fields: TdmsCompleteOwnedField[] = content.completeOwnedFields ?? [];
  if (!fields.length && !content.boundedOwnedBody?.length && !content.ownedVisibleBusinessContent?.length) return null;
  return <section className="tdms-owned-source-content" aria-label="原始表单与专业内容">
    <h4>原始表单与专业内容</h4>
    <p className="tdms-source-eligibility-notice">以下保留来源原始字段、专业及意见；采集完整性、批准状态和目标绑定分别核对。</p>
    <dl className="tdms-source-fields">{fields.map((field: TdmsCompleteOwnedField) => <div key={field.fieldId}>
      <dt>{field.value.actualLabel || field.fieldId}</dt>
      <dd className="tdms-source-full-text">{field.value.rawValue ?? VALUE_LABELS[field.value.state]}</dd>
      <dd className="tdms-source-notice">{VALUE_LABELS[field.value.state]}
        {field.labelOrigin === 'PROFILE_EXPECTED' ? ' · 预期字段标签，来源实际标签以本次观察为准' : ''}</dd>
      {field.links.map((link, index) => <dd key={`${link.locator}:${index}`}>
        {link.numberRaw || link.nativeRole || '关联记录'} · {link.targetRef || '目标待绑定'}
        <span className="tdms-source-locator"> 来源地址 {link.rawHref} · {link.locator}</span>
      </dd>)}
      <dd className="tdms-source-locator">来源定位 {field.value.locator} · {field.tabId} / {field.sectionId}</dd>
    </div>)}</dl>
    {content.boundedOwnedBody?.map((field, index) => <section key={`${field.locator}:${index}`}>
      <h5>{field.actualLabel || field.sectionLabel || '来源标签未取得'}</h5>
      <p className="tdms-source-full-text">{field.rawBoundedValue ?? '原始值未取得'}</p>
      <p className="tdms-source-notice">{field.presence} · 观察时间 {field.observedAt}
        {field.truncation.truncated ? ` · 内容不完整，仅取得 ${field.truncation.capturedCodepoints} 字符` : ''}</p>
      <p className="tdms-source-locator">来源定位 {field.locator}</p>
    </section>)}
    {content.ownedVisibleBusinessContent?.length ? <details>
      <summary>已取得的原始业务字段</summary>
      {content.ownedVisibleBusinessContent.map((row, index) => <dl className="tdms-source-fields" key={index}>
        {Object.entries(row).map(([label, value]) => <div key={label}>
          <dt>{label}</dt><dd className="tdms-source-full-text">{tdmsJsonText(value)}</dd>
        </div>)}
      </dl>)}
    </details> : null}
  </section>;
}
