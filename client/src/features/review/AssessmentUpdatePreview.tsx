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
  onSelectionChange(ids: string[]): void;
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
          <DialogTitle>核对本次更新评估范围</DialogTitle>
          <DialogDescription>
            确认后才请求重新评估。讨论与材料只作为输入，不代表正式采用。
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
        <p>
          将纳入下面选定的已回答对话及其附件。已有评估上下文仍由 Host
          按授权读取；这里不新增或选择其他资料。
        </p>
        <section aria-label="待纳入的已保存对话" className="grid gap-3">
          <p>
            已选 {props.selectedIds.length} / {props.turns.length} 条。单次最多
            100 条；超过时默认只选最早 100 条，可自行调整。
          </p>
          {props.turns.map((turn: ReviewTurnReadModel) => {
            const selected: boolean = props.selectedIds.includes(
              turn.reviewTurnId,
            );
            return (
              <article
                key={turn.reviewTurnId}
                className="grid gap-2 border-b pb-3"
              >
                <Button
                  type="button"
                  variant="outline"
                  aria-pressed={selected}
                  disabled={props.pending}
                  onClick={() =>
                    props.onSelectionChange(
                      selected
                        ? props.selectedIds.filter(
                            (id: string) => id !== turn.reviewTurnId,
                          )
                        : [...props.selectedIds, turn.reviewTurnId],
                    )
                  }
                >
                  {selected ? '已选入' : '未选入'} · 对话 {turn.turnNo}
                </Button>
                <p className="whitespace-pre-wrap break-words">
                  {turn.engineerSuppliedInput.text}
                </p>
                <details>
                  <summary>查看答复与附件范围</summary>
                  <p className="whitespace-pre-wrap break-words">
                    {turn.assistantCandidate?.answer}
                  </p>
                  <p>
                    已保存附件：{turn.attachmentRefs.length}{' '}
                    份；选入不代表已读取或已采用。
                  </p>
                  {turn.attachmentRefs.map((ref: string) => (
                    <p key={ref} className="break-all">
                      {ref}
                    </p>
                  ))}
                </details>
              </article>
            );
          })}
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
          {props.pending ? '按原范围重试更新评估' : '确认范围并更新评估'}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
