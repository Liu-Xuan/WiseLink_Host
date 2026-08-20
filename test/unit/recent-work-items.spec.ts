jest.mock('@lark-apaas/client-toolkit/logger', () => ({
  logger: { error: jest.fn() },
}));

import {
  forgetRecentWorkItem,
  readRecentWorkItems,
  rememberRecentWorkItem,
  workItemIdFromLocator,
} from '../../client/src/utils/recent-work-items';

describe('recent WorkItem navigation references', () => {
  const identity = { userId: 'user-1', tenantId: 'tenant-1' };
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
          removeItem: (key: string): void => {
            values.delete(key);
          },
        },
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
  });

  it('keeps the latest display reference while deduplicating WorkItem identity', () => {
    rememberRecentWorkItem(identity, {
      workItemId: 'WI-001',
      family: 'BOEING_SB',
      documentLabel: 'SB 737-53-1295',
      documentVersionId: 'DV-001',
    });
    rememberRecentWorkItem(identity, {
      workItemId: 'WI-001',
      family: 'BOEING_SB',
      documentLabel: 'SB 737-53-1295 R2',
      documentVersionId: 'DV-002',
    });

    expect(readRecentWorkItems(identity)).toEqual([
      expect.objectContaining({
        workItemId: 'WI-001',
        family: 'BOEING_SB',
        documentLabel: 'SB 737-53-1295 R2',
        documentVersionId: 'DV-002',
      }),
    ]);
  });

  it('isolates recent metadata by exact tenant and user identity', () => {
    rememberRecentWorkItem(identity, {
      workItemId: 'WI-IDENTITY-1',
      family: 'SB',
      documentLabel: 'secret label',
      documentVersionId: 'DV-IDENTITY-1',
    });

    expect(readRecentWorkItems({ ...identity, userId: 'user-2' })).toEqual([]);
    expect(readRecentWorkItems({ ...identity, tenantId: 'tenant-2' })).toEqual(
      [],
    );
    expect(readRecentWorkItems(identity)).toHaveLength(1);
  });

  it('removes cached object metadata after a direct-ID denial', () => {
    rememberRecentWorkItem(identity, {
      workItemId: 'WI-DENIED',
      family: 'SB',
      documentLabel: 'must disappear',
      documentVersionId: 'DV-DENIED',
    });

    forgetRecentWorkItem(identity, 'WI-DENIED');

    expect(readRecentWorkItems(identity)).toEqual([]);
    expect([...values.values()].join('\n')).not.toContain('must disappear');
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
