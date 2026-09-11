"""Restore verified MinerU deployment files from FileService signed URLs.

The manifest is an input artifact assembled by the Host. Signed URLs are used
only for this process and are never written to disk or included in output.
This helper restores the files listed in the manifest; it deliberately does
not create MinerU configuration or claim that a partial manifest is complete.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import tempfile
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


MAX_PART_BYTES = 100_000_000
MAX_FILES = 200
MAX_TOTAL_BYTES = 8 * 1024 ** 3
COPY_BYTES = 8 * 1024 * 1024
SHA256 = re.compile(r'^[a-f0-9]{64}$')
BUCKET_ID = re.compile(r'^bucket_[^/\x00-\x1f\x7f]+$')


def digest_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while data := stream.read(COPY_BYTES):
            digest.update(data)
    return digest.hexdigest()


def verify_file(path, expected_bytes, expected_sha256):
    if path.is_symlink() or not path.is_file() or path.stat().st_size != expected_bytes:
        return False
    return digest_file(path) == expected_sha256


def valid_storage_path(value):
    """Accept the FileService's slash-prefixed path without treating it as local input."""
    if (not isinstance(value, str) or not value.startswith('/') or value.endswith('/')
            or '//' in value or '\\' in value or '/./' in value or '/../' in value
            or value.endswith('/.') or value.endswith('/..')):
        return False
    return all(part not in ('', '.', '..') and all(
        0x20 <= ord(character) != 0x7f for character in part
    ) for part in value.split('/')[1:])


def valid_integer(value, minimum=0):
    return isinstance(value, int) and not isinstance(value, bool) and value >= minimum


def validate_manifest(value):
    if not isinstance(value, dict) or value.get('schemaVersion') != 'wiselink.mineru.runtime-files.v1':
        raise ValueError('MINERU_DEPLOYMENT_MANIFEST_INVALID')
    if value.get('mineruVersion') != '3.4.5' or not re.fullmatch(r'app_[a-z0-9]+', value.get('appId', '')):
        raise ValueError('MINERU_DEPLOYMENT_MANIFEST_INVALID')
    files = value.get('files')
    if not isinstance(files, list) or not 1 <= len(files) <= MAX_FILES:
        raise ValueError('MINERU_DEPLOYMENT_MANIFEST_INVALID')
    seen = set()
    total = 0
    for file in files:
        if not isinstance(file, dict):
            raise ValueError('MINERU_DEPLOYMENT_MANIFEST_INVALID')
        relative = file.get('relativePath')
        path = PurePosixPath(relative) if isinstance(relative, str) else None
        valid_root = path is not None and (
            (len(path.parts) >= 2 and path.parts[0] in ('pipeline', 'vlm'))
            or relative in ('runtime/wheelhouse.tar', 'runtime/python.tar.gz', 'runtime/system-libs.tar')
        )
        if (not valid_root or path.is_absolute() or any(part in ('', '.', '..') for part in path.parts)
                or '\\' in relative or relative in seen):
            raise ValueError('MINERU_DEPLOYMENT_MANIFEST_INVALID')
        file_bytes = file.get('bytes')
        file_sha256 = file.get('sha256')
        parts = file.get('parts')
        if (not valid_integer(file_bytes, 1) or not SHA256.fullmatch(str(file_sha256))
                or not isinstance(parts, list) or not 1 <= len(parts) <= MAX_FILES):
            raise ValueError('MINERU_DEPLOYMENT_MANIFEST_INVALID')
        offset = 0
        for part in parts:
            if (not isinstance(part, dict) or not valid_integer(part.get('offset'))
                    or part.get('offset') != offset):
                raise ValueError('MINERU_DEPLOYMENT_MANIFEST_INVALID')
            part_bytes = part.get('bytes')
            part_sha256 = part.get('sha256')
            if (not valid_integer(part_bytes, 1) or part_bytes > MAX_PART_BYTES
                    or not SHA256.fullmatch(str(part_sha256)) or part.get('verified') is not True
                    or not isinstance(part.get('bucketId'), str) or not BUCKET_ID.fullmatch(part['bucketId'])
                    or not valid_storage_path(part.get('filePath'))
                    or not isinstance(part.get('url'), str)):
                raise ValueError('MINERU_DEPLOYMENT_MANIFEST_INVALID')
            try:
                parsed = urlsplit(part['url'])
            except ValueError:
                raise ValueError('MINERU_DEPLOYMENT_URL_INVALID') from None
            if parsed.scheme != 'https' or not parsed.netloc or parsed.username or parsed.password:
                raise ValueError('MINERU_DEPLOYMENT_URL_INVALID')
            offset += part_bytes
        if offset != file_bytes:
            raise ValueError('MINERU_DEPLOYMENT_MANIFEST_INVALID')
        seen.add(relative)
        total += file_bytes
    if total > MAX_TOTAL_BYTES:
        raise ValueError('MINERU_DEPLOYMENT_MANIFEST_INVALID')
    return value


