import type { ReactNode } from 'react';
import type { EngineeringMatterCatalogEntry } from '@shared/api.interface';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type {
  EngineeringMatterPendingInput,
  EngineeringMatterPendingInputReason,
  EngineeringMatterWorkingRevisionReadModel,
} from '@shared/matter-working.interface';
import { Button } from '@client/src/components/ui/button';
import type {
  AssessmentClaimSelection,
  DocumentAssessmentEvidence,
} from './assessment-reading';
import { compactReadingSummary } from './compact-reading-summary';
import { readableMatterOverview } from './matter-overview-reading';
import { JobAidEvidenceDetails } from './SavedJobAidReadingContext';
interface Props {
  revision: EngineeringMatterWorkingRevisionReadModel | null;
  members: EngineeringMatterCatalogEntry[];
  pendingInputs: EngineeringMatterPendingInput[];
  historical: boolean;
  onLocateDocument: (
    evidence: Pick<
      DocumentAssessmentEvidence,
      'documentVersionId' | 'workItemId'
    >,
  ) => void;
  onOpenClaim: (
    selection: AssessmentClaimSelection,
    trigger: HTMLButtonElement,
  ) => void;
}

const pendingLabels: Record<EngineeringMatterPendingInputReason, string> = {
  NOT_COVERED: '尚未纳入保存工作',
  READ_NOT_PROCESSED: '已读片段，分析或比较处置尚未保存',
  WORK_ITEM_REVISION_CHANGED: '资料工作已更新',
  DOCUMENT_VERSION_CHANGED: '文件版本已变化',
  DOCUMENT_ORIGINAL_CHANGED: '原文解析修订已变化',
  DOCUMENT_SEMANTIC_CHANGED: '原文章节语境已变化',
  RESULT_CHANGED: '资料评估结果已更新',
};

