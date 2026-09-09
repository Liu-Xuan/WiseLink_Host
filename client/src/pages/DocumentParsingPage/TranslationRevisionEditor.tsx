import { useState } from 'react';
import { Button } from '@client/src/components/ui/button';
import { Textarea } from '@client/src/components/ui/textarea';
import { Checkbox } from '@client/src/components/ui/checkbox';
import {
  getCanonicalHostClientSessionGeneration,
  readTranslationRevisions,
  saveTranslationRevision,
  type CanonicalHostClientError,
} from '@client/src/api/canonical-host';
import type {
  TranslationBlockRevisionV2,
  TranslationWorkspaceReadingV2,
} from '@shared/canonical-translation-v2.interface';
import {
  readTranslationDraft,
  writeTranslationDraft,
  type TranslationDraft,
} from './translation-draft-store';

export function TranslationRevisionEditor(props: {
  workItem: { workItemId: string; revision: number };
  workspaceId: string;
  blockId: string;
  onSaved: (reading: TranslationWorkspaceReadingV2) => void;
}) {
  const session: number = getCanonicalHostClientSessionGeneration();
  const scope: string = `${props.workItem.workItemId}:${props.workspaceId}:${props.blockId}`;
  return (
    <RevisionEditor
      key={`${session}:${scope}`}
      {...props}
      session={session}
      scope={scope}
    />
  );
}

