"""Upload verified MinerU deployment files to this app's FileService and read them back.

Development-only CLI helper. The Host runtime consumes the resulting locators using
the platform SDK; it never executes lark-cli or persists temporary signed URLs.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess

PART_BYTES = 96_000_000  # Below the CLI's 100 MB upload limit.


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        while data := stream.read(8 * 1024 * 1024):
            value.update(data)
    return value.hexdigest()


def save(path, value):
    temporary = path.with_suffix('.writing')
    with temporary.open('w') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def cli(app, command, *arguments, cwd):
    completed = subprocess.run(['lark-cli', 'apps', command, '--app-id', app,
                                '--as', 'user', *arguments], cwd=cwd,
                               capture_output=True, text=True, timeout=900)
    try:
        envelope = json.loads(completed.stdout)
    except ValueError as error:
        raise RuntimeError(f'{command}: invalid CLI response; inspect local CLI execution') from error
    if completed.returncode or not envelope.get('ok'):
        # Do not echo signed URLs or arbitrary response bodies.
        failure = envelope.get('error', {})
        raise RuntimeError(f'{command}: {failure.get("code", completed.returncode)} '
                           f'{failure.get("subtype", "failed")}')
    return envelope['data']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app-id', required=True)
    source_group = parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument('--models-root', type=Path)
    source_group.add_argument('--wheelhouse-archive', type=Path)
    source_group.add_argument('--python-archive', type=Path)
    source_group.add_argument('--system-libs-archive', type=Path)
    parser.add_argument('--work-dir', type=Path, required=True)
    args = parser.parse_args()
    deployment_archive = args.wheelhouse_archive or args.python_archive or args.system_libs_archive
    root = args.models_root.resolve(strict=True) if args.models_root else deployment_archive.resolve(strict=True).parent
    work = args.work_dir.resolve()
    work.mkdir(parents=True, exist_ok=True)
    source = json.loads((root / 'verified-models.json').read_text()) if args.models_root else {
        'status': 'VERIFIED', 'files': [],
    }
    if source['status'] != 'VERIFIED':
        raise ValueError('Models must have been verified against the pinned official manifest')
    entries = []
    for entry in source['files']:
        relative = PurePosixPath(entry['kind']) / entry['path']
        if (entry['kind'] not in ('pipeline', 'vlm') or relative.is_absolute()
                or '..' in relative.parts or '\\' in str(relative)):
            raise ValueError('Invalid model path')
        path = (root / relative).resolve(strict=True)
        if not path.is_relative_to(root) or path.stat().st_size != entry['bytes'] or digest(path) != entry['sha256']:
            raise ValueError(f'Model does not match verified source: {relative}')
        entries.append({**entry, 'relativePath': str(relative), 'sourcePath': str(path)})
    if deployment_archive:
        archive = deployment_archive.resolve(strict=True)
        expected_name = 'wheelhouse.tar' if args.wheelhouse_archive else 'python.tar.gz' if args.python_archive else 'system-libs.tar'
        if archive.name != expected_name:
            raise ValueError(f'Expected the prepared {expected_name} deployment archive')
        entries.append({'relativePath': f'runtime/{expected_name}', 'sourcePath': str(archive),
                        'bytes': archive.stat().st_size, 'sha256': digest(archive)})
    progress_path = work / 'upload-progress.json'
    state = json.loads(progress_path.read_text()) if progress_path.exists() else {
        'appId': args.app_id, 'files': [], 'pendingUpload': None,
    }
    if state['appId'] != args.app_id:
        raise ValueError('Upload progress belongs to another app')
    if state.get('pendingUpload'):
        raise RuntimeError('An earlier upload has an unknown outcome. Reconcile its exact unique '
                           'file name using file-list before continuing; do not upload it again.')
    # One file/part at a time bounds memory, disk and service load. Progress survives interruption.
    for entry in entries:
        existing = next((item for item in state['files'] if item['relativePath'] == entry['relativePath']), None)
        if existing is None:
            existing = {key: entry[key] for key in ('relativePath', 'bytes', 'sha256')}
            existing['parts'] = []
            state['files'].append(existing)
        if any(existing[key] != entry[key] for key in ('bytes', 'sha256')):
            raise ValueError('Pinned model changed since upload started')
        with Path(entry['sourcePath']).open('rb') as stream:
            offset = 0
            index = 0
            while data := stream.read(PART_BYTES):
                part_sha = hashlib.sha256(data).hexdigest()
                part = next((item for item in existing['parts'] if item['offset'] == offset), None)
                if part and (part['bytes'] != len(data) or part['sha256'] != part_sha):
                    raise ValueError('Part changed since upload started')
                if part is None:
                    filename = f'mineru-3.4.5-{entry["sha256"][:20]}-{index:03d}.bin'
                    staging = work / filename
                    staging.write_bytes(data)
                    state['pendingUpload'] = {'fileName': filename, 'relativePath': entry['relativePath'],
                                              'offset': offset, 'bytes': len(data), 'sha256': part_sha}
                    save(progress_path, state)
                    uploaded = cli(args.app_id, '+file-upload', '--file', filename, cwd=work)
                    match = re.fullmatch(r'/spark/app/([^/]+)/runtime/api/v1/storage/object/(bucket_[^/]+)(/.+)',
                                         uploaded['download_url'])
                    if (not match or match[1] != args.app_id or match[3] != uploaded['path']
                            or uploaded['size_bytes'] != len(data)):
                        raise ValueError('Upload returned an unexpected application/object location')
                    part = {'offset': offset, 'bytes': len(data), 'sha256': part_sha,
                            'bucketId': match[2], 'filePath': uploaded['path'], 'verified': False}
                    existing['parts'].append(part)
                    state['pendingUpload'] = None
                    save(progress_path, state)
                    staging.unlink()
                if not part['verified']:
                    readback = work / 'readback.bin'
                    # This path contains only a previous readback from this helper.
                    readback.unlink(missing_ok=True)
                    cli(args.app_id, '+file-download', '--path', part['filePath'], '--output', readback.name, cwd=work)
                    if readback.stat().st_size != part['bytes'] or digest(readback) != part['sha256']:
                        raise ValueError(f'FileService readback mismatch: {entry["relativePath"]} part {index}')
                    part['verified'] = True
                    save(progress_path, state)
                    readback.unlink()
                print('VERIFIED_PART', entry['relativePath'], index, len(data), flush=True)
                offset += len(data)
                index += 1
    manifest = {'schemaVersion': 'wiselink.mineru.runtime-files.v1', 'appId': args.app_id,
                'mineruVersion': '3.4.5', 'files': state['files']}
    save(work / 'model-storage-manifest.json', manifest)
    print(json.dumps({'status': 'VERIFIED', 'files': len(entries),
                      'bytes': sum(entry['bytes'] for entry in entries),
                      'manifest': str(work / 'model-storage-manifest.json')}), flush=True)


if __name__ == '__main__':
    main()
