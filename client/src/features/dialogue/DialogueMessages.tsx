import type { FC } from 'react';
import type {
  DialogueMessageReadModel,
  DialogueThreadReadModel,
} from '@shared/dialogue.interface';
import { Button } from '@client/src/components/ui/button';
import { dialogueResponseLabel, dialogueAilyError } from './dialogue-state';

interface DialogueMessagesProps {
  thread: DialogueThreadReadModel;
  disabled: boolean;
  onSelect(message: DialogueMessageReadModel): void;
  onResume(message: DialogueMessageReadModel): void;
}
export const DialogueMessages: FC<DialogueMessagesProps> = ({
  thread,
  disabled,
  onSelect,
  onResume,
}) => (
  <div className="space-y-6" aria-label="私人对话记录">
    {!thread.messages.length && (
      <p className="text-sm text-muted-foreground">还没有消息。</p>
    )}
    {thread.messages.map((message) => (
      <article key={message.messageRef} className="space-y-2 border-b pb-4">
        <p className="text-xs text-muted-foreground">
          {message.origin === 'FEISHU_EXCERPT'
            ? '用户提交的飞书片段 · 未验证原始作者或原生消息'
            : '我的输入'}{' '}
          · Host 已保存
        </p>
        {message.originDetails.label && (
          <p className="break-words text-xs">{message.originDetails.label}</p>
        )}
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.userText}
        </p>
        <p className="text-xs text-muted-foreground">
          {dialogueResponseLabel(message)}
        </p>
        {message.response?.answer && (
          <p className="whitespace-pre-wrap break-words text-sm">
            {message.response.answer}
          </p>
        )}
        {message.response?.error && (
          <p role="alert" className="break-words text-sm text-destructive">
            {dialogueAilyError(message.response.error)}
          </p>
        )}
        {!!message.focus.length && (
          <details className="text-xs text-muted-foreground">
            <summary>
              发送时关注 {message.focus.length} 份资料 ·
              工作摘要，不代表全文已读
            </summary>
            {message.focus.map((context) => (
              <div key={context.workItemId} className="space-y-1 py-2">
                <p>
                  {context.documentLabel} · 资料修订 {context.workItemRevision}·
                  工作版本 {context.workingRevision ?? '暂无'}
                </p>
                <p className="break-all">
                  资料版本：{context.documentVersionId}
                </p>
                <p>
                  摘要读取于 {context.readAt} · 判断截至{' '}
                  {context.assessmentAsOf ?? '暂无'}
                </p>
                <p className="whitespace-pre-wrap break-words">
                  {context.summary || '暂无工作摘要'}
                </p>
                {context.openQuestions.map((question, index) => (
                  <p key={index}>待澄清：{question}</p>
                ))}
                <p>
                  当时尚未用于评估的贡献：{context.pendingContributions.length}{' '}
                  条
                </p>
              </div>
            ))}
          </details>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => onSelect(message)}
        >
          选段保存贡献
        </Button>
        {message.purpose === 'CHAT' && !message.response && (
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onResume(message)}
          >
            继续投递已保存消息
          </Button>
        )}
      </article>
    ))}
  </div>
);
