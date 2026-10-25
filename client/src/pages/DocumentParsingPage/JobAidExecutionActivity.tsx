import type {
  JobAidActivityRead,
  JobAidKnowledgeObservationStatus,
} from '@shared/jobaid-activity.interface';

const knowledgeStatusLabels: Record<JobAidKnowledgeObservationStatus, string> =
  {
    REQUESTED: '已登记工具调用，等待返回',
    STARTING: '工具返回：正在启动',
    RUNNING: '工具返回：检索进行中',
    COMPLETED: '工具返回：检索完成',
    FAILED: '工具返回：检索失败',
    UNKNOWN: '原请求结果待核',
    UNAVAILABLE: '知识检索暂不可用',
  };

function ActivityTime({ value }: { value: string | null }) {
  const date: Date | null = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? (
    <time dateTime={value ?? undefined}>{date.toLocaleString('zh-CN')}</time>
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
        本轮评估过程 · 材料读取记录 {activity.sourceReads.length} 条 · 保存{' '}
        {activity.savedRevisions.length} 次 · 知识工具{' '}
        {activity.knowledgeObservations?.length ?? 0} 条
        {activity.consumerStopped ? ' · 已记录执行停止' : null}
        {activity.error || activity.malformedRecordCount > 0
          ? ' · 部分记录不可用'
          : null}
      </summary>
      {activity.consumerStopped ? (
        <p role="alert">
          已记录本轮执行停止，原请求结果待核；已保存工作独立保留。{' '}
          <ActivityTime value={activity.consumerStopped.observedAt} />
        </p>
      ) : null}
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
      <p>
        以下按实际读取记录展示；同一材料重复读取会分别记录，来源目录数量另行显示。
      </p>
      {activity.sourceReads.length ? (
        <ol>
          {activity.sourceReads.map((read) => (
            <li key={read.sequence}>
              <details>
                <summary>
                  记录 {read.sequence}：已登记读取 {read.sourceCount} 项材料 ·{' '}
                  <ActivityTime value={read.observedAt} />
                </summary>
                <p>
                  本条记录包含 {read.sourceCount}{' '}
                  项读取结果；具体模型输入与判断采用的依据以对应保存工作为准。
                </p>
              </details>
            </li>
          ))}
        </ol>
      ) : (
        <p>当前展示范围没有可用的材料读取记录。</p>
      )}
      {activity.knowledgeObservations !== undefined ? (
        <>
          <h3>知识检索工具</h3>
          <p>
            每条均为独立观察，按原记录顺序展示；没有调用关联标识，不能合并为一次调用。历史观察不证明工具当前仍在运行，也不代表原始文档已核实。
          </p>
          {activity.knowledgeObservations.length ? (
            <ol>
              {activity.knowledgeObservations.map((observation) => (
                <li key={observation.sequence}>
                  <details>
                    <summary>
                      记录 {observation.sequence}：
                      {knowledgeStatusLabels[observation.status]} ·{' '}
                      <ActivityTime value={observation.observedAt} />
                    </summary>
                    <p>
                      本次观察状态：{knowledgeStatusLabels[observation.status]}
                      。未提供可对应的具体问题或调用标识。
                    </p>
                  </details>
                </li>
              ))}
            </ol>
          ) : (
            <p>暂无知识工具记录。</p>
          )}
        </>
      ) : null}
      <h3>工作保存</h3>
      {activity.savedRevisions.length ? (
        <ol>
          {activity.savedRevisions.map((save) => (
            <li
              key={save.workRevisionRef}
              data-work-revision-ref={save.workRevisionRef}
            >
              <details>
                <summary>
                  已保存候选工作第 {save.workRevision} 版 ·{' '}
                  <ActivityTime value={save.savedAt} />
                </summary>
                <p>
                  准确工作修订：<code>{save.workRevisionRef}</code>
                </p>
              </details>
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
