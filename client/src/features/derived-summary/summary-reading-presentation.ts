import type { DerivedSummaryContent, DerivedSummaryMemberReading, DerivedSummaryRevision } from '@shared/derived-summary.interface';
import { deduplicateSummaryNotices } from '@shared/derived-summary-engineering-content';
import { summaryReadingLimitations, summaryReadingText } from './summary-selection';

export interface SummaryReadingCondition {
  text: string;
  inheritedFrom: DerivedSummaryMemberReading[];
  /** Original saved condition when a known processing prefix is separated. */
  savedText?: string;
}

export interface SummaryReadingConditionGroups {
  engineering: SummaryReadingCondition[];
  records: SummaryReadingCondition[];
}

/** The existing stable text identity, without semantic, punctuation or case folding. */
export function summaryConditionKey(value: string): string {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/** Promote saved prose only; an exact repeated opening needs no second copy. */
export function summaryReadingBrief(content: DerivedSummaryContent): string | null {
  const brief = summaryReadingText(content.listBrief).trim();
  const opening = content.body.trim().split(/\r?\n\s*\r?\n/u)
    .find((paragraph: string) => !/^#{1,6} [^\r\n]+$/u.test(paragraph));
  return brief && ![content.headline, opening ?? ''].some((text: string) =>
    summaryConditionKey(text) === summaryConditionKey(brief)) ? brief : null;
}

/** Every condition remains visible. Only its repeated exact saved-member provenance is grouped. */
export function summaryReadingConditions(revision: DerivedSummaryRevision): SummaryReadingCondition[] {
  return summaryReadingLimitations(revision.content.limitations).map((text: string) => ({
    text,
    inheritedFrom: revision.members.filter((member: DerivedSummaryMemberReading) =>
      summaryReadingLimitations(member.limitations).some((condition: string) =>
        summaryConditionKey(condition) === summaryConditionKey(text))),
  }));
}

/** Finite processing-record grammars observed in older saved Wikis. A new
 * qualifier or sentence makes the match fail and leaves the prose visible. */
function processingCondition(value: string): boolean {
  const compact: string = value.replace(/\s+/gu, '');
  return /^本次解读仅基于本次交付的offset\d+-\d+范围（共\d+个sourceunit）以及对应锚点，未覆盖文件未读取的其他范围（如未来可能补充的修订段落等）。$/u.test(compact) ||
    /^仅覆盖显式选取的[一二三四五六七八九十\d]+份成员（一份文件解读DRR-[A-Za-z0-9_-]+、两份工程事项WI-[A-Za-z0-9_-]+\/WI-[A-Za-z0-9_-]+），全部溯源同一FTD原文，为同一来源派生复用而非独立佐证；未选成员、其他ATA与其他机型未覆盖。$/u.test(compact) ||
    /^本层仅综合唯一已保存的ATA\d{2}-\d{2}子层候选（DS-[A-Za-z0-9_-]+）；该子层下的[一二三四五六七八九十\d]+份成员全部溯源同一FTD[A-Za-z0-9_-]+原文，为同一来源派生复用而非独立佐证；未选成员、其他ATA与其他机型未覆盖。$/u.test(compact) ||
    /^本次尚未完成的下层依赖[：:]DS-[A-Za-z0-9_-]+子层的SUMMARY仍为PARTIAL，且[一二三四五六七八九十\d]+份DOCUMENT类保存评估仍为SAVED_ASSESSMENT_NOT_READY（subjectIdfamily_[A-Za-z0-9_-]+），不得宣称已覆盖这些新工作。$/u.test(compact) ||
    /^本次尚未完成的下层依赖[：:][一二三四五六七八九十\d]+份DOCUMENT类保存评估仍为SAVED_ASSESSMENT_NOT_READY（subjectIdfamily_[A-Za-z0-9_-]+，requestId含JA-save-[A-Za-z0-9_-]+(?:、JA-save-[A-Za-z0-9_-]+)*等），不得宣称已覆盖这些新工作。$/u.test(compact);
}

/** Presentation only: preserve processing text in records, never infer an
 * engineering condition from IDs, task readiness or a parser implementation. */
export function summaryWikiReadingConditions(revision: DerivedSummaryRevision): SummaryReadingConditionGroups {
  const engineering: SummaryReadingCondition[] = [], records: SummaryReadingCondition[] = [];
  for (const savedText of deduplicateSummaryNotices(revision.content.limitations)) {
    const inheritedFrom: DerivedSummaryMemberReading[] = revision.members.filter((member: DerivedSummaryMemberReading) =>
      member.limitations.some((text: string) => summaryConditionKey(text) === summaryConditionKey(savedText)));
    const projected: string = summaryReadingText(savedText).trim();
    const condition: SummaryReadingCondition = { text: projected, inheritedFrom, savedText };
    if (!projected || processingCondition(projected)) {
      records.push({ ...condition, text: savedText });
      continue;
    }
    if (summaryConditionKey(projected) !== summaryConditionKey(savedText))
      records.push({ ...condition, text: savedText });
    // Split only the exact parser clause. The entire following applicability
    // statement, including blanks, model numbers and negations, stays visible.
    const parser: RegExpExecArray | null = /^文档解析采用\s+PDFJS_TEXT_LAYER\s+提取[；;]/u.exec(projected);
    if (parser) {
      records.push({ ...condition, text: parser[0] });
      const text: string = projected.slice(parser[0].length).trim();
      if (text) engineering.push({ ...condition, text });
      continue;
    }
    const range: RegExpExecArray | null = /[；;]原件交付范围\s+COMPLETE_DELIVERY，\d+\/\d+，解读仅基于\s+offset\s+\d+-\d+。$/u.exec(projected);
    if (range) {
      records.push({ ...condition, text: range[0].slice(1) });
      const text: string = projected.slice(0, range.index).trim();
      if (text) engineering.push({ ...condition, text });
    } else engineering.push(condition);
  }
  return { engineering, records };
}

export function summaryAdditionalMemberConditions(member: DerivedSummaryMemberReading,
  visible: SummaryReadingCondition[]): string[] {
  const keys = new Set(visible.filter((condition: SummaryReadingCondition) => condition.inheritedFrom.some(
    (source: DerivedSummaryMemberReading) => source.evidenceRef === member.evidenceRef &&
      JSON.stringify(source.member) === JSON.stringify(member.member),
  )).map((condition: SummaryReadingCondition) => summaryConditionKey(condition.savedText ?? condition.text)));
  return summaryReadingLimitations(member.limitations).filter((value: string) => !keys.has(summaryConditionKey(value)));
}
