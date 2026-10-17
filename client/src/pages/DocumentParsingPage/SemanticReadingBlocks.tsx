import { memo } from 'react';
import InitialAnalysisContinueButton from '@client/src/features/review/InitialAnalysisContinueButton';
import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import type {
  TranslationSourceAnchorV2,
  TranslationWorkspaceReadingV2,
} from '@shared/canonical-translation-v2.interface';
import { SemanticBlockContent } from './SemanticBlockContent';
import { TranslationRevisionEditor } from './TranslationRevisionEditor';
import {
  semanticReadingIssues,
  semanticReadingStatusLabels,
  semanticSourceLinks,
  translationIssueOriginLabels,
  type SemanticReadingBlock,
  type SemanticReadingMode,
} from './semantic-reading';

interface SemanticReadingBlockProps {
  block: SemanticReadingBlock;
  anchors: TranslationSourceAnchorV2[];
  isFocused: boolean;
  selectedAnchors: string[];
  nodes: Map<string, HTMLElement>;
  onFocus: (blockId: string | null, ids: string[], scroll?: boolean) => void;
  onSourceRefSelect: (unitId: string, sourceRef: string) => void;
  workItem?: Pick<CanonicalWorkItemProjection, 'workItemId' | 'revision'>;
  workspaceId: string;
  canRequestBlockTranslation?: boolean;
  onRevisionSaved: (reading: TranslationWorkspaceReadingV2) => void;
  onContinuationRequested?: () => void;
}

interface SemanticSingleBlockProps extends SemanticReadingBlockProps {
  mode: SemanticReadingMode;
  onFocusedBlockChange: (blockId: string | null) => void;
  onSelectionChange: (ids: string[]) => void;
  onFeedback: (message: string) => void;
}

