/**
 * WiseLink 3.1 applicability-fleet: L0/L1 aircraft rule matcher.
 *
 * Migrated from the mature v8 applicabilityRuleMatcher source-level reference
 * onto WiseLink 3.1 field names. L0 identity matching keys on aircraftNumber
 * (with registration aliases); L1 structural matching keys on model hierarchy
 * and MSN ranges. Three-valued decisions only — 'unknown' is never coerced.
 */

import { aircraftModelHierarchyMatches } from './aircraftModelHierarchy';

export interface ApplicabilityAircraftIdentity {
  aircraftNumber: string;
  aliases?: Array<{ aliasValue: string }>;
  fleetFamily?: string | null;
  aircraftModel?: string | null;
  series?: string | null;
  msn?: string | null;
}

export interface ApplicabilityRuleFragment {
  ruleFragmentId: string;
  /** WiseLink 3.1 aircraft-number applicability list. */
  appliesToAircraftNumbers?: string[];
  /** Legacy alias kept for migrated fragment shapes. */
  appliesToTailNumbers?: string[];
  appliesToModels?: string[];
  appliesToMsnRanges?: Array<{ from?: string | number | null; to?: string | number | null }>;
}

export type RuleMatchDecision =
  | 'applicable'
  | 'not_applicable'
  | 'partially_applicable'
  | 'needs_review'
  | 'unknown';

export interface RuleMatchResult {
  decision: RuleMatchDecision;
  matchedIds: string[];
  unresolvedIds: string[];
  reason: string;
}

function normalize(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function matchesModel(aircraft: ApplicabilityAircraftIdentity, model: string): boolean {
  return aircraftModelHierarchyMatches(
    {
      fleetFamily: aircraft.fleetFamily ?? null,
      series: aircraft.series ?? null,
      aircraftModel: aircraft.aircraftModel ?? null,
    },
    model,
  );
}

function parseMsn(value: unknown): number {
  const digits = String(value ?? '').replace(/[^\d]/gu, '');
  if (!digits) return Number.NaN;
  return Number.parseInt(digits, 10);
}

function fragmentAircraftNumbers(fragment: ApplicabilityRuleFragment): string[] {
  const numbers = Array.isArray(fragment.appliesToAircraftNumbers)
    && fragment.appliesToAircraftNumbers.length > 0
    ? fragment.appliesToAircraftNumbers
    : fragment.appliesToTailNumbers;
  return Array.isArray(numbers) ? numbers : [];
}

function matchL0Identity(
  aircraft: ApplicabilityAircraftIdentity,
  fragment: ApplicabilityRuleFragment,
): 'applicable' | 'not_applicable' | 'unknown' {
  const aircraftNumbers = fragmentAircraftNumbers(fragment);
  const msnRanges = Array.isArray(fragment.appliesToMsnRanges)
    ? fragment.appliesToMsnRanges
    : [];

  if (aircraftNumbers.length === 0 && msnRanges.length === 0) {
    return 'unknown';
  }

  if (aircraftNumbers.length > 0) {
    const identities = new Set(
      [
        normalize(aircraft.aircraftNumber),
        ...(aircraft.aliases || []).map((alias) => normalize(alias.aliasValue)),
      ].filter(Boolean),
    );
    const numberMatch = aircraftNumbers.some((entry) => identities.has(normalize(entry)));
    if (numberMatch) return 'applicable';
    return 'not_applicable';
  }

  if (msnRanges.length > 0 && aircraft.msn) {
    const msnNum = parseMsn(aircraft.msn);
    if (Number.isNaN(msnNum)) return 'unknown';
    const matched = msnRanges.some((range) => {
      const from = range?.from != null && String(range.from) !== '' ? parseMsn(range.from) : Number.NEGATIVE_INFINITY;
      const to = range?.to != null && String(range.to) !== '' ? parseMsn(range.to) : Number.POSITIVE_INFINITY;
      if (Number.isNaN(from) || Number.isNaN(to)) return false;
      return msnNum >= from && msnNum <= to;
    });
    return matched ? 'applicable' : 'not_applicable';
  }

  return 'unknown';
}

function matchL1Structural(
  aircraft: ApplicabilityAircraftIdentity,
  fragment: ApplicabilityRuleFragment,
): 'applicable' | 'not_applicable' | 'unknown' {
  const models = Array.isArray(fragment.appliesToModels) ? fragment.appliesToModels : [];
  const msnRanges = Array.isArray(fragment.appliesToMsnRanges)
    ? fragment.appliesToMsnRanges
    : [];

  if (models.length > 0) {
    const modelMatch = models.some((model) => matchesModel(aircraft, model));
    if (!modelMatch) return 'not_applicable';
  }

  if (msnRanges.length > 0 && aircraft.msn) {
    const msnNum = parseMsn(aircraft.msn);
    if (!Number.isNaN(msnNum)) {
      const inRange = msnRanges.some((range) => {
        const from = range?.from != null && String(range.from) !== '' ? parseMsn(range.from) : Number.NEGATIVE_INFINITY;
        const to = range?.to != null && String(range.to) !== '' ? parseMsn(range.to) : Number.POSITIVE_INFINITY;
        if (Number.isNaN(from) || Number.isNaN(to)) return false;
        return msnNum >= from && msnNum <= to;
      });
      if (!inRange) return 'not_applicable';
    }
  }

  if (models.length > 0 || msnRanges.length > 0) {
    return 'applicable';
  }

  return 'unknown';
}

export function matchAircraftAgainstFragments(
  aircraft: ApplicabilityAircraftIdentity,
  fragments: ApplicabilityRuleFragment[],
): RuleMatchResult {
  if (!fragments?.length) {
    return {
      decision: 'unknown',
      matchedIds: [],
      unresolvedIds: [],
      reason: 'No rule fragments available for matching',
    };
  }

  const matchedIds: string[] = [];
  const unresolvedIds: string[] = [];
  let hasApplicable = false;
  let hasNotApplicable = false;

  for (const fragment of fragments) {
    const l0 = matchL0Identity(aircraft, fragment);
    if (l0 === 'applicable') {
      matchedIds.push(fragment.ruleFragmentId);
      hasApplicable = true;
      continue;
    }
    if (l0 === 'not_applicable') {
      hasNotApplicable = true;
      continue;
    }

    const l1 = matchL1Structural(aircraft, fragment);
    if (l1 === 'applicable') {
      matchedIds.push(fragment.ruleFragmentId);
      hasApplicable = true;
    } else if (l1 === 'not_applicable') {
      hasNotApplicable = true;
    } else {
      unresolvedIds.push(fragment.ruleFragmentId);
    }
  }

  let decision: RuleMatchDecision = 'unknown';
  if (hasApplicable && !hasNotApplicable && unresolvedIds.length === 0) {
    decision = 'applicable';
  } else if (hasApplicable && hasNotApplicable) {
    decision = 'partially_applicable';
  } else if (hasNotApplicable && !hasApplicable) {
    decision = 'not_applicable';
  } else if (unresolvedIds.length > 0) {
    decision = 'needs_review';
  }

  return {
    decision,
    matchedIds,
    unresolvedIds,
    reason: `L0/L1 match: applicable=${hasApplicable}, notApplicable=${hasNotApplicable}, unresolved=${unresolvedIds.length}`,
  };
}
