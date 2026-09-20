import type {
  EngineeringMatterDirectoryRequest,
  EngineeringMatterDirectoryResponse,
} from '@shared/api.interface';

export type WorkItemMatterResolution =
  | { kind: 'unique'; matterId: string }
  | { kind: 'empty' }
  | { kind: 'ambiguous' };

type DirectoryPage = {
  items: Array<Pick<EngineeringMatterDirectoryResponse['items'][number], 'matterId'>>;
  nextCursor?: string | null;
};

type DirectoryLoader = (
  input: EngineeringMatterDirectoryRequest,
  signal: AbortSignal,
) => Promise<DirectoryPage>;

/**
 * Resolves a work item only after its complete authorized directory has been
 * traversed. A page containing one match is not sufficient while a cursor
 * remains, and an empty page is not final while the directory continues.
 */
export async function resolveWorkItemMatter(
  workItemId: string,
  load: DirectoryLoader,
  signal: AbortSignal,
): Promise<WorkItemMatterResolution> {
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  const matterIds = new Set<string>();
  while (true) {
    const directory = await load(
      cursor ? { workItemId, limit: 20, cursor } : { workItemId, limit: 20 },
      signal,
    );
    if (signal.aborted) return { kind: 'empty' };
    directory.items.forEach((item) => {
      const matterId = item.matterId.trim();
      if (matterId) matterIds.add(matterId);
    });
    if (matterIds.size > 1) return { kind: 'ambiguous' };
    if (!directory.nextCursor) break;
    if (seenCursors.has(directory.nextCursor)) {
      throw new Error('工程事项目录游标未推进。');
    }
    seenCursors.add(directory.nextCursor);
    cursor = directory.nextCursor;
  }
  const [matterId] = [...matterIds];
  return matterId ? { kind: 'unique', matterId } : { kind: 'empty' };
}
