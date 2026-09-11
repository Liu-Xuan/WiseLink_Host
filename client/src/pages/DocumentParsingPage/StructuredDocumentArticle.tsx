import { useState } from 'react';
import { LocateFixed } from 'lucide-react';
import type {
  CanonicalStructuredContentSourceLocator,
  CanonicalStructuredContentUnit,
} from '@shared/api.interface';

interface StructuredDocumentArticleProps {
  units: CanonicalStructuredContentUnit[];
  requestedSourceRef: string;
  onLocateSourceRef: (
    sourceRef: string,
    locator: CanonicalStructuredContentSourceLocator | undefined,
  ) => void;
}

/** Preserve producer paragraph boundaries; page equality does not imply a paragraph. */
export function structuredReadingGroups(
  units: CanonicalStructuredContentUnit[],
): CanonicalStructuredContentUnit[][] {
  return units.map((unit) => [unit]);
}

export function StructuredDocumentArticle({
  units,
  requestedSourceRef,
  onLocateSourceRef,
}: StructuredDocumentArticleProps) {
  const [focusedOrdinal, setFocusedOrdinal] = useState<number | null>(null);
  const selected =
    units.find((unit) => unit.ordinal === focusedOrdinal) ??
    units.find((unit) => unit.sourceRefIds.includes(requestedSourceRef));
  return (
    <>
      <article
        className="structured-document-article"
        aria-label="连续结构化文档"
      >
        {structuredReadingGroups(units).map((group) => {
          const first = group[0];
          const level =
            first.reading?.kind === 'heading' ? first.reading.level : 3;
          const Tag =
            first.displayKind === 'section'
              ? (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const)[
                  Math.min(level, 6) - 1
                ]
              : 'p';
          return (
            <Tag
              key={first.ordinal}
              className={`structured-document-${first.displayKind}`}
              aria-level={
                first.displayKind === 'section' && level > 6 ? level : undefined
              }
            >
              {group.map((unit, index) => (
                <span key={unit.ordinal}>
                  {index > 0 ? ' ' : null}
                  <span
                    id={`structured-unit-${unit.ordinal}`}
                    className={`structured-document-anchor${
                      unit.ordinal === selected?.ordinal ? ' is-selected' : ''
                    }`}
                    tabIndex={0}
                    onFocus={() => setFocusedOrdinal(unit.ordinal)}
                    onClick={() => setFocusedOrdinal(unit.ordinal)}
                    title="点击或聚焦正文查看来源"
                  >
                    {unit.displayText}
                  </span>
                </span>
              ))}
            </Tag>
          );
        })}
      </article>
      {selected ? (
        <aside className="structured-document-source" aria-label="当前段落来源">
          <span>当前段落来源</span>
          {selected.sourceRefIds.length === 0 ? (
            <span>尚无来源定位</span>
          ) : null}
          {selected.sourceRefIds.map((sourceRef, index) => {
            const locator = selected.sourceLocators.find(
              (item) => item.sourceRefId === sourceRef,
            );
            const start = locator?.pageStart;
            const end = locator?.pageEnd;
            const label =
              start == null
                ? `来源 ${index + 1}（页码未提供）`
                : `第 ${start}${end != null && end !== start ? `–${end}` : ''} 页`;
            return (
              <button
                type="button"
                key={sourceRef}
                onClick={() => onLocateSourceRef(sourceRef, locator)}
              >
                <LocateFixed aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </aside>
      ) : null}
    </>
  );
}
