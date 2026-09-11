"""Restore verified OpenCV support libraries into an isolated runtime directory."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tarfile
import tempfile


def restore(archive_path, destination):
    destination = Path(destination)
    with tarfile.open(archive_path, 'r:') as archive:
        members = archive.getmembers()
        if (len(members) > 100 or len({item.name for item in members}) != len(members)
                or sum(item.size for item in members) > 100 * 1024 * 1024
                or any(not item.isfile() or item.size < 1 or not (
                    item.name == 'manifest.json'
                    or re.fullmatch(r'lib/lib[A-Za-z0-9_.+-]+\.so\.[0-9.]+', item.name)
                    or re.fullmatch(r'licenses/[a-z0-9+.-]+\.txt', item.name)) for item in members)):
            raise ValueError('MINERU_SYSTEM_LIBS_ARCHIVE_INVALID')
        manifest = json.loads(archive.extractfile('manifest.json').read())
        if manifest.get('schemaVersion') != 'wiselink.mineru.system-libs.v1' or manifest.get('target') != 'linux-x64':
            raise ValueError('MINERU_SYSTEM_LIBS_MANIFEST_INVALID')
        files = manifest['files']
        if (not isinstance(files, list) or len({item['path'] for item in files}) != len(files)
                or {item['path'] for item in files} != {item.name for item in members if item.name != 'manifest.json'}
                or not {'lib/libGL.so.1', 'lib/libGLX.so.0', 'lib/libGLdispatch.so.0'} <= {item['path'] for item in files}):
            raise ValueError('MINERU_SYSTEM_LIBS_MANIFEST_INVALID')
        payload = {}
        for item in files:
            data = archive.extractfile(item['path']).read()
            if len(data) != item['bytes'] or hashlib.sha256(data).hexdigest() != item['sha256']:
                raise ValueError('MINERU_SYSTEM_LIBS_HASH_MISMATCH')
            payload[item['path']] = data
    if destination.is_symlink():
        raise ValueError('MINERU_SYSTEM_LIBS_CACHE_INVALID')
    if destination.exists():
        for name, data in payload.items():
            path = destination / name
            if path.is_symlink() or path.parent.is_symlink() or not path.is_file() or path.read_bytes() != data:
                raise ValueError('MINERU_SYSTEM_LIBS_CACHE_INVALID')
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = Path(tempfile.mkdtemp(prefix='.system-libs-', dir=destination.parent))
        try:
            for name, data in payload.items():
                path = temporary / name
                path.parent.mkdir(exist_ok=True)
                path.write_bytes(data)
                path.chmod(0o644)
            os.replace(temporary, destination)
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)
    return str(destination.resolve() / 'lib')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--root', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps({'status': 'READY', 'libraryPath': restore(args.archive, args.root)}))


if __name__ == '__main__':
    main()
