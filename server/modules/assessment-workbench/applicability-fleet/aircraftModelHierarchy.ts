/**
 * WiseLink 3.1 applicability-fleet: aircraft model hierarchy matching.
 *
 * Migrated from the mature v8 source-level reference (aircraftModelHierarchy
 * semantics exercised by applicabilityRuleMatcher.test.js and
 * applicabilityKleeneEngine.test.js) onto WiseLink 3.1 field names.
 * Family/branch/minor-model semantics:
 * - family-only patterns ("787", "777", "A320") match every asset in family,
 *   including sub-branch assets reached through aircraftModel/series, but a
 *   fleetFamily with a leftover suffix (e.g. "A320s") only matches when the
 *   pattern itself pins that exact family string;
 * - branch patterns ("737NG", "737MAX") match only that branch below B737;
 * - minor-model patterns ("787-8", "737-800") additionally pin the minor
 *   model, so "787-8" never matches a B787-9 asset and "737NG" never matches
 *   a MAX asset.
 */

export interface AircraftModelHierarchy {
  fleetFamily?: string | null;
  series?: string | null;
  aircraftModel?: string | null;
  model?: string | null;
}

interface ParsedModelToken {
  family: string | null;
  branch: string | null;
  minor: string | null;
  /** Non-variant leftovers (e.g. the "S" in "A320s"); '' for clean tokens. */
  rest: string;
}

const EMPTY_TOKEN: ParsedModelToken = {
  family: null,
  branch: null,
  minor: null,
  rest: '',
};

const MAKER_PREFIX = /^(?:BOEING|AIRBUS|COMAC|EMBRAER|BOMBARDIER)\s+/iu;

function normalizeToken(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function parseModelToken(raw: unknown): ParsedModelToken {
  const text = normalizeToken(raw).replace(MAKER_PREFIX, '');
  if (!text) return EMPTY_TOKEN;
  const match = text.match(/^([A-Z]?)(\d{2,4})(.*)$/u);
  if (!match) return EMPTY_TOKEN;
  const [, letter, digits, tail] = match;
  const family = `${letter || 'B'}${digits}`;
  const restCompact = tail.replace(/[^A-Z0-9]/gu, '');

  if (family === 'B737') {
    if (restCompact.startsWith('MAX')) {
      return { family, branch: 'MAX', minor: null, rest: '' };
    }
    if (restCompact.startsWith('NG')) {
      return { family, branch: 'NG', minor: null, rest: '' };
    }
    const leadingDigits = restCompact.match(/^(\d+)/u)?.[1] ?? '';
    if (leadingDigits.length === 1) {
      // ICAO minor model (737-8) is the MAX branch.
      return { family, branch: 'MAX', minor: leadingDigits, rest: '' };
    }
    if (leadingDigits.length >= 2) {
      // Boeing customer-code suffix (737-89L) or 3-digit minor (737-800) is NG.
      return { family, branch: 'NG', minor: `${leadingDigits[0]}00`, rest: '' };
    }
    return { family, branch: null, minor: null, rest: restCompact };
  }

  if (family === 'B777') {
    // 777F freighter stays below the 777 family for family-only patterns.
    if (restCompact.includes('F')) {
      return { family, branch: 'F', minor: null, rest: '' };
    }
    return { family, branch: null, minor: null, rest: restCompact };
  }

  const minor = restCompact.match(/^(\d{1,3})/u)?.[1] ?? null;
  const nonMinorRest = minor ? restCompact.slice(minor.length) : restCompact;
  return { family, branch: null, minor, rest: nonMinorRest };
}

function tokenMatches(asset: ParsedModelToken, pattern: ParsedModelToken): boolean {
  if (!pattern.family || !asset.family) return false;
  if (pattern.family !== asset.family) return false;
  if (pattern.branch) {
    if (!asset.branch || pattern.branch !== asset.branch) return false;
  }
  if (pattern.minor) {
    if (!asset.minor || pattern.minor !== asset.minor) return false;
  }
  return true;
}

function familyOnlyTokenMatches(asset: ParsedModelToken, pattern: ParsedModelToken): boolean {
  // A fleetFamily candidate only satisfies a pattern when the family token is
  // clean (no branch/minor/leftover letters), so "A320s" never proves a bare
  // "A320" pattern for an A319 asset.
  if (asset.branch || asset.minor || asset.rest) return false;
  return tokenMatches(asset, pattern);
}

export function buildAircraftModelHierarchy(source: AircraftModelHierarchy): AircraftModelHierarchy {
  return {
    fleetFamily: source.fleetFamily ?? null,
    series: source.series ?? null,
    aircraftModel: source.aircraftModel ?? null,
    model: source.model ?? null,
  };
}

export function aircraftModelHierarchyMatches(
  hierarchy: AircraftModelHierarchy,
  model: unknown,
): boolean {
  const pattern = parseModelToken(model);
  if (!pattern.family) return false;

  const modelCandidates = [hierarchy.aircraftModel, hierarchy.model, hierarchy.series]
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '');
  if (modelCandidates.some((candidate) => tokenMatches(parseModelToken(candidate), pattern))) {
    return true;
  }

  if (typeof hierarchy.fleetFamily === 'string' && hierarchy.fleetFamily.trim() !== '') {
    return familyOnlyTokenMatches(parseModelToken(hierarchy.fleetFamily), pattern);
  }
  return false;
}
