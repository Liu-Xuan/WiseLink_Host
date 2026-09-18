import { forwardRef } from 'react';
import type { ReaderDocument, ReaderBlock } from './index';

interface ReaderTextPaneProps {
  document: ReaderDocument;
  language: 'en' | 'zh';
  selectedBlockId: string;
  scrollKey: string;
  onScroll: () => void;
  onBlockClick: (blockId: string) => void;
}

interface SourceBlockProps {
  block: ReaderBlock;
  language: 'en' | 'zh';
  active: boolean;
  onSelect: (blockId: string) => void;
}

function SourceBlock({ block, language, active, onSelect }: SourceBlockProps) {
  const isZh = language === 'zh';
  const text = isZh ? block.zh : block.en;
  const title = isZh ? block.zhTitle : block.title;

  return (
    <section
      className={`source-block ${block.kind} ${active ? 'located' : ''}`}
      data-block-id={block.id}
      id={`${language}-${block.id}`}
      onClick={() => onSelect(block.id)}
    >
      <h2>
        {title}
        <button
          className="page-cite"
          onClick={(e) => {
            e.stopPropagation();
            onSelect(block.id);
          }}
        >
          P{block.page + 1}
        </button>
      </h2>

      {text ? (
        <p>{text}</p>
      ) : (
        <div className="notice">本节中文尚未完成，原文可读。</div>
      )}

      {block.kind === 'table' && (
        <table className="source-table">
          <thead>
            <tr>
              {((isZh ? block.zhHeaders : block.headers) || []).map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {((isZh ? block.zhRows : block.rows) || []).map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const ReaderTextPane = forwardRef<HTMLDivElement, ReaderTextPaneProps>(
  (
    {
      document,
      language,
      selectedBlockId,
      scrollKey,
      onScroll,
      onBlockClick,
    },
    ref
  ) => {
    const isZh = language === 'zh';

    return (
      <div className="reader-text-pane panel">
        <div className="pane-title">
          <b>{isZh ? '中文阅读' : '连续结构化原文'}</b>
          <span>
            {isZh ? '完整语义与原文关联' : '源文顺序与完整语义保留'}
          </span>
        </div>

        <div
          className="document-prose scroll-region"
          ref={ref}
          data-scroll-key={scrollKey}
          onScroll={onScroll}
        >
          <div className="document-heading">
            <small>
              {document.familyId} · {document.version}
            </small>
            <h1>{isZh ? document.title : 'Engineering information'}</h1>
            <p>
              {isZh
                ? '完整语义与原文关联'
                : 'Original text · source-linked reading'}
            </p>
          </div>

          {document.blocks.map((block) => (
            <SourceBlock
              key={block.id}
              block={block}
              language={language}
              active={selectedBlockId === block.id}
              onSelect={onBlockClick}
            />
          ))}
        </div>
      </div>
    );
  }
);

ReaderTextPane.displayName = 'ReaderTextPane';

export default ReaderTextPane;
