import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import original from '@client/src/features/atlas/data/ata-catalog.json';
import projected from '@client/src/pages/WorkspaceHomePage/library-ata-titles.generated.json';
import { ataDirectoryTitles, type AtaTitleScheme } from '@client/src/pages/WorkspaceHomePage/library-ata-directory';

// Independent reference using the complete catalog and the original public
// function's ordering, title grouping, and source-locator deduplication.
function originalTitles(code: string, scheme: AtaTitleScheme) {
  const source = original.schemes[scheme];
  const rows = (code.length === 2 ? source.chapters : source.expanded).filter(row => row.code === code);
  const result: { titleZH: string; titleEN: string; sources: string[] }[] = [];
  for (const row of rows) {
    if (!row.titleZH && !row.titleEN) continue;
    let title = result.find(value => value.titleZH === row.titleZH && value.titleEN === row.titleEN);
    if (!title) {
      title = { titleZH: row.titleZH, titleEN: row.titleEN, sources: [] };
      result.push(title);
    }
    const locator = `${row.file} · ${row.locator}`;
    if (!title.sources.includes(locator)) title.sources.push(locator);
  }
  return result;
}

describe('synchronous library ATA title projection', () => {
  it('is reproducibly generated from the only complete catalog, including its source date', () => {
    expect(execFileSync(process.execPath, ['scripts/generate-library-ata-titles.mjs', '--check'], {
      cwd: resolve(__dirname, '../..'), encoding: 'utf8',
    })).toContain('matches the complete attachment catalog');
    expect(projected.asOf).toBe(original.asOf);
    expect(Object.keys(projected.schemes)).toEqual(Object.keys(original.schemes));
    for (const scheme of ['ispec', 'jasc'] as const) {
      for (const section of ['chapters', 'expanded'] as const) {
        expect(projected.schemes[scheme][section]).toEqual(original.schemes[scheme][section].map(
          ({ code, titleZH, titleEN, file, locator }) => ({ code, titleZH, titleEN, file, locator }),
        ));
      }
    }
  });

  it.each(['ispec', 'jasc'] as const)('preserves every code, bilingual title, row order and locator in %s', scheme => {
    const source = original.schemes[scheme];
    const codes = new Set([...source.chapters, ...source.expanded].map(row => row.code));
    for (const code of [...codes, '', '__UNKNOWN__', '99-99', '23-10-00', ' 23', '2310']) {
      expect(ataDirectoryTitles(code, scheme)).toEqual(originalTitles(code, scheme));
    }
  });

  it('returns immediately on first use and from the module cache on repeated/concurrent use, without shared mutable results', async () => {
    const first = ataDirectoryTitles('45-45', 'ispec');
    expect(Array.isArray(first)).toBe(true);
    expect(first.flatMap(title => title.sources)).toHaveLength(2);
    first[0].titleEN = 'mutated by caller';
    first[0].sources.push('not a source');
    const concurrent = await Promise.all(Array.from({ length: 8 }, () =>
      Promise.resolve().then(() => ataDirectoryTitles('45-45', 'ispec')),
    ));
    for (const titles of concurrent) expect(titles).toEqual(originalTitles('45-45', 'ispec'));
    expect(concurrent[0]).not.toBe(concurrent[1]);
    expect(concurrent[0][0].sources).not.toBe(concurrent[1][0].sources);
    expect(ataDirectoryTitles('23-10', 'jasc')[0].titleEN).toBe('HF Communications System');
    expect(ataDirectoryTitles('23-10', 'ispec')[0].titleEN).toBe('Speech Communications');
  });
});
