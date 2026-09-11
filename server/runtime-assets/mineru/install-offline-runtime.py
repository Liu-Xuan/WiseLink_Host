"""Restore the fixed Linux CPU MinerU environment from verified offline wheels.

This is a deployment helper, not an HTTP-facing installer. Model/config download
and authorization remain with the Host. No package index is consulted here.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import tarfile
import venv


def check_file(path, size, expected):
    if path.is_symlink() or not path.is_file() or path.stat().st_size != size:
        raise ValueError('MINERU_OFFLINE_WHEEL_INVALID')
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while data := stream.read(8 * 1024 * 1024):
            digest.update(data)
    if digest.hexdigest() != expected:
        raise ValueError('MINERU_OFFLINE_WHEEL_INVALID')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--wheelhouse', type=Path, required=True)
    parser.add_argument('--archive', type=Path)
    args = parser.parse_args()
    if (sys.version_info[:2] != (3, 10) or platform.system() != 'Linux'
            or platform.machine().lower() not in ('x86_64', 'amd64')):
        raise RuntimeError('MINERU_OFFLINE_PLATFORM_UNSUPPORTED')
    root = args.root.resolve()
    if args.archive:
        args.wheelhouse.mkdir(parents=True, exist_ok=True)
        if args.wheelhouse.is_symlink():
            raise ValueError('MINERU_OFFLINE_WHEELHOUSE_INVALID')
        total = 0
        names = set()
        with tarfile.open(args.archive, 'r:') as archive:
            for member in archive:
                parts = member.name.split('/')
                if (not member.isfile() or len(parts) != 2 or parts[0] != 'wheelhouse'
                        or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.+-]*', parts[1])
                        or member.name in names or member.size < 1):
                    raise ValueError('MINERU_OFFLINE_ARCHIVE_INVALID')
                names.add(member.name)
                total += member.size
                if total > 2 * 1024 ** 3 or len(names) > 200:
                    raise ValueError('MINERU_OFFLINE_ARCHIVE_INVALID')
                target = args.wheelhouse / parts[1]
                if target.exists():
                    continue  # Every file is verified against the manifest below.
                source = archive.extractfile(member)
                if source is None:
                    raise ValueError('MINERU_OFFLINE_ARCHIVE_INVALID')
                temporary = target.with_suffix(target.suffix + '.extracting')
                if temporary.exists() or temporary.is_symlink():
                    if not temporary.is_file() or temporary.is_symlink():
                        raise ValueError('MINERU_OFFLINE_WHEELHOUSE_INVALID')
                    temporary.unlink()
                with source, temporary.open('xb') as output:
                    while data := source.read(8 * 1024 * 1024):
                        output.write(data)
                    output.flush()
                    os.fsync(output.fileno())
                temporary.replace(target)
    if args.wheelhouse.is_symlink():
        raise ValueError('MINERU_OFFLINE_WHEELHOUSE_INVALID')
    wheelhouse = args.wheelhouse.resolve(strict=True)
    manifest = json.loads((wheelhouse / 'wheelhouse-manifest.json').read_text())
    if manifest['mineruVersion'] != '3.4.5' or manifest['target'] != 'linux-x64-cp310-cpu':
        raise ValueError('MINERU_OFFLINE_MANIFEST_INVALID')
    requirements = []
    names = set()
    pip_wheel = None
    for entry in manifest['wheels']:
        filename = entry['fileName']
        if (Path(filename).name != filename or not filename.endswith('.whl')
                or '/' in filename or '\\' in filename or filename in names
                or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.+\-]*', filename)
                or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', entry['name'])
                or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.+!_-]*', entry['version'])
                or not re.fullmatch(r'[a-f0-9]{64}', entry['sha256'])
                or not isinstance(entry['bytes'], int) or entry['bytes'] < 1):
            raise ValueError('MINERU_OFFLINE_MANIFEST_INVALID')
        names.add(filename)
        path = wheelhouse / filename
        check_file(path, entry['bytes'], entry['sha256'])
        # Wheel names/version strings are verified again by pip's hash-locked install.
        requirements.append(f'{entry["name"]}=={entry["version"]} --hash=sha256:{entry["sha256"]}')
        if entry['name'] == 'pip':
            pip_wheel = path
    if pip_wheel is None:
        raise ValueError('MINERU_OFFLINE_PIP_MISSING')
    root.mkdir(parents=True, exist_ok=True)
    environment = root / 'venv'
    if environment.is_symlink():
        raise ValueError('MINERU_OFFLINE_ENVIRONMENT_INVALID')
    # Python's standard venv avoids relying on uv, ensurepip, or global pip in a
    # replacement container. Preserve existing environments and repair via pip.
    if not (environment / 'pyvenv.cfg').exists():
        venv.EnvBuilder(with_pip=False, symlinks=False).create(environment)
    locked = root / 'requirements.offline.txt'
    locked.write_text('\n'.join(requirements) + '\n')
    executable = environment / 'bin' / 'python'
    # uv and standard POSIX venvs may link bin/python to a system interpreter.
    # Validate the interpreter itself and its prefix below instead of rejecting
    # a legitimate link before it can be inspected.
    if not executable.is_file():
        raise ValueError('MINERU_OFFLINE_ENVIRONMENT_INVALID')
    child_env = {**os.environ, 'PYTHONPATH': str(pip_wheel), 'PYTHONNOUSERSITE': '1',
                 'PIP_CONFIG_FILE': os.devnull, 'PIP_NO_INDEX': '1', 'PIP_DISABLE_PIP_VERSION_CHECK': '1',
                 'CUDA_VISIBLE_DEVICES': '', 'MINERU_MODEL_SOURCE': 'local',
                 'MINERU_EXPECTED_VENV_ROOT': str(environment.resolve())}
    abi_check = subprocess.run(
        [str(executable), '-c',
         'import os,platform,sys;'
         'assert sys.version_info[:2] == (3,10);'
         'assert platform.python_implementation() == "CPython";'
         'assert platform.system() == "Linux";'
         'assert platform.machine().lower() in ("x86_64","amd64");'
         'assert os.path.realpath(sys.prefix) == os.path.realpath(os.environ["MINERU_EXPECTED_VENV_ROOT"])'],
        env=child_env, check=False, capture_output=True, text=True, timeout=30)
    if abi_check.returncode:
        raise RuntimeError('MINERU_OFFLINE_ENVIRONMENT_INVALID')
    subprocess.run([str(executable), '-m', 'pip', 'install', '--no-index', '--no-deps',
                    '--require-hashes', '--find-links', str(wheelhouse), '-r', str(locked)],
                   env=child_env, check=True, timeout=600)
    child_env.pop('PYTHONPATH')
    subprocess.run([str(executable), '-m', 'pip', 'check'], env=child_env, check=True, timeout=60)
    inspection = subprocess.run([str(executable), '-c',
        'import json,platform,torch,torchvision,cv2,six;'
        'from importlib.metadata import version;'
        'import mineru.backend.pipeline.pipeline_analyze;'
        'assert version("mineru")=="3.4.5";'
        'assert torch.version.cuda is None;'
        'assert torch.ones(2).sum().item()==2;'
        'print(json.dumps({"python":platform.python_version(),"mineru":version("mineru"),'
        '"torch":version("torch"),"torchvision":version("torchvision"),"backend":"pipeline-cpu"}))'],
        env=child_env, check=False, capture_output=True, text=True, timeout=120)
    if inspection.returncode:
        print(inspection.stderr[-8192:], file=sys.stderr)
        raise RuntimeError('MINERU_OFFLINE_IMPORT_FAILED')
    result = json.loads(inspection.stdout.strip())
    print(json.dumps({'status': 'READY', **result, 'executable': str(environment / 'bin' / 'mineru')}), flush=True)


if __name__ == '__main__':
    main()
