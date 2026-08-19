jest.mock('@lark-apaas/client-toolkit/logger', () => ({
  logger: { error: jest.fn() },
}));

import {
  readRecentWorkItems,
  rememberRecentWorkItem,
  workItemIdFromLocator,
} from '../../client/src/utils/recent-work-items';

describe('recent WorkItem navigation references', () => {
  const values: Map<string, string> = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: { origin: 'http://localhost:8081' },
        localStorage: {
          getItem: (key: string): string | null => values.get(key) ?? null,
          setItem: (key: string, value: string): void => {
            values.set(key, value);
          },
        },
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
  });

  it('keeps the latest display reference while deduplicating WorkItem identity', () => {
    rememberRecentWorkItem({
      workItemId: 'WI-001',
      family: 'BOEING_SB',
      documentLabel: 'SB 737-53-1295',
      documentVersionId: 'DV-001',
    });
    rememberRecentWorkItem({
      workItemId: 'WI-001',
      family: 'BOEING_SB',
      documentLabel: 'SB 737-53-1295 R2',
      documentVersionId: 'DV-002',
    });

    expect(readRecentWorkItems()).toEqual([
      expect.objectContaining({
        workItemId: 'WI-001',
        family: 'BOEING_SB',
        documentLabel: 'SB 737-53-1295 R2',
        documentVersionId: 'DV-002',
      }),
    ]);
  });

  it('resolves both a workbench route and a library query deep link', () => {
    expect(
      workItemIdFromLocator(
        'http://localhost:8081/work-items/WI-ROUTE-1/documents?node=reader',
      ),
    ).toBe('WI-ROUTE-1');
    expect(
      workItemIdFromLocator('http://localhost:8081/?workItemId=WI-QUERY-2'),
    ).toBe('WI-QUERY-2');
  });
});
