import { useState, type ReactNode } from 'react';
import { FileText, Link2, Paperclip } from 'lucide-react';
import type { ReviewTurnReadModel } from '@shared/api.interface';
import { reviewSourceRefLabel } from './continuous-review-state';
import {
  reviewMaterialReferences,
  type ReviewPrimaryMaterial,
} from './review-materials';
import './review-materials.css';

export interface ReviewMaterialsContext {
  primary: ReviewPrimaryMaterial;
  onOpenPrimary: () => void;
  related: ReactNode;
}

export default function ReviewMaterialsPanel({
  context,
  turns,
  refreshing,
  onLocateSourceRef,
}: {
  context: ReviewMaterialsContext;
  turns: ReviewTurnReadModel[];
  refreshing: boolean;
  onLocateSourceRef: (sourceRef: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const references = reviewMaterialReferences(turns);
  return (
    <details
      className="review-materials"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <strong>本次材料</strong>
        <span>主文件、已保存补充与候选引用</span>
      </summary>
      {open ? (
        <div className="review-materials-body">
          <p className="review-materials-boundary">
            保存、选入、实际读取、候选引用与正式采用分别记录。当前服务尚未返回逐材料的选入、读取和采用回执。
            {refreshing ? ' 正在刷新讨论，已读回记录保留。' : ''}
          </p>
          <article className="review-material-row">
            <FileText aria-hidden="true" />
            <div>
              <h4>{context.primary.title}</h4>
              <p>
                当前评估的主文件
                {context.primary.versionLabel
                  ? ` · ${context.primary.versionLabel}`
                  : ''}
              </p>
              <details>
                <summary>来源版本</summary>
                <p>{context.primary.documentVersionId}</p>
                <p>页面可浏览正文；这不代表系统已在本轮读取全文。</p>
              </details>
            </div>
            <button type="button" onClick={context.onOpenPrimary}>
              浏览主文件
            </button>
          </article>
          <section aria-label="已保存的工程师补充">
            <h4>工程师补充</h4>
            {turns.length ? (
              <details className="review-material-inputs">
                <summary>查看已保存输入 · {turns.length} 个回合</summary>
                {[...turns]
                  .sort((a, b) => a.turnNo - b.turnNo)
                  .map((turn) => (
                    <article key={turn.reviewTurnId}>
                      <strong>
                        回合 {turn.turnNo} · 输入版本 {turn.inputRevision}
                      </strong>
                      <p>{turn.engineerSuppliedInput.text}</p>
                    </article>
                  ))}
              </details>
            ) : (
              <p>尚未读回工程师补充记录。</p>
            )}
            {references.attachments.map((attachment, index) => (
              <article className="review-material-row" key={attachment.ref}>
                <Paperclip aria-hidden="true" />
                <div>
                  <h4>补充附件 {index + 1}</h4>
                  <p>
                    已保存至回合 {attachment.turnNos.join('、')} ·
                    读取回执未返回
                  </p>
                  <details>
                    <summary>附件记录</summary>
                    <p>{attachment.ref}</p>
                    <p>附件名称、来源版本与可定位正文尚未返回。</p>
                  </details>
                </div>
              </article>
            ))}
            {!references.attachments.length ? (
              <p>当前讨论未返回补充附件。</p>
            ) : null}
          </section>
          {context.related}
          <section
            aria-label="候选引用的原文片段"
            className="review-material-citations"
          >
            <h4>候选引用的原文片段</h4>
            {references.citedSources.length ? (
              <>
                <p>
                  以下定位来自已保存候选；它们不表示相同数量的独立资料，也不证明整份资料已读或已采用。
                </p>
                <ul>
                  {references.citedSources.map((source, index) => (
                    <li key={source.sourceRef}>
                      <button
                        type="button"
                        title={source.sourceRef}
                        onClick={() => onLocateSourceRef(source.sourceRef)}
                      >
                        <Link2 aria-hidden="true" />
                        {reviewSourceRefLabel(source.sourceRef, index)}
                      </button>
                      <span>
                        {source.citations
                          .map(
                            (citation) =>
                              `回合 ${citation.turnNo}（版本 ${citation.inputRevision}）`,
                          )
                          .join('、')}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>当前讨论尚未返回候选引用。</p>
            )}
          </section>
        </div>
      ) : null}
    </details>
  );
}
