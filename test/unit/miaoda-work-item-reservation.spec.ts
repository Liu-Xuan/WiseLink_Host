import { MiaodaWorkItemRepository } from '../../server/modules/work-item/miaoda-work-item.repository';
import { actionAttempt } from '../../server/database/schema';

interface StoredWorkItem {
  workItemId: string;
  requestId: string;
  tenantId: string;
  actionType: string;
  documentId: string;
  documentVersionId: string;
  sourceArtifactId: string;
  sourceFileSha256: string;
  sourceByteLength: number;
  normalizedFamily: string;
  runKey: string;
}

interface StoredAttempt {
  attemptId: string;
  workItemId: string;
  actionType: string;
  attemptNo: number;
}

interface FixtureDatabase {
  insert: jest.Mock;
  select: jest.Mock;
  transaction: jest.Mock;
}

function database() {
  const workItems: StoredWorkItem[] = [];
  const attempts: StoredAttempt[] = [];
  let selectedKind: 'work-item' | 'attempt' = 'work-item';
  let failActionAttemptInsert = false;

  const db: FixtureDatabase = {
    insert: jest.fn((table: unknown) => {
      const kind: 'work-item' | 'attempt' =
        table === actionAttempt ? 'attempt' : 'work-item';
      return {
        values: (value: StoredWorkItem | StoredAttempt) => ({
          onConflictDoNothing: () => {
            if (kind === 'attempt' && failActionAttemptInsert) {
              throw new Error('ACTION_ATTEMPT_INSERT_FAILED');
            }
            if (kind === 'attempt') {
              const row = value as StoredAttempt;
              const existing = attempts.find(
                (current) =>
                  current.workItemId === row.workItemId &&
                  current.actionType === row.actionType &&
                  current.attemptNo === row.attemptNo,
              );
              if (!existing) attempts.push(row);
            }
            return {
            returning: async () => {
              if (kind === 'work-item') {
                const row = value as StoredWorkItem;
                const existing = workItems.find(
                  (current) =>
                    current.tenantId === row.tenantId &&
                    current.actionType === row.actionType &&
                    current.documentVersionId === row.documentVersionId &&
                    current.runKey === row.runKey,
                );
                if (existing) return [];
                workItems.push(row);
                return [{ workItemId: row.workItemId }];
              }
              const row = value as StoredAttempt;
              return [{ attemptId: row.attemptId }];
            },
          };
          },
        }),
      };
    }),
    select: jest.fn(() => ({
      from: (table: unknown) => {
        selectedKind = table === actionAttempt
          ? 'attempt'
          : 'work-item';
        return {
          where: () => ({
            limit: async () => [
              selectedKind === 'work-item'
                ? workItems[workItems.length - 1]
                : attempts[attempts.length - 1],
            ].filter(Boolean),
          }),
        };
      },
    })),
    transaction: jest.fn(
      async (callback: (transaction: FixtureDatabase) => unknown) => {
        const workItemsSnapshot = [...workItems];
        const attemptsSnapshot = [...attempts];
        try {
          return await callback(db);
        } catch (error) {
          workItems.splice(0, workItems.length, ...workItemsSnapshot);
          attempts.splice(0, attempts.length, ...attemptsSnapshot);
          throw error;
        }
      },
    ),
  };
  return {
    db,
    workItems,
    attempts,
    failActionAttemptInsert: (value: boolean) => {
      failActionAttemptInsert = value;
    },
  };
}

function input(runKey: string) {
  return {
    tenantId: 'tenant-2001',
    actorUserId: 'engineer-1001',
    documentId: 'document-sb',
    documentVersionId: 'document-version-sb',
    sourceArtifactId: 'artifact-sb',
    sourceFileSha256: 'a'.repeat(64),
    sourceByteLength: 1024,
    normalizedFamily: 'SB',
    requestOrigin: 'MIAODA' as const,
    runKey,
  };
}

describe('MiaodaWorkItemRepository reservation identity', () => {
  it('reuses the same run key and creates a distinct WorkItem for another key', async () => {
    const { db, workItems } = database();
    const repository = new MiaodaWorkItemRepository(db as never);

    const first = await repository.reserve(input('dev:first'));
    const retry = await repository.reserve(input('dev:first'));
    const second = await repository.reserve(input('dev:second'));

    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(retry.workItemId).toBe(first.workItemId);
    expect(second.created).toBe(true);
    expect(second.workItemId).not.toBe(first.workItemId);
    expect(workItems).toHaveLength(2);
  });

  it('rolls back the WorkItem when the first ActionAttempt insert fails', async () => {
    const { db, workItems, attempts, failActionAttemptInsert } = database();
    const repository = new MiaodaWorkItemRepository(db as never);
    failActionAttemptInsert(true);

    await expect(repository.reserve(input('dev:rollback'))).rejects.toThrow(
      'ACTION_ATTEMPT_INSERT_FAILED',
    );
    expect(workItems).toHaveLength(0);
    expect(attempts).toHaveLength(0);
  });
});