def safe_destination(root, relative):
    destination = root.joinpath(*PurePosixPath(relative).parts)
    current = root
    for part in PurePosixPath(relative).parts[:-1]:
        if current.is_symlink() or not current.is_dir():
            raise ValueError('MINERU_DEPLOYMENT_SYMLINK_FORBIDDEN')
        current = current / part
        if current.is_symlink():
            raise ValueError('MINERU_DEPLOYMENT_SYMLINK_FORBIDDEN')
        if current.exists() and not current.is_dir():
            raise ValueError('MINERU_DEPLOYMENT_SYMLINK_FORBIDDEN')
        current.mkdir(exist_ok=True)
    parent = destination.parent
    resolved_parent = parent.resolve(strict=True)
    if not resolved_parent.is_relative_to(root):
        raise ValueError('MINERU_DEPLOYMENT_SYMLINK_FORBIDDEN')
    if destination.is_symlink():
        raise ValueError('MINERU_DEPLOYMENT_SYMLINK_FORBIDDEN')
    return destination


def download_part(part, staging):
    request = Request(part['url'], headers={'Accept': 'application/octet-stream'})
    try:
        with urlopen(request, timeout=120) as response, staging.open('wb') as output:
            content_length = response.headers.get('Content-Length')
            try:
                final_url = urlsplit(response.geturl())
                declared_length = int(content_length) if content_length is not None else None
            except (TypeError, ValueError):
                raise ValueError('MINERU_DEPLOYMENT_OBJECT_MISMATCH') from None
            if final_url.scheme != 'https':
                raise ValueError('MINERU_DEPLOYMENT_URL_INVALID')
            if declared_length is not None and declared_length != part['bytes']:
                raise ValueError('MINERU_DEPLOYMENT_OBJECT_MISMATCH')
            digest = hashlib.sha256()
            count = 0
            while data := response.read(COPY_BYTES):
                count += len(data)
                if count > part['bytes']:
                    raise ValueError('MINERU_DEPLOYMENT_OBJECT_MISMATCH')
                digest.update(data)
                output.write(data)
            if count != part['bytes'] or digest.hexdigest() != part['sha256']:
                raise ValueError('MINERU_DEPLOYMENT_OBJECT_MISMATCH')
            output.flush()
            os.fsync(output.fileno())
    except OSError:
        raise ValueError('MINERU_DEPLOYMENT_DOWNLOAD_FAILED') from None


def restore(root, manifest):
    root.mkdir(parents=True, exist_ok=True)
    if root.is_symlink() or not root.is_dir():
        raise ValueError('MINERU_DEPLOYMENT_ROOT_INVALID')
    root = root.resolve(strict=True)
    restored = 0
    reused = 0
    for file in manifest['files']:
        destination = safe_destination(root, file['relativePath'])
        if verify_file(destination, file['bytes'], file['sha256']):
            reused += 1
            restored += 1
            continue
        if destination.exists() and not destination.is_file():
            raise ValueError('MINERU_DEPLOYMENT_SYMLINK_FORBIDDEN')
        with tempfile.NamedTemporaryFile(
                mode='wb', prefix=f'.{destination.name}.', suffix='.assembling',
                dir=destination.parent, delete=False) as temporary:
            staging = Path(temporary.name)
        try:
            staging.unlink()
            with staging.open('xb') as output:
                full_digest = hashlib.sha256()
                total = 0
                for part in file['parts']:
                    part_staging = staging.with_name(staging.name + '.part')
                    if part_staging.is_symlink():
                        raise ValueError('MINERU_DEPLOYMENT_SYMLINK_FORBIDDEN')
                    if part_staging.exists():
                        part_staging.unlink()
                    download_part(part, part_staging)
                    with part_staging.open('rb') as input_stream:
                        while data := input_stream.read(COPY_BYTES):
                            total += len(data)
                            full_digest.update(data)
                            output.write(data)
                    part_staging.unlink()
                if total != file['bytes'] or full_digest.hexdigest() != file['sha256']:
                    raise ValueError('MINERU_DEPLOYMENT_FILE_MISMATCH')
                output.flush()
                os.fsync(output.fileno())
            os.replace(staging, destination)
            restored += 1
        finally:
            staging.unlink(missing_ok=True)
            staging.with_name(staging.name + '.part').unlink(missing_ok=True)
    return restored, reused


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--root', type=Path, required=True)
    args = parser.parse_args()
    if not args.root.is_absolute():
        raise ValueError('MINERU_DEPLOYMENT_ROOT_INVALID')
    manifest = validate_manifest(json.loads(args.manifest.read_text(encoding='utf-8')))
    restored, reused = restore(args.root, manifest)
    print(json.dumps({'status': 'RESTORED', 'files': restored, 'reused': reused,
                      'manifestFiles': len(manifest['files'])}, separators=(',', ':')), flush=True)


if __name__ == '__main__':
    main()
