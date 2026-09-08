export type LibraryViewMode = 'document' | 'matter' | 'tasks';

export function libraryViewMode(params: URLSearchParams): LibraryViewMode {
  if (params.get('mode') === 'matter') return 'matter';
  if (params.get('mode') === 'tasks' || params.get('workItemId')?.trim())
    return 'tasks';
  return 'document';
}
