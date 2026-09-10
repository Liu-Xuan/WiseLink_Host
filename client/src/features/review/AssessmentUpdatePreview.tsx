import { Button } from '@client/src/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';
import type { ReviewTurnReadModel } from '@shared/api.interface';

interface AssessmentUpdatePreviewProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  turns: ReviewTurnReadModel[];
  selectedIds: string[];
  revision: number;
  workingRevision?: number;
  materialTitle?: string;
  documentVersionId?: string;
  modelLabel: string;
  focusLabel?: string;
  hasUnsentDraft: boolean;
  pending: boolean;
  notice?: string;
  disabled: boolean;
  onConfirm(): void;
}

export default function AssessmentUpdatePreview(
  props: AssessmentUpdatePreviewProps,
) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>本次评估输入</DialogTitle>
          <DialogDescription>
            已自动汇集当前范围的有效讨论。讨论与材料作为评估输入，不代表正式采用。
          </DialogDescription>
        </DialogHeader>
        {props.notice ? <p role="alert">{props.notice}</p> : null}
        <p>
          事项版本 {props.revision}
          {props.workingRevision !== undefined
            ? ` · 工作版本 ${props.workingRevision}`
            : ''}{' '}
          · 模型：{props.modelLabel}
        </p>
        {props.materialTitle ? (
          <p>
            主文件：{props.materialTitle} · {props.documentVersionId}
          </p>
        ) : null}
        {props.focusLabel ? <p>本次评估范围：{props.focusLabel}</p> : null}
        <p>将纳入以下已保存的对话及其附件。原件性质和来源保持不变。</p>
        <section aria-label="待纳入的已保存对话" className="grid gap-3">
          <p>
            已自动汇集 {props.selectedIds.length}{' '}
            条；超过单次上限时不会截断内容。
          </p>
          {props.turns.map((turn: ReviewTurnReadModel) => (
            <article
              key={turn.reviewTurnId}
              className="grid gap-2 border-b pb-3"
            >
              <p>讨论 {turn.turnNo}</p>
              <p className="whitespace-pre-wrap break-words">
                {turn.engineerSuppliedInput.text}
              </p>
              <details>
                <summary>查看答复与附件来源</summary>
                <p className="whitespace-pre-wrap break-words">
                  {turn.assistantCandidate?.answer}
                </p>
                <p>
                  已保存附件：{turn.attachmentRefs.length}{' '}
                  份；纳入不代表已读取或已采用。
                </p>
                {turn.attachmentRefs.map((ref: string) => (
                  <p key={ref} className="break-all">
                    {ref}
                  </p>
                ))}
              </details>
            </article>
          ))}
          {!props.turns.length ? <p>尚无同范围、已回答的新对话。</p> : null}
        </section>
        {props.hasUnsentDraft ? (
          <p role="status">
            编辑框中的未发送文字及附件不在本次范围内，更新后仍保留。
          </p>
        ) : null}
        {props.pending ? (
          <p role="status">提交结果待核对；重试保持原版本、模型和对话范围。</p>
        ) : null}
        <Button
          type="button"
          disabled={props.disabled}
          onClick={props.onConfirm}
        >
          {props.pending ? '按原范围重试更新评估' : '更新评估'}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
