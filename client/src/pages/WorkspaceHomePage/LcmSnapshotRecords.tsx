import type { LcmCandidateRecord } from '@shared/lcm-export-staging.interface';
import type { LcmSnapshotSummary } from '@shared/lcm-source-reading.interface';
import { lcmModelLabel, lcmModelNames, lcmRecordPresentation, lcmSnapshotTimeFacts } from './lcm-source-presentation';

export function LcmSnapshotFacts({ snapshot }: { snapshot: LcmSnapshotSummary }) {
  return <section className="library-lcm-snapshot-facts" aria-label="所选 LCM 快照范围与时间">
    <h2>{snapshot.originalFileName}</h2>
    <dl className="suite-library-key-facts">
      {lcmSnapshotTimeFacts(snapshot).map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
      <div><dt>覆盖机型</dt><dd title={snapshot.coveredAircraftModels.join(' / ')}>{lcmModelNames(snapshot.coveredAircraftModels) || '未取得'}</dd></div>
      <div><dt>覆盖飞机</dt><dd>{snapshot.coveredAircraftCount} 架（实际范围，非全机队比例）</dd></div>
      <div><dt>快照行数</dt><dd>{snapshot.recordCount} 行</dd></div>
      <div><dt>来源系统实例</dt><dd>{snapshot.sourceInstanceId}</dd></div>
      <div><dt>来源范围</dt><dd>{snapshot.scopeKey}</dd></div>
      <div><dt>快照 ID</dt><dd>{snapshot.snapshotId}</dd></div>
      <div><dt>原始导出</dt><dd>仅有本地来源引用，尚无可下载的 Host 原件。</dd></div>
    </dl>
    <details><summary>原始导出身份与来源精度</summary>
      <p>原件 SHA256 {snapshot.originalSha256} · {snapshot.originalByteLength} 字节</p>
      <p>采集 ID {snapshot.collectionId} · 来源时间精度 {snapshot.sourceTimePrecision}
        {' · '}来源时区 {snapshot.sourceTimeZone ?? '未取得'}</p>
    </details>
  </section>;
}

export function LcmSnapshotRecords({ records }: { records: LcmCandidateRecord[] }) {
  return <section className="library-lcm-records" aria-label="LCM 软件构型记录">
    {!records.length ? <p role="status">当前筛选没有匹配记录。</p> : null}
    {records.map(record => {
      const presentation = lcmRecordPresentation(record);
      return <article key={record.recordId} className="library-lcm-record" data-lcm-record-id={record.recordId}>
        <header><strong>{presentation.softwareName}</strong><span>{record.partNumber || '软件件号未取得'}</span></header>
        <dl className="suite-library-key-facts">
          <div><dt>机型 / 飞机</dt><dd title={record.aircraftModel}>{lcmModelLabel(record.aircraftModel) || '机型未取得'} · {record.tailNumber || '单机身份未取得'}</dd></div>
          <div><dt>系统 / ATA</dt><dd>{presentation.system} · {presentation.ata}</dd></div>
          <div><dt>位置 / 功能</dt><dd>{presentation.position}</dd></div>
          <div><dt>软件版本</dt><dd>{presentation.softwareVersion}</dd></div>
          <div><dt>允装</dt><dd>{presentation.allowed}</dd></div>
          <div><dt>实装</dt><dd>{presentation.installed}</dd></div>
          <div><dt>新生效</dt><dd>{presentation.newlyEffective}</dd></div>
          <div><dt>原始状态</dt><dd>{presentation.rawState}</dd></div>
          <div><dt>实际生效 / 执行时间</dt><dd>{presentation.effectiveAt} / {presentation.executedAt}</dd></div>
          <div><dt>关联工程文件原始字段</dt><dd>{record.originalEo || '未取得，未推断已实施'}</dd></div>
        </dl>
        <details><summary>原始字段与行出处</summary>
          <dl className="suite-library-key-facts">{Object.entries(record.fields).map(([label, value]) =>
            <div key={label}><dt>{label}</dt><dd>{value ?? '来源留空'}</dd></div>)}</dl>
          <p>状态解释依据：{record.semanticBasis === 'user-confirmed-matrix-definition'
            ? '已确认的来源矩阵定义' : '仅来源列表观察；不据此推断允装或实装'}</p>
          {record.sourceRows.map(row => <section key={`${row.sheet}:${row.row}`}>
            <p>{row.sheet} · 源行 {row.row}</p>
            <ul>{Object.entries(row.cells).map(([label, cell]) => <li key={cell.address}>
              {label} · {cell.address} · {cell.rawValue === null ? '来源留空' : String(cell.rawValue)}
              {cell.formula ? ` · 源公式 ${cell.formula}` : ''}
            </li>)}</ul>
          </section>)}
        </details>
      </article>;
    })}
  </section>;
}
