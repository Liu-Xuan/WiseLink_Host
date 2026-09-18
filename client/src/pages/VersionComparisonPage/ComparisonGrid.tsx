import ComparisonBlock from './ComparisonBlock';
import type { ComparisonBlock as Block } from './index';

interface DocumentVersion {
  id: string;
  version: string;
  blocks: Block[];
}

interface ComparisonGridProps {
  newer: DocumentVersion;
  older: DocumentVersion;
  onOpenReader: (documentId: string) => void;
}

export default function ComparisonGrid({
  newer,
  older,
  onOpenReader,
}: ComparisonGridProps) {
  return (
    <div className="comparison-grid">
      <section className="comparison-column panel">
        <div className="column-header">
          <h2>此前原文 · {older.version}</h2>
          <button
            className="btn btn-sm"
            onClick={() => onOpenReader(older.id)}
          >
            精读当时版本
          </button>
        </div>

        <div className="comparison-prose scroll-region" data-scroll-key="comparison-old">
          {older.blocks.map((block) => {
            const newerBlock = newer.blocks.find((b) => b.id === block.id);
            const hasChanged = newerBlock ? newerBlock.en !== block.en : false;

            return (
              <ComparisonBlock
                key={block.id}
                block={block}
                changed={hasChanged}
                side="old"
              />
            );
          })}
        </div>
      </section>

      <section className="comparison-column panel">
        <div className="column-header">
          <h2>本版原文 · {newer.version}</h2>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => onOpenReader(newer.id)}
          >
            精读本版
          </button>
        </div>

        <div className="comparison-prose scroll-region" data-scroll-key="comparison-new">
          {newer.blocks.map((block) => {
            const olderBlock = older.blocks.find((b) => b.id === block.id);
            const hasChanged = olderBlock ? olderBlock.en !== block.en : true;

            return (
              <ComparisonBlock
                key={block.id}
                block={block}
                changed={hasChanged}
                side="new"
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}
