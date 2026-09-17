import type { DocumentOriginalBinding, DocumentOriginalResult } from '@shared/document-original.interface';

type SourceUnit = DocumentOriginalResult['source']['units'][number];

/** Display groups only. Saved units, text, identities and source locations stay intact. */
export function originalReadingGroups(original: DocumentOriginalResult): SourceUnit[][] {
  const locations = new Map(original.locations.map(location => [location.sourceRefId, location]));
  const geometry = (unit: SourceUnit) => unit.sourceRefIds.map(ref => locations.get(ref));
  const bodyUnits = original.source.units.filter(unit => unit.mapping.pageFurniture !== true);
  const pageUnits = new Map<number, SourceUnit[]>();
  for (const unit of bodyUnits) {
    for (const page of new Set(geometry(unit).flatMap(location => location?.pageIndex == null ? [] : [location.pageIndex])))
      pageUnits.set(page, [...(pageUnits.get(page) ?? []), unit]);
  }
  const groups: SourceUnit[][] = [];
  for (const unit of bodyUnits) {
    const group = groups.at(-1), previous = group?.at(-1);
    const before = previous ? geometry(previous) : [], after = geometry(unit);
    const first = before.at(-1), second = after[0];
    const previousText = group?.map(member => String(member.payload.text ?? '')).join(' ') ?? '';
    const nextText = String(unit.payload.text ?? '').trim();
    const lastBox = first?.boxes.at(-1), firstBox = second?.boxes[0];
    const sameParagraph = previous && previous.kind === 'paragraph' && unit.kind === 'paragraph' &&
      previous.mapping.pageFurniture !== true && unit.mapping.pageFurniture !== true &&
      previous.moduleId === unit.moduleId && previous.parentUnitId === unit.parentUnitId && previous.payload.role === unit.payload.role;
    const pageBoundary = first?.pageIndex != null && second?.pageIndex === first.pageIndex + 1 &&
      before.every(location => location?.pageIndex === first.pageIndex) && after.every(location => location?.pageIndex === second.pageIndex) &&
      pageUnits.get(first.pageIndex)?.at(-1) === previous && pageUnits.get(second.pageIndex)?.[0] === unit;
    const sameColumn = first?.precision === 'TEXT_ITEM' && second?.precision === 'TEXT_ITEM' &&
      first.coordinateSpace === 'PDF_VIEWPORT_TOP_LEFT' && second.coordinateSpace === first.coordinateSpace &&
      first.viewportWidth === second.viewportWidth && lastBox && firstBox && lastBox[3] > 0 &&
      Math.abs(lastBox[0] - firstBox[0]) <= 2 && Math.abs(lastBox[3] - firstBox[3]) <= 0.5;
    const independent = /^(?:\d+[.)]|[A-Z][.)]|[-•]|WARNING\b|CAUTION\b|DANGER\b|NOTE\b|If\b|Unless\b|Except\b|Provided\b|When\b|Only\b|Please note\b)/i.test(nextText);
    if (sameParagraph && pageBoundary && sameColumn && !independent && closesPageEdgeParenthesis(previousText, nextText)) group!.push(unit);
    else groups.push([unit]);
  }
  return groups;
}

/** All distinct one-based physical pages of the unit's precise saved locations, in source order. */
export function originalUnitPages(original: DocumentOriginalResult, unitId: string): number[] {
  const unit = original.source.units.find(item => item.unitId === unitId);
  if (!unit) return [];
  const locations = new Map(original.locations.map(location => [location.sourceRefId, location]));
  const pages: number[] = [];
  for (const ref of unit.sourceRefIds) {
    const pageIndex = locations.get(ref)?.pageIndex;
    if (pageIndex !== null && pageIndex !== undefined && !pages.includes(pageIndex + 1)) pages.push(pageIndex + 1);
  }
  return pages;
}

/** One-based physical page of the unit's first precise saved location; null when none exists. */
export function originalUnitPage(original: DocumentOriginalResult, unitId: string): number | null {
  return originalUnitPages(original, unitId)[0] ?? null;
}

/** Exact identity of a parse run; a page choice recorded for another run must never be honored. */
export function sameOriginalBinding(
  a: DocumentOriginalBinding | null | undefined,
  b: DocumentOriginalBinding | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.documentVersionId === b.documentVersionId
    && a.parseRunId === b.parseRunId
    && a.parseRevision === b.parseRevision
    && a.sourceArtifactId === b.sourceArtifactId
    && a.sourceSha256 === b.sourceSha256
    && a.sourceByteLength === b.sourceByteLength;
}

function closesPageEdgeParenthesis(before: string, after: string): boolean {
  if (/[.!?]["')\]]?\s*$/.test(before)) return false;
  const stack: string[] = [];
  const consume = (text: string) => {
    for (const character of text) {
      if (character === '(' || character === '[') stack.push(character);
      else if (character === ')' || character === ']') {
        if (stack.pop() !== (character === ')' ? '(' : '[')) return false;
      }
    }
    return true;
  };
  if (!consume(before) || !stack.length) return false;
  // Closure must occur within the next fragment's first sentence, not a later paragraph.
  const sentenceEnd = after.search(/[.!?](?:\s|$)/);
  return consume(sentenceEnd < 0 ? after : after.slice(0, sentenceEnd + 1)) && stack.length === 0;
}
