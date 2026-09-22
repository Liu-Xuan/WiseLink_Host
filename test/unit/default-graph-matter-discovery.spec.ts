import type { EngineeringMatterDirectoryRequest } from '@shared/api.interface';
import {
  resolveDefaultGraphMatter,
  type DefaultMatterResolution,
} from '../../client/src/pages/RelationGraphPage/default-matter-resolver';

type DirectoryPage = {
  items: Array<{ matterId: string }>;
  nextCursor?: string | null;
};

type Loader = (
  input: EngineeringMatterDirectoryRequest,
  signal: AbortSignal,
) => Promise<DirectoryPage>;

function pageOf(matterIds: string[], nextCursor?: string): DirectoryPage {
  return { items: matterIds.map((matterId) => ({ matterId })), nextCursor };
}

describe('default graph matter discovery', () => {
  test('fetches limit-1 pages and stops at the first lawful matter', async () => {
    const calls: Array<EngineeringMatterDirectoryRequest> = [];
    const load: Loader = async (input) => {
      calls.push(input);
      if (!input.cursor) return pageOf(['   '], 'c1');
      if (input.cursor === 'c1') return pageOf(['  matter-2  '], 'c2');
      return pageOf(['matter-3']);
    };
    const resolution: DefaultMatterResolution = await resolveDefaultGraphMatter(
      load,
      new AbortController().signal,
    );
    expect(resolution).toEqual({ kind: 'unique', matterId: 'matter-2' });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ limit: 1 });
    expect(calls[1]).toEqual({ limit: 1, cursor: 'c1' });
  });

  test('keeps paging through empty pages and reports empty at the end', async () => {
    const calls: Array<EngineeringMatterDirectoryRequest> = [];
    const load: Loader = async (input) => {
      calls.push(input);
      if (!input.cursor) return pageOf([], 'c1');
      return pageOf([''], undefined);
    };
    const resolution = await resolveDefaultGraphMatter(
      load,
      new AbortController().signal,
    );
    expect(resolution).toEqual({ kind: 'empty' });
    expect(calls.map((call) => call.limit)).toEqual([1, 1]);
  });

  test('rejects a cursor that does not advance', async () => {
    const load: Loader = async () => pageOf([], 'same-cursor');
    await expect(
      resolveDefaultGraphMatter(load, new AbortController().signal),
    ).rejects.toThrow('工程事项目录游标未推进。');
  });

  test('aborts before the first request and after a blank page without reading more', async () => {
    const before = new AbortController();
    before.abort();
    const loadNever: Loader = async () => {
      throw new Error('must not be called after abort');
    };
    await expect(resolveDefaultGraphMatter(loadNever, before.signal)).resolves.toEqual({
      kind: 'empty',
    });

    const controller = new AbortController();
    let callCount = 0;
    const load: Loader = async () => {
      callCount += 1;
      controller.abort();
      return pageOf([], 'c1');
    };
    await expect(resolveDefaultGraphMatter(load, controller.signal)).resolves.toEqual({
      kind: 'empty',
    });
    expect(callCount).toBe(1);
  });
});
