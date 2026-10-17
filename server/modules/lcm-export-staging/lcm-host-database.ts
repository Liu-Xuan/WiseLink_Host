import { sql } from 'drizzle-orm';
import { PostgresJsSession } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import type postgres from 'postgres';
import { lcmReadingError } from './lcm-source-reading.port';

interface LcmHostTransactions {
  run<T>(actorId: string, operation: (tx: postgres.TransactionSql) => Promise<T>): Promise<T>;
}

/** Standalone clients are explicitly injected by the existing local collector/tests only.
 * Host composition always supplies lcmHostDatabase; there is no connection fallback. */
export type LcmRepositoryDatabase = postgres.Sql | LcmHostTransactions;

export async function lcmTransaction<T>(database: LcmRepositoryDatabase, actorId: string,
  operation: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  if (typeof database === 'function') return await database.begin(operation) as T;
  return database.run(actorId, operation);
}

function isTransactionClient(value: unknown): value is postgres.TransactionSql {
  return typeof value === 'function' && typeof Reflect.get(value, 'unsafe') === 'function' &&
    typeof Reflect.get(value, 'savepoint') === 'function' && Reflect.get(value, 'begin') === undefined;
}

/** Resolve the injected SDK Proxy for every transaction, including after ZTI rotation.
 * The first Drizzle execute runs the SDK's actual request preSql/SET LOCAL ROLE on
 * that same transaction. Its exported PostgresJsSession then exposes the existing
 * transaction client to the candidate repositories; no new connection or role SQL. */
export function lcmHostDatabase(database: PostgresJsDatabase): LcmHostTransactions {
  return { async run<T>(actorId: string,
    operation: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    return database.transaction(async transaction => {
      const identity = await transaction.execute<{ userId: string | null; databaseRole: string }>(sql`
        SELECT nullif(current_setting('app.user_id',true),'') AS "userId",current_user AS "databaseRole"`);
      if (identity.length !== 1 || !actorId || identity[0].userId !== actorId ||
          !identity[0].databaseRole.startsWith('authenticated_'))
        throw lcmReadingError('LCM_DATABASE_REQUEST_IDENTITY_REQUIRED', 403);
      const session = transaction._.session;
      if (!(session instanceof PostgresJsSession) || !isTransactionClient(session.client))
        throw lcmReadingError('LCM_HOST_DATABASE_UNAVAILABLE', 503);
      return operation(session.client);
    });
  } };
}
