import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DataPaasModule, DATAPAAS_CONFIG, DRIZZLE_DATABASE, DrizzleDatabaseManager,
  SqlExecutionContextMiddleware } = require('@lark-apaas/nestjs-datapaas');

/** Only an owned loopback cluster from owned-postgres-cluster.mjs is accepted.
 * Actual SDK manager, dynamic provider, trace proxy, request middleware and global
 * prepared-query patch are used. Only observability receives a local no-op sink. */
export async function lcmSdkDatabase(cluster) {
  if (cluster.instance.host !== '127.0.0.1' || cluster.instance.port !== cluster.expected.port ||
      !/^wiselink_tdms_test_[a-f0-9]{16}$/u.test(cluster.expected.database))
    throw new Error('LCM_SDK_TEST_OWNED_LOOPBACK_REQUIRED');
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16), roleSchema = 'lcm_' + suffix;
  const login = 'tdms_fixture_app_' + suffix;
  const authenticatedRole = 'authenticated_' + roleSchema, anonRole = 'anon_' + roleSchema,
    serviceRole = 'service_role_' + roleSchema;
  for (const role of [login, authenticatedRole, anonRole, serviceRole])
    await cluster.admin.unsafe(`CREATE ROLE ${role} ${role === login ? 'LOGIN' : 'NOLOGIN'} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
  await cluster.admin.unsafe(`GRANT ${authenticatedRole},${anonRole},${serviceRole} TO ${login}`);
  for (const role of [authenticatedRole, anonRole, serviceRole]) {
    await cluster.admin.unsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await cluster.admin.unsafe(`GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO ${role}`);
    await cluster.admin.unsafe(`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
  }
  const connectionString = `postgres://${login}@127.0.0.1:${cluster.expected.port}/${cluster.expected.database}?schema=${roleSchema}`;
  const definition = DataPaasModule.forRoot({ connectionString, maxConnections: 4,
    logger: false, ssl: false, autoContext: true });
  const config = definition.providers.find(provider => provider.provide === DATAPAAS_CONFIG).useValue;
  const span = { spanContext: () => ({ traceId: 'local-test', spanId: 'local-test' }), setAttribute() {}, end() {} };
  const manager = new DrizzleDatabaseManager(config, { startTrace: () => span, dropTrace() {} },
    { getContext: () => undefined });
  const provider = definition.providers.find(item => item.provide === DRIZZLE_DATABASE);
  const database = await provider.useFactory(manager);
  const middleware = new SqlExecutionContextMiddleware(config);
  return { database, middleware, manager, roles: { login, authenticatedRole, anonRole, serviceRole },
    withRequest(userContext, operation) {
      return new Promise((resolve, reject) => middleware.use({ userContext }, {}, () => {
        Promise.resolve().then(operation).then(resolve, reject);
      }));
    },
    async close() { await manager.onModuleDestroy(); },
  };
}
