"""Prepare checksum-pinned MinerU models on the machine that will run the parser."""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request

CHUNK = 8 * 1024 * 1024


def checksum(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while data := stream.read(CHUNK):
            digest.update(data)
    return digest.hexdigest()


def model_path(root, entry):
    relative = PurePosixPath(entry['path'])
    if (entry['kind'] not in ('pipeline', 'vlm') or relative.is_absolute()
            or '..' in relative.parts or '\\' in entry['path']
            or not re.fullmatch(r'[a-f0-9]{64}', entry['sha256'])
            or not isinstance(entry['bytes'], int) or entry['bytes'] < 1):
        raise ValueError('Invalid pinned model entry')
    path = root / entry['kind'] / relative
    if not path.resolve().is_relative_to(root):
        raise ValueError('Model path escapes root')
    return path


def prepare_file(root, entry, repositories, source, verify_only):
    path = model_path(root, entry)
    if path.exists():
        if path.stat().st_size != entry['bytes'] or checksum(path) != entry['sha256']:
            raise ValueError(f'Existing model checksum mismatch: {entry["kind"]}/{entry["path"]}')
        print('REUSED', entry['kind'], entry['path'], flush=True)
        return
    if verify_only:
        raise FileNotFoundError(f'Missing model: {entry["kind"]}/{entry["path"]}')
    path.parent.mkdir(parents=True, exist_ok=True)
    staging = path.with_name(path.name + '.download')
    if staging.is_symlink():
        raise ValueError('Model staging symlink is not allowed')
    repository = repositories[entry['kind']]
    name = urllib.parse.quote(entry['path'], safe='/')
    if source == 'modelscope':
        # The endpoint is mutable; the pinned size and SHA256 remain authoritative.
        url = f'https://modelscope.cn/models/{repository["modelscope"]}/resolve/master/{name}'
    else:
        url = f'https://huggingface.co/{repository["huggingface"]}/resolve/{repository["revision"]}/{name}'
    offset = staging.stat().st_size if staging.exists() else 0
    if offset > entry['bytes']:
        raise ValueError('Model staging exceeds pinned size')
    # Only complete download chunks can be resumed after an interrupted response.
    if offset != entry['bytes']:
        offset -= offset % CHUNK
    with staging.open('r+b' if staging.exists() else 'xb') as stream:
        stream.truncate(offset)
        while offset < entry['bytes']:
            end = min(offset + CHUNK, entry['bytes']) - 1
            expected = end - offset + 1
            for attempt in range(4):
                try:
                    request = urllib.request.Request(url, headers={'Range': f'bytes={offset}-{end}'})
                    with urllib.request.urlopen(request, timeout=90) as response:
                        ranged = response.status == 206 and response.headers.get('Content-Range') == f'bytes {offset}-{end}/{entry["bytes"]}'
                        whole_small_file = response.status == 200 and offset == 0 and end + 1 == entry['bytes']
                        if not (ranged or whole_small_file):
                            raise ValueError('Model server returned an unexpected byte range')
                        data = response.read(expected + 1)
                    if len(data) != expected:
                        raise ValueError('Model download length mismatch')
                    stream.seek(offset)
                    stream.write(data)
                    stream.flush()
                    offset += expected
                    break
                except (OSError, ValueError, urllib.error.URLError) as error:
                    print('RETRY', entry['kind'], entry['path'], attempt + 1, type(error).__name__, flush=True)
                    if attempt == 3:
                        raise
                    time.sleep(2 ** attempt)
            if offset == entry['bytes'] or offset % (64 * 1024 * 1024) == 0:
                print('DOWNLOADED_BYTES', entry['kind'], entry['path'], offset, entry['bytes'], flush=True)
        os.fsync(stream.fileno())
    if checksum(staging) != entry['sha256']:
        raise ValueError(f'Downloaded model checksum mismatch: {entry["kind"]}/{entry["path"]}')
    # Never publish a partial or unverified model file.
    os.link(staging, path)  # Fails if another preparation has already published this path.
    staging.unlink()
    print('VERIFIED', entry['kind'], entry['path'], entry['bytes'], flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--with-vlm', action='store_true')
    parser.add_argument('--verify-only', action='store_true')
    parser.add_argument('--source', choices=('modelscope', 'huggingface'), default='modelscope')
    args = parser.parse_args()
    manifest = json.loads(Path(__file__).with_name('models.json').read_text())
    root = args.root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    entries = [entry for entry in manifest['files'] if args.with_vlm or entry['kind'] == 'pipeline']
    needed = sum(entry['bytes'] for entry in entries if not model_path(root, entry).exists())
    if not args.verify_only and shutil.disk_usage(root).free < needed + 1024 * 1024 * 1024:
        raise OSError('Insufficient free space for models and 1 GiB parse/build reserve')
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(prepare_file, root, entry, manifest['repositories'], args.source, args.verify_only) for entry in entries]
        for future in concurrent.futures.as_completed(futures):
            future.result()
    config = {
        'model-source': 'local',
        'models-dir': {'pipeline': str(root / 'pipeline')},
        'llm-aided-config': {'title_aided': {'enable': False}},
    }
    if args.with_vlm:
        config['models-dir']['vlm'] = str(root / 'vlm')
    output = root / 'mineru.json'
    content = json.dumps(config, indent=2) + '\n'
    if output.exists():
        if output.read_text() != content:
            raise ValueError('Existing model configuration differs; use a new model root')
    else:
        with output.open('x') as stream:
            stream.write(content)
    print(json.dumps({'status': 'VERIFIED', 'files': len(entries), 'bytes': sum(entry['bytes'] for entry in entries), 'config': str(output)}), flush=True)


if __name__ == '__main__':
    main()
