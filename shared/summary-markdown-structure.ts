export interface SummaryTextRange { start: number; end: number }
export interface SummaryMarkdownHeading extends SummaryTextRange { depth: number; title: string }

/** Explicit ATX boundaries only. Code examples never create catalog entries. */
export function summaryMarkdownStructure(body: string): {
  headings: SummaryMarkdownHeading[]; fences: SummaryTextRange[];
} {
  const headings: SummaryMarkdownHeading[] = [], fences: SummaryTextRange[] = [];
  let offset: number = 0;
  let fence: { marker: string; length: number; start: number } | null = null;
  for (const line of body.matchAll(/[^\n]*(?:\n|$)/gu)) {
    if (!line[0]) continue;
    const raw: string = line[0], text: string = raw.replace(/\r?\n$/u, '');
    const marker: RegExpExecArray | null = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(text);
    if (fence) {
      if (marker && marker[1][0] === fence.marker && marker[1].length >= fence.length && !marker[2].trim()) {
        fences.push({ start: fence.start, end: offset + raw.length }); fence = null;
      }
    } else if (marker && (marker[1][0] !== '`' || !marker[2].includes('`'))) {
      fence = { marker: marker[1][0], length: marker[1].length, start: offset };
    } else {
      const heading: RegExpExecArray | null = /^ {0,3}(#{1,6})[\t ]+(.+?)\s*$/u.exec(text);
      if (heading) headings.push({ start: offset, end: offset + raw.length,
        depth: heading[1].length, title: heading[2].replace(/[\t ]+#+[\t ]*$/u, '').trim() });
    }
    offset += raw.length;
  }
  if (fence) fences.push({ start: fence.start, end: body.length });
  return { headings, fences };
}

export function summaryMatterHeading(title: string): { matterId: string; title: string } | null {
  const match: RegExpExecArray | null = /^事项[：:]\s*([A-Za-z0-9_-]+)(?:\s*[|｜]\s*(.*))?$/u.exec(title);
  return match ? { matterId: match[1], title: match[2] ?? '' } : null;
}
