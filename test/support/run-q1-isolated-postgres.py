"""Create a disposable loopback PostgreSQL cluster, run offline tests, then stop it."""
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time

repo = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--include-baseline', action='store_true', help='Also run the unchanged historical DB suite.')
parser.add_argument('--output-dir', type=Path, help='New evidence directory; an existing path is rejected.')
options = parser.parse_args()
if options.output_dir:
    output = options.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=False)
else:
    output = Path(tempfile.mkdtemp(prefix='q1-test-results-', dir=repo.parent))
base = Path(tempfile.mkdtemp(prefix='q1-pg-', dir=output))
cluster = base / 'data'
socket_dir = Path(tempfile.mkdtemp(prefix='q1-socket-', dir='/tmp'))
with socket.socket() as probe:
    probe.bind(('127.0.0.1', 0))
    port = probe.getsockname()[1]
pg_bin = Path('/opt/homebrew/bin')
started = False
metadata = {'host': '127.0.0.1', 'port': port, 'cluster': str(cluster), 'tests': []}


def run(command, **kwargs):
    return subprocess.run(command, check=True, text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT, **kwargs)


try:
    run([str(pg_bin / 'initdb'), '-D', str(cluster), '-U', 'codex_q1',
         '--auth-local=trust', '--auth-host=trust', '--encoding=UTF8', '--locale=C'])
    run([str(pg_bin / 'pg_ctl'), '-D', str(cluster), '-l', str(base / 'postgres.log'),
         '-o', f'-h 127.0.0.1 -p {port} -k {socket_dir}', '-w', 'start'])
    started = True
    files = ['test/node/q1-review-work-dependencies-postgres.test.mjs']
    if options.include_baseline:
        files.insert(0, 'test/node/jobaid-work-postgres.test.mjs')
    for index, test_file in enumerate(files):
        database = f'wiselink_jobaid_test_q1_{index}'
        run([str(pg_bin / 'createdb'), '-h', '127.0.0.1', '-p', str(port),
             '-U', 'codex_q1', database])
        env = os.environ.copy()
        env['JOBAID_WORK_TEST_DATABASE_URL'] = f'postgresql://codex_q1@127.0.0.1:{port}/{database}'
        before = time.monotonic()
        result = subprocess.run(['node', '--test', '--test-reporter=tap', test_file],
                                cwd=repo, env=env, text=True, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, timeout=180)
        log = output / (Path(test_file).stem + '.tap')
        log.write_text(result.stdout)
        metadata['tests'].append({'file': test_file, 'exitCode': result.returncode,
                                 'seconds': round(time.monotonic() - before, 3), 'log': str(log)})
        print(result.stdout, flush=True)
finally:
    if started:
        stopped = subprocess.run([str(pg_bin / 'pg_ctl'), '-D', str(cluster), '-m', 'fast', '-w', 'stop'],
                                 text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        metadata['stopExitCode'] = stopped.returncode
    (output / 'postgres-run.json').write_text(json.dumps(metadata, indent=2))
    print(json.dumps(metadata), flush=True)

raise SystemExit(0 if metadata['tests'] and all(t['exitCode'] == 0 for t in metadata['tests']) else 1)
