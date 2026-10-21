import type { DerivedSummaryContextBasis, DerivedSummaryContextStatus,
  DerivedSummaryMemberReading, DerivedSummaryRevision } from '@shared/derived-summary.interface';
import type { EngineeringMatterWorkingRevisionReadModel } from '@shared/matter-working.interface';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';
import { summaryError, summaryMemberRef } from './derived-summary.validation';
import { assertSummaryMatterCatalog } from './derived-summary-matter-catalog';

/** Stable identities only; the existing evidence registry remains the body owner. */
export function contextMemberNotices(readings: DerivedSummaryMemberReading[]): DerivedSummaryContextBasis['memberNotices'] {
  const unique = new Map(readings.map(item => [summaryMemberRef(item.member), item]));
  return [...unique.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, item]) => ({
    member: item.member, current: item.current, overviewStatus: item.overviewStatus,
    limitations: [...item.limitations],
  }));
}

export function assertSummaryContextBasis(basis: DerivedSummaryContextBasis): void {
  if (!basis || basis.schemaVersion !== 'wiselink.derived-summary-context.v1' ||
      !['memberNotices', 'sources', 'workItems', 'matters', 'summaries', 'uncoordinatedDependencies']
        .every(key => Array.isArray(basis[key as keyof DerivedSummaryContextBasis])) ||
      basis.sources.some(source => !source.documentVersionId || !source.familyId ||
        !Number.isSafeInteger(source.currentGeneration) || source.currentGeneration < 0 ||
        (source.publishedParse !== undefined && source.publishedParse !== null &&
          (typeof source.publishedParse !== 'object' || Array.isArray(source.publishedParse) ||
            typeof source.publishedParse.parseRunId !== 'string' || !source.publishedParse.parseRunId.trim() ||
            !Number.isSafeInteger(source.publishedParse.parseRevision) || source.publishedParse.parseRevision < 1)) ||
          (source.semanticRevisions !== undefined && (!Array.isArray(source.semanticRevisions) ||
          source.semanticRevisions.some(item => !item.parseRunId ||
            !Number.isSafeInteger(item.parseRevision) || item.parseRevision < 1 ||
            !Number.isSafeInteger(item.semanticRevision) || item.semanticRevision < 1)))) ||
      (basis.documentReadings !== undefined && (!Array.isArray(basis.documentReadings) || basis.documentReadings.some(item =>
        !item.documentVersionId || !item.parseRunId || !item.readingRunRef || !Number.isSafeInteger(item.semanticRevision) || item.semanticRevision < 1 ||
        !(item.currentReadingRunRef === null || typeof item.currentReadingRunRef === 'string' && item.currentReadingRunRef.trim()) ||
        !(item.currentReadingRevision === null || Number.isSafeInteger(item.currentReadingRevision) && item.currentReadingRevision > 0)))))
    throw summaryError('DERIVED_SUMMARY_CONTEXT_INVALID');
  if (basis.wikiMatterCatalog !== undefined) assertSummaryMatterCatalog(basis.wikiMatterCatalog);
}

export function summaryContextStatus(frozen: DerivedSummaryContextBasis | undefined,
  fresh?: DerivedSummaryContextBasis): DerivedSummaryContextStatus {
  const common = { sourceAuthority: 'CATALOG_SELECTED' as const, sourceCurrentness: 'UNKNOWN' as const,
    coverage: 'SELECTED_MEMBERS_ONLY' as const };
  if (!frozen) return { ...common, state: 'LEGACY_UNCHECKED', reasons: ['NO_SAVED_CONTEXT_BASIS', 'PUBLISHER_CURRENTNESS_UNKNOWN'] };
  assertSummaryContextBasis(frozen);
  if (!fresh) throw summaryError('DERIVED_SUMMARY_CONTEXT_INVALID');
  assertSummaryContextBasis(fresh);
  const changed = (['memberNotices', 'sources', 'workItems', 'matters', 'summaries', 'documentReadings', 'wikiMatterCatalog'] as const)
    .filter(key => canonicalJson(frozen[key]) !== canonicalJson(fresh[key]));
  const coverageGap = fresh.memberNotices.some(item => !item.current || item.overviewStatus !== 'CURRENT') ||
    fresh.sources.some(item => item.selectedHead !== item.documentVersionId) ||
    fresh.matters.some(item => item.selectedWork.some(work => work.basedOnMatterRevisionId !== item.currentMatterRevisionId));
  const correctionGap = fresh.matters.some(item => item.selectedWork.some(work =>
    work.correctionNotices.some(notice => !notice.correctedWorkRef && !notice.unchanged) ||
    work.overviewCorrectionNotices.some(notice => !notice.savedWorkRef) || work.referenceWorkNotices.some(notice =>
      notice.correctionNotices.some(correction => !correction.correctedWorkRef && !correction.unchanged) ||
      (notice.overviewCorrectionNotices ?? []).some(correction => !correction.savedWorkRef))));
  return { ...common, state: changed.length || coverageGap || correctionGap ? 'RECHECK_REQUIRED' : 'UNCHANGED_HOST_CONTEXT',
    reasons: [...changed.map(key => `CHANGED_${key.toUpperCase()}`), ...(coverageGap ? ['SELECTED_HISTORY_OR_INCOMPLETE_COVERAGE'] : []),
      ...(correctionGap ? ['CORRECTION_REVIEW_PENDING'] : []), ...fresh.uncoordinatedDependencies, 'PUBLISHER_CURRENTNESS_UNKNOWN'] };
}

export function assertSummaryContextUnchanged(frozen: DerivedSummaryContextBasis | undefined,
  fresh: DerivedSummaryContextBasis): void {
  if (!frozen) throw summaryError('DERIVED_SUMMARY_CONTEXT_BASIS_REQUIRED');
  assertSummaryContextBasis(frozen);
  // Explicit history remains eligible for a qualified synthesis when unchanged.
  if (canonicalJson(frozen) !== canonicalJson(fresh)) throw summaryError('DERIVED_SUMMARY_CONTEXT_CHANGED');
}

/** Public exact content excludes the internal head vector: a newer head may be
 * unreadable even when the selected historical body remains authorized. */
export function publicSummaryRevision(saved: DerivedSummaryRevision): DerivedSummaryRevision {
  const { contextBasis: _internal, ...publicRevision } = saved;
  return publicRevision;
}

/** SQL notice windows may tie on createdAt; ordering is not a dependency. */
export function contextWorkNotices(saved: EngineeringMatterWorkingRevisionReadModel) {
  const ordered = <T extends { attemptRef: string }>(values: T[]): T[] => [...values].sort((a, b) =>
    a.attemptRef < b.attemptRef ? -1 : a.attemptRef > b.attemptRef ? 1 : canonicalJson(a).localeCompare(canonicalJson(b)));
  return { correctionNotices: ordered(saved.correctionNotices ?? []),
    overviewCorrectionNotices: ordered(saved.overviewCorrectionNotices ?? []),
    referenceWorkNotices: (saved.referenceWorkNotices ?? []).map(notice => ({ ...notice,
      affectedIssueKeys: [...notice.affectedIssueKeys].sort(), correctionNotices: ordered(notice.correctionNotices),
      overviewCorrectionNotices: ordered(notice.overviewCorrectionNotices ?? []),
    })).sort((a, b) => a.evidenceRef < b.evidenceRef ? -1 : a.evidenceRef > b.evidenceRef ? 1 : 0) };
}
