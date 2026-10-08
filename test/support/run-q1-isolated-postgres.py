"""Run offline Q1 tests only in a new verified owned loopback PostgreSQL cluster."""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import subprocess
import tempfile
import time
import uuid

repo = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--include-baseline', action='store_true', help='Also run the unchanged historical DB suite.')
parser.add_argument('--include-scope', action='store_true', help='Also run SDK SQL isolation; off by default.')
parser.add_argument('--include-matter', action='store_true', help='Also run the Matter DB suite; off by default.')
parser.add_argument('--only-matter', action='store_true', help='Run only Matter, incompatible with baseline/scope.')
parser.add_argument('--test-name-pattern', help='Optional focused Node pattern; actual skip counts are recorded.')
parser.add_argument('--output-dir', type=Path, help='New evidence directory; existing paths are rejected.')
parser.add_argument('--pg-bin-directory', type=Path, default=Path('/opt/homebrew/bin'))
parser.add_argument('--pg-share-directory', type=Path, help='Optional existing initdb share directory.')
parser.add_argument('--expected-pg-version', help='Exact server_version_num, e.g. 140017.')
parser.add_argument('--node-binary', type=Path, default=Path(shutil.which('node') or 'node'))
options = parser.parse_args()
if options.only_matter and (options.include_baseline or options.include_scope):
    parser.error('--only-matter cannot be combined with --include-baseline or --include-scope')
if options.expected_pg_version and not re.fullmatch(r'[0-9]{5,6}', options.expected_pg_version):
    parser.error('--expected-pg-version must be an exact numeric server_version_num')
if options.output_dir:
    output = options.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=False)
else:
    output = Path(tempfile.mkdtemp(prefix='q1-test-results-', dir=repo.parent))
base = Path(tempfile.mkdtemp(prefix='q1-owned-pg-', dir=output)).resolve()
cluster = base / 'data'
token = uuid.uuid4().hex[:16]
role = 'codex_q1_' + token
with socket.socket() as probe:
    probe.bind(('127.0.0.1', 0))
    port = probe.getsockname()[1]
pg_bin = options.pg_bin_directory.resolve()
node_binary = options.node_binary.resolve()
# No inherited credentials, PG*/DATABASE_URL, provider or business environment.
clean_env = {key: os.environ[key] for key in
             ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'LANG'] if key in os.environ}
clean_env['LC_ALL'] = 'C'
metadata = {'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'host': '127.0.0.1', 'port': port, 'role': role, 'cluster': str(cluster),
            'pgBin': str(pg_bin), 'nodeBinary': str(node_binary), 'tests': [],
            'testNamePattern': options.test_name_pattern, 'ownershipVerified': False,
            'inheritedDbOrBusinessEnvironment': False,
            'optionalScopeEnabled': options.include_scope,
            'optionalMatterEnabled': options.include_matter or options.only_matter,
            'livePlatformOrModelCalls': False}
engine = None
engine_log = None
exit_code = 1


def run(command, timeout=30):
    result = subprocess.run(command, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, env=clean_env, timeout=timeout)
    if result.returncode:
        raise RuntimeError(json.dumps({'command': command, 'exitCode': result.returncode,
                                       'output': result.stdout[-5000:]}))
    return result.stdout.strip()


def identity(database='postgres'):
    return json.loads(run([str(pg_bin / 'psql'), '-X', '-v', 'ON_ERROR_STOP=1', '-A', '-t',
        '-h', '127.0.0.1', '-p', str(port), '-U', role, '-d', database, '-c',
        "SELECT json_build_object('directory',current_setting('data_directory'),"
        "'host',host(inet_server_addr()),'port',inet_server_port(),'database',current_database(),"
        "'role',current_user,'version',current_setting('server_version_num'))"]))


