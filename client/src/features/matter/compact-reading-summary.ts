/** A short entry point to saved work; the complete text stays in the reading view. */
export function compactReadingSummary(headline: string, brief: string): string {
  const clean = brief.replace(/\s+/gu, ' ').trim();
  if (!clean) return headline;
  const marker = /(?:核心判定|核心判断|主要结论|结论)[:：]/u.exec(clean);
  const relevant = marker ? clean.slice(marker.index + marker[0].length).trim() : clean;
  const processLead = /^(?:本批|本轮|本次|已读取|已保存)/u;
  const engineeringPoint =
    /(?:触发|导致|故障|失效|异常|缺陷|锁死|问题|风险|影响|要求|措施|处置|建议)/u;
  const metadata = /(?:编号|ATA|ECCN|Originated|Revised|生成日期)/iu;
  const isMetadata = (value: string): boolean =>
    metadata.test(value) && !engineeringPoint.test(value);

  // Keep a short saved judgment whole: its second clause can be the decisive
  // negation or applicability limit.
  if (relevant.length <= 220 && !processLead.test(relevant) &&
      !isMetadata(relevant)) return relevant;

  const clauses = relevant.split(/[；。]/u).map(value => value.trim())
    .filter(value => value && !processLead.test(value) && !isMetadata(value));
  const issue = clauses.find(value => value.length <= 180 &&
    engineeringPoint.test(value));
  if (!issue) return headline;

  const selected = [issue];
  const addWhenFits = (value: string | undefined): void => {
    if (!value || selected.includes(value)) return;
    if ([...selected, value].join('；').length <= 259) selected.push(value);
  };
  addWhenFits(clauses.find(value =>
    /(?:处置|措施|预防|恢复|避免|workaround)/iu.test(value)));
  addWhenFits([...clauses].reverse().find(value =>
    /(?:待确认|待核|未|尚|仍需|TBD|UNKNOWN|不得|不适用)/iu.test(value)));
  return `${selected.join('；')}。`;
}
