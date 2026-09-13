import type { FC } from 'react';

import type { EngineeringMatterCatalogEntry } from '@shared/api.interface';
import type {
  EngineeringMatterPendingInput,
  EngineeringMatterPendingInputReason,
  EngineeringMatterWorkingCoverage,
  EngineeringMatterWorkingReadModel,
  EngineeringMatterWorkingTextItem,
} from '@shared/matter-working.interface';

interface MatterWorkingDetailsProps {
  working: EngineeringMatterWorkingReadModel;
  members: EngineeringMatterCatalogEntry[];
}

const MATTER_PENDING_REASON_LABELS: Record<
  EngineeringMatterPendingInputReason,
  string
> = {
  NOT_COVERED: '尚未纳入本轮核查',
  READ_NOT_PROCESSED: '已读片段，尚未保存分析或比较处置',
  WORK_ITEM_REVISION_CHANGED: '成员任务已更新',
  DOCUMENT_VERSION_CHANGED: '文档版本已变化',
  DOCUMENT_ORIGINAL_CHANGED: '原文解析修订已变化',
  DOCUMENT_SEMANTIC_CHANGED: '原文章节语境已更新，待核对',
  RESULT_CHANGED: '成员评估结果已更新',
};

function memberLabel(
  members: EngineeringMatterCatalogEntry[],
  workItemId: string,
): string {
  const member: EngineeringMatterCatalogEntry | undefined = members.find(
    (entry: EngineeringMatterCatalogEntry) => entry.workItemId === workItemId,
  );
  return member?.document.documentCode || '关联材料';
}

const MatterWorkingDetails: FC<MatterWorkingDetailsProps> = ({
  working,
  members,
}) => (
  <div className="space-y-6">
    {working.pendingInputs.length > 0 ? (
      <section
        className="space-y-3 rounded-xl border border-border bg-muted/30 p-4"
        aria-label="待核查的新输入"
      >
        <h2 className="text-sm font-semibold">还有材料尚未覆盖</h2>
        <p className="text-xs leading-6 text-muted-foreground">
          已保存认识继续保留。加入或更新材料，不等于已经阅读或据此修改了判断。
        </p>
        <ul className="space-y-3">
          {working.pendingInputs.map((input: EngineeringMatterPendingInput) => (
            <li key={input.inputId} className="space-y-1 text-sm">
              <strong>{memberLabel(members, input.current.workItemId)}</strong>
              <p className="text-xs text-muted-foreground">
                {input.reasons
                  .map(
                    (reason: EngineeringMatterPendingInputReason) =>
                      MATTER_PENDING_REASON_LABELS[reason],
                  )
                  .join('；')}
              </p>
            </li>
          ))}
        </ul>
      </section>
    ) : null}
    {working.current ? (
      <>
        <section className="space-y-3" aria-label="本轮保存效果">
          <h2 className="text-sm font-semibold">本轮保存效果</h2>
          <p className="whitespace-pre-wrap break-words text-sm leading-7">
            {working.current.changeSummary}
          </p>
          {working.current.change.changedBecause ? (
            <p className="text-sm leading-7">
              变化原因：{working.current.change.changedBecause}
            </p>
          ) : null}
          <p className="text-xs leading-6 text-muted-foreground">
            工作修订 {working.current.workingRevision} ·{' '}
            {working.current.createdAt}。
            事项工作记录不代表正式采用，也不推进成员文档的评估结果。
          </p>
        </section>
        {working.current.state.openQuestions.length > 0 ? (
          <section className="space-y-3" aria-label="仍待核实的问题">
            <h2 className="text-sm font-semibold">仍待核实的问题</h2>
            <ul className="space-y-2 text-sm leading-7">
              {working.current.state.openQuestions.map(
                (item: EngineeringMatterWorkingTextItem) => (
                  <li key={item.itemId}>{item.text}</li>
                ),
              )}
            </ul>
          </section>
        ) : null}
        {working.current.state.reviewConditions.length > 0 ? (
          <section className="space-y-3" aria-label="复看条件">
            <h2 className="text-sm font-semibold">出现这些情况时复看</h2>
            <ul className="space-y-2 text-sm leading-7">
              {working.current.state.reviewConditions.map(
                (item: EngineeringMatterWorkingTextItem) => (
                  <li key={item.itemId}>{item.text}
                    {item.when?.kind === 'DUE_AT' ? <span className="block text-xs text-muted-foreground">复看时间：{item.when.at}</span> : null}
                    {item.when?.kind === 'ORIGINAL_CHANGED' ? <span className="block text-xs text-muted-foreground">指定输入的原文修订变化时复看</span> : null}
                  </li>
                ),
              )}
            </ul>
            <p className="text-xs text-muted-foreground">
              后台消费者运行时检查明确时间和原文变化；纯文字条件仍需人工判断。触发复看不代表工程结论已经变化。
            </p>
          </section>
        ) : null}
        {working.current.state.coverage.length > 0 ? (
          <details className="border-t border-border pt-4">
            <summary className="cursor-pointer text-sm font-medium">
              已核查范围及材料贡献
            </summary>
            <ul className="mt-4 space-y-4">
              {working.current.state.coverage.map(
                (coverage: EngineeringMatterWorkingCoverage, index: number) => (
                  <li
                    key={`${coverage.binding.inputId}:${index}`}
                    className="space-y-1 text-sm leading-7"
                  >
                    <strong>
                      {memberLabel(members, coverage.binding.workItemId)}
                    </strong>
                    <p>
                      实际核查范围：{coverage.checkedScope}（
                      {coverage.checkedSourceRefIds.length}{' '}
                      处原文，不代表已覆盖整份文档）
                    </p>
                    <p>
                      {coverage.contribution === 'SUBSTANTIVE'
                        ? '对认识有实质贡献'
                        : coverage.contribution === 'NO_MATERIAL_CHANGE'
                          ? '核查后认识不变'
                          : '仅取得阅读片段，仍待核查'}
                      ：{coverage.reason}
                    </p>
                  </li>
                ),
              )}
            </ul>
          </details>
        ) : null}
      </>
    ) : null}
  </div>
);

export default MatterWorkingDetails;
