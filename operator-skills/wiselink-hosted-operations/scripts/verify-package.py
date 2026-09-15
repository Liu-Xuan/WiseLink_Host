#!/usr/bin/env python3
"""Verify the existing Publish Lite manifest and ZIP without extracting or executing it."""
import argparse
import hashlib
import json
import stat
import sys
import zipfile
from pathlib import Path


def require(condition, message):
    if not condition:
        raise ValueError(message)


def safe_parts(name):
    require(isinstance(name, str) and name and not name.startswith('/'), 'invalid path')
    require('\\' not in name, 'backslash path')
    parts = name.rstrip('/').split('/')
    require(all(part not in ('', '.', '..') for part in parts), 'unsafe path')
    return parts


def verify(zip_path, manifest_path, expected_sha=None):
    manifest = json.loads(Path(manifest_path).read_text())
    require(manifest['schemaVersion'] == 'wiselink.skill-publish-lite.v1', 'manifest schema')
    archive, files = manifest['archive'], manifest['files']
    root = archive['rootDirectory']
    require(safe_parts(root) == [root] and root == manifest['slug'], 'archive root')
    payload = Path(zip_path).read_bytes()
    digest = hashlib.sha256(payload).hexdigest()
    require(digest == archive['sha256'], 'archive SHA mismatch')
    require(expected_sha is None or digest == expected_sha, 'accepted SHA mismatch')
    require(len(payload) == archive['byteLength'], 'archive length mismatch')
    require(isinstance(files, list) and files, 'manifest files missing')
    expected = {}
    for item in files:
        safe_parts(item['path'])
        require(not item['path'].endswith('/'), 'manifest file is directory')
        require(item['path'] not in expected, 'duplicate manifest file')
        require(item['mode'] in ('100644', '100755'), 'manifest file mode')
        expected[item['path']] = item
    require(archive['fileCount'] == len(expected), 'manifest count mismatch')
    with zipfile.ZipFile(zip_path) as package:
        seen, actual, mode_unavailable = set(), set(), 0
        for info in package.infolist():
            parts = safe_parts(info.filename)
            require(info.filename not in seen, 'duplicate ZIP entry')
            seen.add(info.filename)
            require(parts[0] == root, 'ZIP root mismatch')
            mode = info.external_attr >> 16
            if info.is_dir():
                require(stat.S_IFMT(mode) in (0, stat.S_IFDIR), 'special directory entry')
                continue
            dos_regular = info.create_system == 0 and mode == 0 and not (info.external_attr & 0x18)
            require(len(parts) > 1 and (stat.S_ISREG(mode) or dos_regular), 'non-regular ZIP file')
            relative = '/'.join(parts[1:])
            require(relative in expected, 'unexpected ZIP file')
            actual.add(relative)
            item = expected[relative]
            if dos_regular:
                mode_unavailable += 1  # Existing publisher emits DOS entries without Unix permissions.
            else:
                require(mode == int(item['mode'], 8), 'file mode mismatch')
            require(info.file_size == item['byteLength'], 'file length mismatch')
            with package.open(info) as entry:
                hashed, length = hashlib.sha256(), 0
                for chunk in iter(lambda: entry.read(65536), b''):
                    hashed.update(chunk)
                    length += len(chunk)
            require(length == item['byteLength'], 'read length mismatch')
            require(hashed.hexdigest() == item['sha256'], 'file SHA mismatch')
        require(actual == set(expected), 'missing ZIP files')
    return {'version': manifest['version'], 'sha256': digest, 'files': len(expected),
            'sourceCommit': manifest['source']['gitCommit'], 'unixModeUnavailableFiles': mode_unavailable}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--zip', required=True)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--expected-sha256')
    args = parser.parse_args()
    try:
        print(json.dumps({'verified': True, **verify(args.zip, args.manifest, args.expected_sha256)}))
    except (ValueError, KeyError, TypeError, OSError, zipfile.BadZipFile, RuntimeError) as exc:
        print(f'PACKAGE_VERIFICATION_FAILED: {exc}', file=sys.stderr)
        sys.exit(1)
