/** A short entry point to saved work; the complete text stays in the reading view. */
export function compactReadingSummary(headline: string, brief: string): string {
  const clean = brief.replace(/\s+/gu, ' ').trim();
  if (!clean) return headline;
  const marker = /(?:核心判定|核心判断|主要结论|结论|实质工程分析)[:：]/u.exec(clean);
  const relevant = marker ? clean.slice(marker.index + marker[0].length).trim() : clean;
  const processLead = /^(?:本批|本轮|本次|已读取|已保存)/u;
  const engineeringPoint =
    /(?:触发|导致|故障|失效|异常|缺陷|锁死|阻断|问题|风险|影响|要求|措施|处置|建议)/u;
  const metadata = /(?:编号|ATA|ECCN|Originated|Revised|生成日期)/iu;
  const limitation = /(?:待确认|待核|未知|尚未|仍需|不适用|不得)/u;
  const isMetadata = (value: string): boolean =>
    metadata.test(value) && !engineeringPoint.test(value) && !limitation.test(value);

  // Keep a short saved judgment whole: its second clause can be the decisive
  // negation or applicability limit.
  if (relevant.length <= 220 && !processLead.test(relevant) &&
      !isMetadata(relevant)) return relevant;

  const clauses = relevant.split(/[；。]/u).map(value => value.trim())
    .filter(value => value && !processLead.test(value) && !isMetadata(value));
  // A long list of source facts can contain a useful judgment even when no
  // single sentence fits the entry. Split at list/comma boundaries, never in
  // the middle of a number, negation or condition.
  const points = clauses.flatMap(value =>
    value.length > 180 || (relevant.length > 260 && value.includes('、'))
      ? value.split(/、/u).map(part => part.trim()).filter(Boolean)
      : [value]);
  const issue = points.find(value => value.length <= 180 &&
    engineeringPoint.test(value));
  if (!issue) return headline;

  const selected = [issue];
  const addWhenFits = (value: string | undefined): void => {
    if (!value || selected.includes(value)) return;
    if ([...selected, value].join('；').length <= 259) selected.push(value);
  };
  addWhenFits(points.find(value =>
    /(?:Applicability|适用范围|适用条件)/iu.test(value)));
  addWhenFits(points.find(value =>
    /(?:处置|措施|预防|恢复|避免|workaround|Interim|Final)/iu.test(value)));
  const limited = clauses.flatMap(value => value.split(/，/u))
    .map(value => value.trim()).filter(Boolean);
  addWhenFits([...limited].reverse().find(value =>
    /(?:待确认|待核|未|尚|仍需|TBD|UNKNOWN|不得|不适用)/iu.test(value)));
  return `${selected.join('；')}。`;
}
