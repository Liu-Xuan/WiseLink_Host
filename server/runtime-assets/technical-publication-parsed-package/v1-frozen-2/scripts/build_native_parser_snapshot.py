#!/usr/bin/env python3
"""Capture one deterministic, path-neutral snapshot from the S1000D parser.

The canonical contract does not import the producer at validation time.  This
explicit bridge command is instead run against an exact local producer checkout;
its checked-in output is then treated as an immutable, byte-bound lineage input.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


SOURCE_RELATIVE = Path("fixtures/source/native-s1000d-issue-4-2")
OUTPUT_RELATIVE = Path("fixtures/source/native-s1000d-issue-4-2.parsed.json")
PATH_NEUTRAL_SOURCE = "contract://fixtures/source/native-s1000d-issue-4-2"


def render_json(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def build_snapshot(contract_root: Path, service_root: Path) -> dict[str, Any]:
    source_root = service_root / "src"
    if not source_root.is_dir():
        raise FileNotFoundError(f"S1000D service source directory is absent: {source_root}")
    sys.path.insert(0, str(source_root))
    try:
        from s1000d_service import parse_s1000d  # type: ignore[import-not-found]
    finally:
        sys.path.pop(0)

    parsed = parse_s1000d(contract_root / SOURCE_RELATIVE).to_dict()
    parsed["package"]["source"] = PATH_NEUTRAL_SOURCE
    return parsed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--contract-root", required=True, type=Path)
    parser.add_argument("--s1000d-service-root", required=True, type=Path)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--write", action="store_true")
    action.add_argument("--check", action="store_true")
    args = parser.parse_args()

    contract_root = args.contract_root.resolve()
    service_root = args.s1000d_service_root.resolve()
    expected = render_json(build_snapshot(contract_root, service_root))
    output_path = contract_root / OUTPUT_RELATIVE
    if args.write:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(expected)
        ok = True
    else:
        ok = output_path.is_file() and output_path.read_bytes() == expected
    print(
        json.dumps(
            {
                "ok": ok,
                "output": OUTPUT_RELATIVE.as_posix(),
                "byteLength": len(expected),
            },
            ensure_ascii=False,
        )
    )
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
