import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import type { EngineeringMatterDirectoryResponse } from '@shared/api.interface';
import useMatterDirectory from '../../client/src/features/matter/useMatterDirectory';
import { getEngineeringMatterDirectory } from '@client/src/api/engineering-matter';

jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => 1,
}));
jest.mock('@client/src/api/engineering-matter', () => ({
  getEngineeringMatterDirectory: jest.fn(),
}));

const readDirectory = jest.mocked(getEngineeringMatterDirectory);

function response(matterId: string, nextCursor: string | null = null): EngineeringMatterDirectoryResponse {
  return {
    items: [{
      matterId,
      title: matterId,
      primaryWorkItemId: null,
      createdAt: '2026-09-20',
      updatedAt: '2026-09-20',
      currentMatterRevisionId: 'MR-1',
      workingRevision: 1,
      result: null,
    }],
    nextCursor,
    fileReadPerformed: false,
  };
}

let current: ReturnType<typeof useMatterDirectory>;
let setRevision: (value: number) => void;

function Probe() {
  const [revision, updateRevision] = useState(0);
  setRevision = updateRevision;
  current = useMatterDirectory('', '', 1, true, revision);
  return createElement('output', null, `${current.loading}:${current.items.map((item) => item.matterId).join(',')}`);
}

describe('useMatterDirectory refresh generation', () => {
  let dom: JSDOM;
  let root: Root;

  beforeEach(() => {
    dom = new JSDOM('<div id="root"></div>');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
    readDirectory.mockReset();
    root = createRoot(dom.window.document.getElementById('root')!);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    dom.window.close();
  });

  it('shows the refreshed directory and rejects the superseded response', async () => {
    let resolveInitial!: (value: EngineeringMatterDirectoryResponse) => void;
    let resolveRefresh!: (value: EngineeringMatterDirectoryResponse) => void;
    let resolveNext!: (value: EngineeringMatterDirectoryResponse) => void;
    readDirectory
      .mockImplementationOnce(() => new Promise((resolve) => { resolveInitial = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNext = resolve; }));

    await act(async () => root.render(createElement(Probe)));
    await act(async () => setRevision(1));
    await act(async () => resolveRefresh(response('MAT-NEW', 'new-next')));
    expect(current.items.map((item) => item.matterId)).toEqual(['MAT-NEW']);
    expect(current.loading).toBe(false);
    expect(current.nextCursor).toBe('new-next');

    await act(async () => current.loadMore());
    expect(readDirectory).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'new-next' }),
      expect.any(AbortSignal),
    );
    await act(async () => resolveNext(response('MAT-NEXT')));
    expect(current.items.map((item) => item.matterId)).toEqual([
      'MAT-NEW',
      'MAT-NEXT',
    ]);

    await act(async () => resolveInitial(response('MAT-OLD', 'old-next')));
    expect(current.items.map((item) => item.matterId)).toEqual([
      'MAT-NEW',
      'MAT-NEXT',
    ]);
    expect(current.nextCursor).toBeNull();
  });
});
