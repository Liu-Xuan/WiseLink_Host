import { resolveWorkItemMatter } from '../../client/src/pages/RelationGraphPage/work-item-matter-resolver';

function page(items: Array<{ matterId: string }>, nextCursor: string | null = null) {
  return { items, nextCursor, fileReadPerformed: false };
}

it('continues after a single match while a cursor remains', async () => {
  const calls: string[] = [];
  const result = await resolveWorkItemMatter('WI-1', async (input) => {
    calls.push(input.cursor ?? 'first');
    return input.cursor ? page([{ matterId: 'M-1' }]) : page([{ matterId: 'M-1' }], 'next');
  }, new AbortController().signal);
  expect(result).toEqual({ kind: 'unique', matterId: 'M-1' });
  expect(calls).toEqual(['first', 'next']);
});

it('does not treat an empty first page as final', async () => {
  const result = await resolveWorkItemMatter('WI-1', async (input) => (
    input.cursor ? page([{ matterId: 'M-2' }]) : page([], 'next')
  ), new AbortController().signal);
  expect(result).toEqual({ kind: 'unique', matterId: 'M-2' });
});

it('reports ambiguity only after two distinct registered matters are found', async () => {
  const result = await resolveWorkItemMatter('WI-1', async (input) => (
    input.cursor ? page([{ matterId: 'M-2' }]) : page([{ matterId: 'M-1' }], 'next')
  ), new AbortController().signal);
  expect(result).toEqual({ kind: 'ambiguous' });
});

it('rejects a repeated cursor instead of looping', async () => {
  await expect(resolveWorkItemMatter('WI-1', async () => page([], 'same'), new AbortController().signal))
    .rejects.toThrow('游标未推进');
});
