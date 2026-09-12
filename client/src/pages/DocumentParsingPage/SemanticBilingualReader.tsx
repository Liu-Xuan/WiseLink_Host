import { useRef, useState } from 'react';
import { Copy, Download } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import InitialAnalysisContinueButton from '@client/src/features/review/InitialAnalysisContinueButton';
import type {
  CanonicalInitialAnalysisReadModel,
  CanonicalReaderTranslationProjection,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import type { TranslationWorkspaceReadingV2 } from '@shared/canonical-translation-v2.interface';
import { SemanticBlockContent } from './SemanticBlockContent';
import { LegacyBilingualReader } from './LegacyBilingualReader';
import { TranslationRevisionEditor } from './TranslationRevisionEditor';
import {
  semanticReadingCoverage,
  semanticReadingStatusLabels,
  semanticReadingText,
  semanticSourceLinks,
  translationIssueOriginLabels,
  type SemanticReadingMode,
} from './semantic-reading';
import './semantic-bilingual-reader.css';

interface Props {
  translation: CanonicalReaderTranslationProjection;
  onSourceRefSelect: (unitId: string, sourceRef: string) => void;
  workItem?: Pick<CanonicalWorkItemProjection, 'workItemId' | 'revision'>;
  canRequestBlockTranslation?: boolean;
  initialAnalysis?: CanonicalInitialAnalysisReadModel | null;
  onContinuationRequested?: () => void;
  mode?: SemanticReadingMode;
}

const executionLabels: Record<string, string> = {
  PENDING: '等待开始',
  BUSY: '正在执行',
  REQUESTED: '已请求',
  QUEUED: '排队中',
  RUNNING: '进行中',
  COMMITTING: '正在保存',
  RETRY_SCHEDULED: '等待服务重试',
  SUCCEEDED: '本次执行完成',
  FAILED: '执行中断，已保存内容保留',
  TIMED_OUT: '执行超时，已保存内容保留',
  WAITING_INPUT: '等待补充输入',
  CANCELLED: '已取消',
  CONFLICT: '需核对版本',
};

export function SemanticBilingualReader(props: Props) {
  if (props.translation.status === 'SEMANTIC_READING_AID_AVAILABLE') {
    return (
      <SemanticWorkspaceReader
        key={props.translation.reading.workspaceId}
        {...props}
        reading={props.translation.reading}
      />
    );
  }
  return <LegacyBilingualReader {...props} />;
}

function SemanticWorkspaceReader({
  reading: hostReading,
  mode = 'bilingual',
  ...props
}: Props & { reading: TranslationWorkspaceReadingV2 }) {
  const [selectedAnchors, setSelectedAnchors] = useState<string[]>([]);
  const [focusedBlock, setFocusedBlock] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string>('');
  const [revisedReading, setRevisedReading] =
    useState<TranslationWorkspaceReadingV2 | null>(null);
  const blockNodes = useRef(new Map<string, HTMLElement>());
  const reading: TranslationWorkspaceReadingV2 =
    revisedReading && revisedReading.rowVersion >= hostReading.rowVersion
      ? revisedReading
      : hostReading;
  const view = semanticReadingCoverage(reading);
  const blocks = [...reading.blocks].sort(
    (a, b) => a.source.order - b.source.order,
  );
  const outline = blocks.filter((block) => block.source.kind === 'heading');
  const hasReadable: boolean = blocks.some((block) => block.selected);
  const execution = props.initialAnalysis?.stages.translation;
  const continueAllowed: boolean =
    props.initialAnalysis?.continuationOperations?.includes('TRANSLATE') ===
    true;
  const percentLabel: string =
    view.readablePercent === null
      ? '尚无可计算文字范围'
      : `${Math.floor(view.readablePercent * 10) / 10}% 已登记文字可读`;

  function focusBlock(blockId: string, ids: string[], scroll = false): void {
    setFocusedBlock(blockId);
    setSelectedAnchors(ids);
    if (scroll) {
      blockNodes.current
        .get(blockId)
        ?.scrollIntoView({ block: 'start', behavior: 'auto' });
      blockNodes.current.get(blockId)?.focus({ preventScroll: true });
    }
  }
  async function copyReading(): Promise<void> {
    try {
      await navigator.clipboard.writeText(semanticReadingText(reading));
      setFeedback('已复制完整可读语义范围，包含版本、原文条件及缺项清单。');
    } catch {
      setFeedback('复制未成功，请使用导出或手动选择文字。');
    }
  }
  function exportReading(): void {
    const blob: Blob = new Blob(
      [
        JSON.stringify(
          {
            schemaVersion: 'wiselink.3_1.bilingual_reading_export.v2',
            exportedAt: new Date().toISOString(),
            candidateOnly: true,
            scope: reading.completeness,
            workspaceId: reading.workspaceId,
            rowVersion: reading.rowVersion,
            source: reading.source,
            coverage: reading.coverage,
            anchors: reading.anchors,
            blocks: reading.blocks,
            finalCandidate: reading.finalCandidate,
            readingText: semanticReadingText(reading),
          },
          null,
          2,
        ),
      ],
      { type: 'application/json;charset=utf-8' },
    );
    const url: string = URL.createObjectURL(blob);
    const link: HTMLAnchorElement = document.createElement('a');
    link.href = url;
    link.download = `双语候选-${reading.completeness}-${reading.source.documentVersionId}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setFeedback(
      '已导出当前双语数据，保留版本、整段对应、原表结构、条件和缺项。',
    );
  }
  return (
    <div className={`wl-bilingual-reader mode-${mode}`}>
      <header className="wl-bilingual-toolbar">
        <div className="wl-semantic-progress">
          <strong>{view.scope}</strong>
          <p>{percentLabel}</p>
          {view.readablePercent !== null ? (
            <progress
              max={100}
              value={view.readablePercent}
              aria-label="已登记原文字符的可读覆盖率"
            />
          ) : null}
          <p>
            已保存{' '}
            {reading.coverage.savedSourceCharacters.toLocaleString('zh-CN')} /{' '}
            {reading.coverage.registeredSourceCharacters.toLocaleString(
              'zh-CN',
            )}{' '}
            个原文字符
          </p>
        </div>
        <div className="wl-bilingual-actions">
          {props.workItem && continueAllowed ? (
            <InitialAnalysisContinueButton
              workItemId={props.workItem.workItemId}
              expectedRevision={props.workItem.revision}
              operation="TRANSLATE"
              label={
                reading.coverage.missingBlockCount === 0 &&
                reading.coverage.pendingCheckBlockCount > 0
                  ? '继续未完成检查'
                  : '继续未完成部分'
              }
              onQueued={() => props.onContinuationRequested?.()}
            />
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void copyReading()}
            disabled={!hasReadable}
          >
            <Copy aria-hidden="true" />
            复制
          </Button>
          <Button variant="ghost" size="sm" onClick={exportReading}>
            <Download aria-hidden="true" />
            导出
          </Button>
        </div>
      </header>
      <div className="wl-semantic-state" aria-live="polite">
        <span>{view.delivery}</span>
        {execution ? (
          <span>
            运行：{executionLabels[execution.status] ?? execution.status}
            {execution.terminalCode ? `（${execution.terminalCode}）` : ''}
          </span>
        ) : null}
        <span>仅供阅读与评估参考，尚非正式采用</span>
      </div>
      {feedback ? (
        <p role="status" className="wl-bilingual-scope">
          {feedback}
        </p>
      ) : null}
      {reading.coverage.unresolvedSourceUnitCount > 0 &&
      view.readablePercent === 100 ? (
        <p className="wl-bilingual-scope" role="note">
          文字覆盖率已达 100%，仍有 {reading.coverage.unresolvedSourceUnitCount}{' '}
          个来源单元需处理；不代表全文或图像内容已经完成。
        </p>
      ) : null}
      <div
        className={`wl-semantic-layout${outline.length ? ' has-outline' : ''}`}
      >
        {outline.length ? (
          <nav className="wl-semantic-outline" aria-label="文档章节">
            <span>文档目录</span>
            {outline.map((block) => (
              <button
                type="button"
                key={block.source.blockId}
                aria-current={
                  focusedBlock === block.source.blockId ? 'location' : undefined
                }
                onClick={() =>
                  focusBlock(block.source.blockId, block.source.anchorIds, true)
                }
              >
                {block.selected?.candidate.elements
                  .map((element) => element.translatedText)
                  .join(' ') ||
                  reading.anchors
                    .filter((anchor) =>
                      block.source.anchorIds.includes(anchor.anchorId),
                    )
                    .map((anchor) => anchor.sourceText)
                    .join(' ') ||
                  '无文字标题'}
              </button>
            ))}
            {view.missing.length ? (
              <details>
                <summary>未完成范围（{view.missing.length}）</summary>
                {view.missing.map((block, index) => (
                  <button
                    type="button"
                    key={block.source.blockId}
                    onClick={() =>
                      focusBlock(
                        block.source.blockId,
                        block.source.anchorIds,
                        true,
                      )
                    }
                  >
                    {index + 1}.{' '}
                    {semanticReadingStatusLabels[block.readingStatus]}
                  </button>
                ))}
              </details>
            ) : null}
          </nav>
        ) : null}
        <div
          className="wl-semantic-document"
          aria-label={
            mode === 'original'
              ? '连续原文'
              : mode === 'translation'
                ? '连续中文阅读'
                : '语义对齐的中英对照'
          }
        >
          {blocks.map((block) => {
            const sourceAnchors = reading.anchors.filter((anchor) =>
              block.source.anchorIds.includes(anchor.anchorId),
            );
            const isFocused: boolean = focusedBlock === block.source.blockId;
            return (
              <article
                className={`wl-bilingual-block kind-${block.source.kind}${isFocused ? ' is-selected' : ''}`}
                key={block.source.blockId}
                data-semantic-block={block.source.blockId}
                tabIndex={-1}
                ref={(node) => {
                  if (node) blockNodes.current.set(block.source.blockId, node);
                  else blockNodes.current.delete(block.source.blockId);
                }}
              >
                <div
                  className={
                    mode === 'bilingual'
                      ? 'wl-bilingual-columns'
                      : 'wl-semantic-single'
                  }
                >
                  {mode !== 'translation' ? (
                    <div lang="en">
                      <SemanticBlockContent
                        block={block}
                        anchors={sourceAnchors}
                        original
                        selectedAnchors={selectedAnchors}
                        onFocus={(ids) => focusBlock(block.source.blockId, ids)}
                      />
                    </div>
                  ) : null}
                  {mode !== 'original' ? (
                    <div lang="zh-CN">
                      <SemanticBlockContent
                        block={block}
                        anchors={sourceAnchors}
                        original={false}
                        selectedAnchors={selectedAnchors}
                        onFocus={(ids) => focusBlock(block.source.blockId, ids)}
                      />
                    </div>
                  ) : null}
                </div>
                {block.issues.length ? (
                  <ul className="wl-bilingual-issues">
                    {block.issues.map((issue, index) => (
                      <li
                        key={`${issue.code}-${index}`}
                        data-severity={issue.severity}
                      >
                        <strong>
                          {translationIssueOriginLabels[issue.origin]} ·{' '}
                          {issue.severity === 'BLOCK'
                            ? '需处理'
                            : issue.severity === 'REVIEW'
                              ? '待复核'
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
                        ? setFocusedBlock(null)
                        : focusBlock(
                            block.source.blockId,
                            block.source.anchorIds,
                          )
                    }
                  >
                    查看来源与修订
                  </button>
                  {block.selected ? (
                    <span>
                      正文版本 {block.selected.contentRevision}
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
                      本语义范围对应 {sourceAnchors.length}{' '}
                      个原文片段；来源位置以实际记录为准。
                    </p>
                    <div className="wl-bilingual-actions">
                      {semanticSourceLinks(sourceAnchors).map(
                        ({ anchor, ref, label }) => (
                          <button
                            type="button"
                            key={ref}
                            onClick={() => {
                              setSelectedAnchors([anchor.anchorId]);
                              props.onSourceRefSelect(anchor.sourceUnitId, ref);
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
                          anchors={sourceAnchors}
                          original
                          selectedAnchors={selectedAnchors}
                          onFocus={setSelectedAnchors}
                        />
                      </div>
                    ) : null}
                    {props.workItem ? (
                      <TranslationRevisionEditor
                        workItem={props.workItem}
                        workspaceId={reading.workspaceId}
                        blockId={block.source.blockId}
                        onSaved={setRevisedReading}
                      />
                    ) : null}
                    {props.workItem &&
                    props.canRequestBlockTranslation &&
                    !block.source.sourceIssues.some(
                      (issue) => issue.severity === 'BLOCK',
                    ) ? (
                      <InitialAnalysisContinueButton
                        workItemId={props.workItem.workItemId}
                        expectedRevision={props.workItem.revision}
                        operation="TRANSLATE"
                        blockIds={[block.source.blockId]}
                        label="重新翻译此完整语义范围"
                        onQueued={() => {
                          setFeedback(
                            '局部翻译请求已保存，原可读版本保留到新候选检查通过。',
                          );
                          props.onContinuationRequested?.();
                        }}
                      />
                    ) : null}
                    <p className="wl-bilingual-scope">
                      译文说明尚未接通。补充解释不会写入忠实译文，也不会作为已保存说明。
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
          })}
        </div>
      </div>
    </div>
  );
}
