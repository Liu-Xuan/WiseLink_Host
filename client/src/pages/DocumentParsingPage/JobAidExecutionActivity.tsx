import type { JobAidActivityRead, JobAidKnowledgeObservationStatus } from '@shared/jobaid-activity.interface';

const knowledgeStatusLabels: Record<JobAidKnowledgeObservationStatus, string> = {
  REQUESTED: '已登记工具调用，等待返回',
  STARTING: '工具返回：正在启动',
  RUNNING: '工具返回：检索进行中',
  COMPLETED: '工具返回：检索完成',
  FAILED: '工具返回：检索失败',
  UNKNOWN: '检索结果尚未确认',
  UNAVAILABLE: '知识检索暂不可用',
};

function ActivityTime({ value }: { value: string | null }) {
  return value ? (
    <time dateTime={value}>{new Date(value).toLocaleString('zh-CN')}</time>
  ) : (
    <span>未记录时间</span>
  );
}

export default function JobAidExecutionActivity({
  activity,
}: {
  activity?: JobAidActivityRead | null;
}) {
  if (!activity) return null;
  return (
    <details className="wl-jobaid-notice" aria-label="本轮评估过程">
      <summary>
        本轮评估过程 · 当前展示读取 {activity.sourceReads.length} 条 · 保存{' '}
        {activity.savedRevisions.length} 次 · 知识工具 {activity.knowledgeObservations?.length ?? 0} 条
        {activity.error || activity.malformedRecordCount > 0
          ? ' · 部分记录不可用'
          : null}
      </summary>
      <p>
        记录反映材料读取和候选保存，不代表正式采用。读取与保存分别按各自记录顺序展示。
      </p>
      {activity.error ? (
        <p role="alert">材料读取记录损坏，暂时无法展示；已保存工作仍可阅读。</p>
      ) : null}
      {activity.omittedEarlierRecordCount > 0 ? (
        <p>较早的 {activity.omittedEarlierRecordCount} 条活动未在此展开。</p>
      ) : null}
      {activity.unknownRecordCount > 0 ? (
        <p>当前范围内有 {activity.unknownRecordCount} 条其他类型记录未展示。</p>
      ) : null}
      {activity.malformedRecordCount > 0 ? (
        <p role="alert">
          当前范围内有 {activity.malformedRecordCount} 条损坏记录未展示。
        </p>
      ) : null}
      <h3>材料读取</h3>
      {activity.sourceReads.length ? (
        <ol>
          {activity.sourceReads.map((read) => (
            <li key={read.sequence}>
              记录 {read.sequence}：已登记读取 {read.sourceCount} 项材料 ·{' '}
              <ActivityTime value={read.observedAt} />
            </li>
          ))}
        </ol>
      ) : (
        <p>当前展示范围没有可用的材料读取记录。</p>
      )}
      {activity.knowledgeObservations !== undefined ? <>
        <h3>知识检索工具</h3>
        <p>以下是调用时的观察记录，不证明工具当前仍在运行。检索完成也不代表原始文档已核实。</p>
        {activity.knowledgeObservations.length ? <ol>
          {activity.knowledgeObservations.map((observation) => <li key={observation.sequence}>
            记录 {observation.sequence}：{knowledgeStatusLabels[observation.status]} ·{' '}
            <ActivityTime value={observation.observedAt} />
          </li>)}
        </ol> : <p>当前展示范围没有知识工具记录；这不表示已完成检索。</p>}
      </> : null}
      <h3>工作保存</h3>
      {activity.savedRevisions.length ? (
        <ol>
          {activity.savedRevisions.map((save) => (
            <li
              key={save.workRevisionRef}
              data-work-revision-ref={save.workRevisionRef}
            >
              已保存候选工作第 {save.workRevision} 版 ·{' '}
              <ActivityTime value={save.savedAt} />
            </li>
          ))}
        </ol>
      ) : (
        <p>本轮尚无已保存工作回执；此前保存的正文独立保留。</p>
      )}
      {activity.hasEarlierSavedRevisions ? (
        <p>此处仅展示本轮最近 {activity.savedRevisions.length} 次保存。</p>
      ) : null}
    </details>
  );
}
