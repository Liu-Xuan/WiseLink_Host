import type { MineruReaderSource } from '@shared/mineru-reading.interface';

/** Match complete text/resource identities. Repeated content is bound only when every occurrence agrees. */
export function bindMineruReaderSources(
  root: HTMLElement,
  sources: MineruReaderSource[],
  assets: Record<string, string>,
): number {
  root
    .querySelectorAll<HTMLElement>('[data-mineru-source-id]')
    .forEach((node) => {
      delete node.dataset.mineruSourceId;
      if (node.dataset.mineruSourceTabstop === 'true') {
        node.removeAttribute('tabindex');
        delete node.dataset.mineruSourceTabstop;
      }
    });
  const grouped = new Map<
    string,
    { sources: MineruReaderSource[]; nodes: HTMLElement[] }
  >();
  const sourceSignature = (source: MineruReaderSource) => {
    if (source.kind === 'note') return `note:${source.id}`;
    if (source.kind === 'image')
      return source.imagePath &&
        Object.prototype.hasOwnProperty.call(assets, source.imagePath)
        ? `image:${assets[source.imagePath]}`
        : null;
    return `${source.kind}:${JSON.stringify((source.items ?? source.cells ?? [source.text ?? '']).map(normalize))}`;
  };
  for (const source of sources) {
    const signature = sourceSignature(source);
    if (!signature) continue;
    const group = grouped.get(signature) ?? { sources: [], nodes: [] };
    group.sources.push(source);
    grouped.set(signature, group);
  }
  const offer = (signature: string, node: HTMLElement) =>
    grouped.get(signature)?.nodes.push(node);
  root
    .querySelectorAll<HTMLElement>(
      'h1,h2,h3,h4,h5,h6,p,ul,ol,table,img,[data-mineru-note-id],[data-mineru-image-src]',
    )
    .forEach((node) => {
      if (node.dataset.mineruNoteId) {
        offer(`note:${node.dataset.mineruNoteId}`, node);
        return;
      }
      if (node.closest('[data-mineru-note-id]')) return;
      if (node.dataset.mineruImageSrc) {
        offer(`image:${node.dataset.mineruImageSrc}`, node);
        return;
      }
      if (node.closest('[data-mineru-image-src]')) return;
      const tag = node.tagName.toLowerCase();
      if (tag === 'img') {
        offer(`image:${node.getAttribute('src')}`, node);
        return;
      }
      if (tag === 'table') {
        if (node.querySelector('table')) return;
        const cells = [...node.querySelectorAll<HTMLElement>('th,td')].map(
          (cell) => normalize(cell.textContent ?? ''),
        );
        offer(`table:${JSON.stringify(cells)}`, node);
        return;
      }
      if (tag === 'ul' || tag === 'ol') {
        if (node.querySelector('ul,ol')) return;
        const items = [...node.children]
          .filter((child) => child.tagName === 'LI')
          .map((item) => normalize(item.textContent ?? ''));
        offer(`list:${JSON.stringify(items)}`, node);
        return;
      }
      if (node.closest('table,li')) return;
      const kind = tag === 'p' ? 'paragraph' : 'heading';
      offer(
        `${kind}:${JSON.stringify([normalize(node.textContent ?? '')])}`,
        node,
      );
    });
  let bound = 0;
  for (const group of grouped.values()) {
    if (group.sources.length !== group.nodes.length) continue;
    group.sources.forEach((source, index) => {
      const node = group.nodes[index];
      node.dataset.mineruSourceId = source.id;
      if (!node.hasAttribute('tabindex')) {
        node.tabIndex = 0;
        node.dataset.mineruSourceTabstop = 'true';
      }
      bound++;
    });
  }
  return bound;
}
function normalize(text: string) {
  return text.replace(/\s+/gu, ' ').trim();
}