/** Saved revision reading; current module facts never overlay historical work. */
export default function MatterFirstScreenReading({
  revision,
  members,
  pendingInputs,
  historical,
  onLocateDocument,
  onOpenClaim,
}: Props) {
  const work = revision?.state.problemWork;
  const result = readableMatterOverview(revision);
  const evidence: AssessmentEvidence[] = [
    ...(work?.evidence ?? []),
    ...(result?.evidence ?? []),
  ];
  const decisiveIssues =
    work?.issues.filter((issue) =>
      work.decisiveIssueKeys.includes(issue.issueKey),
    ) ?? [];
  const decisiveClaims = !work
    ? (result?.content.claims.filter((claim) =>
        result.content.decisiveClaimIds.includes(claim.claimId),
      ) ?? [])
    : [];
  const headline = work?.headline ?? result?.content.headline;
  const brief = work?.listBrief ?? result?.content.listBrief;
  const measures =
    work?.issues.flatMap((issue) =>
      issue.measures.map((measure) => ({ issue, measure })),
    ) ?? [];
  const issueQuestions =
    work?.issues.flatMap((issue) =>
      issue.openQuestions.map((question) => ({ issue, question })),
    ) ?? [];
  const savedQuestions = revision?.state.openQuestions ?? [];
  const conditions = revision?.state.reviewConditions ?? [];

  return (
    <div
      className="matter-first-screen"
      aria-label="事项工程阅读摘要"
      data-matter-work-ref={revision?.matterWorkRevisionId}
    >
      <section className="space-y-3" aria-label="当前判断与范围">
        <h2 className="text-lg font-semibold">
          {historical ? '本版判断与范围' : '当前判断与范围'}
        </h2>
        {headline ? (
          <>
            <h3 className="font-medium">{headline}</h3>
            <p className="whitespace-pre-wrap text-sm leading-7">
              {compactReadingSummary(headline, brief ?? '')}
            </p>
            <p className="text-xs text-muted-foreground">
              {work?.overviewStatus === 'STALE'
                ? '此前保存的系统候选判断，尚未覆盖本次问题更新'
                : work?.overviewStatus === 'NOT_AVAILABLE'
                  ? '已保存的问题摘要，尚未形成综合判断'
                  : '已保存的系统候选判断'}
            </p>
          </>
        ) : (
          <p className="text-sm leading-7">
            {revision?.state.focus.question ??
              '尚未形成事项综合认识。已有资料仍可从关联资料阅读。'}
          </p>
        )}
        <SavedReadingList
          visible={1}
          label="其余决定性问题与条件"
          items={decisiveIssues.map((issue) => (
            <div
              key={issue.issueKey}
              className="space-y-1 border-l-2 border-primary/40 pl-3"
            >
              <h3 className="text-sm font-medium">
                决定性问题：{issue.question}
              </h3>
              <SavedReadingList
                visible={2}
                label="其余已保存的条件与限制"
                items={issue.riskScenarios.flatMap((risk, index) => [
                  ...risk.conditions.map((text, position) => (
                    <p
                      key={`c:${index}:${position}`}
                      className="text-sm leading-6"
                    >
                      条件：{text}
                    </p>
                  )),
                  ...risk.limitations.map((text, position) => (
                    <p
                      key={`l:${index}:${position}`}
                      className="text-sm leading-6"
                    >
                      限制：{text}
                    </p>
                  )),
                ])}
              />
              <JobAidEvidenceDetails
                refs={issue.premiseRefs}
                evidence={evidence}
                onLocateDocument={onLocateDocument}
                label="核对决定性问题的依据"
              />
            </div>
          ))}
        />
        <SavedReadingList
          visible={1}
          label="其余关键判断与限制"
          items={decisiveClaims.map((claim) => (
            <div
              key={claim.claimId}
              className="space-y-1 border-l-2 border-primary/40 pl-3"
            >
              <p className="text-sm leading-7">{claim.text}</p>
              {claim.premises
                .filter((premise) => premise.limitation)
                .map((premise, index) => (
                  <p key={index} className="text-sm leading-6">
                    条件与限制：{premise.limitation}
                  </p>
                ))}
              <Button
                variant="ghost"
                className="h-auto whitespace-normal px-0 text-left underline"
                size="sm"
                onClick={(event) =>
                  onOpenClaim(
                    {
                      resultRef: result!.resultRef,
                      resultRevision: result!.resultRevision,
                      claimId: claim.claimId,
                    },
                    event.currentTarget,
                  )
                }
              >
                核对此判断依据
              </Button>
            </div>
          ))}
        />
        {historical ? (
          <p className="text-sm text-muted-foreground">
            适用范围按本版保存的判断与依据阅读；此处不叠加当前适用性模块结果。
          </p>
        ) : (
          <MatterApplicability
            members={members}
            onLocateDocument={onLocateDocument}
          />
        )}
      </section>
      <section className="space-y-3" aria-label="公司安排与落实">
        <h2 className="text-lg font-semibold">公司安排与落实</h2>
        <div className="space-y-3">
          <div className="space-y-2 rounded-lg border border-border p-3">
            <h3 className="text-sm font-medium">公司正式安排的读取范围</h3>
            <p className="text-sm leading-6">
              {historical ? '本版保存读取' : '本次事项读取'}
              尚未提供可核对的公司批准意见清单。
            </p>
            <p className="text-sm leading-6">
              正式工程文件与措施状态、逐 AEO 进展和期限尚未取得。
            </p>
          </div>
          <div className="space-y-2 rounded-lg border border-border p-3">
            <h3 className="text-sm font-medium">系统评估建议 · 保存候选</h3>
            {!measures.length ? (
              <p className="text-sm leading-6">本版未单独保存措施建议。</p>
            ) : null}
            {measures.slice(0, 1).map(({ issue, measure }, index) => (
              <SavedMeasure
                key={`${issue.issueKey}:${index}`}
                measure={measure}
                evidence={evidence}
                onLocateDocument={onLocateDocument}
              />
            ))}
            {measures.length > 1 ? (
              <details>
                <summary className="cursor-pointer text-sm">
                  其余 {measures.length - 1} 项保存建议
                </summary>
                {measures.slice(1).map(({ issue, measure }, index) => (
                  <SavedMeasure
                    key={`${issue.issueKey}:${index}`}
                    measure={measure}
                    evidence={evidence}
                    onLocateDocument={onLocateDocument}
                  />
                ))}
              </details>
            ) : null}
          </div>
        </div>
      </section>
      <section className="space-y-3" aria-label="变化与下一步">
        <h2 className="text-lg font-semibold">变化与下一步</h2>
        <p className="text-sm leading-7">
          {revision?.changeSummary || '尚未取得本版保存的变化说明。'}
        </p>
        {revision?.change.changedBecause ? (
          <p className="text-sm leading-7">
            变化原因：{revision.change.changedBecause}
          </p>
        ) : null}
        {!historical && pendingInputs.length ? (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">
              已变化、尚未纳入保存工作的资料
            </h3>
            <SavedReadingList
              visible={1}
              label="其余待核查资料"
              items={pendingInputs.map((input) => {
                const member = members.find(
                  (entry) =>
                    entry.workItemId === input.current.workItemId &&
                    entry.document.documentVersionId ===
                      input.current.documentVersionId,
                );
                return (
                  <div key={input.inputId} className="text-sm leading-6">
                    <Button
                      variant="ghost"
                      className="h-auto whitespace-normal px-0 text-left underline"
                      size="sm"
                      onClick={() =>
                        onLocateDocument({
                          workItemId: input.current.workItemId,
                          documentVersionId: input.current.documentVersionId,
                        })
                      }
                    >
                      {member?.document.documentCode ??
                        '阅读这份准确版本的资料'}
                    </Button>
                    <p>
                      {input.reasons
                        .map((reason) => pendingLabels[reason])
                        .join('；')}
                    </p>
                  </div>
                );
              })}
            />
          </div>
        ) : null}
        <SavedReadingList
          visible={1}
          label="其余事项待核问题"
          items={savedQuestions.map((question) => (
            <div key={question.itemId} className="space-y-1">
              <p className="text-sm leading-7">待核：{question.text}</p>
              <JobAidEvidenceDetails
                refs={question.basisRefs}
                evidence={evidence}
                onLocateDocument={onLocateDocument}
                label="核对此待核项的保存依据"
              />
            </div>
          ))}
        />
        <SavedReadingList
          visible={1}
          label="其余问题的影响与下一步"
          items={issueQuestions.map(({ issue, question }, index) => (
            <div key={`${issue.issueKey}:${index}`} className="space-y-1">
              <p className="text-sm leading-7">待核：{question.question}</p>
              <p className="text-sm leading-6">
                影响对象与判断：{question.affects}
              </p>
              <p className="text-sm leading-6">
                下一步所需依据：{question.nextEvidence}
              </p>
            </div>
          ))}
        />
        <SavedReadingList
          visible={1}
          label="其余复核条件"
          items={conditions.map((condition) => (
            <div key={condition.itemId} className="space-y-1">
              <p className="text-sm leading-7">复核条件：{condition.text}</p>
              {condition.when?.kind === 'DUE_AT' ? (
                <p className="text-sm">复看时间：{condition.when.at}</p>
              ) : null}
              {condition.when?.kind === 'ORIGINAL_CHANGED' ? (
                <p className="text-sm">指定输入的原文修订变化时复核。</p>
              ) : null}
              <JobAidEvidenceDetails
                refs={condition.basisRefs}
                evidence={evidence}
                onLocateDocument={onLocateDocument}
                label="核对此复核条件的依据"
              />
            </div>
          ))}
        />
        {!savedQuestions.length &&
        !issueQuestions.length &&
        !conditions.length ? (
          <p className="text-sm text-muted-foreground">
            本版未单独保存待跟进问题或复核条件。
          </p>
        ) : null}
      </section>
    </div>
  );
}

