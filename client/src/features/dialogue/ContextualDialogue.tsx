import { useEffect, useRef, useState } from 'react';
import { initAgentChat, type AgentSDKInstance } from '@lark-apaas/aily-web-sdk';
import { Button } from '@client/src/components/ui/button';
import type { DialogueWorkItemOption } from './DialogueContributionPicker';

// Public embed channel identifier issued by Aily; authentication is handled by
// the native iframe using the existing Feishu-account / self-only channel policy.
const CHANNEL_TOKEN = 'wsk_4pPoq3JOZhcjgo35HjFOd7';

/** Native Aily owns its editor, messages, history, attachments and login. */
export default function ContextualDialogue({
  document,
  documentRevision,
  discussionScope,
}: {
  document: DialogueWorkItemOption;
  documentRevision?: string;
  discussionScope: '文档' | '事项';
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Give each initialization its own node: a late SDK completion must never
    // remove an iframe belonging to the next document or React effect.
    const mount = window.document.createElement('div');
    mount.style.height = '100%';
    root.appendChild(mount);
    let disposed = false;
    let instance: AgentSDKInstance | undefined;
    setError('');
    void initAgentChat(mount, {
      channelToken: CHANNEL_TOKEN,
      customParams: {
        documentLabel: {
          value: document.label,
          desc: '当前主资料名称或编号，仅用于讨论定位，不作为权限或正式证据。',
        },
        documentRevision: {
          value: documentRevision ?? '未提供版本标签',
          desc: '当前资料版本；未提供时不得推断版本。',
        },
        discussionScope: {
          value: discussionScope,
          desc: '当前页面的文档或事项类型。',
        },
      },
    })
      .then(async (next) => {
        if (disposed) await next.destroy();
        else instance = next;
      })
      .catch((reason: unknown) => {
        if (!disposed)
          setError(reason instanceof Error ? reason.message : 'Aily 加载失败');
      });
    return () => {
      disposed = true;
      mount.remove();
      if (instance) void instance.destroy();
    };
  }, [
    document.workItemId,
    document.label,
    documentRevision,
    discussionScope,
    attempt,
  ]);

  return (
    <div className="space-y-2">
      <div
        ref={rootRef}
        className="h-[min(680px,75vh)] min-h-[420px] overflow-hidden rounded-lg border border-border bg-background"
        aria-label="Aily 原生聊天窗口"
      />
      {error && (
        <div role="alert" className="flex items-center gap-3 text-sm">
          <span>{error}</span>
          <Button
            variant="outline"
            onClick={() => setAttempt((value) => value + 1)}
          >
            重新加载
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        讨论资料：{document.label}
        {documentRevision ? ` · ${documentRevision}` : ''}
        。讨论不会自动更新评估。
      </p>
    </div>
  );
}
