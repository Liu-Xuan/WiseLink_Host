import type { CapabilityService } from '@lark-apaas/fullstack-nestjs-core';
import {
  readMineruArtifacts,
  type MineruReadingBlock,
} from './mineru-artifacts';
import type { readMineruArtifactFiles } from './mineru-artifact-files';

type Bundle = Pick<Awaited<ReturnType<typeof readMineruArtifactFiles>>, 'document' | 'assets' | 'contentListV2' | 'middle'>;
export interface MineruTitleInput {
  id: string;
  text: string;
  lineHeight: number;
  page: number;
}
export type MineruTitleCall = (
  titles: readonly MineruTitleInput[],
) => Promise<unknown>;
export type MineruTitleEnhancementStatus =
  | { status: 'DISABLED' | 'NOT_APPLICABLE' | 'APPLIED' }
  | {
      status: 'FAILED';
      code:
        | 'TITLE_SOURCE_MISMATCH'
        | 'TITLE_MODEL_FAILED'
        | 'TITLE_OUTPUT_INVALID'
        | 'TITLE_INPUT_TOO_LARGE';
    };

/** Verified instance schema: textToJson, unary, titlesJson -> {levels: array}. */
export function miaodaMineruTitleCall(
  service: Pick<CapabilityService, 'load'>,
): MineruTitleCall {
  return (titles) =>
    service
      .load('wl-mineru-title-levels')
      .call('textToJson', { titlesJson: JSON.stringify(titles) });
}