try:
    assert node_binary.is_file(), 'EXISTING_NODE_BINARY_REQUIRED'
    run([str(pg_bin / 'initdb'), '-D', str(cluster), '-U', role,
         '--auth-local=trust', '--auth-host=trust', '--encoding=UTF8', '--locale=C',
         *(['-L', str(options.pg_share_directory.resolve())] if options.pg_share_directory else [])])
    engine_log = (base / 'postgres.log').open('w')
    # Retain the exact child handle; never discover or stop a pre-existing server.
    engine = subprocess.Popen([str(pg_bin / 'postgres'), '-D', str(cluster),
        '-h', '127.0.0.1', '-p', str(port), '-k', ''], env=clean_env,
        stdin=subprocess.DEVNULL, stdout=engine_log, stderr=subprocess.STDOUT)
    metadata['pid'] = engine.pid
    for _ in range(50):
        if engine.poll() is not None:
            raise RuntimeError('OWNED_POSTGRES_START_FAILED')
        try:
            instance = identity()
            break
        except RuntimeError:
            time.sleep(.1)
    else:
        raise RuntimeError('OWNED_POSTGRES_START_TIMEOUT')
    pid_lines = (cluster / 'postmaster.pid').read_text().splitlines()
    assert Path(instance['directory']).resolve() == cluster.resolve(), 'DATA_DIRECTORY_MISMATCH'
    assert instance['host'] == '127.0.0.1' and instance['port'] == port, 'ENDPOINT_MISMATCH'
    assert instance['database'] == 'postgres' and instance['role'] == role, 'BOOTSTRAP_IDENTITY_MISMATCH'
    assert int(pid_lines[0]) == engine.pid and Path(pid_lines[1]).resolve() == cluster.resolve()
    assert int(pid_lines[3]) == port, 'POSTMASTER_PID_PORT_MISMATCH'
    if options.expected_pg_version:
        assert instance['version'] == options.expected_pg_version, 'REQUESTED_SERVER_VERSION_MISMATCH'
    metadata['instance'] = instance
    metadata['ownershipVerified'] = True
    files = ['test/node/q1-review-work-dependencies-postgres.test.mjs']
    if options.include_baseline:
        files.insert(0, 'test/node/jobaid-work-postgres.test.mjs')
    if options.include_scope:
        files.append('test/node/dialogue-browser-scope-postgres.test.mjs')
    if options.include_matter:
        files.append('test/node/engineering-matter-postgres.test.mjs')
    if options.only_matter:
        files = ['test/node/engineering-matter-postgres.test.mjs']
    for index, test_file in enumerate(files):
        is_scope = test_file == 'test/node/dialogue-browser-scope-postgres.test.mjs'
        is_matter = test_file == 'test/node/engineering-matter-postgres.test.mjs'
        database = ('wiselink_dialogue_test' if is_scope else 'wiselink_engineering_matter_test'
                    if is_matter else f'wiselink_jobaid_test_q1_{token}_{index}')
        run([str(pg_bin / 'createdb'), '-h', '127.0.0.1', '-p', str(port), '-U', role, database])
        database_identity = identity(database)
        assert database_identity == {**instance, 'database': database}, 'NEW_DATABASE_OWNERSHIP_MISMATCH'
        env = clean_env.copy()
        env['DIALOGUE_TEST_DATABASE_URL' if is_scope else 'ENGINEERING_MATTER_TEST_DATABASE_URL'
            if is_matter else 'JOBAID_WORK_TEST_DATABASE_URL'] = f'postgresql://{role}@127.0.0.1:{port}/{database}'
        command = [str(node_binary), '--test', '--test-reporter=tap',
                   *(['--test-name-pattern', options.test_name_pattern] if options.test_name_pattern else []), test_file]
        before = time.monotonic()
        result = subprocess.run(command, cwd=repo, env=env, text=True, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, timeout=240)
        log = output / (Path(test_file).stem + '.tap')
        log.write_text(result.stdout)
        counts = {key: int(matches[-1]) for key in ['tests', 'pass', 'fail', 'skipped', 'cancelled', 'todo']
                  if (matches := re.findall(r'^# ' + key + r' (\d+)\s*$', result.stdout, re.MULTILINE))}
        metadata['tests'].append({'file': test_file, 'command': command, 'database': database_identity,
            'exitCode': result.returncode, 'seconds': round(time.monotonic() - before, 3),
            'log': str(log), 'actualTapCounts': counts})
        print(json.dumps(metadata['tests'][-1]), flush=True)
        if result.returncode or counts.get('fail', 0) or counts.get('cancelled', 0):
            break
    exit_code = 0 if metadata['tests'] and all(item['exitCode'] == 0 for item in metadata['tests']) else 1
except Exception as error:
    metadata['error'] = str(error)
    exit_code = 1
finally:
    if engine is not None and engine.poll() is None:
        engine.send_signal(signal.SIGINT)  # Fast shutdown of only our exact child.
        try:
            engine.wait(timeout=20)
        except subprocess.TimeoutExpired:
            engine.kill()
            engine.wait(timeout=10)
    metadata['stopExitCode'] = engine.returncode if engine is not None else None
    metadata['ownedProcessStopped'] = engine is None or engine.poll() is not None
    if engine_log:
        engine_log.close()
    metadata['pidfileAbsent'] = not (cluster / 'postmaster.pid').exists()
    with socket.socket() as probe:
        metadata['portClosed'] = probe.connect_ex(('127.0.0.1', port)) != 0
    if metadata['ownedProcessStopped'] and metadata['pidfileAbsent'] and metadata['portClosed']:
        shutil.rmtree(cluster, ignore_errors=True)
    metadata['clusterRemoved'] = not cluster.exists()
    metadata['completedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    if not (metadata['stopExitCode'] == 0 and metadata['ownedProcessStopped'] and
            metadata['pidfileAbsent'] and metadata['portClosed'] and metadata['clusterRemoved']):
        exit_code = 1
    metadata['exitCode'] = exit_code
    (output / 'postgres-run.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(json.dumps(metadata), flush=True)

raise SystemExit(exit_code)
