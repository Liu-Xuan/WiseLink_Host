import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import InitialAnalysisContinueButton from '@client/src/features/review/InitialAnalysisContinueButton';
import type {
  CanonicalInitialAnalysisReadModel,
  CanonicalReaderTranslationProjection,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import type {
  TranslationSourceAnchorV2,
  TranslationWorkspaceReadingV2,
} from '@shared/canonical-translation-v2.interface';
import { SemanticPaneBlock, SemanticSingleBlock } from './SemanticReadingBlocks';
import { indexSemanticReadingAnchors, semanticBlockSelection } from './semantic-reading-index';
import { LegacyBilingualReader } from './LegacyBilingualReader';
import {
  semanticReadingCoverage,
  semanticReadingStatusLabels,
  semanticReadingText,
  semanticReadingExport,
  semanticReadingHeading,
  type SemanticReadingMode,
  type SemanticReadingBlock,
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
  locateRevision?: { revisionId: string; request: number } | null;
}

const NO_ANCHORS: TranslationSourceAnchorV2[] = [];

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
  const bilingualPaneNodes = useRef({
    original: new Map<string, HTMLElement>(),
    translation: new Map<string, HTMLElement>(),
  });
  const bilingualAnchorNodes = useRef({
    original: new Map<string, Map<string, HTMLElement>>(),
    translation: new Map<string, Map<string, HTMLElement>>(),
  });
  const reading: TranslationWorkspaceReadingV2 =
    revisedReading && revisedReading.rowVersion >= hostReading.rowVersion
      ? revisedReading
      : hostReading;
  const { view, blocks, outline, anchorsByBlock, hasReadable } = useMemo(() => {
    const blocks = [...reading.blocks].sort((a, b) => a.source.order - b.source.order);
    return {
      view: semanticReadingCoverage(reading),
      blocks,
      outline: blocks.filter((block) => semanticReadingHeading(block) !== null),
      anchorsByBlock: indexSemanticReadingAnchors(blocks, reading.anchors),
      hasReadable: blocks.some((block) => block.selected),
    };
  }, [reading]);
  const selectedIds = useMemo(() => new Set(selectedAnchors), [selectedAnchors]);
  const execution = props.initialAnalysis?.stages.translation;
  const continueAllowed: boolean =
    props.initialAnalysis?.continuationOperations?.includes('TRANSLATE') ===
    true;
  const percentLabel: string =
    view.readablePercent === null
      ? '尚无可计算文字范围'
      : `${Math.floor(view.readablePercent * 10) / 10}% 的原文已有可读中文`;

  const focusBlock = useCallback((blockId: string | null, ids: string[], scroll = false): void => {
    setFocusedBlock(blockId);
    setSelectedAnchors(ids);
    if (!blockId) return;
    if (scroll) {
      blockNodes.current
        .get(blockId)
        ?.scrollIntoView({ block: 'start', behavior: 'auto' });
      bilingualPaneNodes.current.original
        .get(blockId)
        ?.scrollIntoView({ block: 'start', behavior: 'auto' });
      bilingualPaneNodes.current.translation
        .get(blockId)
        ?.scrollIntoView({ block: 'start', behavior: 'auto' });
      const anchorNode = ids
        .map((id) => bilingualAnchorNodes.current.original.get(blockId)?.get(id) ??
          bilingualAnchorNodes.current.translation.get(blockId)?.get(id))
        .find((node): node is HTMLElement => Boolean(node));
      anchorNode?.scrollIntoView({ block: 'center', behavior: 'auto' });
      blockNodes.current.get(blockId)?.focus({ preventScroll: true });
    }
  }, []);
  const lastLocated = useRef<Props['locateRevision']>(null);
  useEffect(() => {
    if (!props.locateRevision || lastLocated.current === props.locateRevision) return;
    const block = reading.blocks.find(item => item.readingStatus === 'READABLE' &&
      item.selected?.selectedForReading && item.selected.blockRevisionId === props.locateRevision!.revisionId);
    lastLocated.current = props.locateRevision;
    if (block) focusBlock(block.source.blockId, block.source.anchorIds, true);
  }, [props.locateRevision, reading, focusBlock]);
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
          { ...semanticReadingExport(reading), exportedAt: new Date().toISOString() },
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
              aria-label="中文可读覆盖率（按已登记原文字符计）"
            />
          ) : null}
          <p>
            已保存中文覆盖{' '}
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
      </div>
      {feedback ? (
        <p role="status" className="wl-bilingual-scope">
          {feedback}
        </p>
      ) : null}
      {reading.coverage.unresolvedSourceUnitCount > 0 &&
      view.readablePercent === 100 ? (
        <details className="wl-bilingual-scope"><summary>阅读范围</summary>
          <p>文字覆盖率 100%，还有 {reading.coverage.unresolvedSourceUnitCount} 个来源单元待处理。</p>
        </details>
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
                  (anchorsByBlock.get(block) ?? NO_ANCHORS)
                    .map((anchor) => anchor.sourceText)
                    .join(' ') ||
                  '无文字标题'}
                {semanticReadingHeading(block) === 'candidate'
                  ? <small>候选标题 · 层级未知</small> : null}
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
          {mode === 'bilingual' ? (
            <div className="wl-semantic-bilingual-panes">
              <SemanticPane
                side="original"
                blocks={blocks}
                anchorsByBlock={anchorsByBlock}
                selectedIds={selectedIds}
                focusedBlock={focusedBlock}
                selectedAnchors={selectedAnchors}
                nodes={bilingualPaneNodes.current.original}
                anchorNodes={bilingualAnchorNodes.current.original}
                onFocus={focusBlock}
                onSourceRefSelect={props.onSourceRefSelect}
                workItem={props.workItem}
                workspaceId={reading.workspaceId}
                canRequestBlockTranslation={props.canRequestBlockTranslation}
                onRevisionSaved={setRevisedReading}
                onContinuationRequested={props.onContinuationRequested}
              />
              <SemanticPane
                side="translation"
                blocks={blocks}
                anchorsByBlock={anchorsByBlock}
                selectedIds={selectedIds}
                focusedBlock={focusedBlock}
                selectedAnchors={selectedAnchors}
                nodes={bilingualPaneNodes.current.translation}
                anchorNodes={bilingualAnchorNodes.current.translation}
                onFocus={focusBlock}
                onSourceRefSelect={props.onSourceRefSelect}
                workItem={props.workItem}
                workspaceId={reading.workspaceId}
                canRequestBlockTranslation={props.canRequestBlockTranslation}
                onRevisionSaved={setRevisedReading}
                onContinuationRequested={props.onContinuationRequested}
              />
            </div>
          ) : blocks.map((block) => (
            <SemanticSingleBlock
              key={block.source.blockId}
              block={block}
              anchors={anchorsByBlock.get(block) ?? NO_ANCHORS}
              isFocused={focusedBlock === block.source.blockId}
              selectedAnchors={semanticBlockSelection(block, selectedAnchors, selectedIds)}
              nodes={blockNodes.current}
              mode={mode}
              onFocus={focusBlock}
              onFocusedBlockChange={setFocusedBlock}
              onSelectionChange={setSelectedAnchors}
              onSourceRefSelect={props.onSourceRefSelect}
              workItem={props.workItem}
              workspaceId={reading.workspaceId}
              canRequestBlockTranslation={props.canRequestBlockTranslation}
              onRevisionSaved={setRevisedReading}
              onContinuationRequested={props.onContinuationRequested}
              onFeedback={setFeedback}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SemanticPane({
  side, blocks, anchorsByBlock, focusedBlock, selectedAnchors, selectedIds,
  nodes, anchorNodes, onFocus, onSourceRefSelect, workItem, workspaceId,
  canRequestBlockTranslation, onRevisionSaved, onContinuationRequested,
}: {
  side: 'original' | 'translation';
  blocks: SemanticReadingBlock[];
  anchorsByBlock: ReadonlyMap<SemanticReadingBlock, TranslationSourceAnchorV2[]>;
  focusedBlock: string | null;
  selectedAnchors: string[];
  selectedIds: ReadonlySet<string>;
  nodes: Map<string, HTMLElement>;
  anchorNodes: Map<string, Map<string, HTMLElement>>;
  onFocus: (blockId: string | null, ids: string[], scroll?: boolean) => void;
  onSourceRefSelect: (unitId: string, sourceRef: string) => void;
  workItem?: Pick<CanonicalWorkItemProjection, 'workItemId' | 'revision'>;
  workspaceId: string;
  canRequestBlockTranslation?: boolean;
  onRevisionSaved: (reading: TranslationWorkspaceReadingV2) => void;
  onContinuationRequested?: () => void;
}) {
  const original = side === 'original';
  return (
    <section className={`wl-semantic-pane is-${side}`} aria-label={original ? '连续原文' : '连续中文阅读'}>
      <h3 className="wl-semantic-pane-title">{original ? '原文' : '中文'}</h3>
      <div className="wl-semantic-pane-scroll">
        {blocks.map((block) => (
          <SemanticPaneBlock
            key={block.source.blockId}
            block={block}
            anchors={anchorsByBlock.get(block) ?? NO_ANCHORS}
            isFocused={focusedBlock === block.source.blockId}
            selectedAnchors={semanticBlockSelection(block, selectedAnchors, selectedIds)}
            original={original}
            nodes={nodes}
            anchorNodes={anchorNodes}
            onFocus={onFocus}
            onSourceRefSelect={onSourceRefSelect}
            workItem={workItem}
            workspaceId={workspaceId}
            canRequestBlockTranslation={canRequestBlockTranslation}
            onRevisionSaved={onRevisionSaved}
            onContinuationRequested={onContinuationRequested}
          />
        ))}
      </div>
    </section>
  );
}