function MatterApplicability({
  members,
  onLocateDocument,
}: Pick<Props, 'members' | 'onLocateDocument'>) {
  const labels = {
    APPLICABLE: '适用',
    NOT_APPLICABLE: '不适用',
    UNKNOWN: '待确认',
  };
  return (
    <section className="space-y-2" aria-label="已有适用性模块结论">
      <h3 className="text-sm font-medium">本机队范围 · 已有适用性模块</h3>
      {!members.length ? (
        <p className="text-sm">当前事项没有可复用适用性结果的关联资料任务。</p>
      ) : null}
      <SavedReadingList
        visible={2}
        label="其余资料的适用性与依据入口"
        items={members.map((member) => {
          const applicability = member.applicability;
          const exact =
            applicability?.documentVersionId ===
            member.document.documentVersionId;
          const stale =
            applicability &&
            (applicability.status === 'STALE' ||
              applicability.currentness === 'STALE');
          return (
            <div key={member.workItemId} className="text-sm leading-6">
              <Button
                variant="ghost"
                className="h-auto whitespace-normal px-0 text-left underline"
                size="sm"
                onClick={() =>
                  onLocateDocument({
                    workItemId: member.workItemId,
                    documentVersionId: member.document.documentVersionId,
                  })
                }
              >
                {member.document.documentCode} ·{' '}
                {member.document.businessRevision || '版次未提供'}
              </Button>
              {applicability && exact ? (
                <p>
                  {applicability.aircraftNumber || '评估对象未提供'}：
                  {stale
                    ? '原模块结论已过期，需重新核对'
                    : `模块候选结论：${labels[applicability.decision]}`}
                  {stale ? `（原结论：${labels[applicability.decision]}）` : ''}
                  {applicability.status === 'WAITING_INPUT'
                    ? '；模块正在等待输入'
                    : ''}
                  {applicability.blockingUnknownCount > 0
                    ? `；${applicability.blockingUnknownCount} 项决定性事实待确认`
                    : ''}
                  {applicability.assessmentAsOf
                    ? `；评估截至 ${applicability.assessmentAsOf}`
                    : ''}
                </p>
              ) : (
                <p>
                  {applicability
                    ? '适用性结果与资料版本不一致，待重新读取。'
                    : member.applicabilityUnavailableReason ===
                        'SOURCE_MISMATCH'
                      ? '适用性结果的来源与此资料版本不一致，本次未展示，待核对。'
                      : '尚未取得此资料的已有适用性结果。'}
                </p>
              )}
            </div>
          );
        })}
      />
      {members.some((member) => member.applicability) ? (
        <p className="text-xs text-muted-foreground">
          按各资料的准确评估对象分别阅读，不汇成全机队结论。
        </p>
      ) : null}
    </section>
  );
}

