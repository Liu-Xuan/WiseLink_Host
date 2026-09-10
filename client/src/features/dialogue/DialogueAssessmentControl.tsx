import { useState, type FC } from 'react';
import type {
  DialogueAssessmentResponse,
  DialogueThreadReadModel,
  DialogueWorkingContext,
  RequestDialogueAssessment,
} from '@shared/dialogue.interface';
import { readDialogueContext, readDialogue } from '@client/src/api/dialogues';
import { Button } from '@client/src/components/ui/button';
import { Textarea } from '@client/src/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import type { DialogueWorkItemOption } from './DialogueContributionPicker';
import type { usePrivateDialogue } from './usePrivateDialogue';
import {
  dialogueAssessmentSelectionValid,
  type DialogueChosenContribution,
} from './dialogue-assessment-selection';
import { dialogueAssessmentOperation } from './dialogue-assessment-operation';

interface DialogueAssessmentControlProps {
  thread: DialogueThreadReadModel;
  workItems: DialogueWorkItemOption[];
  disabled: boolean;
  error: string;
  hasDraft: boolean;
  execute: ReturnType<typeof usePrivateDialogue>['execute'];
  onAccepted?(result: DialogueAssessmentResponse): void;
}

export const DialogueAssessmentControl: FC<DialogueAssessmentControlProps> = ({
  thread,
  workItems,
  disabled,
  error,
  hasDraft,
  execute,
  onAccepted,
}) => {
  const [target, setTarget] = useState('');
  const [context, setContext] = useState<DialogueWorkingContext | null>(null);
  const [chosen, setChosen] = useState<DialogueChosenContribution[]>([]);
  const [instruction, setInstruction] = useState('');
  const [receipt, setReceipt] = useState<DialogueAssessmentResponse | null>(
    null,
  );
  const candidates = thread.contributions.filter(
    (item) => item.workItemId === target && item.status === 'ACTIVE',
  );
  const selectionValid = dialogueAssessmentSelectionValid(
    chosen,
    thread.contributions,
    target,
  );
  const readCurrent = (): void => {
    let result: DialogueWorkingContext | null = null;
    setContext(null);
    setReceipt(null);
    void execute(
      async (signal) => {
        result = await readDialogueContext(thread.threadRef, target, signal);
        return readDialogue(thread.threadRef, signal);
      },
      { done: () => setContext(result) },
    );
  };
  const submit = (): void => {
    if (
      !context ||
      disabled ||
      error ||
      !instruction.trim() ||
      instruction.length > 2000 ||
      !selectionValid
    )
      return;
    const input: RequestDialogueAssessment = {
      requestId: crypto.randomUUID(),
      workItemId: target,
      expectedWorkItemRevision: context.workItemRevision,
      expectedWorkingRef: context.workingRef,
      contributions: chosen,
      userMessage: instruction,
    };
    const operation = dialogueAssessmentOperation(thread.threadRef, input);
    void execute(operation.run, {
      mutation: true,
      done: () => {
        const result = operation.receipt();
        if (!result) return;
        setReceipt(result);
        setContext(null);
        setChosen([]);
        setInstruction('');
        onAccepted?.(result);
      },
    });
  };
  return (
    <details className="space-y-3 border-t pt-3 text-sm">
      <summary>用选定贡献更新工作判断</summary>
      <p className="text-xs text-muted-foreground">
        单次更新一份资料。只有明确选中的私人贡献进入本次请求；不分享，不正式采用。
      </p>
      <Select
        value={target}
        disabled={disabled}
        onValueChange={(value) => {
          setTarget(value);
          setContext(null);
          setChosen([]);
          setReceipt(null);
        }}
      >
        <SelectTrigger aria-label="重评目标资料">
          <SelectValue placeholder="选择目标资料" />
        </SelectTrigger>
        <SelectContent>
          {workItems.map((item) => (
            <SelectItem key={item.workItemId} value={item.workItemId}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        disabled={disabled || !target}
        onClick={readCurrent}
      >
        读取当前工作版本
      </Button>
      {context && (
        <>
          <p>
            资料修订 {context.workItemRevision} · 当前工作版本{' '}
            {context.workingRevision ?? '暂无'}· 读取于 {context.readAt}
          </p>
          <p className="whitespace-pre-wrap break-words">
            {context.summary || '尚无工作判断'}
          </p>
          <p className="break-all text-xs">
            资料版本：{context.documentVersionId}
          </p>
          <div className="space-y-2" aria-label="明确选择本次输入贡献">
            {!candidates.length && <p>该资料暂无可选择的私人贡献。</p>}
            {candidates.map((item) => (
              <Button
                key={item.contributionRef}
                variant="outline"
                className="h-auto max-w-full whitespace-pre-wrap break-words text-left"
                disabled={disabled}
                aria-pressed={chosen.some(
                  (selected) =>
                    selected.contributionRef === item.contributionRef,
                )}
                onClick={() =>
                  setChosen(
                    chosen.some(
                      (selected) =>
                        selected.contributionRef === item.contributionRef,
                    )
                      ? chosen.filter(
                          (selected) =>
                            selected.contributionRef !== item.contributionRef,
                        )
                      : [
                          ...chosen,
                          {
                            contributionRef: item.contributionRef,
                            expectedRevision: item.revision,
                          },
                        ],
                  )
                }
              >
                {item.selectedText}
              </Button>
            ))}
          </div>
          <Textarea
            aria-label="本次更新要求"
            value={instruction}
            maxLength={2000}
            disabled={disabled}
            placeholder="说明本次需要重新判断的问题"
            onChange={(event) => setInstruction(event.target.value)}
          />
          {hasDraft && <p>对话输入框中的未发送草稿不会进入本次更新。</p>}
          {error && <p>请先重新读取当前工作版本，核对后再提交。</p>}
          {!!chosen.length && !selectionValid && (
            <div role="alert">
              <p>
                所选贡献已变化、撤回或超出20条。不会缩小输入范围，请清除选择后重新核对。
              </p>
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() => setChosen([])}
              >
                清除选择并重新核对
              </Button>
            </div>
          )}
          <Button
            disabled={
              disabled ||
              Boolean(error) ||
              !selectionValid ||
              instruction.length > 2000 ||
              !instruction.trim()
            }
            onClick={submit}
          >
            确认以 {chosen.length} 条贡献更新工作判断
          </Button>
        </>
      )}
      {receipt && (
        <p role="status">
          评估请求已受理，结果尚未确认更新，也未正式采用。
          {onAccepted && (
            <Button variant="ghost" onClick={() => onAccepted(receipt)}>
              查看评估进度
            </Button>
          )}
        </p>
      )}
    </details>
  );
};
