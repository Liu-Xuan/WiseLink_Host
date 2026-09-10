import { useEffect, useState } from 'react';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { listDialogues } from '@client/src/api/dialogue-directory';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import { Button } from '@client/src/components/ui/button';
import { PrivateDialoguePanel } from './PrivateDialoguePanel';
import type { DialogueThreadSummary } from '@shared/dialogue.interface';
import type { DialogueWorkItemOption } from './DialogueContributionPicker';

/** Reuse the authenticated dialogue and contribution flow within the current document. */
export default function ContextualDialogue({
  document,
  assessmentEnabled = true,
}: {
  document: DialogueWorkItemOption;
  assessmentEnabled?: boolean;
}) {
  const session = useCurrentUserSession();
  const [threads, setThreads] = useState<DialogueThreadSummary[]>([]);
  const [threadRef, setThreadRef] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void listDialogues(controller.signal, undefined, document.workItemId)
      .then((rows) => {
        if (controller.signal.aborted) return;
        setThreads(rows);
        setThreadRef(rows[0]?.threadRef);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : '对话读取失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [document.workItemId, session.sessionGeneration, revision]);
  if (loading) return <p role="status">正在读取此资料的对话…</p>;
  if (error)
    return (
      <div role="alert">
        <p>{error}</p>
        <Button onClick={() => setRevision((value) => value + 1)}>
          重新读取
        </Button>
      </div>
    );
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        可在飞书 Aily
        中开展开放式对话，也可在这里围绕当前资料提问或保存飞书片段。
      </p>
      {threads.length > 1 && (
        <Select value={threadRef} onValueChange={setThreadRef}>
          <SelectTrigger aria-label="此资料的对话记录">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {threads.map((thread) => (
              <SelectItem key={thread.threadRef} value={thread.threadRef}>
                {new Date(thread.createdAt).toLocaleString()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {!assessmentEnabled && (
        <p className="text-sm text-muted-foreground">
          这里讨论事项关联的主资料；事项评估请使用本页的更新评估操作。
        </p>
      )}
      <PrivateDialoguePanel
        threadRef={threadRef}
        workItems={[document]}
        initialWorkItemIds={[document.workItemId]}
        contextual
        assessmentEnabled={assessmentEnabled}
        onThreadReady={setThreadRef}
      />
    </div>
  );
}