export async function enhanceMineruTitles(
  bundle: Bundle,
  call?: MineruTitleCall,
): Promise<Bundle & { titleEnhancement: MineruTitleEnhancementStatus }> {
  if (!call) return { ...bundle, titleEnhancement: { status: 'DISABLED' } };
  const titles = bundle.document.blocks.filter(
    (block) => block.type === 'title',
  );
  if (!titles.length)
    return { ...bundle, titleEnhancement: { status: 'NOT_APPLICABLE' } };
  // Bind all three views before invoking a model; never pay for an ambiguous edit.
  let bindings: ReturnType<typeof bindTitles>;
  try {
    bindings = bindTitles(bundle, titles);
  } catch {
    return {
      ...bundle,
      titleEnhancement: { status: 'FAILED', code: 'TITLE_SOURCE_MISMATCH' },
    };
  }
  if (
    bindings.inputs.length > 256 ||
    JSON.stringify(bindings.inputs).length > 32000
  ) {
    return {
      ...bundle,
      titleEnhancement: { status: 'FAILED', code: 'TITLE_INPUT_TOO_LARGE' },
    };
  }
  let raw: unknown;
  let timer: NodeJS.Timeout | undefined;
  try {
    raw = await Promise.race([
      call(bindings.inputs),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('TITLE_TIMEOUT')), 90000);
      }),
    ]);
  } catch {
    return {
      ...bundle,
      titleEnhancement: { status: 'FAILED', code: 'TITLE_MODEL_FAILED' },
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
  let levels: number[];
  try {
    levels = validateLevels(raw, titles);
  } catch {
    return {
      ...bundle,
      titleEnhancement: { status: 'FAILED', code: 'TITLE_OUTPUT_INVALID' },
    };
  }
  const middle = structuredClone(bundle.middle) as Record<string, unknown>;
  const contentListV2 = structuredClone(bundle.contentListV2) as Array<
    Array<Record<string, unknown>>
  >;
  const lines = bundle.document.markdown.split('\n');
  bindings.items.forEach((binding, index) => {
    const title = titles[index];
    const [pageIndex, blockIndex] = title.sourcePointer
      .slice(1)
      .split('/')
      .map(Number);
    const content = contentListV2[pageIndex][blockIndex].content as Record<
      string,
      unknown
    >;
    content.level = levels[index];
    const page = (middle.pdf_info as Array<Record<string, unknown>>)[pageIndex];
    (page.para_blocks as Array<Record<string, unknown>>)[
      binding.middleIndex
    ].level = levels[index];
    lines[binding.markdownLine] = lines[binding.markdownLine].replace(
      /^( {0,3})#{1,6}(?=[ \t])/,
      (_, indent: string) => indent + '#'.repeat(levels[index]),
    );
  });
  const document = readMineruArtifacts({
    markdown: lines.join('\n'),
    middle,
    contentListV2,
    assetPaths: bundle.assets.map((a) => a.path),
  });
  return {
    ...bundle,
    document,
    middle,
    contentListV2,
    titleEnhancement: { status: 'APPLIED' },
  };
}

function bindTitles(bundle: Bundle, titles: MineruReadingBlock[]) {
  const markdownHeadings: Array<{ line: number; text: string }> = [];
  let fence: { character: string; length: number } | undefined;
  bundle.document.markdown.split('\n').forEach((line, index) => {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (match) {
      if (!fence) fence = { character: match[1][0], length: match[1].length };
      else if (
        match[1][0] === fence.character &&
        match[1].length >= fence.length &&
        !match[2].trim()
      )
        fence = undefined;
      return;
    }
    if (fence) return;
    const heading = line.match(/^ {0,3}#{1,6}[ \t]+(.+?)\r?$/);
    if (heading)
      markdownHeadings.push({ line: index, text: plain(heading[1]) });
  });
  if (markdownHeadings.length !== titles.length)
    throw new Error('TITLE_COUNT_MISMATCH');
  const middle = bundle.middle as Record<string, unknown>;
  const used = new Set<string>();
  const inputs: MineruTitleInput[] = [];
  const items = titles.map((title, index) => {
    const spans = title.content.title_content;
    if (!Array.isArray(spans)) throw new Error('TITLE_SPANS_INVALID');
    const text = spans
      .map((value) => {
        const span = value as Record<string, unknown>;
        if (
          typeof span.content !== 'string' ||
          !['text', 'equation_inline', 'phonetic'].includes(String(span.type))
        )
          throw new Error('TITLE_SPAN_UNSUPPORTED');
        return span.type === 'equation_inline'
          ? `$${span.content}$`
          : span.content;
      })
      .join('')
      .trim();
    if (!text || plain(text) !== markdownHeadings[index].text || !title.bbox)
      throw new Error('TITLE_MARKDOWN_MISMATCH');
    const page = (middle.pdf_info as Array<Record<string, unknown>>)[
      title.pageIndex
    ];
    const size = page.page_size as number[];
    if (!Array.isArray(page.para_blocks))
      throw new Error('TITLE_MIDDLE_MISSING');
    const matches: number[] = [];
    page.para_blocks.forEach((value, i) => {
      const block = value as Record<string, unknown>;
      if (block.type !== 'title' || !Array.isArray(block.bbox)) return;
      const bbox = block.bbox as number[];
      if (
        bbox.length === 4 &&
        bbox.every(
          (v, k) =>
            Number.isFinite(v) &&
            Math.floor((v * 1000) / size[k % 2]) === title.bbox![k],
        )
      )
        matches.push(i);
    });
    if (matches.length !== 1 || used.has(`${title.pageIndex}/${matches[0]}`))
      throw new Error('TITLE_MIDDLE_AMBIGUOUS');
    used.add(`${title.pageIndex}/${matches[0]}`);
    const block = (page.para_blocks as Array<Record<string, unknown>>)[
      matches[0]
    ];
    const bbox = block.bbox as number[];
    inputs.push({
      id: title.id,
      text,
      page: title.pageIndex + 1,
      lineHeight: bbox[3] - bbox[1],
    });
    return {
      markdownLine: markdownHeadings[index].line,
      middleIndex: matches[0],
    };
  });
  return { inputs, items };
}

function validateLevels(raw: unknown, titles: MineruReadingBlock[]): number[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('TITLE_OUTPUT_INVALID');
  const output = raw as Record<string, unknown>;
  if (
    !Array.isArray(output.levels) ||
    output.levels.length !== titles.length ||
    Object.keys(output).some((key) => key !== 'levels')
  )
    throw new Error('TITLE_OUTPUT_INVALID');
  let previous = 0;
  return output.levels.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('TITLE_OUTPUT_INVALID');
    const row = value as Record<string, unknown>;
    const level = row.level;
    if (
      row.id !== titles[index].id ||
      typeof level !== 'number' ||
      !Number.isInteger(level) ||
      level < 1 ||
      level > 4 ||
      level > previous + 1 ||
      Object.keys(row).some((key) => key !== 'id' && key !== 'level')
    )
      throw new Error('TITLE_OUTPUT_INVALID');
    previous = level;
    return level;
  });
}
function plain(text: string) {
  return text
    .replace(/\\([\\`*_{}\[\]()#+\-.!|>])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
