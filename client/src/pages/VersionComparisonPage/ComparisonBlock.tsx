import type { ComparisonBlock as Block } from './index';

interface ComparisonBlockProps {
  block: Block;
  changed: boolean;
  side: 'old' | 'new';
}

export default function ComparisonBlock({
  block,
  changed,
  side,
}: ComparisonBlockProps) {
  return (
    <section
      className={`comparison-block ${changed ? `changed ${side}` : ''}`}
      data-block-id={block.id}
    >
      <h3>
        {block.zhTitle}
        {changed && (
          <span className="change-badge">
            {side === 'old' ? '此处有变化' : '对应内容变化'}
          </span>
        )}
      </h3>
      <p className="block-chinese">{block.zh}</p>
      <p className="block-english">{block.en}</p>
    </section>
  );
}
