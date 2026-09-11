"""Package the pinned Linux/CPython 3.10 CPU wheels for offline Host restoration."""
import argparse
import email
import hashlib
import json
from pathlib import Path
import re
import tarfile
import zipfile


def canonical(name):
    return re.sub(r'[-_.]+', '-', name).lower()


def supports_linux_cp310_x64(tag):
    """Return whether a wheel tag is usable by the fixed Host runtime."""
    parts = tag.split('-')
    if len(parts) != 3:
        return False
    python_tag, abi_tag, platform_tag = parts
    python_tags = set(python_tag.split('.'))
    if platform_tag == 'any':
        return abi_tag == 'none' and bool(python_tags & {'py2', 'py3', 'py310'})
    platforms = platform_tag.split('.')
    cp_abi3_tags = {
        tag for tag in python_tags
        if tag.startswith('cp') and tag[2:].isdigit()
        and 32 <= int(tag[2:]) <= 310
    }
    python_compatible = (
        ('cp310' in python_tags and abi_tag in {'cp310', 'abi3', 'none'})
        or (cp_abi3_tags and abi_tag == 'abi3')
        or (abi_tag == 'none' and bool(python_tags & {'py2', 'py3', 'py310'}))
    )
    linux_x64 = any(
        candidate.endswith('_x86_64') and 'linux' in candidate
        for candidate in platforms
    )
    return bool(python_compatible and linux_x64)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--wheelhouse', type=Path, required=True)
    parser.add_argument('--requirements', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    expected = {canonical(name): version for name, version in re.findall(
        r'^([A-Za-z0-9_.-]+)==([^\s]+)', args.requirements.read_text(), flags=re.MULTILINE)}
    expected.update({'six': '1.17.0', 'pip': '26.2.1'})
    wheels = []
    names = set()
    for path in sorted(args.wheelhouse.glob('*.whl')):
        if path.is_symlink() or not path.is_file():
            raise ValueError(f'Wheel must be a regular file: {path.name}')
        with zipfile.ZipFile(path) as archive:
            metadata_names = [
                name for name in archive.namelist()
                if name.count('/') == 1 and name.endswith('.dist-info/METADATA')
            ]
            if len(metadata_names) != 1:
                raise ValueError('Ambiguous wheel metadata')
            metadata = email.message_from_bytes(archive.read(metadata_names[0]))
            wheel_names = [
                name for name in archive.namelist()
                if name.count('/') == 1 and name.endswith('.dist-info/WHEEL')
            ]
            if len(wheel_names) != 1:
                raise ValueError('Ambiguous wheel compatibility metadata')
            tags = [
                line.split(':', 1)[1].strip()
                for line in archive.read(wheel_names[0]).decode('utf-8').splitlines()
                if line.lower().startswith('tag:') and ':' in line
            ]
            if not tags or not any(supports_linux_cp310_x64(tag) for tag in tags):
                raise ValueError(f'Wheel is not Linux CPython 3.10 x86_64 compatible: {path.name}')
        name = canonical(metadata['Name'])
        version = metadata['Version']
        if name in names or expected.get(name) != version:
            raise ValueError(f'Unexpected or duplicate wheel: {name} {version}')
        names.add(name)
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            while data := stream.read(8 * 1024 * 1024):
                digest.update(data)
        wheels.append({'fileName': path.name, 'name': name, 'version': version,
                       'bytes': path.stat().st_size, 'sha256': digest.hexdigest()})
    if names != set(expected):
        raise ValueError(f'Missing pinned wheels: {sorted(set(expected) - names)}')
    manifest = {'mineruVersion': '3.4.5', 'target': 'linux-x64-cp310-cpu', 'wheels': wheels}
    manifest_path = args.wheelhouse / 'wheelhouse-manifest.json'
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Wheels are already compressed. A plain tar bounds CPU cost and is readable
    # with Python's standard library in the replacement Host container.
    with tarfile.open(args.output, 'x') as archive:
        for entry in wheels:
            archive.add(args.wheelhouse / entry['fileName'], arcname=f'wheelhouse/{entry["fileName"]}')
        archive.add(manifest_path, arcname='wheelhouse/wheelhouse-manifest.json')
    print(json.dumps({'status': 'PACKAGED', 'wheels': len(wheels), 'bytes': args.output.stat().st_size,
                      'archive': str(args.output)}))


if __name__ == '__main__':
    main()
