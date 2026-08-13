#!/usr/bin/env python3
"""Build the immutable byte manifest for U0 frozen revision 2."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from scripts.contract_core import (
    CONTRACT_REVISION,
    CONTRACT_SCHEMA_ID,
    CONTRACT_SCHEMA_VERSION,
    sha256_bytes,
    sha256_object,
)


MANIFEST_RELATIVE = Path("freeze/frozen-2-contract-manifest.json")
PINNED_DIRECTORIES = ("schema", "extensions", "fixtures", "scripts", "tests")
PINNED_ROOT_FILES = ("requirements.txt",)


def _pinned_paths(contract_root: Path) -> list[Path]:
    paths: list[Path] = []
    for directory in PINNED_DIRECTORIES:
        root = contract_root / directory
        paths.extend(
            path.relative_to(contract_root)
            for path in root.rglob("*")
            if path.is_file()
            and "__pycache__" not in path.parts
            and path.suffix not in {".pyc", ".pyo"}
        )
    paths.extend(Path(value) for value in PINNED_ROOT_FILES)
    return sorted(set(paths), key=lambda value: value.as_posix())


def expected_freeze_manifest(contract_root: Path) -> dict[str, Any]:
    files = []
    for relative in _pinned_paths(contract_root):
        payload = (contract_root / relative).read_bytes()
        files.append(
            {
                "path": relative.as_posix(),
                "byteLength": len(payload),
                "sha256": sha256_bytes(payload),
            }
        )
    stable = {
        "schemaVersion": "techpub.contract-freeze-manifest.v1",
        "contractRevision": CONTRACT_REVISION,
        "contractSchemaVersion": CONTRACT_SCHEMA_VERSION,
        "contractSchemaId": CONTRACT_SCHEMA_ID,
        "files": files,
    }
    return {**stable, "manifestHash": sha256_object(stable)}


def render_json(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--contract-root", required=True, type=Path)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--write", action="store_true")
    action.add_argument("--check", action="store_true")
    args = parser.parse_args()

    contract_root = args.contract_root.resolve()
    manifest = expected_freeze_manifest(contract_root)
    expected = render_json(manifest)
    path = contract_root / MANIFEST_RELATIVE
    if args.write:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(expected)
        ok = True
    else:
        ok = path.is_file() and path.read_bytes() == expected
    print(
        json.dumps(
            {
                "ok": ok,
                "path": MANIFEST_RELATIVE.as_posix(),
                "byteLength": len(expected),
                "fileCount": len(manifest["files"]),
            },
            ensure_ascii=False,
        )
    )
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
