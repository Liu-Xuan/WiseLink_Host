import { useCallback, useEffect, useState } from 'react';
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { getCanonicalLibraryQuicklook } from '@client/src/api/canonical-host';
import { listDialogues } from '@client/src/api/dialogue-directory';
import { PrivateDialoguePanel } from '@client/src/features/dialogue/PrivateDialoguePanel';
import type {
  DialogueThreadSummary,
  DialogueAssessmentResponse,
} from '@shared/dialogue.interface';
import type { DialogueWorkItemOption } from '@client/src/features/dialogue/DialogueContributionPicker';
import { Button } from '@client/src/components/ui/button';
import { OfficialOauthLink } from '@client/src/components/OfficialOauthLink';

export default function DialoguePage() {
  const session = useCurrentUserSession();
  return (
    <DialoguePageContent
      key={`${session.sessionGeneration}:${session.currentUser.user_id ?? ''}`}
    />
  );
}

function DialoguePageContent() {
  const { threadRef } = useParams<{ threadRef: string }>();
  const [params] = useSearchParams();
  const focusId = params.get('workItemId') ?? '';
  const navigate = useNavigate();
  const session = useCurrentUserSession();
  const authenticated =
    session.profileSettled &&
    !session.authenticationRequired &&
    Boolean(session.currentUser.user_id);
  const [threads, setThreads] = useState<DialogueThreadSummary[]>([]);
  const [listError, setListError] = useState('');
  const [listRevision, setListRevision] = useState(0);
  const [before, setBefore] = useState<string>();
  const [more, setMore] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [focusedOption, setFocusedOption] =
    useState<DialogueWorkItemOption | null>(null);
  const [focusError, setFocusError] = useState('');
  const [receipt, setReceipt] = useState<DialogueAssessmentResponse | null>(
    null,
  );
  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController();
    setListLoading(true);
    setListError('');
    void listDialogues(controller.signal, before)
      .then((rows) => {
        if (controller.signal.aborted) return;
        setThreads((previous) =>
          before
            ? [
                ...previous,
                ...rows.filter(
                  (row) =>
                    !previous.some((item) => item.threadRef === row.threadRef),
                ),
              ]
            : rows,
        );
        setMore(rows.length === 50);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setThreads([]);
          setListError(
            reason instanceof Error ? reason.message : '会话列表读取失败',
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setListLoading(false);
      });
    return () => controller.abort();
  }, [authenticated, before, listRevision]);
  useEffect(() => {
    let disposed = false;
    setFocusedOption(null);
    setFocusError('');
    if (authenticated && focusId)
      void getCanonicalLibraryQuicklook(focusId)
        .then(({ document }) => {
          if (!disposed)
            setFocusedOption({
              workItemId: document.workItemId,
              label: `${document.documentCode} · ${document.businessRevision}`,
              documentVersionId: document.documentVersionId,
              createdAt: document.createdAt,
              description: `当前评估 · ${new Date(document.createdAt).toLocaleString()}`,
            });
        })
        .catch(() => {
          if (!disposed)
            setFocusError('指定资料无法读取，请从资料库重新进入。');
        });
    return () => {
      disposed = true;
    };
  }, [authenticated, focusId]);
  const onThreadReady = useCallback(
    (ref: string) => {
      if (ref !== threadRef) {
        setBefore(undefined);
        setListRevision((value) => value + 1);
        navigate(
          `/dialogues/${encodeURIComponent(ref)}${focusId ? `?workItemId=${encodeURIComponent(focusId)}` : ''}`,
          { replace: true },
        );
      }
    },
    [threadRef, focusId, navigate],
  );
  const options: DialogueWorkItemOption[] = focusedOption
    ? [focusedOption]
    : [];
  if (!authenticated)
    return (
      <main className="p-6">
        <h1>开放式对话</h1>
        <p>
          {session.profileSettled
            ? '请连接飞书身份后继续。'
            : '正在确认登录状态…'}
        </p>
        {session.profileSettled ? (
          <Button asChild>
            <OfficialOauthLink>连接飞书身份</OfficialOauthLink>
          </Button>
        ) : null}
      </main>
    );
  return (
    <main className="mx-auto grid w-full max-w-7xl gap-6 p-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="space-y-3">
        <h1 className="text-xl font-semibold">开放式对话</h1>
        <Button asChild>
          <Link to="/dialogues" onClick={() => setReceipt(null)}>
            新建对话
          </Link>
        </Button>
        <p className="text-sm text-muted-foreground">
          开放式对话主要在飞书中与 Aily
          机器人进行。围绕具体文档或事项，请从资料库进入交互复核。这里保留本人已有对话与补充记录。
        </p>
        <Button asChild variant="outline">
          <Link to="/library">打开资料库</Link>
        </Button>
        <nav aria-label="历史对话" className="space-y-2">
          {threads.map((item) => (
            <Link
              key={item.threadRef}
              className="block rounded border p-2 text-sm"
              aria-current={item.threadRef === threadRef ? 'page' : undefined}
              to={`/dialogues/${item.threadRef}`}
              onClick={() => setReceipt(null)}
            >
              {new Date(item.createdAt).toLocaleString()} ·{' '}
              {item.threadRef.slice(0, 6)}
            </Link>
          ))}
        </nav>
        {listError ? <p role="alert">{listError}</p> : null}
        <Button
          variant="outline"
          disabled={listLoading}
          onClick={() => {
            setBefore(undefined);
            setListRevision((value) => value + 1);
          }}
        >
          {listLoading ? '读取中…' : '刷新列表'}
        </Button>
        {more && threads.length ? (
          <Button
            variant="ghost"
            disabled={listLoading}
            onClick={() => setBefore(threads[threads.length - 1].threadRef)}
          >
            更早的会话
          </Button>
        ) : null}
      </aside>
      <section className="min-w-0 space-y-4">
        {focusError ? <p role="alert">{focusError}</p> : null}
        <PrivateDialoguePanel
          threadRef={threadRef}
          workItems={options}
          initialWorkItemIds={focusId ? [focusId] : []}
          onThreadReady={onThreadReady}
          onAssessmentAccepted={setReceipt}
        />
        {receipt ? (
          <p role="status">
            评估更新已提交。
            <Link
              className="underline"
              to={`/work-items/${encodeURIComponent(receipt.workItemId)}/documents?node=review&tab=review`}
            >
              查看执行进度与保存结果
            </Link>
          </p>
        ) : null}
      </section>
    </main>
  );
}
