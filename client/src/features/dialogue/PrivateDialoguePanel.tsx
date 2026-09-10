import { Link } from 'react-router-dom';
import { useEffect, useState, type FC } from 'react';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import {
  appendDialogue,
  createDialogue,
  readDialogue,
  saveDialogueContribution,
  withdrawDialogueContribution,
  resumeDialogueMessage,
} from '@client/src/api/dialogues';
import type {
  AppendDialogueMessageRequest,
  DialogueMessagePurpose,
  DialogueMessageReadModel,
  DialogueOrigin,
  DialogueAssessmentResponse,
} from '@shared/dialogue.interface';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Textarea } from '@client/src/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import {
  DialogueContributionPicker,
  type DialogueSelection,
  type DialogueWorkItemOption,
} from './DialogueContributionPicker';
import { DialogueMessages } from './DialogueMessages';
import { usePrivateDialogue } from './usePrivateDialogue';
import { DialogueAssessmentControl } from './DialogueAssessmentControl';
import { dialogueAilyError } from './dialogue-state';
import {
  dialogueFocusOptions,
  restoreDialogueFocus,
  type DialogueFocusState,
} from './dialogue-focus';

export interface PrivateDialoguePanelProps {
  threadRef?: string;
  /** Current Host-authorized search choices; changing them does not change selected focus IDs. */
  workItems: DialogueWorkItemOption[];
  initialWorkItemIds?: string[];
  onThreadReady?(threadRef: string): void;
  onAssessmentAccepted?(result: DialogueAssessmentResponse): void;
}

export const PrivateDialoguePanel: FC<PrivateDialoguePanelProps> = (props) => {
  const session = useCurrentUserSession();
  if (!session.profileSettled) return <p>正在确认登录状态…</p>;
  if (session.authenticationRequired || !session.currentUser.user_id)
    return <p>请登录后读取私人对话。</p>;
  return (
    <PrivateDialogueContent
      key={`${session.sessionGeneration}:${session.currentUser.user_id}:${props.threadRef ?? 'new'}`}
      {...props}
    />
  );
};

