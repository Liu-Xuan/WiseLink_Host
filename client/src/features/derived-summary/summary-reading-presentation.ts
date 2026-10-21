import type { DerivedSummaryContent, DerivedSummaryMemberReading, DerivedSummaryRevision } from '@shared/derived-summary.interface';
import { summaryReadingLimitations, summaryReadingText } from './summary-selection';

export interface SummaryReadingCondition {
  text: string;
  inheritedFrom: DerivedSummaryMemberReading[];
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

export function summaryAdditionalMemberConditions(member: DerivedSummaryMemberReading,
  visible: SummaryReadingCondition[]): string[] {
  const keys = new Set(visible.filter((condition: SummaryReadingCondition) => condition.inheritedFrom.some(
    (source: DerivedSummaryMemberReading) => source.evidenceRef === member.evidenceRef &&
      JSON.stringify(source.member) === JSON.stringify(member.member),
  )).map((condition: SummaryReadingCondition) => summaryConditionKey(condition.text)));
  return summaryReadingLimitations(member.limitations).filter((value: string) => !keys.has(summaryConditionKey(value)));
}
