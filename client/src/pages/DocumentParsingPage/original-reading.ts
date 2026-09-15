import type { DocumentOriginalResult } from '@shared/document-original.interface';

type SourceUnit = DocumentOriginalResult['source']['units'][number];

/** Display groups only. Saved units, text, identities and source locations stay intact. */
export function originalReadingGroups(original: DocumentOriginalResult): SourceUnit[][] {
  const locations = new Map(original.locations.map(location => [location.sourceRefId, location]));
  const geometry = (unit: SourceUnit) => unit.sourceRefIds.map(ref => locations.get(ref));
  const pageUnits = new Map<number, SourceUnit[]>();
  for (const unit of original.source.units.filter(unit => unit.mapping.pageFurniture !== true)) {
    for (const page of new Set(geometry(unit).flatMap(location => location?.pageIndex == null ? [] : [location.pageIndex])))
      pageUnits.set(page, [...(pageUnits.get(page) ?? []), unit]);
  }
  const groups: SourceUnit[][] = [];
  for (const unit of original.source.units) {
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