const PrivateDialogueContent: FC<PrivateDialoguePanelProps> = ({
  threadRef,
  workItems,
  initialWorkItemIds,
  onThreadReady,
  onAssessmentAccepted,
}) => {
  const state = usePrivateDialogue(threadRef);
  const { thread, busy, error, retry, denied, execute, refresh } = state;
  const [draft, setDraft] = useState('');
  const [purpose, setPurpose] = useState<DialogueMessagePurpose>('CHAT');
  const [origin, setOrigin] = useState<DialogueOrigin>('HOST');
  const [sourceLabel, setSourceLabel] = useState('');
  const [focus, setFocus] = useState<DialogueFocusState>({
    ids: [...new Set(initialWorkItemIds ?? [])].slice(0, 8),
    initialized: !threadRef && initialWorkItemIds !== undefined,
  });
  const [selected, setSelected] = useState<DialogueMessageReadModel | null>(
    null,
  );
  const locked: boolean = busy || Boolean(retry);
  const validFocus: string[] = focus.ids;
  const focusOptions = dialogueFocusOptions(validFocus, workItems, thread);
  useEffect(() => {
    if (thread && !denied)
      setFocus((previous) =>
        restoreDialogueFocus(previous, thread.focusWorkItemIds),
      );
  }, [thread, denied]);
  useEffect(() => {
    if (denied) {
      setDraft('');
      setSourceLabel('');
      setSelected(null);
      setFocus({ ids: [], initialized: true });
    }
  }, [denied]);
  useEffect(() => {
    if (thread) onThreadReady?.(thread.threadRef);
  }, [thread?.threadRef, onThreadReady]);
  useEffect(() => {
    if (
      selected &&
      !thread?.messages.some(
        (message) => message.messageRef === selected.messageRef,
      )
    )
      setSelected(null);
  }, [thread, selected]);
  const start = (): void => {
    const input = { requestId: crypto.randomUUID(), workItemIds: validFocus };
    void execute((signal) => createDialogue(input, signal), { mutation: true });
  };
  const send = (): void => {
    if (!thread || locked || !draft.trim()) return;
    const ref = thread.threadRef;
    const input: AppendDialogueMessageRequest = {
      requestId: crypto.randomUUID(),
      expectedThreadRevision: thread.revision,
      userText: draft,
      workItemIds: validFocus,
      purpose,
      origin,
      ...(origin === 'FEISHU_EXCERPT'
        ? { originDetails: { label: sourceLabel } }
        : {}),
    };
    void execute((signal) => appendDialogue(ref, input, signal), {
      mutation: true,
      done: () => {
        setDraft('');
        setSourceLabel('');
      },
    });
  };
  const save = (selection: DialogueSelection): void => {
    if (!thread || locked) return;
    const ref = thread.threadRef;
    const input = {
      ...selection,
      requestId: crypto.randomUUID(),
      expectedThreadRevision: thread.revision,
    };
    void execute((signal) => saveDialogueContribution(ref, input, signal), {
      mutation: true,
      done: () => setSelected(null),
    });
  };
  if (denied) return <p role="alert">{error}</p>;
  return (
    <section
      className="min-w-0 space-y-4 rounded-lg border bg-background p-4"
      aria-label="私下与 Aily 讨论"
    >
      <header className="space-y-1">
        <h2 className="font-semibold">私下与 Aily 讨论</h2>
        <p className="text-xs text-muted-foreground">
          仅自己可见。普通聊天不会更新工作判断；保存贡献也不代表正式采用。
        </p>
      </header>
      {error && (
        <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>{error}</p>
          {retry && (
            <>
              <p>
                结果尚未确认，其他操作暂时锁定。重试会复用原请求，不会另发一条。
              </p>
              <Button variant="outline" disabled={busy} onClick={retry}>
                重试原请求
              </Button>
            </>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2" aria-label="当前关注资料">
        <span className="text-sm">
          下一条消息关注：
          {validFocus.length ? `${validFocus.length} 份` : '无指定资料'}
        </span>
        {focusOptions.map((item) => (
          <Button
            key={item.workItemId}
            size="sm"
            variant="outline"
            aria-pressed={validFocus.includes(item.workItemId)}
            disabled={
              locked ||
              (!validFocus.includes(item.workItemId) && validFocus.length >= 8)
            }
            onClick={() =>
              setFocus({
                initialized: true,
                ids: validFocus.includes(item.workItemId)
                  ? validFocus.filter((id) => id !== item.workItemId)
                  : [...validFocus, item.workItemId],
              })
            }
          >
            {item.label}
          </Button>
        ))}
      </div>
      {!thread ? (
        <Button disabled={locked || Boolean(threadRef)} onClick={start}>
          开始私人对话
        </Button>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={locked}
              onClick={() => refresh()}
            >
              刷新已保存内容
            </Button>
            {thread.nextMessageCursor && (
              <Button
                variant="ghost"
                size="sm"
                disabled={locked}
                onClick={() => {
                  const ref = thread.threadRef;
                  const cursor = thread.nextMessageCursor!;
                  void execute((signal) => readDialogue(ref, signal, cursor), {
                    older: true,
                  });
                }}
              >
                查看更早一页
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            等待回答时短时自动读取，约两分钟后暂停；可手动刷新，不会重新发送消息。
          </p>
          <DialogueMessages
            thread={thread}
            disabled={locked}
            onSelect={setSelected}
            onResume={(message) => {
              const ref = thread.threadRef;
              void execute(
                (signal) =>
                  resumeDialogueMessage(ref, message.messageRef, signal),
                { mutation: true },
              );
            }}
          />
          {!thread.aily.available && (
            <p role="status" className="text-sm">
              Aily 暂不可用：
              {dialogueAilyError(thread.aily.reason || '服务尚未就绪')}
              。可以仅保存片段，不会切换其他模型。
            </p>
          )}
          {!thread.aily.available &&
          thread.aily.reason === 'USER_REAUTHORIZATION_REQUIRED' ? (
            <Button asChild variant="outline">
              <Link to="/client/oauth/callback">连接飞书身份以使用 Aily</Link>
            </Button>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2">
            <Select
              value={purpose}
              disabled={locked}
              onValueChange={(value) =>
                setPurpose(
                  value === 'CONTRIBUTION_ONLY' ? 'CONTRIBUTION_ONLY' : 'CHAT',
                )
              }
            >
              <SelectTrigger aria-label="消息用途">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CHAT">与 Aily 讨论</SelectItem>
                <SelectItem value="CONTRIBUTION_ONLY">
                  仅保存片段，不调用模型
                </SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={origin}
              disabled={locked}
              onValueChange={(value) => {
                setOrigin(
                  value === 'FEISHU_EXCERPT' ? 'FEISHU_EXCERPT' : 'HOST',
                );
                if (value === 'FEISHU_EXCERPT') setPurpose('CONTRIBUTION_ONLY');
              }}
            >
              <SelectTrigger aria-label="输入来源">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="HOST">我的输入</SelectItem>
                <SelectItem value="FEISHU_EXCERPT">粘贴飞书片段</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {origin === 'FEISHU_EXCERPT' && (
            <Input
              aria-label="飞书片段来源说明（自述）"
              maxLength={200}
              value={sourceLabel}
              disabled={locked}
              onChange={(event) => setSourceLabel(event.target.value)}
              placeholder="来源说明（选填，不作为原始作者证明）"
            />
          )}
          <Textarea
            aria-label="尚未发送的私人输入"
            value={draft}
            maxLength={20000}
            disabled={locked}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="提出问题、补充假设或粘贴需要保留的片段…"
          />
          <Button
            disabled={
              locked ||
              !draft.trim() ||
              (purpose === 'CHAT' && !thread.aily.available)
            }
            onClick={send}
          >
            {busy
              ? '正在处理…'
              : purpose === 'CHAT'
                ? '发送给 Aily'
                : '保存片段'}
          </Button>
          <details className="space-y-3 text-sm">
            <summary>私人贡献（{thread.contributions.length}）</summary>
            {thread.contributions.map((contribution) => (
              <div
                key={contribution.contributionRef}
                className="space-y-1 border-t py-2"
              >
                <p className="whitespace-pre-wrap break-words">
                  {contribution.selectedText}
                </p>
                <p className="text-xs text-muted-foreground">
                  归属：
                  {workItems.find(
                    (item) => item.workItemId === contribution.workItemId,
                  )?.label ?? '关联资料'}{' '}
                  ·{' '}
                  {contribution.status === 'WITHDRAWN'
                    ? '已撤回'
                    : contribution.usedBy.length
                      ? `已用于 ${contribution.usedBy.length} 次评估`
                      : '尚未用于评估'}
                </p>
                {contribution.status === 'ACTIVE' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={locked}
                    onClick={() => {
                      const ref = thread.threadRef;
                      const input = {
                        requestId: crypto.randomUUID(),
                        expectedRevision: contribution.revision,
                      };
                      void execute(
                        (signal) =>
                          withdrawDialogueContribution(
                            ref,
                            contribution.contributionRef,
                            input,
                            signal,
                          ),
                        { mutation: true },
                      );
                    }}
                  >
                    撤回后续使用（不撤销已用评估）
                  </Button>
                )}
              </div>
            ))}
          </details>
          <DialogueAssessmentControl
            thread={thread}
            workItems={workItems}
            disabled={locked}
            error={error}
            hasDraft={Boolean(draft.trim())}
            execute={execute}
            onAccepted={onAssessmentAccepted}
          />
        </>
      )}
      {selected &&
        thread?.messages.some(
          (message) => message.messageRef === selected.messageRef,
        ) && (
          <DialogueContributionPicker
            key={selected.messageRef}
            message={selected}
            contributions={thread.contributions}
            workItems={workItems}
            disabled={locked}
            onClose={() => setSelected(null)}
            onSave={save}
          />
        )}
    </section>
  );
};
