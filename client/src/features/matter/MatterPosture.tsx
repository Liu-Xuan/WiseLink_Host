import { Link } from 'react-router-dom';
import type { EngineeringMatterWorkspaceRead } from '@client/src/api/engineering-matter';
import { matterWorkRoute } from './matter-navigation';
import { matterReadingReturnParams } from './reading-return';
import OverviewCorrectionNotices from './OverviewCorrectionNotices';
import OverviewSourceWork from './OverviewSourceWork';
import ReferenceWorkNotices from './ReferenceWorkNotices';
import './matter-posture.css';

export function matterPostureRoute(matterId: string): string {
  return `/matters/${encodeURIComponent(matterId)}/posture`;
}

export function postureCoverage(data: EngineeringMatterWorkspaceRead): string {
  const current = data.working.current;
  const work = current?.state.problemWork;
  if (!current) return '尚未取得已保存的事项工作';
  if (!work) return '综合覆盖范围尚未核实';
  if (work.overviewStatus === 'NOT_AVAILABLE')
    return '问题分析已保存，尚未形成综合意见';
  if (work.overviewStatus === 'STALE') return '综合意见尚未纳入最新分析';
  return '已保存综合覆盖当前问题工作；不代表正式采用';
}

/** Selected-Matter projection only: no inference, aggregation, or additional reads. */
export default function MatterPosture({
  data,
}: {
  data: EngineeringMatterWorkspaceRead;
}) {
  const { matter, working } = data;
  const current = working.current;
  const work = current?.state.problemWork;
  const result = current?.state.substantiveResult;
  const exactWork = current
    ? matterWorkRoute(matter.matterId, current.matterWorkRevisionId)
    : `/matters/${encodeURIComponent(matter.matterId)}`;
  const materialsRoute = `/matters/${encodeURIComponent(matter.matterId)}?panel=materials`;
  const conditions = current?.state.reviewConditions ?? [];
  const questions = current?.state.openQuestions ?? [];
  const decisiveIssues =
    work?.issues.filter((issue) =>
      work.decisiveIssueKeys.includes(issue.issueKey),
    ) ?? [];
  const decisive =
    work?.overviewStatus !== 'NOT_AVAILABLE'
      ? (result?.content.claims.filter((claim) =>
          result.content.decisiveClaimIds.includes(claim.claimId),
        ) ?? [])
      : [];
  function documentRoute(documentVersionId: string) {
    // Independent version reader; no invented parseRun or replacement by latest.
    return `/document-versions/${encodeURIComponent(documentVersionId)}?${matterReadingReturnParams(matter.matterId, documentVersionId, 'brief', current?.matterWorkRevisionId ?? '')}`;
  }
  return (
    <div className="matter-posture">
      <header className="matter-posture-summary">
        <p>选中事项 · 当前授权读取范围 · 非全局统计</p>
        <h1>{matter.title}</h1>
        <p>
          本次工作变化：{current?.changeSummary || '尚未取得已保存的工作变化。'}
        </p>
        <p>
          依据覆盖：
          {working.pendingInputs.length
            ? '仍有输入待核查，现有认识不覆盖全部新变化。'
            : '本次未返回待核查输入，不等于全部依据已核实。'}
        </p>
        <p>
          下一关注：
          {conditions[0]?.text ??
            questions[0]?.text ??
            '尚未单独保存后续关注条件。'}
        </p>
      </header>
      <div className="matter-posture-ring">
        <section className="matter-posture-center" aria-label="当前认识与覆盖">
          <p className="matter-posture-eyebrow">
            {work || result
              ? '已保存认识 · 我方候选'
              : '资料范围 · 尚无可读分析'}
          </p>
          <h2>{work?.headline ?? result?.content.headline ?? matter.title}</h2>
          <p className="matter-posture-reading">
            {work?.understanding ??
              result?.content.lead ??
              '尚无可读的事项分析；当前仅展示确切资料范围。'}
          </p>
          <p>
            {current
              ? `工作修订 ${current.workingRevision} 已保存`
              : '尚未读到保存工作'}
          </p>
          {work?.roundCompletion === 'IN_PROGRESS' ? (
            <p>已保存部分分析；其余工作尚未完成。</p>
          ) : null}
          <p className="matter-posture-coverage">{postureCoverage(data)}</p>
          {current && (work || result) ? <OverviewSourceWork matterId={matter.matterId} source={current.overviewSourceWork} overviewStatus={work?.overviewStatus} /> : null}
          {current ? (
            <p className="matter-posture-note">
              普通生成运行状态尚未核实；不由综合覆盖状态推断生成失败。
            </p>
          ) : null}
          {decisiveIssues.length ? (
            <div>
              <h3>当前问题的关键限制</h3>
              <ul>
                {decisiveIssues.map((issue) => (
                  <li key={issue.issueKey}>
                    <strong>{issue.question}</strong>
                    {issue.riskScenarios.map((risk, index) => (
                      <div key={index}>
                        {risk.conditions.map((text, i) => (
                          <p key={`condition:${i}`}>条件：{text}</p>
                        ))}
                        {risk.limitations.map((text, i) => (
                          <p key={`limit:${i}`}>限制：{text}</p>
                        ))}
                      </div>
                    ))}
                    {issue.measures.map((measure, index) => (
                      <div key={index}>
                        {measure.limitations.map((text, i) => (
                          <p key={i}>措施限制：{text}</p>
                        ))}
                      </div>
                    ))}
                    {issue.openQuestions.map((question, index) => (
                      <p key={index}>
                        待核：{question.question}；影响：{question.affects}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {decisive.length ? (
            <div>
              <h3>
                {work?.overviewStatus === 'STALE'
                  ? '上次综合的关键判断及限制'
                  : '已保存的关键判断及限制'}
              </h3>
              <ul>
                {decisive.map((claim) => (
                  <li key={claim.claimId}>
                    {claim.text}
                    {claim.premises
                      .filter((premise) => premise.limitation)
                      .map((premise, index) => (
                        <p key={`${premise.evidenceRef}:${index}`}>
                          {premise.limitation}
                        </p>
                      ))}
                  </li>
                ))}
              </ul>
            </div>
          ) : !decisiveIssues.length ? (
            <p className="matter-posture-note">
              {work || result
                ? '未单独返回决定性限制；请结合完整问题正文核对，不代表没有限制。'
                : '尚未取得问题及限制记录，不代表没有待核问题。'}
            </p>
          ) : null}
          {current ? (
            <Link to={exactWork}>阅读这份工作与完整问题正文</Link>
          ) : (
            <Link to={materialsRoute}>查看当前资料范围</Link>
          )}
        </section>

        <section
          className="matter-posture-card matter-posture-sources"
          aria-label="文件依据范围"
        >
          <h2>文件依据范围</h2>
          <p className="matter-posture-note">
            已关联不代表有效、已读或已正式采用。
          </p>
          <ul>
            {matter.catalog.entries.map((entry) => (
              <li key={entry.workItemId}>
                <Link to={documentRoute(entry.document.documentVersionId)}>
                  {entry.document.documentCode} ·{' '}
                  {entry.document.businessRevision || '厂家版次未提供'}
                </Link>
                <p>
                  {entry.relationRole === 'PRIMARY' ? '主要资料' : '关联资料'} ·{' '}
                  {entry.documentCurrentness.selectedVersionIsCurrent
                    ? '所选版本与库内当前一致（不证明业务有效性）'
                    : '所选版本非库内当前或当前尚未核实'}
                </p>
              </li>
            ))}
          </ul>
          {!matter.catalog.entries.length ? (
            <p>未返回任务关联文件；其余资料关系见资料清单。</p>
          ) : null}
          <Link to={materialsRoute}>核对完整资料关系与待取得资料</Link>
          {current?.state.coverage.length ? (
            <details>
              <summary>已保存核查范围</summary>
              <ul>
                {current.state.coverage.map((item, index) => (
                  <li key={`${item.binding.inputId}:${index}`}>
                    <Link to={documentRoute(item.binding.documentVersionId)}>
                      阅读所核查来源版本
                    </Link>
                    <p>{item.checkedScope}</p>
                    <p>{item.reason}</p>
                    <p>
                      {item.contribution === 'READ_ONLY'
                        ? '仅取得片段，仍待核查'
                        : item.contribution === 'NO_MATERIAL_CHANGE'
                          ? '核查后认识不变'
                          : '对认识有实质贡献'}
                      ；不代表整份文档已覆盖。
                    </p>
                  </li>
                ))}
              </ul>
            </details>
          ) : (
            <p className="matter-posture-note">
              未返回已核查范围，不能由引用数量判断分析完整度。
            </p>
          )}
        </section>

        <section
          className="matter-posture-card matter-posture-change"
          aria-label="本次工作变化"
        >
          <h2>本次工作变化</h2>
          <p>{current?.changeSummary || '尚无已保存的工作变化。'}</p>
          {current?.change.changedBecause ? (
            <p>{current.change.changedBecause}</p>
          ) : null}
          {current ? (
            <>
              <p className="matter-posture-note">
                工作保存时间：{current.createdAt}；不是工程事件发生时间。
              </p>
              <Link to={exactWork}>阅读本次保存工作</Link>
            </>
          ) : null}
          <p className="matter-posture-note">
            当前记录仅说明工作变化；文件修订内容、比较范围与工程事件时间仍需另行核对。
          </p>
        </section>

        <section
          className="matter-posture-card matter-posture-questions"
          aria-label="认识与关键未知"
        >
          <h2>认识与关键未知</h2>
          {questions.length ? (
            <ul>
              {questions.map((item) => (
                <li key={item.itemId}>{item.text}</li>
              ))}
            </ul>
          ) : (
            <p>尚未单独保存待核问题，不代表所有疑点已解决。</p>
          )}
          {work ? (
            <>
              <p>{work.completionReason}</p>
              <Link to={exactWork}>核对全部问题正文与依据</Link>
            </>
          ) : null}
        </section>

        <section
          className="matter-posture-card matter-posture-actions"
          aria-label="我方措施记录覆盖"
        >
          <h2>我方措施记录</h2>
          <p>
            当前读取未提供措施颁发、计划、执行及效果记录。复核条件不作为已执行措施。
          </p>
        </section>
        <section
          className="matter-posture-card matter-posture-observations"
          aria-label="运行观察覆盖"
        >
          <h2>运行观察</h2>
          <p>
            当前读取未提供运行观察或故障记录，不能据此判断无故障或措施有效。
          </p>
        </section>
        <section
          className="matter-posture-card matter-posture-followup"
          aria-label="后续复核条件"
        >
          <h2>后续关注 · 复核条件</h2>
          {conditions.length ? (
            <>
              <ul>
                {conditions.map((item) => (
                  <li key={item.itemId}>
                    {item.text}
                    {item.when?.kind === 'DUE_AT' ? (
                      <p>已保存复核时间：{item.when.at}</p>
                    ) : item.when?.kind === 'ORIGINAL_CHANGED' ? (
                      <p>指定输入原文修订变化时复核</p>
                    ) : null}
                  </li>
                ))}
              </ul>
              <Link to={exactWork}>阅读条件所在的保存工作</Link>
            </>
          ) : (
            <p>尚未单独保存复核条件，不代表无需后续关注。</p>
          )}
          <p className="matter-posture-note">
            条件不是执行记录，也不是厂家承诺的里程碑。
          </p>
        </section>
      </div>
      <section
        className="matter-posture-records"
        aria-label="独立核对请求及引用限制"
      >
        <OverviewCorrectionNotices
          matterId={matter.matterId}
          notices={current?.overviewCorrectionNotices}
        />
        <ReferenceWorkNotices notices={current?.referenceWorkNotices} />
        <p className="matter-posture-note">
          核对请求的结果与已保存工作分别列示。
        </p>
      </section>
    </div>
  );
}
