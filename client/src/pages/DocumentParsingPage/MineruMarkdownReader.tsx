import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type {
  MineruReadingProjection,
  MineruReaderSource,
} from '@shared/mineru-reading.interface';
import { bindMineruReaderSources } from './mineru-reader-bindings';
import { defaultRehypePlugins } from 'streamdown';
import { Streamdown } from '../../components/ui/streamdown';
import './mineru-markdown-reader.css';

export interface MineruMarkdownReaderProps {
  markdown: string;
  /** Bundle image path -> authorized Host resource path, supplied after access checks. */
  assets: Record<string, string>;
  /** Receives only validated bundle paths and authorized same-origin URLs. */
  renderImage?: (image: { path: string; src: string; alt: string }) => React.ReactNode;
  projection?: MineruReadingProjection;
  onLocateSource?: (source: MineruReaderSource) => void;
}
interface Heading {
  id: string;
  text: string;
  level: number;
}

/** Only same-origin Host paths can be substituted for bundle-local images. */
export function mineruImageUrl(
  path: string | undefined,
  assets: Record<string, string>,
) {
  if (
    !path ||
    !/^images\/[a-zA-Z0-9_./-]+$/.test(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  )
    return undefined;
  if (!Object.prototype.hasOwnProperty.call(assets, path)) return undefined;
  const url = assets[path];
  return /^\/(?!\/)/.test(url) && !/[\\\s]/.test(url) ? url : undefined;
}

/** Full Markdown supplies both headings and paragraphs; never re-segment by PDF lines. */
export function MineruMarkdownReader({
  markdown,
  assets,
  renderImage,
  projection,
  onLocateSource,
}: MineruMarkdownReaderProps) {
  const prefix = useId();
  const articleRef = useRef<HTMLElement>(null);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState('');
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [boundSourceCount, setBoundSourceCount] = useState(0);
  const selectedSource = projection?.sources.find(
    (source) => source.id === selectedSourceId,
  );
  const components = useMemo(
    () => ({
      img: ({ src, alt }: { src?: string; alt?: string }) => {
        const url = mineruImageUrl(src, assets);
        return url ? (
          <span data-mineru-image-src={url}>
            {renderImage ? renderImage({ path: src!, src: url, alt: alt || '文档图片' }) :
              <img src={url} alt={alt || '文档图片'} loading="lazy" />}
          </span>
        ) : (
          <span role="status" className="mineru-image-unavailable">
            图片暂不可用{alt ? `：${alt}` : ''}
          </span>
        );
      },
      a: ({ href, children }: { href?: string; children?: React.ReactNode }) =>
        href && /^https?:\/\//i.test(href) ? (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ) : (
          <span>{children}</span>
        ),
      pre: ({ children }: { children?: React.ReactNode }) => (
        <pre>{children}</pre>
      ),
      // Document code stays literal, including code labelled mermaid.
      code: ({ children }: { children?: React.ReactNode }) => (
        <code>{children}</code>
      ),
    }),
    [assets, renderImage],
  );

  useEffect(() => {
    const root = articleRef.current;
    if (!root) return;
    const elements = [
      ...root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'),
    ];
    const entries = elements.map((element, index) => {
      element.id = `${prefix}-heading-${index}`;
      element.tabIndex = -1;
      return {
        id: element.id,
        text: element.textContent || '',
        level: Number(element.tagName.slice(1)),
      };
    });
    setHeadings(entries);
    setActive(entries[0]?.id || '');
    const scrollRoot = root.closest<HTMLElement>('.mineru-reading-body');
    if (!scrollRoot) return;
    let frame = 0;
    const updateActive = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = scrollRoot.getBoundingClientRect().top + 40;
        let current = elements[0];
        for (const element of elements) {
          if (element.getBoundingClientRect().top <= top) current = element;
        }
        if (
          scrollRoot.scrollHeight > scrollRoot.clientHeight &&
          scrollRoot.scrollHeight -
            scrollRoot.clientHeight -
            scrollRoot.scrollTop <
            4
        )
          current = elements.at(-1);
        if (current) setActive(current.id);
      });
    };
    scrollRoot.addEventListener('scroll', updateActive, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scrollRoot.removeEventListener('scroll', updateActive);
    };
  }, [markdown, prefix]);

  useEffect(() => {
    const root = articleRef.current;
    if (root)
      setBoundSourceCount(
        bindMineruReaderSources(root, projection?.sources ?? [], assets),
      );
    setSelectedSourceId('');
  }, [markdown, projection, assets, renderImage]);

  const selectSource = (target: EventTarget) => {
    if (!(target instanceof Element)) return;
    const node = target.closest<HTMLElement>('[data-mineru-source-id]');
    if (node && articleRef.current?.contains(node))
      setSelectedSourceId(node.dataset.mineruSourceId ?? '');
  };

  const outline = (
    <nav aria-label="文档目录">
      {headings.length ? (
        headings.map((heading) => (
          <button
            key={heading.id}
            type="button"
            aria-current={active === heading.id ? 'location' : undefined}
            style={{ paddingInlineStart: `${12 + (heading.level - 1) * 14}px` }}
            onClick={() => {
              const element = articleRef.current?.ownerDocument.getElementById(
                heading.id,
              );
              element?.scrollIntoView({ block: 'start', behavior: 'smooth' });
              element?.focus({ preventScroll: true });
              setActive(heading.id);
            }}
          >
            {heading.text}
          </button>
        ))
      ) : (
        <p>文档未提供标题目录。</p>
      )}
    </nav>
  );

  return (
    <section className="mineru-reading-workspace" aria-label="文档阅读">
      <aside className="mineru-reading-outline">
        <strong>目录</strong>
        {outline}
      </aside>
      <div className="mineru-reading-body">
        <details className="mineru-reading-mobile-outline">
          <summary>目录</summary>
          {outline}
        </details>
        <article
          ref={articleRef}
          className="mineru-reading-article"
          onClick={(event) => selectSource(event.target)}
          onFocus={(event) => selectSource(event.target)}
        >
          <Streamdown
            rehypePlugins={[
              defaultRehypePlugins.raw,
              defaultRehypePlugins.sanitize,
              defaultRehypePlugins.katex,
            ]}
            mode="static"
            parseIncompleteMarkdown={false}
            controls={false}
            parseMarkdownIntoBlocksFn={(text) => [text]}
            components={components}
          >
            {markdown}
          </Streamdown>
          {projection?.notes.length ? (
            <section className="mineru-reading-notes" aria-label="文档注释">
              <strong>注释</strong>
              {projection.notes.map((note) => (
                <p key={note.id} data-mineru-note-id={note.id}>
                  {note.text}
                </p>
              ))}
            </section>
          ) : null}
        </article>
        {projection ? (
          <aside className="mineru-source-actions" aria-label="原文定位">
            <span>
              {selectedSource ? '已选中正文内容' : '选择正文查看原文位置'}
            </span>
            {selectedSource ? (
              <button
                type="button"
                disabled={!onLocateSource}
                onClick={() => onLocateSource?.(selectedSource)}
              >
                查看原文
              </button>
            ) : null}
            {boundSourceCount < projection.sources.length ? (
              <small>部分内容尚无精确定位。</small>
            ) : null}
            {projection.issues.some(issue => issue.blockId === selectedSource?.blockId) ? (
              <small>此内容需对照原文核对。</small>
            ) : projection.issues.length ? (
              <small>部分表格或图片内容需对照原文核对。</small>
            ) : null}
          </aside>
        ) : null}
      </div>
    </section>
  );
}
