type Block = Record<string, unknown>;
const METADATA = new Set(['page_header', 'page_footer', 'page_number']);

/** Fix observed pipeline misclassifications without regrouping body paragraphs. */
export function mineruPageFurniture(pages: unknown[]) {
  const metadata = new Set<string>();
  const captionPages = new Map<string, Set<number>>();
  const titlePages = new Map<string, Set<number>>();
  const removedText = new Set<string>();
  const removedCaptions = new Set<string>();
  const blocks = pages.map(page => Array.isArray(page)
    ? page.filter(block => block && typeof block === 'object' && !Array.isArray(block)) as Block[] : []);
  blocks.forEach((page, pageIndex) => page.forEach(block => {
    const text = blockText(block);
    if (METADATA.has(String(block.type)) && text) metadata.add(normalize(text));
    if (top(block, 110) && block.type === 'title') add(titlePages, text, pageIndex);
    if (top(block, 150) && block.type === 'table') add(captionPages, spans(content(block).table_caption), pageIndex);
  }));
  // In the real FTD, the first running header became a table caption and the
  // next one a title. Require both roles on different pages; ordinary repeated
  // section headings alone are not enough to discard text.
  const runningTitles = new Set([...titlePages.keys()].filter(text =>
    captionPages.has(text) && new Set([...titlePages.get(text)!, ...captionPages.get(text)!]).size > 1));

  function omitted(block: Block) {
    const text = blockText(block);
    const key = normalize(text);
    const box = Array.isArray(block.bbox) ? block.bbox : [];
    const marginal = typeof box[1] === 'number' && (box[1] <= 110 || box[1] >= 850);
    // These are publication/legal notices, not engineering warnings or notes.
    const publicationNotice = typeof box[1] === 'number' && box[1] >= 850 &&
      /^(?:[\p{L}\p{N}&.-]+\s+)?PROPRIETARY\b|^COPYRIGHT(?:\s|©)|^EXPORT CONTROLLED\b/iu.test(text.trim());
    const exclude = METADATA.has(String(block.type)) ||
      (block.type === 'paragraph' && (publicationNotice || (marginal && metadata.has(key)))) ||
      (block.type === 'title' && top(block, 110) && runningTitles.has(key));
    if (exclude && key) removedText.add(key);
    return exclude;
  }

  function readingContent(block: Block): Block {
    const value = structuredClone(content(block));
    const caption = normalize(spans(value.table_caption));
    if (block.type === 'table' && top(block, 150) && runningTitles.has(caption)) {
      value.table_caption = [];
      removedText.add(caption);
      removedCaptions.add(caption);
    }
    return value;
  }

  function markdown(value: string) {
    if (!removedText.size) return value;
    // Remove only complete Markdown paragraphs/headings matching excluded
    // source text. Never replace a substring inside a table, code or body text.
    const chunks = value.split(/(\r?\n[ \t]*\r?\n)/);
    for (let index = 0; index < chunks.length; index += 2) {
      // MinerU writes table captions directly above the HTML table, without
      // a blank paragraph separator. Remove that caption line alone.
      const newline = chunks[index].indexOf('\n');
      if (newline !== -1 && removedCaptions.has(normalize(chunks[index].slice(0, newline))) &&
          /^\s*<table(?:\s|>)/i.test(chunks[index].slice(newline + 1))) {
        chunks[index] = chunks[index].slice(newline + 1);
      }
      const key = normalize(chunks[index].replace(/^ {0,3}#{1,6}[ \t]+/, ''));
      if (removedText.has(key)) chunks[index] = '';
    }
    return chunks.join('');
  }
  return { omitted, readingContent, markdown };
}

function content(block: Block): Block {
  return block?.content && typeof block.content === 'object' && !Array.isArray(block.content)
    ? block.content as Block : {};
}
function spans(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.map(span => span && typeof span.content === 'string' ? span.content : '').join('');
}
function blockText(block: Block) {
  const value = content(block);
  return spans(value[`${block.type}_content`] ?? value.paragraph_content);
}
function normalize(value: string) { return value.normalize('NFKC').replace(/\s+/g, ' ').trim(); }
function top(block: Block, boundary: number) {
  return Array.isArray(block?.bbox) && typeof block.bbox[1] === 'number' && block.bbox[1] <= boundary;
}
function add(map: Map<string, Set<number>>, value: string, page: number) {
  const key = normalize(value);
  if (!key) return;
  if (!map.has(key)) map.set(key, new Set());
  map.get(key)!.add(page);
}
