import type {
  LcmMatrixPartCount,
  LcmMatrixQuery,
  LcmMatrixSoftwareIndex,
} from './lcm-matrix.interface';

const tailCollator: Intl.Collator = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'variant',
});
export const lcmNaturalCompare = (a: string, b: string): number =>
  tailCollator.compare(a, b);

export function lcmQueryModels(query: LcmMatrixQuery): string[] {
  return [...new Set([...(query.aircraftModels ?? []), ...(query.aircraftModel ? [query.aircraftModel] : [])])];
}

export function lcmModelMatches(model: string, selected?: string | readonly string[]): boolean {
  return !selected || (typeof selected === 'string' ? model === selected : !selected.length || selected.includes(model));
}

export function lcmSortedModels(models: string[]): string[] {
  const rank = (model: string): number => 'BAC'.indexOf(model.charAt(0).toUpperCase()) < 0
    ? 3 : 'BAC'.indexOf(model.charAt(0).toUpperCase());
  return [...new Set(models)].sort((a, b) => rank(a) - rank(b) || (rank(a) === 3 ? 0 : lcmNaturalCompare(a, b)));
}

export function lcmSoftwareRef(
  domain: string,
  name: string | null,
  recordRef: string,
): string {
  // Missing names remain separate unresolved records, never one invented software project.
  return JSON.stringify([
    'software',
    domain,
    name,
    name === null ? recordRef : null,
  ]);
}

export function lcmAircraftRef(domain: string, tail: string): string {
  return JSON.stringify(['aircraft', domain, tail]);
}

export function lcmSoftwareMatches(
  software: LcmMatrixSoftwareIndex,
  search: string,
  ata?: string,
  differencesOnly = false,
): boolean {
  const needle: string = search.trim().toLocaleLowerCase();
  return (
    (!ata || software.ata.includes(ata)) &&
    (!differencesOnly || software.knownInstalledSetDifference) &&
    (!needle ||
      [
        software.lcmSoftwareName ?? '',
        ...software.ata,
        ...software.systems,
        ...software.parts.map((p: LcmMatrixPartCount) => p.partNumber ?? ''),
        ...software.aliases.map((a: { alias: string }) => a.alias),
      ].some((v: string) => v.toLocaleLowerCase().includes(needle)))
  );
}
