import type { ReactNode } from 'react';
import type {
  TranslationReadingElementV2,
  TranslationSourceAnchorV2,
} from '@shared/canonical-translation-v2.interface';
import { SemanticSourceGrid } from './SemanticSourceGrid';
import type { SemanticReadingBlock } from './semantic-reading';

export function SemanticElements({
  elements,
  selectedAnchors,
  onFocus,
}: {
  elements: TranslationReadingElementV2[];
  selectedAnchors: string[];
  onFocus: (ids: string[]) => void;
}) {
  const content: ReactNode[] = [];
  let list: TranslationReadingElementV2[] = [];
  const render = (element: TranslationReadingElementV2) => (
    <button
      type="button"
      onClick={() => onFocus(element.anchorIds)}
      title="显示这段译文的全部来源"
    >
      {element.translatedText}
    </button>
  );
  const className = (element: TranslationReadingElementV2): string =>
    `wl-bilingual-element kind-${element.kind}${element.anchorIds.some((id) => selectedAnchors.includes(id)) ? ' is-highlighted' : ''}`;
  const flushList = (): void => {
    if (!list.length) return;
    content.push(
      <ul key={`list-${list[0].elementId}`} className="wl-semantic-list">
        {list.map((element) => (
          <li key={element.elementId} className={className(element)}>
            {render(element)}
          </li>
        ))}
      </ul>,
    );
    list = [];
  };
  for (const element of elements) {
    if (element.kind === 'list_item') {
      list.push(element);
      continue;
    }
    flushList();
    const Tag =
      element.kind === 'heading'
        ? 'h3'
        : element.kind === 'advisory'
          ? 'aside'
          : 'p';
    content.push(
      <Tag key={element.elementId} className={className(element)}>
        {render(element)}
      </Tag>,
    );
  }
  flushList();
  return <>{content}</>;
}

export function SemanticBlockContent({
  block,
  anchors,
  original,
  selectedAnchors,
  onFocus,
}: {
  block: SemanticReadingBlock;
  anchors: TranslationSourceAnchorV2[];
  original: boolean;
  selectedAnchors: string[];
  onFocus: (ids: string[]) => void;
}) {
  const elements: TranslationReadingElementV2[] =
    block.selected?.candidate.elements ?? [];
  const isGrid: boolean =
    block.source.kind === 'table' &&
    block.source.sourceStructure.some((unit) => unit.payload.layout === 'grid');
  if (!original && !block.selected) {
    return (
      <p className="wl-bilingual-unresolved">
        {block.readingStatus === 'PENDING_CHECK'
          ? '译文已保存，检查完成后在此接续。'
          : block.readingStatus === 'BLOCKED'
            ? '此完整语义范围暂不可读；需处理原因见下方。'
            : '此处待生成，已完成的段落可继续阅读。'}
      </p>
    );
  }
  if (isGrid) {
    const extraAnchors = anchors.filter(
      (anchor) => !anchor.payloadPath.startsWith('/payload/rowGroups/'),
    );
    const extraIds = new Set(extraAnchors.map((anchor) => anchor.anchorId));
    const extraElements = elements.filter((element) =>
      element.anchorIds.some((id) => extraIds.has(id)),
    );
    // Render each reading element once, even when one caption has several anchors.
    return (
      <>
        {original ? (
          <OriginalAnchors
            anchors={extraAnchors}
            selectedAnchors={selectedAnchors}
            onFocus={onFocus}
          />
        ) : (
          <SemanticElements
            elements={extraElements}
            selectedAnchors={selectedAnchors}
            onFocus={onFocus}
          />
        )}
        {block.source.sourceStructure.map((unit) =>
          unit.payload.layout === 'grid' ? (
            <SemanticSourceGrid
              key={unit.sourceUnitId}
              payload={unit.payload}
              sourceUnitId={unit.sourceUnitId}
              anchors={anchors}
              elements={original ? undefined : elements}
              selectedAnchors={selectedAnchors}
              onFocus={onFocus}
            />
          ) : (
            <p key={unit.sourceUnitId} className="wl-bilingual-unresolved">
              该来源结构不属于可显示的网格，请核对原文件。
            </p>
          ),
        )}
      </>
    );
  }
  if (original)
    return anchors.length ? (
      <OriginalAnchors
        anchors={anchors}
        selectedAnchors={selectedAnchors}
        onFocus={onFocus}
        heading={block.source.kind === 'heading'}
      />
    ) : (
      <p className="wl-bilingual-scope">
        此来源没有已提取文字，需查看原文件中的图示或引用。
      </p>
    );
  return elements.length ? (
    <SemanticElements
      elements={elements}
      selectedAnchors={selectedAnchors}
      onFocus={onFocus}
    />
  ) : (
    <p className="wl-bilingual-scope">保留原有结构或引用，无需另译文字。</p>
  );
}

function OriginalAnchors({
  anchors,
  selectedAnchors,
  onFocus,
  heading = false,
}: {
  anchors: TranslationSourceAnchorV2[];
  selectedAnchors: string[];
  onFocus: (ids: string[]) => void;
  heading?: boolean;
}) {
  const Tag = heading ? 'h3' : 'p';
  return (
    <>
      {anchors.map((anchor) => (
        <Tag
          key={anchor.anchorId}
          className={`wl-bilingual-element${selectedAnchors.includes(anchor.anchorId) ? ' is-highlighted' : ''}`}
        >
          <button
            type="button"
            onClick={() => onFocus([anchor.anchorId])}
            title="显示来源对应"
          >
            {anchor.sourceText}
          </button>
        </Tag>
      ))}
    </>
  );
}
