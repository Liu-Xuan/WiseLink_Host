import { AsyncLocalStorage } from 'node:async_hooks';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sameScope } from './tdms-source.authorization';
import { tdmsError, type TdmsSourceScope } from './tdms-source.types';

// Carries only the caller's existing transaction, never identity or a grant cache.
const transactions = new AsyncLocalStorage<PostgresJsDatabase>();
// A request's optional conditional pin, not an identity/permission cache or a transferable credential.
const expectations = new AsyncLocalStorage<
  (database?: PostgresJsDatabase) => Promise<TdmsSourceScope>
>();

export function withTdmsReceiverExpectation<T>(
  check: (database?: PostgresJsDatabase) => Promise<TdmsSourceScope>,
  operation: () => Promise<T>,
): Promise<T> {
  return expectations.run(check, operation);
}

export function tdmsReceiverHasExpectation(): boolean {
  return expectations.getStore() !== undefined;
}

/** Rebuild the original pin's current server-authorized scope; never cache a grant. */
export async function tdmsReceiverExpectedScope(): Promise<
  TdmsSourceScope | undefined
> {
  return expectations.getStore()?.(transactions.getStore());
}

export async function assertTdmsReceiverScope(
  scope: TdmsSourceScope,
): Promise<void> {
  const expected = await tdmsReceiverExpectedScope();
  if (expected && !sameScope(expected, scope))
    throw tdmsError('TDMS_RECEIVER_IDENTITY_CHANGED', 409);
}

export function tdmsReceiverDatabase(): PostgresJsDatabase | undefined {
  return transactions.getStore();
}

export function withTdmsReceiverDatabase<T>(
  database: PostgresJsDatabase,
  operation: () => Promise<T>,
): Promise<T> {
  return transactions.run(database, async () => {
    const check = expectations.getStore();
    await check?.(database);
    const result = await operation();
    await check?.(database);
    return result;
  });
}
