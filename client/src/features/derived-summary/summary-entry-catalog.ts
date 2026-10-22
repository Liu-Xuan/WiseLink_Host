import type { DerivedSummaryContent } from '@shared/derived-summary.interface';
import { summaryReadingHeadline, summaryReadingText } from './summary-selection';
import { summaryMarkdownStructure, summaryMatterHeading, type SummaryTextRange as TextRange,
  type SummaryMarkdownHeading as MarkdownHeading } from '@shared/summary-markdown-structure';

export interface SummaryEntryPreview { label: string; body: string }
export interface SummaryEngineeringEntry {
  matterId?: string;
  title: string;
  body: string;
  previews: SummaryEntryPreview[];
}
export interface SummaryEntryCatalog {
  intro: string;
  entries: SummaryEngineeringEntry[];
  structured: boolean;
}

const progressTitles = new Set(['当前状态', '当前进展', '状态与进展', 'Status', 'Status 与最终措施']);
const publicationTitles = new Set(['FTD / SL / SB', 'FTD/SL/SB', '关联文件', '文件情况']);
const previewTitle = (title: string): boolean => progressTitles.has(title) || publicationTitles.has(title);

function withoutRanges(body: string, ranges: TextRange[]): string {
  let offset: number = 0;
  const parts: string[] = [];
  for (const range of ranges.sort((left: TextRange, right: TextRange) => left.start - right.start)) {
    if (range.start < offset) continue;
    parts.push(body.slice(offset, range.start)); offset = range.end;
  }
  parts.push(body.slice(offset));
  return parts.join('').trim();
}

function engineeringEntry(title: string, body: string, legacy: boolean): SummaryEngineeringEntry {
  const structure = summaryMarkdownStructure(body);
  const previews: SummaryEntryPreview[] = [], ranges: TextRange[] = [];
  for (const [index, heading] of structure.headings.entries()) {
    if (heading.depth > 3 || !previewTitle(heading.title)) continue;
    const end: number = structure.headings.slice(index + 1)
      .find((next: MarkdownHeading) => next.depth <= heading.depth)?.start ?? body.length;
    const value: string = body.slice(heading.end, end).trim();
    if (value) { previews.push({ label: heading.title, body: value }); ranges.push({ start: heading.start, end }); }
  }
  if (legacy) {
    // Older saved bodies use bold paragraph labels. Only those exact labels are
    // promoted; words such as “关闭”, “发布”, dates and negations are never inferred.
    for (const match of body.matchAll(/(?:^|\n[\t ]*\r?\n)(\*\*([^*\r\n]+)\*\*[\t ]*[：:][\t ]*)([^]*?)(?=\r?\n[\t ]*\r?\n|$)/gu)) {
      const start: number = match.index + match[0].indexOf(match[1]);
      if (!previewTitle(match[2]) || structure.fences.some((range: TextRange) => start >= range.start && start < range.end) ||
        ranges.some((range: TextRange) => start >= range.start && start < range.end)) continue;
      previews.push({ label: match[2], body: match[3].trim() });
      ranges.push({ start, end: match.index + match[0].length });
    }
  }
  previews.sort((left: SummaryEntryPreview, right: SummaryEntryPreview) =>
    Number(progressTitles.has(right.label)) - Number(progressTitles.has(left.label)));
  return { title, body: withoutRanges(body, ranges), previews };
}

/** New saved Wiki Markdown carries explicit entry headings. An old report stays
 * whole: its background/measures headings are never guessed to be new topics. */
export function summaryEntryCatalog(content: DerivedSummaryContent): SummaryEntryCatalog {
  const body: string = summaryReadingText(content.body);
  const entries: MarkdownHeading[] = summaryMarkdownStructure(body).headings.filter((heading: MarkdownHeading) =>
    heading.depth === 2 && (/^条目[：:]\s*\S/u.test(heading.title) || summaryMatterHeading(heading.title) !== null));
  if (!entries.length) return { intro: '', structured: false,
    entries: [engineeringEntry(summaryReadingHeadline(content.headline), body, true)] };
  return { intro: body.slice(0, entries[0].start).trim(), structured: true,
    entries: entries.map((heading: MarkdownHeading, index: number) => {
      const matter = summaryMatterHeading(heading.title);
      const end = matter ? summaryMarkdownStructure(body).headings.find(next =>
        next.depth === 2 && next.start > heading.start)?.start : entries[index + 1]?.start;
      return { ...engineeringEntry(matter ? matter.title : heading.title.replace(/^条目[：:]\s*/u, ''),
        body.slice(heading.end, end ?? body.length).trim(), false),
        ...(matter ? { matterId: matter.matterId } : {}) };
    }) };
}

export function summaryUnboundBody(content: DerivedSummaryContent): string {
  const headings = summaryMarkdownStructure(content.body).headings.filter(heading => heading.depth === 2);
  const index = headings.findIndex(heading => heading.title === '未归属资料');
  return index < 0 ? '' : content.body.slice(headings[index].end, headings[index + 1]?.start ?? content.body.length).trim();
}
