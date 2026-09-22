import type {
  EngineeringMatterDirectoryRequest,
  EngineeringMatterDirectoryResponse,
} from '@shared/api.interface';

export type DefaultMatterResolution =
  | { kind: 'unique'; matterId: string }
  | { kind: 'empty' };

type DirectoryPage = {
  items: Array<Pick<EngineeringMatterDirectoryResponse['items'][number], 'matterId'>>;
  nextCursor?: string | null;
};

type DirectoryLoader = (
  input: EngineeringMatterDirectoryRequest,
  signal: AbortSignal,
) => Promise<DirectoryPage>;

/**
 * Default graph entry only needs the first lawful matter: each page is fetched
 * with limit 1 and no item beyond the first is ever consumed. Unlike
 * resolveWorkItemMatter, which must traverse the whole directory to prove a
 * work item has exactly one matter, the default resolver may stop at the first
 * legal entry. Empty pages keep advancing until the directory ends.
 */
export async function resolveDefaultGraphMatter(
  load: DirectoryLoader,
  signal: AbortSignal,
): Promise<DefaultMatterResolution> {
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  while (!signal.aborted) {
    const directory = await load(
      cursor ? { limit: 1, cursor } : { limit: 1 },
      signal,
    );
    if (signal.aborted) return { kind: 'empty' };
    const first = directory.items.find(
      (item) => item.matterId.trim().length > 0,
    );
    if (first) return { kind: 'unique', matterId: first.matterId.trim() };
    if (!directory.nextCursor) return { kind: 'empty' };
    if (seenCursors.has(directory.nextCursor)) {
      throw new Error('工程事项目录游标未推进。');
    }
    seenCursors.add(directory.nextCursor);
    cursor = directory.nextCursor;
  }
  return { kind: 'empty' };
}
