/** MinerU artifact reading; no font inference, paragraph regrouping or model calls. */
import { mineruPageFurniture } from './mineru-page-furniture';
type JsonObject = Record<string, unknown>;
export type MineruBox = readonly [number, number, number, number];

export interface MineruReadingBlock {
  id: string;
  pageIndex: number;
  type: string;
  /** Coordinates from content_list_v2, top-left, 0..1000. */
  bbox: MineruBox | null;
  headingLevel: number | null;
  /** Retain structured spans, tables and captions, not stringified objects. */
  content: JsonObject;
  assetPath: string | null;
  sourcePointer: string;
}

export interface MineruDocumentArtifacts {
  version: string;
  backend: string;
  markdown: string;
  pages: Array<{
    pageIndex: number;
    width: number;
    height: number;
    middlePointer: string;
  }>;
  blocks: MineruReadingBlock[];
  discardedBlocks: MineruReadingBlock[];
  /** Original middle spans/lines remain available for precise source mapping. */
  middle: JsonObject;
  diagnostics: Array<{ code: string; blockId: string }>;
}

const AUXILIARY = new Set(['page_aside_text', 'page_footnote']);
const TYPES = new Set([
  'title',
  'paragraph',
  'image',
  'table',
  'chart',
  'equation_interline',
  'list',
  'code',
  'algorithm',
]);

/** v2 is an array of pages, each containing blocks; v1 is not coerced into v2. */
export function readMineruArtifacts(input: {
  markdown: string;
  contentListV2: unknown;
  middle: unknown;
  assetPaths: readonly string[];
}): MineruDocumentArtifacts {
  const middle = object(input.middle, 'middle');
  const version = nonempty(middle._version_name, 'middle._version_name');
  if (version !== '3.4.5') {
    throw new Error(`MINERU_VERSION_UNSUPPORTED:${version}`);
  }
  if (typeof input.markdown !== 'string' || !input.markdown.trim()) {
    throw new Error('MINERU_MARKDOWN_EMPTY');
  }
  const pageInfo = array(middle.pdf_info, 'middle.pdf_info');
  const pageBlocks = array(input.contentListV2, 'content_list_v2');
  if (!pageInfo.length || pageBlocks.length !== pageInfo.length) {
    throw new Error('MINERU_PAGE_COUNT_MISMATCH');
  }
  const assets = new Set(input.assetPaths.map(safeMineruAssetPath));
  const furniture = mineruPageFurniture(pageBlocks);
  const document: MineruDocumentArtifacts = {
    version,
    backend: nonempty(middle._backend, 'middle._backend'),
    markdown: input.markdown,
    pages: [],
    blocks: [],
    discardedBlocks: [],
    middle: structuredClone(middle),
    diagnostics: [],
  };
  pageInfo.forEach((rawPage, pageIndex) => {
    const page = object(rawPage, `middle.pdf_info[${pageIndex}]`);
    const dimensions = array(page.page_size, 'page_size');
    if (
      page.page_idx !== pageIndex ||
      dimensions.length !== 2 ||
      !dimensions.every(
        (value) =>
          typeof value === 'number' && Number.isFinite(value) && value > 0,
      )
    ) {
      throw new Error(`MINERU_PAGE_GEOMETRY_INVALID:${pageIndex}`);
    }
    document.pages.push({
      pageIndex,
      width: Number(dimensions[0]),
      height: Number(dimensions[1]),
      middlePointer: `/pdf_info/${pageIndex}`,
    });
    array(pageBlocks[pageIndex], `content_list_v2[${pageIndex}]`).forEach(
      (rawBlock, blockIndex) => {
        const block = object(rawBlock, 'content_list_v2.block');
        const type = nonempty(block.type, 'block.type');
        if (furniture.omitted(block)) return;
        const content = object(block.content, 'block.content');
        const id = `page-${pageIndex + 1}-block-${blockIndex + 1}`;
        let headingLevel: number | null = null;
        if (type === 'title') {
          const level = content.level;
          if (
            typeof level !== 'number' ||
            !Number.isSafeInteger(level) ||
            level < 1
          ) {
            throw new Error(`MINERU_HEADING_LEVEL_INVALID:${id}`);
          }
          headingLevel = level;
        }
        const bbox = box(block.bbox);
        if (!bbox)
          document.diagnostics.push({ code: 'BBOX_UNAVAILABLE', blockId: id });
        if (!TYPES.has(type) && !AUXILIARY.has(type)) {
          document.diagnostics.push({
            code: 'UNSUPPORTED_BLOCK_TYPE',
            blockId: id,
          });
        }
        let assetPath: string | null = null;
        if (content.image_source !== undefined) {
          const image = object(content.image_source, 'image_source');
          if (
            image.path &&
            image.path !== 'images/' &&
            image.path !== 'images/None'
          ) {
            assetPath = safeMineruAssetPath(
              nonempty(image.path, 'image_source.path'),
            );
            if (!assets.has(assetPath))
              throw new Error(`MINERU_ASSET_MISSING:${assetPath}`);
          }
        }
        const normalized: MineruReadingBlock = {
          id,
          pageIndex,
          type,
          bbox,
          headingLevel,
          content: furniture.readingContent(block),
          assetPath,
          sourcePointer: `/${pageIndex}/${blockIndex}`,
        };
        (AUXILIARY.has(type) ? document.discardedBlocks : document.blocks).push(
          normalized,
        );
      },
    );
  });
  document.markdown = furniture.markdown(input.markdown);
  return document;
}

/** Only bundle-local image paths are admitted; URLs and encoded traversal are not. */
export function safeMineruAssetPath(path: string): string {
  if (
    !/^images\/[a-zA-Z0-9_./-]+$/.test(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('MINERU_ASSET_PATH_INVALID');
  }
  return path;
}

function object(value: unknown, name: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`MINERU_OBJECT_INVALID:${name}`);
  return value as JsonObject;
}
function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`MINERU_ARRAY_INVALID:${name}`);
  return value;
}
function nonempty(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`MINERU_STRING_INVALID:${name}`);
  return value;
}
function box(value: unknown): MineruBox | null {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every(
      (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1000,
    ) ||
    value[2] <= value[0] ||
    value[3] <= value[1]
  )
    return null;
  return [value[0], value[1], value[2], value[3]];
}
