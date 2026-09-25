/** A short entry point to saved work; the complete text stays in the reading view. */
export function compactReadingSummary(headline: string, brief: string): string {
  const clean = brief.replace(/\s+/gu, ' ').trim();
  if (!clean) return headline;
  const marker = /(?:核心判定|核心判断|主要结论|结论)[:：]/u.exec(clean);
  const relevant = marker ? clean.slice(marker.index + marker[0].length).trim() : clean;
  const clause = relevant.split(/[；。]/u, 1)[0]?.trim() ?? '';
  if (clause && clause.length <= 160 && !/^(?:本批|本轮|本次|已读取|已保存)/u.test(clause))
    return `${clause}。`;
  return headline;
}