/** Keep the first saved item visible; expandable entries retain their full text. */
function SavedReadingList({
  items,
  visible,
  label,
}: {
  items: ReactNode[];
  visible: number;
  label: string;
}) {
  if (!items.length) return null;
  return (
    <div className="space-y-2">
      {items.slice(0, visible)}
      {items.length > visible ? (
        <details>
          <summary className="cursor-pointer text-sm">
            {label}（{items.length - visible}）
          </summary>
          <div className="mt-2 space-y-2">{items.slice(visible)}</div>
        </details>
      ) : null}
    </div>
  );
}

function SavedMeasure({
  measure,
  evidence,
  onLocateDocument,
}: {
  measure: NonNullable<
    EngineeringMatterWorkingRevisionReadModel['state']['problemWork']
  >['issues'][number]['measures'][number];
  evidence: AssessmentEvidence[];
  onLocateDocument: Props['onLocateDocument'];
}) {
  const status = {
    PROPOSED: '提出的建议',
    REPORTED_IMPLEMENTED: '候选引用来源报告已实施',
    VERIFIED_EFFECTIVE: '候选评价为有效',
  };
  return (
    <div className="space-y-1 text-sm leading-6">
      <p>{measure.text}</p>
      <p className="text-xs text-muted-foreground">{status[measure.status]}</p>
      <p>针对：{measure.addresses}</p>
      {measure.limitations.map((limitation, index) => (
        <p key={index}>限制：{limitation}</p>
      ))}
      <JobAidEvidenceDetails
        refs={measure.basisRefs}
        evidence={evidence}
        onLocateDocument={onLocateDocument}
        label="核对建议的保存依据"
      />
    </div>
  );
}
