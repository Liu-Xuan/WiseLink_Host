import { constants } from 'node:fs';
import { access, mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

async function binary(name) {
  const roots = process.env.TDMS_PG_BIN_DIRECTORY
    ? [process.env.TDMS_PG_BIN_DIRECTORY]
    : (process.env.PATH ?? '').split(delimiter);
  for (const root of roots) {
    if (!root) continue;
    const path = join(root, name);
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {}
  }
  return null;
}
export async function postgresCapability() {
  const initdb = await binary('initdb'),
    engine = await binary('postgres');
  return {
    available: Boolean(initdb && engine),
    initdb,
    engine,
    reason:
      initdb && engine
        ? null
        : 'No existing PostgreSQL initdb/server binaries; no engine was installed',
  };
}
export function validateOwnedEndpoint(url, expected) {
  const u = new URL(url);
  if (
    !['postgres:', 'postgresql:'].includes(u.protocol) ||
    u.hostname !== '127.0.0.1' ||
    u.search ||
    u.hash ||
    u.password ||
    u.username !== 'tdms_test_owner' ||
    u.port !== String(expected.port) ||
    u.pathname !== `/${expected.database}` ||
    !/^wiselink_tdms_test_[a-f0-9]{16}$/.test(expected.database)
  )
    throw new Error('TDMS_ISOLATED_PG_OWNED_ENDPOINT_REQUIRED');
  return u;
}
async function command(file, args) {
  const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (v) => {
    out += v;
  });
  child.stderr.on('data', (v) => {
    out += v;
  });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (code !== 0)
    throw Object.assign(new Error('TDMS_ISOLATED_PG_COMMAND_FAILED'), {
      command: file,
      exitCode: code,
      diagnostic: out.slice(-2000),
    });
  return out;
}
async function unusedPort() {
  const server = createServer();
  await new Promise((r, j) =>
    server.listen(0, '127.0.0.1', r).once('error', j),
  );
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
export async function startOwnedPostgres(capability) {
  if (!capability.available) throw new Error('TDMS_ISOLATED_PG_ENGINE_ABSENT');
  // This runner never accepts a caller database URL or production environment fallback.
  const root = await mkdtemp(join(tmpdir(), 'wiselink-tdms-pg-'));
  const data = join(root, 'data');
  const expected = {
    port: null,
    database:
      'wiselink_tdms_test_' + randomUUID().replaceAll('-', '').slice(0, 16),
  };
  let engine;
  let boot;
  let admin;
  let exited = false;
  let engineExit = Promise.resolve();
  let stopping;
  const connections = [];
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  function stop() {
    if (!stopping) stopping = cleanup();
    return stopping;
  }
  async function cleanup() {
    for (const c of connections) await c.end({ timeout: 5 }).catch(() => {});
    if (admin) await admin.end({ timeout: 5 }).catch(() => {});
    if (boot) await boot.end({ timeout: 5 }).catch(() => {});
    if (engine?.pid && !exited) {
      engine.kill('SIGTERM');
      await Promise.race([engineExit, delay(5000)]);
      if (!exited) {
        engine.kill('SIGKILL');
        await Promise.race([engineExit, delay(5000)]);
      }
      if (!exited) throw new Error('TDMS_ISOLATED_PG_CLEANUP_PROCESS_TIMEOUT');
    }
    await rm(root, { recursive: true, force: true });
  }
  try {
    await mkdir(data);
    expected.port = await unusedPort();
    await command(capability.initdb, [
      '-D',
      data,
      '-U',
      'tdms_test_owner',
      '--auth=trust',
      '--encoding=UTF8',
      '--locale=C',
      '--no-instructions',
    ]);
    engine = spawn(
      capability.engine,
      [
        '-D',
        data,
        '-h',
        '127.0.0.1',
        '-p',
        String(expected.port),
        '-k',
        '',
        '-c',
        'fsync=off',
        '-c',
        'full_page_writes=off',
        '-c',
        'synchronous_commit=off',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let engineError;
    engineExit = new Promise((resolve) => {
      engine.once('exit', () => {
        exited = true;
        resolve();
      });
      engine.once('error', (error) => {
        engineError = error;
        // ChildProcess error also covers failed kill attempts; only no-pid spawn failure proves exit.
        if (!engine.pid) {
          exited = true;
          resolve();
        }
      });
    });
    let diagnostics = '';
    engine.stderr.on('data', (v) => {
      diagnostics = (diagnostics + v).slice(-3000);
    });
    boot = postgres(
      `postgres://tdms_test_owner@127.0.0.1:${expected.port}/postgres`,
      { max: 1, prepare: false, connect_timeout: 1, onnotice() {} },
    );
    let ready = false;
    for (let i = 0; i < 50; i++) {
      if (engineError) throw new Error('TDMS_ISOLATED_PG_PROCESS_START_ERROR');
      if (exited)
        throw Object.assign(new Error('TDMS_ISOLATED_PG_START_FAILED'), {
          diagnostic: diagnostics,
        });
      try {
        await boot`SELECT 1`;
        ready = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (!ready) throw new Error('TDMS_ISOLATED_PG_START_TIMEOUT');
    // inet::text retains the /32 mask; host(inet) preserves exact address comparison.
    const [instance] =
      await boot`SELECT current_setting('data_directory') AS directory,host(inet_server_addr()) AS host,inet_server_port() AS port`;
    if (
      (await realpath(instance.directory)) !== (await realpath(data)) ||
      instance.host !== '127.0.0.1' ||
      instance.port !== expected.port
    )
      throw new Error('TDMS_ISOLATED_PG_INSTANCE_OWNERSHIP_MISMATCH');
    await boot.unsafe(`CREATE DATABASE ${expected.database}`);
    const url = `postgres://tdms_test_owner@127.0.0.1:${expected.port}/${expected.database}`;
    validateOwnedEndpoint(url, expected);
    admin = postgres(url, { max: 1, prepare: false, onnotice() {} });
    const [identity] =
      await admin`SELECT current_database() AS name,pg_postmaster_start_time() AS started`;
    if (identity.name !== expected.database)
      throw new Error('TDMS_ISOLATED_PG_DATABASE_MISMATCH');
    return {
      admin,
      expected,
      root,
      data,
      instance,
      identity,
      async connect(applicationUser = 'tdms_test_owner') {
        if (
          applicationUser !== 'tdms_test_owner' &&
          !/^tdms_fixture_app_[a-f0-9]{16}$/u.test(applicationUser)
        )
          throw new Error('TDMS_ISOLATED_PG_APPLICATION_LOGIN_INVALID');
        const applicationUrl = new URL(url);
        applicationUrl.username = applicationUser;
        const c = postgres(applicationUrl.href, {
          max: 1,
          prepare: false,
          onnotice() {},
        });
        connections.push(c);
        return c;
      },
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
