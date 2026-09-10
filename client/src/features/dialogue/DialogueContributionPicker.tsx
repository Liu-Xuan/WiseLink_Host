import { useState, type FC } from 'react';
import type {
  DialogueContributionKind,
  DialogueContributionReadModel,
  DialogueMessageReadModel,
} from '@shared/dialogue.interface';
import { Button } from '@client/src/components/ui/button';
import { Textarea } from '@client/src/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@client/src/components/ui/dialog';
import {
  selectedDialogueText,
  dialogueSourceSelection,
} from './dialogue-state';

export interface DialogueWorkItemOption {
  workItemId: string;
  label: string;
  documentVersionId?: string;
  createdAt?: string;
  description?: string;
}
export interface DialogueSelection {
  messageRef: string;
  sourcePart: 'USER' | 'ASSISTANT';
  selection: { start: number; end: number };
  workItemId: string;
  kind: DialogueContributionKind;
  supersedesContributionRef?: string;
}
interface DialogueContributionPickerProps {
  message: DialogueMessageReadModel;
  workItems: DialogueWorkItemOption[];
  contributions: DialogueContributionReadModel[];
  disabled: boolean;
  onClose(): void;
  onSave(selection: DialogueSelection): void;
}
const kinds: Array<{ value: DialogueContributionKind; label: string }> = [
  { value: 'QUESTION', label: '问题' },
  { value: 'HYPOTHESIS', label: '假设' },
  { value: 'CORRECTION', label: '纠正' },
  { value: 'CONSTRAINT', label: '约束' },
  { value: 'CLARIFICATION', label: '澄清' },
];

export const DialogueContributionPicker: FC<
  DialogueContributionPickerProps
> = ({ message, workItems, contributions, disabled, onClose, onSave }) => {
  const [sourcePart, setSourcePart] = useState<'USER' | 'ASSISTANT'>('USER');
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [workItemId, setWorkItemId] = useState(
    message.focus.length === 1 ? message.focus[0].workItemId : '',
  );
  const [kind, setKind] = useState<DialogueContributionKind>('QUESTION');
  const [supersedes, setSupersedes] = useState('none');
  const prior = contributions.filter(
    (item) => item.workItemId === workItemId && item.status === 'ACTIVE',
  );
  const source: string =
    sourcePart === 'USER' ? message.userText : (message.response?.answer ?? '');
  const selected: string | null = selectedDialogueText(
    source,
    selection.start,
    selection.end,
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>保存为私人贡献</DialogTitle>
          <DialogDescription>
            选中原文片段并指定归属。保存不会自动重评、分享或正式采用。
          </DialogDescription>
        </DialogHeader>
        <Select
          value={sourcePart}
          disabled={disabled}
          onValueChange={(value) => {
            setSourcePart(value === 'ASSISTANT' ? 'ASSISTANT' : 'USER');
            setSelection({ start: 0, end: 0 });
          }}
        >
          <SelectTrigger aria-label="片段来源">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="USER">我的输入</SelectItem>
            {message.response?.answer &&
              message.response.status === 'COMPLETED' &&
              !message.response.incomplete && (
                <SelectItem value="ASSISTANT">Aily 回答</SelectItem>
              )}
          </SelectContent>
        </Select>
        <Textarea
          aria-label="请在原文中选中需要保存的文字"
          readOnly
          value={source}
          className="min-h-48"
          onSelect={(event) =>
            setSelection(
              dialogueSourceSelection(
                source,
                event.currentTarget.selectionStart,
                event.currentTarget.selectionEnd,
              ),
            )
          }
        />
        <p className="whitespace-pre-wrap break-words text-sm" role="status">
          {selected || '尚未选择有效片段'}
        </p>
        <Select
          value={workItemId}
          disabled={disabled}
          onValueChange={(value) => {
            setWorkItemId(value);
            setSupersedes('none');
          }}
        >
          <SelectTrigger aria-label="贡献归属资料">
            <SelectValue placeholder="选择归属资料" />
          </SelectTrigger>
          <SelectContent>
            {workItems.map((item) => (
              <SelectItem key={item.workItemId} value={item.workItemId}>
                {item.label}
                {item.description ? ` · ${item.description}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={kind}
          disabled={disabled}
          onValueChange={(value) => {
            const next = kinds.find((item) => item.value === value);
            if (next) setKind(next.value);
            setSupersedes('none');
          }}
        >
          <SelectTrigger aria-label="贡献类型">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {kinds.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {kind === 'CORRECTION' && (
          <Select
            value={supersedes}
            disabled={disabled}
            onValueChange={setSupersedes}
          >
            <SelectTrigger aria-label="替代此前前提">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">不替代此前贡献</SelectItem>
              {prior.map((item) => (
                <SelectItem
                  key={item.contributionRef}
                  value={item.contributionRef}
                >
                  {item.selectedText.slice(0, 100)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {kind === 'CORRECTION' && supersedes !== 'none' && (
          <p className="text-xs">
            保存时撤回所选旧前提，并建立替代关系；不会撤销已经使用旧前提的评估。
            原前提：
            {
              prior.find((item) => item.contributionRef === supersedes)
                ?.selectedText
            }
          </p>
        )}
        <Button
          disabled={
            disabled ||
            !selected ||
            (kind === 'CORRECTION' &&
              supersedes !== 'none' &&
              !prior.some((item) => item.contributionRef === supersedes)) ||
            !workItems.some((item) => item.workItemId === workItemId)
          }
          onClick={() =>
            onSave({
              messageRef: message.messageRef,
              sourcePart,
              selection,
              workItemId,
              kind,
              ...(kind === 'CORRECTION' &&
              prior.some((item) => item.contributionRef === supersedes)
                ? { supersedesContributionRef: supersedes }
                : {}),
            })
          }
        >
          保存私人贡献
        </Button>
      </DialogContent>
    </Dialog>
  );
};
