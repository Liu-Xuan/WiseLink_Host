"""Package OpenCV's non-core Linux libraries from Debian's official repository.

No package is installed on the build machine. Debian 11 builds keep the glibc
floor below the manylinux_2_28 Python wheels used by this deployment.
"""
import argparse
import hashlib
import io
import json
import lzma
from pathlib import Path
import posixpath
import tarfile
import urllib.request

REPOSITORY = 'https://deb.debian.org/debian'
PACKAGES = {
    'libgl1': ['libGL.so.1'],
    'libglx0': ['libGLX.so.0'],
    'libglvnd0': ['libGLdispatch.so.0'],
    'libx11-6': ['libX11.so.6'],
    'libxcb1': ['libxcb.so.1'],
    'libxau6': ['libXau.so.6'],
    'libxdmcp6': ['libXdmcp.so.6'],
    'libbsd0': ['libbsd.so.0'],
    'libmd0': ['libmd.so.0'],
    'libglib2.0-0': ['libglib-2.0.so.0', 'libgthread-2.0.so.0'],
    'libpcre3': ['libpcre.so.3'],
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def download(url):
    with urllib.request.urlopen(url, timeout=120) as response:
        return response.read()


def deb_data(data):
    if not data.startswith(b'!<arch>\n'):
        raise ValueError('Invalid Debian archive')
    offset = 8
    while offset + 60 <= len(data):
        header = data[offset:offset + 60]
        name = header[:16].decode().strip().rstrip('/')
        size = int(header[48:58])
        body = data[offset + 60:offset + 60 + size]
        if len(body) != size:
            raise ValueError('Truncated Debian archive')
        if name.startswith('data.tar'):
            return tarfile.open(fileobj=io.BytesIO(body), mode='r:*')
        offset += 60 + size + size % 2
    raise ValueError('Missing Debian data archive')


def content(archive, name):
    members = {item.name.removeprefix('./'): item for item in archive.getmembers()}
    for _ in range(8):
        item = members[name]
        if item.issym():
            name = posixpath.normpath(posixpath.join(posixpath.dirname(name), item.linkname))
        elif item.isfile():
            return archive.extractfile(item).read()
        else:
            raise ValueError('Unexpected library member')
    raise ValueError('Library link loop')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    index = lzma.decompress(download(REPOSITORY + '/dists/bullseye/main/binary-amd64/Packages.xz')).decode()
    selected = {}
    for paragraph in index.split('\n\n'):
        fields = dict(line.split(': ', 1) for line in paragraph.splitlines() if ': ' in line and not line.startswith(' '))
        if fields.get('Package') in PACKAGES and fields.get('Architecture') == 'amd64':
            selected[fields['Package']] = fields
    if set(selected) != set(PACKAGES):
        raise ValueError('Missing Debian package metadata')
    entries = {}
    packages = []
    for package, names in PACKAGES.items():
        fields = selected[package]
        url = REPOSITORY + '/' + fields['Filename']
        data = download(url)
        if len(data) != int(fields['Size']) or sha(data) != fields['SHA256']:
            raise ValueError('Debian package hash mismatch')
        with deb_data(data) as archive:
            members = {item.name.removeprefix('./') for item in archive.getmembers()}
            for name in names:
                choices = [prefix + name for prefix in ('usr/lib/x86_64-linux-gnu/', 'lib/x86_64-linux-gnu/') if prefix + name in members]
                if len(choices) != 1:
                    raise ValueError('Missing or ambiguous library')
                body = content(archive, choices[0])
                if body[:5] != b'\x7fELF\x02' or int.from_bytes(body[18:20], 'little') != 62:
                    raise ValueError('Expected Linux x86_64 ELF library')
                entries['lib/' + name] = body
            copyright_path = 'usr/share/doc/' + package + '/copyright'
            entries['licenses/' + package + '.txt'] = content(archive, copyright_path)
        packages.append({'package': package, 'version': fields['Version'], 'url': url, 'sha256': sha(data)})
        print('VERIFIED ' + package + ' ' + fields['Version'], flush=True)
    manifest = {'schemaVersion': 'wiselink.mineru.system-libs.v1', 'target': 'linux-x64', 'packages': packages,
                'files': [{'path': name, 'bytes': len(body), 'sha256': sha(body)} for name, body in sorted(entries.items())]}
    entries['manifest.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(args.output, 'x') as archive:
        for name, body in sorted(entries.items()):
            member = tarfile.TarInfo(name)
            member.size = len(body)
            member.mode = 0o644
            archive.addfile(member, io.BytesIO(body))
    print(json.dumps({'status': 'PACKAGED', 'libraries': sum(name.startswith('lib/') for name in entries),
                      'bytes': args.output.stat().st_size, 'sha256': sha(args.output.read_bytes())}))


if __name__ == '__main__':
    main()
