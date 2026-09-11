"""Safely publish the bundled Linux CPython 3.10 runtime.

This bootstrap intentionally uses only the Python standard library.  The Host
checks the downloaded archive against the deployment manifest before invoking
it; ``--sha256`` is also available when the bootstrap should repeat that check.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tarfile
import tempfile


MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
MAX_EXTRACTED_BYTES = 512 * 1024 * 1024
MAX_MEMBERS = 100_000
COPY_BYTES = 8 * 1024 * 1024


class RuntimeRestoreError(ValueError):
    pass


def fail(code):
    raise RuntimeRestoreError(code)


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while data := stream.read(COPY_BYTES):
            digest.update(data)
    return digest.hexdigest()


def verify_archive(path, expected_sha256):
    if path.is_symlink() or not path.is_file():
        fail('MINERU_PYTHON_ARCHIVE_INVALID')
    if path.stat().st_size > MAX_ARCHIVE_BYTES:
        fail('MINERU_PYTHON_ARCHIVE_TOO_LARGE')
    if expected_sha256 is None:
        return
    if (len(expected_sha256) != 64
            or any(character not in '0123456789abcdef' for character in expected_sha256)
            or sha256_file(path) != expected_sha256):
        fail('MINERU_PYTHON_ARCHIVE_SHA256_MISMATCH')


def archive_parts(name):
    if (not isinstance(name, str) or not name or name.startswith('/')
            or '\\' in name or '\x00' in name):
        fail('MINERU_PYTHON_ARCHIVE_PATH_INVALID')
    trimmed = name[:-1] if name.endswith('/') else name
    parts = trimmed.split('/')
    if (not parts or parts[0] != 'python'
            or any(part in ('', '.', '..') for part in parts)):
        fail('MINERU_PYTHON_ARCHIVE_PATH_INVALID')
    return parts


def relative_symlink_target(root, path, linkname):
    if (not isinstance(linkname, str) or not linkname or linkname.startswith('/')
            or '\\' in linkname or '\x00' in linkname):
        fail('MINERU_PYTHON_ARCHIVE_SYMLINK_INVALID')
    root = root.resolve()
    target = Path(os.path.realpath(path.parent / linkname))
    if not target.is_relative_to(root):
        fail('MINERU_PYTHON_ARCHIVE_SYMLINK_ESCAPE')


def ensure_parent(root, parts):
    current = root
    for part in parts:
        current = current / part
        if current.is_symlink() or (current.exists() and not current.is_dir()):
            fail('MINERU_PYTHON_ARCHIVE_PARENT_INVALID')
        current.mkdir(exist_ok=True)


def write_member(archive, member, destination, root):
    if member.islnk():
        fail('MINERU_PYTHON_ARCHIVE_HARDLINK_FORBIDDEN')
    if member.isdir():
        if destination.exists() or destination.is_symlink():
            fail('MINERU_PYTHON_ARCHIVE_DUPLICATE')
        destination.mkdir()
        os.chmod(destination, member.mode & 0o777)
        return 0
    if member.issym():
        relative_symlink_target(root, destination, member.linkname)
        if destination.exists() or destination.is_symlink():
            fail('MINERU_PYTHON_ARCHIVE_DUPLICATE')
        os.symlink(member.linkname, destination)
        return 0
    if not member.isfile() or member.size < 0:
        fail('MINERU_PYTHON_ARCHIVE_SPECIAL_FILE_FORBIDDEN')
    if destination.exists() or destination.is_symlink():
        fail('MINERU_PYTHON_ARCHIVE_DUPLICATE')
    source = archive.extractfile(member)
    if source is None:
        fail('MINERU_PYTHON_ARCHIVE_FILE_INVALID')
    count = 0
    with source, destination.open('xb') as output:
        while data := source.read(COPY_BYTES):
            count += len(data)
            if count > member.size:
                fail('MINERU_PYTHON_ARCHIVE_FILE_INVALID')
            output.write(data)
        if count != member.size:
            fail('MINERU_PYTHON_ARCHIVE_FILE_INVALID')
        output.flush()
        os.fsync(output.fileno())
    os.chmod(destination, member.mode & 0o777)
    return count


def extract_archive(archive_path, staging):
    python_root = staging / 'python'
    python_root.mkdir()
    seen = set()
    extracted_bytes = 0
    with tarfile.open(archive_path, mode='r:gz') as archive:
        for index, member in enumerate(archive):
            if index >= MAX_MEMBERS:
                fail('MINERU_PYTHON_ARCHIVE_TOO_MANY_MEMBERS')
            if member.name.endswith('/') and not member.isdir():
                fail('MINERU_PYTHON_ARCHIVE_PATH_INVALID')
            parts = archive_parts(member.name)
            key = tuple(parts)
            if key in seen:
                fail('MINERU_PYTHON_ARCHIVE_DUPLICATE')
            seen.add(key)
            if member.isdir() and len(parts) == 1:
                continue
            ensure_parent(python_root, parts[1:-1])
            destination = python_root.joinpath(*parts[1:])
            extracted_bytes += write_member(archive, member, destination, python_root)
            if extracted_bytes > MAX_EXTRACTED_BYTES:
                fail('MINERU_PYTHON_ARCHIVE_TOO_LARGE')
    if not seen or ('bin', 'python3.10') not in {key[1:] for key in seen}:
        fail('MINERU_PYTHON_ARCHIVE_INTERPRETER_MISSING')
    return python_root


def validate_tree(root):
    if root.is_symlink() or not root.is_dir():
        fail('MINERU_PYTHON_RUNTIME_INVALID')
    pending = [root]
    while pending:
        directory = pending.pop()
        try:
            entries = list(os.scandir(directory))
        except OSError:
            fail('MINERU_PYTHON_RUNTIME_INVALID')
        for entry in entries:
            path = Path(entry.path)
            metadata = path.lstat()
            if stat.S_ISLNK(metadata.st_mode):
                relative_symlink_target(root, path, os.readlink(path))
            elif stat.S_ISDIR(metadata.st_mode):
                pending.append(path)
            elif stat.S_ISREG(metadata.st_mode):
                if metadata.st_nlink != 1:
                    fail('MINERU_PYTHON_RUNTIME_HARDLINK_FORBIDDEN')
            else:
                fail('MINERU_PYTHON_RUNTIME_SPECIAL_FILE_FORBIDDEN')


def inspect_interpreter(python_root):
    executable = python_root / 'bin' / 'python3.10'
    if executable.is_symlink() or not executable.is_file() or not os.access(executable, os.X_OK):
        fail('MINERU_PYTHON_RUNTIME_INTERPRETER_INVALID')
    environment = dict(os.environ)
    environment.pop('PYTHONHOME', None)
    environment.pop('PYTHONPATH', None)
    environment['PYTHONNOUSERSITE'] = '1'
    code = (
        'import json,os,platform,sys;'
        'print(json.dumps({"implementation":platform.python_implementation(),'
        '"python":platform.python_version(),"system":platform.system(),'
        '"machine":platform.machine(),"prefix":os.path.realpath(sys.prefix)}))'
    )
    try:
        result = subprocess.run([str(executable), '-S', '-c', code],
                                cwd=str(python_root), env=environment,
                                capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        fail('MINERU_PYTHON_RUNTIME_INTERPRETER_INVALID')
    if result.returncode != 0:
        fail('MINERU_PYTHON_RUNTIME_INTERPRETER_INVALID')
    try:
        facts = json.loads(result.stdout.strip())
    except (TypeError, ValueError):
        fail('MINERU_PYTHON_RUNTIME_INTERPRETER_INVALID')
    if (facts.get('implementation') != 'CPython' or not str(facts.get('python', '')).startswith('3.10.')
            or facts.get('system') != 'Linux' or facts.get('machine', '').lower() not in ('x86_64', 'amd64')
            or Path(facts.get('prefix', '')).resolve() != python_root.resolve()):
        fail('MINERU_PYTHON_RUNTIME_ABI_INVALID')
    return executable.resolve()


def fsync_directory(path):
    try:
        descriptor = os.open(str(path), os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    except OSError:
        fail('MINERU_PYTHON_RUNTIME_PUBLISH_FAILED')


def restore(archive_path, root, expected_sha256=None):
    verify_archive(archive_path, expected_sha256)
    root.mkdir(parents=True, exist_ok=True)
    if root.is_symlink() or not root.is_dir():
        fail('MINERU_PYTHON_ROOT_INVALID')
    root = root.resolve(strict=True)
    target = root / 'python'
    if target.is_symlink():
        fail('MINERU_PYTHON_RUNTIME_SYMLINK_FORBIDDEN')
    if target.exists():
        validate_tree(target)
        executable = inspect_interpreter(target)
        return executable, True

    staging_parent = Path(tempfile.mkdtemp(prefix='.python-runtime-', dir=str(root)))
    published = False
    try:
        staging_python = extract_archive(archive_path, staging_parent)
        validate_tree(staging_python)
        inspect_interpreter(staging_python)
        if target.exists() or target.is_symlink():
            fail('MINERU_PYTHON_RUNTIME_ALREADY_EXISTS')
        os.replace(staging_python, target)
        published = True
        fsync_directory(root)
        executable = inspect_interpreter(target)
        return executable, False
    finally:
        if not published:
            shutil.rmtree(staging_parent, ignore_errors=True)
        else:
            staging_parent.rmdir()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--sha256', '--expected-sha256', dest='expected_sha256')
    args = parser.parse_args()
    if not args.root.is_absolute():
        fail('MINERU_PYTHON_ROOT_INVALID')
    executable, reused = restore(args.archive, args.root, args.expected_sha256)
    print(json.dumps({'status': 'READY', 'executable': str(executable), 'reused': reused},
                     separators=(',', ':')), flush=True)


if __name__ == '__main__':
    main()