function RevisionEditor({
  workItem,
  workspaceId,
  blockId,
  onSaved,
  session,
  scope,
}: Parameters<typeof TranslationRevisionEditor>[0] & {
  session: number;
  scope: string;
}) {
  const [opened, setOpened] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [revisions, setRevisions] = useState<TranslationBlockRevisionV2[]>([]);
  const [draft, setDraft] = useState<TranslationDraft | null>(() =>
    readTranslationDraft(scope),
  );
  const [confirmed, setConfirmed] = useState<boolean>(
    () => readTranslationDraft(scope)?.saveUnconfirmed === true,
  );
  const [message, setMessage] = useState<string>('');
  const saveUnconfirmed: boolean = draft?.saveUnconfirmed === true;
  const base = revisions.find(
    (revision) => revision.blockRevisionId === draft?.baseBlockRevisionId,
  );
  const candidate =
    base && draft
      ? {
          ...base.candidate,
          elements: base.candidate.elements.map((element) => ({
            ...element,
            translatedText:
              draft.texts[element.elementId] ?? element.translatedText,
          })),
        }
      : null;
  const newerAvailable: boolean = Boolean(
    draft &&
    revisions[0] &&
    revisions[0].blockRevisionId !== draft.baseBlockRevisionId,
  );

  function updateDraft(next: TranslationDraft | null): void {
    writeTranslationDraft(scope, next, session);
    setDraft(next);
  }
  function startDraft(revision: TranslationBlockRevisionV2): void {
    updateDraft({
      baseBlockRevisionId: revision.blockRevisionId,
      expectedRowVersion: revision.rowVersion,
      expectedWorkItemRevision: workItem.revision,
      requestId: crypto.randomUUID(),
      saveUnconfirmed: false,
      texts: Object.fromEntries(
        revision.candidate.elements.map((element) => [
          element.elementId,
          element.translatedText,
        ]),
      ),
    });
    setConfirmed(false);
  }
  async function open(): Promise<void> {
    setBusy(true);
    setMessage('');
    try {
      const result = await readTranslationRevisions(
        workItem.workItemId,
        workspaceId,
      );
      const blocks = result.revisions
        .filter((item) => item.blockId === blockId)
        .sort((a, b) => b.contentRevision - a.contentRevision);
      if (session !== getCanonicalHostClientSessionGeneration()) return;
      setRevisions(blocks);
      if (!draft && blocks[0]) startDraft(blocks[0]);
      setOpened(true);
      if (draft)
        setMessage(
          '已重新读取版本；你的草稿和原保存请求均已保留，未被新正文覆盖。',
        );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `读取修订失败：${error.message}`
          : '读取修订记录失败，请重试。',
      );
    } finally {
      setBusy(false);
    }
  }
  async function save(): Promise<void> {
    if (!draft || !candidate || !confirmed) return;
    setBusy(true);
    setMessage('');
    updateDraft({ ...draft, saveUnconfirmed: true });
    try {
      const result = await saveTranslationRevision(workItem.workItemId, {
        requestId: draft.requestId,
        workspaceId,
        expectedWorkItemRevision: draft.expectedWorkItemRevision,
        baseBlockRevisionId: draft.baseBlockRevisionId,
        expectedRowVersion: draft.expectedRowVersion,
        candidate,
        confirmedSourceReview: true,
      });
      if (session !== getCanonicalHostClientSessionGeneration()) return;
      setRevisions(
        result.revisions
          .filter((item) => item.blockId === blockId)
          .sort((a, b) => b.contentRevision - a.contentRevision),
      );
      updateDraft(null);
      setConfirmed(false);
      onSaved(result.reading);
      setMessage(
        result.revision.selectedForReading
          ? '工程师修订候选已保存并可读。原版本保留，不构成正式采用。'
          : result.revision.check?.issues.some(
                (issue) => issue.severity === 'BLOCK',
              )
            ? `修订已保存，仍需处理：${result.revision.check.issues
                .filter((issue) => issue.severity === 'BLOCK')
                .map((issue) => issue.message)
                .join('；')}`
            : '修订已保存，检查完成前继续显示原可读版本。',
      );
    } catch (error) {
      const failure = error as CanonicalHostClientError;
      const known: boolean = [400, 401, 403, 404, 409].includes(
        failure.statusCode ?? 0,
      );
      updateDraft({ ...draft, saveUnconfirmed: !known });
      setMessage(
        known
          ? `保存未通过：${failure.message}。草稿保留；重新读取只核对版本，不覆盖你的修改。`
          : '保存结果未确认。请核对同一保存请求，确认之前不要改写或重新生成；你的草稿仍保留。',
      );
    } finally {
      setBusy(false);
    }
  }
  async function copyDraft(): Promise<void> {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(
        `人工修订草稿 · 尚未保存\n基于 ${draft.baseBlockRevisionId}\n${Object.values(draft.texts).join('\n\n')}`,
      );
      setMessage('已复制草稿及其基础版本。');
    } catch {
      setMessage('复制失败，草稿仍保留，可手动选择文字。');
    }
  }
  return (
    <div className="wl-translation-editor">
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => (opened ? setOpened(false) : void open())}
      >
        {opened
          ? '收起修订与版本'
          : draft
            ? '继续未保存的修订'
            : '修订译文 / 查看版本'}
      </Button>
      {message ? <p role="status">{message}</p> : null}
      {opened ? (
        <div>
          {newerAvailable ? (
            <p role="alert">
              已有更新正文。当前草稿仍绑定原版本，不能直接覆盖新内容；请先核对差异。
            </p>
          ) : null}
          {candidate && draft ? (
            <>
              <p>
                修订整个语义范围，保留其全部条件、数值、表头与脚注。补充解释不应加入忠实译文。
              </p>
              {candidate.elements.map((element, index) => (
                <label key={element.elementId}>
                  译文 {index + 1}
                  <Textarea
                    value={element.translatedText}
                    disabled={busy || saveUnconfirmed}
                    rows={Math.min(
                      12,
                      Math.max(
                        3,
                        Math.ceil(element.translatedText.length / 60),
                      ),
                    )}
                    onChange={(event) => {
                      updateDraft({
                        ...draft,
                        texts: {
                          ...draft.texts,
                          [element.elementId]: event.target.value,
                        },
                        requestId: crypto.randomUUID(),
                      });
                      setConfirmed(false);
                    }}
                  />
                </label>
              ))}
              <label className="wl-translation-editor-confirm">
                <Checkbox
                  checked={confirmed}
                  disabled={busy || saveUnconfirmed}
                  onCheckedChange={(value) => setConfirmed(value === true)}
                />
                已核对该语义范围的全部原文、条件、数值和来源对应
              </label>
              <div className="wl-bilingual-actions">
                <Button
                  disabled={
                    busy ||
                    !confirmed ||
                    candidate.elements.some(
                      (element) => !element.translatedText.trim(),
                    )
                  }
                  onClick={() => void save()}
                >
                  {saveUnconfirmed ? '核对同一保存请求' : '保存人工修订候选'}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void copyDraft()}
                >
                  复制草稿
                </Button>
              </div>
            </>
          ) : draft ? (
            <>
              <p role="alert">
                草稿的基础正文未能读回。不会将草稿套到其他版本；仍可复制保留的修改。
              </p>
              <Button variant="outline" onClick={() => void copyDraft()}>
                复制保留的草稿
              </Button>
            </>
          ) : (
            <p>
              {revisions.length
                ? '已保存。可选择最新版本开始下一次修订。'
                : '此范围尚无已保存正文，不能凭空添加人工译文。'}
            </p>
          )}
          <div className="wl-bilingual-actions">
            <Button variant="ghost" disabled={busy} onClick={() => void open()}>
              重新读取（保留草稿）
            </Button>
            {revisions[0] && !saveUnconfirmed ? (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => startDraft(revisions[0])}
              >
                {draft
                  ? '放弃此草稿，从最新版本重新编辑'
                  : '从最新版本开始修订'}
              </Button>
            ) : null}
          </div>
          <details>
            <summary>历史版本（{revisions.length}）</summary>
            {revisions.map((revision) => (
              <section key={revision.blockRevisionId}>
                <p>
                  版本 {revision.contentRevision} ·{' '}
                  {revision.provenance.authorKind === 'ENGINEER'
                    ? '工程师修订'
                    : (revision.provenance.executionModel?.displayName ??
                      revision.provenance.modelVersion ??
                      '平台未报告模型版本')}{' '}
                  · {new Date(revision.savedAt).toLocaleString('zh-CN')}
                  {revision.selectedForReading
                    ? ' · 当前可读'
                    : ' · 非当前可读版本'}
                </p>
                {revision.candidate.elements.map((element) => (
                  <p key={element.elementId}>{element.translatedText}</p>
                ))}
                {revision.check?.issues.map((issue, index) => (
                  <p key={index}>{issue.message}</p>
                ))}
              </section>
            ))}
          </details>
        </div>
      ) : null}
    </div>
  );
}
