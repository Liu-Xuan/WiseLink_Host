#!/usr/bin/env python3
"""Explicit frozen.1/frozen.2 Reader dispatch without schema guessing."""

from __future__ import annotations

import importlib.util
import sys
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Any

from scripts.contract_core import (
    CONTRACT_REVISION,
    CONTRACT_SCHEMA_ID,
    CONTRACT_SCHEMA_VERSION,
    load_json,
    read_parsed_package,
)


FROZEN_SCHEMA_ID = "urn:techpub:schema:v1:parsed-package:frozen-1"
FROZEN_SCHEMA_VERSION = "techpub.parsed-package.v1"
FROZEN_REVISION = "frozen.1"


@dataclass(frozen=True)
class DispatchedReader:
    selected_revision: str
    selected_contract_root: Path
    reader: Any

    def summary(self) -> dict[str, Any]:
        return {
            "selectedContractRevision": self.selected_revision,
            "selectedContractRoot": str(self.selected_contract_root),
            "package": self.reader.summary(),
        }


def _load_frozen_core(frozen_contract_root: Path) -> ModuleType:
    module_name = "_techpub_frozen_1_contract_core"
    existing = sys.modules.get(module_name)
    if existing is not None:
        return existing
    module_path = frozen_contract_root / "scripts" / "contract_core.py"
    if not module_path.is_file():
        raise ValueError(
            f"CONTRACT.REVISION_RUNTIME_MISSING: frozen.1 core not found at {module_path}"
        )
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    if spec is None or spec.loader is None:
        raise ValueError(
            f"CONTRACT.REVISION_RUNTIME_MISSING: cannot load frozen.1 core at {module_path}"
        )
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def read_versioned_package(
    path: Path,
    *,
    candidate_contract_root: Path,
    frozen_contract_root: Path,
    mode: str = "strict",
) -> DispatchedReader:
    package = load_json(path)
    if not isinstance(package, dict):
        raise ValueError("CONTRACT.REVISION_MISMATCH: package root must be an object")
    observed = (
        package.get("$schema"),
        package.get("schemaVersion"),
        package.get("contractRevision"),
    )
    candidate_identity = (
        CONTRACT_SCHEMA_ID,
        CONTRACT_SCHEMA_VERSION,
        CONTRACT_REVISION,
    )
    frozen_identity = (
        FROZEN_SCHEMA_ID,
        FROZEN_SCHEMA_VERSION,
        FROZEN_REVISION,
    )
    if observed == candidate_identity:
        reader = read_parsed_package(
            path,
            contract_root=candidate_contract_root,
            mode=mode,
        )
        return DispatchedReader(CONTRACT_REVISION, candidate_contract_root, reader)
    if observed == frozen_identity:
        frozen_core = _load_frozen_core(frozen_contract_root)
        reader = frozen_core.read_parsed_package(
            path,
            contract_root=frozen_contract_root,
            mode=mode,
        )
        return DispatchedReader(FROZEN_REVISION, frozen_contract_root, reader)

    known_schema_ids = {CONTRACT_SCHEMA_ID, FROZEN_SCHEMA_ID}
    known_revisions = {CONTRACT_REVISION, FROZEN_REVISION}
    if observed[0] in known_schema_ids or observed[2] in known_revisions:
        raise ValueError(
            "CONTRACT.REVISION_MISMATCH: schemaVersion/$schema/contractRevision are mixed: "
            + repr(observed)
        )
    raise ValueError("CONTRACT.REVISION_UNSUPPORTED: " + repr(observed))
