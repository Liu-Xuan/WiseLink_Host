#!/usr/bin/env python3
"""Build a U0 Python vendor directory from pinned wheels.

Downloads the exact frozen.2 dependency set from PyPI and unpacks the
wheels verbatim into a vendor directory, producing the same layout as the
committed ``server/runtime/u0-python/vendor/*`` directories (pure wheel
extraction -- no bytecode compile, no metadata beyond what the wheel
itself contains).

Cross-platform: pass ``--platform``/``--python-version``/``--abi`` to
build a vendor for a platform other than the current interpreter (e.g.
build the hosted ``linux-x64-cp310`` vendor from a darwin/arm64 host).

Examples:
  # hosted linux x86_64 cp310 vendor
  python3 scripts/build-u0-python-vendor.py \\
      --target server/runtime/u0-python/vendor/linux-x64-cp310 \\
      --platform manylinux2014_x86_64 --python-version 310 --abi cp310

  # download wheels only (no unpack)
  python3 scripts/build-u0-python-vendor.py --target /tmp/unused \\
      --wheels .u0-build/wheels --download-only
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

PINNED = [
    ("attrs", "26.1.0"),
    ("jsonschema", "4.25.1"),
    ("jsonschema-specifications", "2025.9.1"),
    ("referencing", "0.36.2"),
    ("rfc3339-validator", "0.1.4"),
    ("rpds-py", "0.27.1"),
    ("six", "1.17.0"),
    ("typing-extensions", "4.16.0"),
]

# Files pip --target installs that a pristine wheel never contains; the
# committed vendors keep the pristine wheel layout.
PIP_ONLY_FILES = {"INSTALLER", "REQUESTED", "direct_url.json"}


def run(cmd: list[str]) -> None:
    print(f"[build] $ {' '.join(cmd)}", file=sys.stderr)
    proc = subprocess.run(cmd, check=False)
    if proc.returncode != 0:
        sys.exit(f"FAILED: {' '.join(cmd)}")


def wheel_name(dist: str, version: str) -> str:
    return f"{dist.replace('-', '_')}-{version}-"


def have_wheel(wheel_dir: Path, dist: str, version: str) -> bool:
    return any(p.name.startswith(wheel_name(dist, version)) for p in wheel_dir.iterdir())


def download(wheel_dir: Path, platform_args: list[str]) -> None:
    for name, version in PINNED:
        if have_wheel(wheel_dir, name, version):
            continue
        cmd = [sys.executable, "-m", "pip", "download", f"{name}=={version}"]
        if platform_args:
            cmd += platform_args
        cmd += ["--only-binary", ":all:", "-d", str(wheel_dir)]
        run(cmd)


def unpack(wheel_dir: Path, target: Path) -> None:
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    for name, version in PINNED:
        wheel = next(
            p for p in wheel_dir.iterdir() if p.name.startswith(wheel_name(name, version))
        )
        with zipfile.ZipFile(wheel) as zf:
            zf.extractall(target)
        # strip pip-only metadata and bytecode caches
        for extra in PIP_ONLY_FILES:
            for p in target.rglob(extra):
                p.unlink()
        for cache in list(target.rglob("__pycache__")):
            shutil.rmtree(cache)
        print(f"[build] unpacked {wheel.name}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", required=True, type=Path)
    parser.add_argument("--wheels", type=Path, default=None)
    parser.add_argument("--platform", action="append", default=[])
    parser.add_argument("--python-version", default=None)
    parser.add_argument("--abi", default=None)
    parser.add_argument(
        "--download-only", action="store_true", help="stop after downloading wheels"
    )
    args = parser.parse_args()

    wheel_dir = args.wheels
    if wheel_dir is None:
        wheel_dir = Path(tempfile.mkdtemp(prefix="u0-wheels-"))
    wheel_dir.mkdir(parents=True, exist_ok=True)

    platform_args: list[str] = []
    for p in args.platform:
        platform_args += ["--platform", p]
    if args.python_version:
        platform_args += ["--python-version", args.python_version]
    if args.abi:
        platform_args += ["--abi", args.abi]

    download(wheel_dir, platform_args)

    if args.download_only:
        print(f"[build] wheels ready in {wheel_dir}")
        return 0

    unpack(wheel_dir, args.target)
    print(f"[build] vendor ready at {args.target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
