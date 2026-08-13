#!/usr/bin/env python3
"""Read frozen.1 or frozen.2 through explicit revision dispatch."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from scripts.version_dispatch import read_versioned_package


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--contract-root", required=True, type=Path)
    parser.add_argument("--frozen-contract-root", type=Path)
    parser.add_argument("--package", required=True, type=Path)
    parser.add_argument("--mode", choices=("strict", "forensic"), default="strict")
    args = parser.parse_args()
    contract_root = args.contract_root.resolve()
    frozen_contract_root = (
        args.frozen_contract_root.resolve()
        if args.frozen_contract_root is not None
        else contract_root.parent / "v1"
    )
    package_path = args.package
    if not package_path.is_absolute():
        package_path = contract_root / package_path
    try:
        reader = read_versioned_package(
            package_path.resolve(),
            candidate_contract_root=contract_root,
            frozen_contract_root=frozen_contract_root,
            mode=args.mode,
        )
    except (OSError, TypeError, ValueError) as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "artifact": str(package_path),
                    "mode": args.mode,
                    "error": str(exc),
                },
                ensure_ascii=False,
            )
        )
        return 1
    print(json.dumps({"ok": True, "summary": reader.summary()}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
