import type { EngineeringMatterWorkingRevisionReadModel } from '@shared/matter-working.interface';
import OverviewCorrectionNotices from './OverviewCorrectionNotices';
import OverviewSourceWork from './OverviewSourceWork';
import ReferenceWorkNotices from './ReferenceWorkNotices';

/** Meaning-changing notices must remain beside the saved reading, even when
 * the complete issue analysis is collapsed. */
export default function MatterSavedWorkNotices({
  revision,
  includeReferences = false,
}: {
  revision: EngineeringMatterWorkingRevisionReadModel;
  includeReferences?: boolean;
}) {
  return (
    <div className="space-y-2" aria-label="本版保存工作与引用的更新提示">
      <OverviewSourceWork
        matterId={revision.matterId}
        source={revision.overviewSourceWork}
        overviewStatus={revision.state.problemWork?.overviewStatus}
      />
      <OverviewCorrectionNotices
        matterId={revision.matterId}
        notices={revision.overviewCorrectionNotices}
      />
      {revision.correctionNotices?.map((notice) => (
        <p key={notice.attemptRef} role="note" className="text-sm leading-7">
          问题 {notice.issueKey}：
          {notice.unchanged
            ? '已完成比较并保留原认识。'
            : notice.correctedWorkRef
              ? '此版本已有后继更正；当前展示仍为原版本。'
              : '已登记待核更正，尚未取得更正后的保存结果。'}{' '}
          {notice.reason}
        </p>
      ))}
      {includeReferences
        ? revision.state.problemWork?.issues.map((issue) => {
            const notices = revision.referenceWorkNotices?.filter((notice) =>
              notice.affectedIssueKeys.includes(issue.issueKey),
            );
            if (
              !notices?.some(
                (notice) =>
                  notice.overviewStatus !== 'CURRENT' ||
                  notice.correctionNotices.length ||
                  notice.overviewCorrectionNotices?.length,
              )
            )
              return null;
            return (
              <section
                key={issue.issueKey}
                className="space-y-1"
                aria-label="受引用变化影响的问题"
              >
                <h3 className="text-sm font-medium">
                  影响问题：{issue.question || issue.issueKey}
                </h3>
                <ReferenceWorkNotices notices={notices} />
              </section>
            );
          })
        : null}
    </div>
  );
}
