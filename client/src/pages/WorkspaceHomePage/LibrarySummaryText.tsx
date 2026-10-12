import { useState } from 'react';

/** Expand the same saved text in place; no new reading or analysis request. */
export function LibrarySummaryText({ text, expandable = true }: { text: string; expandable?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  return <div className={`suite-library-summary${expandable && !expanded ? ' is-folded' : ''}`}>
    <p className={expanded || !expandable ? 'is-expanded' : undefined}>{text}</p>
    {expandable ? <button type="button" aria-expanded={expanded} aria-label={expanded ? '收起摘要' : '展开摘要'}
      onClick={event => { event.stopPropagation(); setExpanded(value => !value); }}>
      {expanded ? '收起' : '展开'}
    </button> : null}
  </div>;
}
