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
import { dialogueAssessmentOperation } from './dialogue-assessment-operation';
import { dialogueFocusOptions } from './dialogue-focus';

interface DialogueAssessmentControlProps {
  thread: DialogueThreadReadModel;
  workItems: DialogueWorkItemOption[];
  focusWorkItemIds?: string[];
  disabled: boolean;
  error: string;
  hasDraft: boolean;
  execute: ReturnType<typeof usePrivateDialogue>['execute'];
  onAccepted?(result: DialogueAssessmentResponse): void;
}

export const DialogueAssessmentControl: FC<DialogueAssessmentControlProps> = ({
  thread,
  workItems,
  focusWorkItemIds = [],
  disabled,
  error,
  hasDraft,
  execute,
  onAccepted,
}) => {
  const [targetChoice, setTarget] = useState('');
  const targetIds: string[] = [
    ...new Set(
      thread.contributions
        .filter((item) => item.status === 'ACTIVE')
        .map((item) => item.workItemId),
    ),
  ];
  const targetOptions: DialogueWorkItemOption[] = dialogueFocusOptions(
    targetIds,
    workItems.filter((item) => targetIds.includes(item.workItemId)),
    thread,
  );
  const preferred: string =
    focusWorkItemIds.length === 1 && targetIds.includes(focusWorkItemIds[0])
      ? focusWorkItemIds[0]
      : targetIds.length === 1
        ? targetIds[0]
        : '';
  const target: string = targetIds.includes(targetChoice)
    ? targetChoice
    : preferred;
  const [context, setContext] = useState<DialogueWorkingContext | null>(null);
  const [instruction, setInstruction] = useState('');
  const [receipt, setReceipt] = useState<DialogueAssessmentResponse | null>(
    null,
  );
  const candidates =
    context?.workItemId === target ? context.pendingContributions : [];
  const selectionValid = candidates.length > 0;
  const readCurrent = (workItemId: string = target): void => {
    if (!workItemId || disabled) return;
    let result: DialogueWorkingContext | null = null;
    setContext(null);
    setReceipt(null);
    void execute(
      async (signal) => {
        result = await readDialogueContext(
          thread.threadRef,
          workItemId,
          signal,
        );
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
      instruction.length > 2000 ||
      context.workItemId !== target ||
      !selectionValid
    )
      return;
    const input: RequestDialogueAssessment = {
      requestId: crypto.randomUUID(),
      workItemId: target,
      expectedWorkItemRevision: context.workItemRevision,
      expectedWorkingRef: context.workingRef,
      contributions: [],
      collectionMode: 'ALL_PENDING',
      userMessage:
        instruction.trim() ||
        '请结合本次汇集的补充内容，核对当前资料并更新工作判断，说明判断变化、依据和仍待确认的事项。',
    };
    const operation = dialogueAssessmentOperation(thread.threadRef, input);
    void execute(operation.run, {
      mutation: true,
      done: () => {
        const result = operation.receipt();
        if (!result) return;
        setReceipt(result);
        setContext(null);
        setInstruction('');
        onAccepted?.(result);
      },
    });
  };
  return (
    <details
      className="space-y-3 border-t pt-3 text-sm"
      onToggle={(event) => {
        if (event.currentTarget.open && !context && !receipt) readCurrent();
      }}
    >
      <summary>用讨论中的补充更新评估</summary>
      <p className="text-xs text-muted-foreground">
        当前资料的有效补充自动汇集，点击更新后才重新评估。
      </p>
      {!targetIds.length && <p>先在对话中选取需要补充的原话并保存。</p>}
      {targetOptions.length === 1 ? (
        <p className="font-medium">更新：{targetOptions[0].label}</p>
      ) : targetOptions.length > 1 ? (
        <Select
          value={target}
          disabled={disabled}
          onValueChange={(value) => {
            setTarget(value);
            setContext(null);
            setReceipt(null);
            readCurrent(value);
          }}
        >
          <SelectTrigger aria-label="重评目标资料">
            <SelectValue placeholder="选择目标资料" />
          </SelectTrigger>
          <SelectContent>
            {targetOptions.map((item) => (
              <SelectItem key={item.workItemId} value={item.workItemId}>
                {item.label}
                {item.description ? ` · ${item.description}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {target && (
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || !target}
          onClick={() => readCurrent()}
        >
          {disabled ? '正在读取…' : context ? '刷新工作版本' : '读取工作版本'}
        </Button>
      )}
      {context && context.workItemId === target && (
        <>
          <details className="text-xs text-muted-foreground">
            <summary>
              基于工作版本 {context.workingRevision ?? '暂无'} · 查看当前判断
            </summary>
            <p className="whitespace-pre-wrap break-words">
              {context.summary || '尚无工作判断'}
            </p>
          </details>
          <details>
            <summary>
              当前待用 {candidates.length} 条补充 · 查看原话与来源
            </summary>
            <div className="space-y-3 py-2">
              {candidates.map((item) => (
                <article
                  key={item.contributionRef}
                  className="space-y-1 border-b pb-2"
                >
                  <p className="whitespace-pre-wrap break-words">
                    {item.selectedText}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.sourcePart === 'ASSISTANT'
                      ? 'Aily 候选答复'
                      : item.origin === 'FEISHU_EXCERPT'
                        ? '用户提交摘录'
                        : '用户陈述'}{' '}
                    · {item.kind}
                    {item.revision ? ` · 修订 ${item.revision}` : ''}
                  </p>
                </article>
              ))}
            </div>
          </details>
          <Textarea
            aria-label="本次更新要求"
            value={instruction}
            maxLength={2000}
            disabled={disabled}
            placeholder="本次更新重点（选填），例如核实某项假设或比较新增材料"
            onChange={(event) => setInstruction(event.target.value)}
          />
          {hasDraft && <p>对话输入框中的未发送草稿不会进入本次更新。</p>}
          {error && <p>请先重新读取当前工作版本，核对后再提交。</p>}
          <Button
            disabled={
              disabled ||
              Boolean(error) ||
              !selectionValid ||
              instruction.length > 2000
            }
            onClick={submit}
          >
            更新评估
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