// Each row receives only its effective highlight and focus, so other rows can reuse their render.
export const SemanticSingleBlock = memo(function SemanticSingleBlock({
  block, anchors, isFocused, selectedAnchors, nodes, onFocus, onSourceRefSelect,
  workItem, workspaceId, canRequestBlockTranslation, onRevisionSaved,
  onContinuationRequested, mode, onFocusedBlockChange, onSelectionChange, onFeedback,
}: SemanticSingleBlockProps) {
  return (
    <article
      className={`wl-bilingual-block kind-${block.source.kind}${isFocused ? ' is-selected' : ''}`}
      data-semantic-block={block.source.blockId}
      tabIndex={-1}
      ref={(node) => {
        if (node) nodes.set(block.source.blockId, node);
        else nodes.delete(block.source.blockId);
      }}
    >
      <div
        className="wl-semantic-single"
      >
        {mode !== 'translation' ? (
          <div lang="en">
            <SemanticBlockContent
              block={block}
              anchors={anchors}
              original
              selectedAnchors={selectedAnchors}
              onFocus={(ids) => onFocus(block.source.blockId, ids)}
            />
          </div>
        ) : null}
        {mode !== 'original' ? (
          <div lang="zh-CN">
            <SemanticBlockContent
              block={block}
              anchors={anchors}
              original={false}
              selectedAnchors={selectedAnchors}
              onFocus={(ids) => onFocus(block.source.blockId, ids)}
            />
          </div>
        ) : null}
      </div>
      {semanticReadingIssues(block).length ? (
        <ul className="wl-bilingual-issues">
          {semanticReadingIssues(block).map((issue, index) => (
            <li
              key={`${issue.code}-${index}`}
              data-severity={issue.severity}
            >
              <strong>
                {translationIssueOriginLabels[issue.origin]} ·{' '}
                {issue.severity === 'BLOCK'
                  ? '阅读限制'
                  : issue.severity === 'REVIEW'
                    ? '说明'
                    : '提示'}
                ：
              </strong>
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
      <footer>
        <button
          type="button"
          aria-expanded={isFocused}
          onClick={() =>
            isFocused
              ? onFocusedBlockChange(null)
              : onFocus(
                  block.source.blockId,
                  block.source.anchorIds,
                )
          }
        >
          查看来源与修订
        </button>
        {block.selected && isFocused ? (
          <span>
            译文修订 {block.selected.contentRevision}
            {block.selected.provenance.authorKind === 'ENGINEER'
              ? ' · 人工修订候选'
              : ''}
          </span>
        ) : (
          <span>
            {semanticReadingStatusLabels[block.readingStatus]}
          </span>
        )}
      </footer>
      {isFocused ? (
        <div className="wl-semantic-context">
          <p>
            本语义范围对应 {anchors.length}{' '}
            个原文片段；来源位置以实际记录为准。
          </p>
          <div className="wl-bilingual-actions">
            {semanticSourceLinks(anchors).map(
              ({ anchor, ref, label }) => (
                <button
                  type="button"
                  key={ref}
                  onClick={() => {
                    onSelectionChange([anchor.anchorId]);
                    onSourceRefSelect(anchor.sourceUnitId, ref);
                  }}
                >
                  {label}
                </button>
              ),
            )}
          </div>
          {mode === 'translation' ? (
            <div className="wl-semantic-source-context" lang="en">
              <SemanticBlockContent
                block={block}
                anchors={anchors}
                original
                selectedAnchors={selectedAnchors}
                onFocus={onSelectionChange}
              />
            </div>
          ) : null}
          {workItem ? (
            <TranslationRevisionEditor
              workItem={workItem}
              workspaceId={workspaceId}
              blockId={block.source.blockId}
              onSaved={onRevisionSaved}
            />
          ) : null}
          {workItem &&
          canRequestBlockTranslation &&
          !block.source.sourceIssues.some(
            (issue) => issue.severity === 'BLOCK',
          ) ? (
            <InitialAnalysisContinueButton
              workItemId={workItem.workItemId}
              expectedRevision={workItem.revision}
              operation="TRANSLATE"
              blockIds={[block.source.blockId]}
              label="重新翻译此完整语义范围"
              onQueued={() => {
                onFeedback(
                  '局部翻译请求已保存，原可读版本保留到新候选检查通过。',
                );
                onContinuationRequested?.();
              }}
            />
          ) : null}
          <p className="wl-bilingual-scope">
            暂无已保存的译文说明。
          </p>
          {block.selected ? (
            <details>
              <summary>版本来源与检查</summary>
              <p>
                保存：
                {new Date(block.selected.savedAt).toLocaleString(
                  'zh-CN',
                )}{' '}
                · 检查：
                {block.selected.checkedAt
                  ? new Date(block.selected.checkedAt).toLocaleString(
                      'zh-CN',
                    )
                  : '待检查'}
              </p>
              {block.selected.provenance.reusedFrom ? <p>复用此前译文：原文与实际使用的上下文未变化，未重新调用翻译。</p> : null}
              <p>
                {block.selected.provenance.authorKind === 'ENGINEER'
                  ? '工程师修订候选'
                  : block.selected.provenance.producer?.kind === 'OFFICIAL_PLUGIN'
                    ? '官方文档翻译 · 具体模型未报告'
                    : `执行模型：${block.selected.provenance.executionModel?.displayName ?? block.selected.provenance.modelVersion ?? '平台未报告'}`}
              </p>
            </details>
          ) : null}
        </div>
      ) : null}
    </article>
  );
});

interface SemanticPaneBlockProps extends SemanticReadingBlockProps {
  original: boolean;
  anchorNodes: Map<string, Map<string, HTMLElement>>;
}

export const SemanticPaneBlock = memo(function SemanticPaneBlock({
  block, anchors, isFocused, selectedAnchors, nodes, onFocus, onSourceRefSelect,
  workItem, workspaceId, canRequestBlockTranslation, onRevisionSaved,
  onContinuationRequested, original, anchorNodes,
}: SemanticPaneBlockProps) {
  return (
    <article
      className={`wl-bilingual-block kind-${block.source.kind}${isFocused ? ' is-selected' : ''}`}
      data-semantic-block={block.source.blockId}
      tabIndex={-1}
      ref={(node) => {
        if (node) nodes.set(block.source.blockId, node);
        else nodes.delete(block.source.blockId);
      }}
    >
      <SemanticBlockContent
        block={block}
        anchors={anchors}
        original={original}
        selectedAnchors={selectedAnchors}
        onFocus={(ids) => onFocus(block.source.blockId, ids)}
        onAnchorNode={(ids, node) => {
          // Shared anchors have a distinct rendered occurrence in each block.
          const blockId = block.source.blockId;
          let blockAnchors = anchorNodes.get(blockId);
          if (node && !blockAnchors) {
            blockAnchors = new Map<string, HTMLElement>();
            anchorNodes.set(blockId, blockAnchors);
          }
          ids.forEach((id) => {
            if (node) blockAnchors?.set(id, node);
            else blockAnchors?.delete(id);
          });
          if (!blockAnchors?.size) anchorNodes.delete(blockId);
        }}
      />
      {!original && semanticReadingIssues(block).length ? (
        <ul className="wl-bilingual-issues">
          {semanticReadingIssues(block).map((issue, index) => (
            <li key={`${issue.code}-${index}`} data-severity={issue.severity}>
              <strong>{translationIssueOriginLabels[issue.origin]}：</strong>{issue.message}
            </li>
          ))}
        </ul>
      ) : null}
      <footer>
        <button
          type="button"
          aria-expanded={isFocused}
          onClick={() => isFocused ? onFocus(null, []) : onFocus(block.source.blockId, block.source.anchorIds)}
        >
          {isFocused ? '收起来源' : '查看来源'}
        </button>
        <span>{semanticReadingStatusLabels[block.readingStatus]}</span>
      </footer>
      {!original && isFocused ? (
        <div className="wl-semantic-context">
          <p>本语义范围对应 {anchors.length} 个原文片段；来源位置以实际记录为准。</p>
          <div className="wl-bilingual-actions">
            {semanticSourceLinks(anchors).map(({ anchor, ref, label }) => (
              <button
                type="button"
                key={ref}
                onClick={() => onSourceRefSelect(anchor.sourceUnitId, ref)}
              >
                {label}
              </button>
            ))}
          </div>
          {workItem ? (
            <TranslationRevisionEditor
              workItem={workItem}
              workspaceId={workspaceId}
              blockId={block.source.blockId}
              onSaved={onRevisionSaved}
            />
          ) : null}
          {workItem && canRequestBlockTranslation ? (
            <InitialAnalysisContinueButton
              workItemId={workItem.workItemId}
              expectedRevision={workItem.revision}
              operation="TRANSLATE"
              blockIds={[block.source.blockId]}
              label="重新翻译此完整语义范围"
              onQueued={onContinuationRequested}
            />
          ) : null}
        </div>
      ) : null}
    </article>
  );
});
