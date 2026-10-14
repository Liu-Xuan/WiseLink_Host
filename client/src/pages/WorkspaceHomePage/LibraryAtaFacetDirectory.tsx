import { ataDirectoryCode, buildLibraryAtaFacets, type AtaTitleScheme } from './library-ata-directory';

/** Chapter expansion is navigation; leaf selection retains Host's exact raw-value filter. */
export function LibraryAtaFacetDirectory({ counts, selected, scheme = 'ispec', disabled, onSelect }: {
  counts: Record<string, number>;
  selected: string;
  scheme?: AtaTitleScheme;
  disabled?: boolean;
  onSelect: (rawValue: string) => void;
}) {
  const selectedChapter = ataDirectoryCode(selected)?.ata2;
  return <nav className="suite-ata-facets" aria-label="ATA 章节分组">
    {buildLibraryAtaFacets(counts, scheme).map(chapter => <details key={chapter.key}
      open={chapter.key === selectedChapter || chapter.entries.some(entry => entry.value === selected) || undefined}>
      <summary>{chapter.label}</summary>
      {chapter.entries.map(entry => <button type="button" key={entry.value}
        className={`suite-folder-row${selected === entry.value ? ' active' : ''}`}
        disabled={disabled || !entry.value.trim()} aria-pressed={selected === entry.value}
        title={`原始 ATA：${entry.value || '空值'}；${entry.count} 个文档族`}
        onClick={() => onSelect(entry.value)}>
        <span>{entry.label}</span>
        <small>{entry.count}</small>
      </button>)}
    </details>)}
  </nav>;
}
