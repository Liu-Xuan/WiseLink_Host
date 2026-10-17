export const LIBRARY_DIRECTORY_READING_KEYS = ['directorySession', 'directoryNodes', 'directoryY'] as const;

/** ATA layout has expandable chapters and one disclosure for unclassified chapters. */
export function libraryDirectoryNodeState(raw: string): Record<string, boolean> | null {
  if (!raw || raw.length > 1536 || /[\u0000-\u001f\u007f]/u.test(raw)) return null;
  const result: Record<string, boolean> = {};
  for (const entry of raw.split(',')) {
    const match: RegExpExecArray | null = /^(\d{2}|__UNKNOWN__|__RAW__|__ANOMALIES__):([01])$/u.exec(entry);
    if (!match || Object.prototype.hasOwnProperty.call(result, match[1])) return null;
    result[match[1]] = match[2] === '1';
  }
  return result;
}

export function libraryDirectoryReadingParams(params: URLSearchParams): URLSearchParams {
  const result: URLSearchParams = new URLSearchParams();
  const session: string = params.get('directorySession') ?? '';
  if (params.getAll('directorySession').length !== 1 || !/^\d{1,16}$/u.test(session) ||
    !Number.isSafeInteger(Number(session)) || String(Number(session)) !== session) return result;
  result.set('directorySession', session);
  const nodes: string = params.get('directoryNodes') ?? '';
  const state: Record<string, boolean> | null = libraryDirectoryNodeState(nodes);
  if (params.getAll('directoryNodes').length === 1 && state)
    result.set('directoryNodes', Object.keys(state).sort().map((key: string) => `${key}:${state[key] ? '1' : '0'}`).join(','));
  const y: string = params.get('directoryY') ?? '';
  if (params.getAll('directoryY').length === 1 && /^\d{1,7}$/u.test(y) && y.trim() === y) result.set('directoryY', y);
  return result;
}

export function clearLibraryDirectoryReading(params: URLSearchParams): void {
  for (const key of LIBRARY_DIRECTORY_READING_KEYS) params.delete(key);
}
