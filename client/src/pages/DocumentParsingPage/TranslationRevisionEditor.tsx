import { useState } from 'react';
import { Button } from '@client/src/components/ui/button';
import {
  readTranslationRevisions,
  saveTranslationRevision,
} from '@client/src/api/canonical-host';
import type {
  TranslationBlockCandidateV2,
  TranslationBlockRevisionV2,
  TranslationWorkspaceReadingV2,
} from '@shared/canonical-translation-v2.interface';

export function TranslationRevisionEditor({
  workItem,
  workspaceId,
  blockId,
  onSaved,
}: {
  workItem: { workItemId: string; revision: number };
  workspaceId: string;
  blockId: string;
  onSaved: (reading: TranslationWorkspaceReadingV2) => void;
}) {
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revisions, setRevisions] = useState<TranslationBlockRevisionV2[]>([]);
  const [candidate, setCandidate] =
    useState<TranslationBlockCandidateV2 | null>(null);
  const [requestId, setRequestId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  const latest = revisions[0];
  async function open() {
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
      setRevisions(blocks);
      setCandidate(blocks[0] ? structuredClone(blocks[0].candidate) : null);
      setRequestId(crypto.randomUUID());
      setConfirmed(false);
      setOpened(true);
    } catch {
      setMessage('读取修订记录失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!latest || !candidate || !confirmed) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await saveTranslationRevision(workItem.workItemId, {
        requestId,
        workspaceId,
        expectedWorkItemRevision: workItem.revision,
        baseBlockRevisionId: latest.blockRevisionId,
        expectedRowVersion: latest.rowVersion,
        candidate,
        confirmedSourceReview: true,
      });
      setRevisions(
        result.revisions
          .filter((item) => item.blockId === blockId)
          .sort((a, b) => b.contentRevision - a.contentRevision),
      );
      setCandidate(structuredClone(result.revision.candidate));
      setRequestId(crypto.randomUUID());
      setConfirmed(false);
      onSaved(result.reading);
      setMessage(
        result.revision.selectedForReading
          ? '已保存工程师修订候选，原版本仍可查看。'
          : `修订已保存，仍有需处理项：${result.revision.check?.issues
              .filter((issue) => issue.severity === 'BLOCK')
              .map((issue) => issue.message)
              .join('；')}`,
      );
    } catch {
      setMessage(
        '保存未确认。任务运行中或版本已变化时不能覆盖；可重试同一保存，或重新读取后核对。',
      );
    } finally {
      setBusy(false);
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
        {opened ? '收起人工修订' : '查看版本与人工修订'}
      </Button>
      {message ? <p role="status">{message}</p> : null}
      {opened ? (
        <div>
          {candidate ? (
            <>
              <p>
                对照上方原文逐段修改。保存会生成新的阅读候选，不构成工程批准或正式采用。
              </p>
              {candidate.elements.map((element, index) => (
                <label key={element.elementId}>
                  译文 {index + 1}
                  <textarea
                    value={element.translatedText}
                    disabled={busy}
                    rows={Math.min(
                      12,
                      Math.max(
                        3,
                        Math.ceil(element.translatedText.length / 60),
                      ),
                    )}
                    onChange={(event) => {
                      setCandidate({
                        ...candidate,
                        elements: candidate.elements.map((item, i) =>
                          i === index
                            ? { ...item, translatedText: event.target.value }
                            : item,
                        ),
                      });
                      setRequestId(crypto.randomUUID());
                      setConfirmed(false);
                    }}
                  />
                </label>
              ))}
              <label className="wl-translation-editor-confirm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                已核对该块全部原文、条件、数值和来源对应
              </label>
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
                保存人工修订候选
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void open()}
              >
                重新读取
              </Button>
            </>
          ) : (
            <p>该块尚无已保存正文。</p>
          )}
          <details>
            <summary>历史版本（{revisions.length}）</summary>
            {revisions.map((revision) => (
              <section key={revision.blockRevisionId}>
                <p>
                  版本 {revision.contentRevision} ·{' '}
                  {revision.provenance.authorKind === 'ENGINEER'
                    ? '工程师修订'
                    : revision.provenance.modelVersion?.startsWith(
                          'configured-route:',
                        )
                      ? `已选路由：${revision.provenance.executionModel?.displayName ?? revision.provenance.modelVersion.slice('configured-route:'.length)}；平台未报告模型版本`
                      : (revision.provenance.modelVersion ??
                        '平台未报告模型版本')}{' '}
                  · {new Date(revision.savedAt).toLocaleString('zh-CN')}
                  {revision.selectedForReading ? ' · 当前可读' : ''}
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
