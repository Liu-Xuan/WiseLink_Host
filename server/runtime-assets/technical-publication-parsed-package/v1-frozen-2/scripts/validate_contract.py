#!/usr/bin/env python3
"""Execute the complete frozen revision 2 conformance suite."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker
from pypdf import PdfReader

from scripts.build_fixtures import expected_outputs
from scripts.build_freeze_manifest import (
    MANIFEST_RELATIVE as FREEZE_MANIFEST_RELATIVE,
    expected_freeze_manifest,
    render_json as render_freeze_manifest,
)
from scripts.build_source_fixtures import expected_outputs as expected_source_outputs
from scripts.contract_core import (
    DuplicateKeyError,
    jcs_restricted,
    load_json,
    read_parsed_package,
    sha256_text,
    validate_artifact_record,
    validate_package,
    validate_parse_failure_report,
    validate_writer_provenance_manifest,
)
from scripts.version_dispatch import read_versioned_package


CORE_SCHEMA_PATHS = (
    "schema/parsed-package.schema.json",
    "schema/artifact-record.schema.json",
    "schema/parse-failure-report.schema.json",
    "schema/writer-provenance-manifest.schema.json",
    "schema/extension-registry.schema.json",
)


def _codes(items: list[Any], severity: str) -> set[str]:
    return {item.code for item in items if item.severity == severity}


def verify(contract_root: Path) -> dict[str, Any]:
    failures: list[dict[str, Any]] = []
    checks: list[dict[str, Any]] = []

    def record(name: str, ok: bool, **detail: Any) -> None:
        item = {"name": name, "ok": ok, **detail}
        checks.append(item)
        if not ok:
            failures.append(item)

    for relative in CORE_SCHEMA_PATHS:
        try:
            schema = load_json(contract_root / relative)
            Draft202012Validator.check_schema(schema)
            record(f"schema:{relative}", True, schemaId=schema.get("$id"))
        except Exception as exc:  # report malformed schema without hiding the failure
            record(f"schema:{relative}", False, error=str(exc))

    try:
        registry = load_json(contract_root / "extensions/registry.json")
        registry_schema = load_json(contract_root / "schema/extension-registry.schema.json")
        registry_errors = list(
            Draft202012Validator(
                registry_schema, format_checker=FormatChecker()
            ).iter_errors(registry)
        )
        record(
            "extension-registry:schema",
            not registry_errors,
            errors=[item.message for item in registry_errors],
        )
        for registration in registry["extensions"]:
            schema_path = contract_root / registration["schemaPath"]
            extension_schema = load_json(schema_path)
            Draft202012Validator.check_schema(extension_schema)
            record(
                f"extension-schema:{registration['namespace']}",
                extension_schema.get("$id") == registration["schemaId"],
                schemaId=extension_schema.get("$id"),
            )
    except Exception as exc:
        record("extension-registry:load", False, error=str(exc))

    try:
        source_mismatches = []
        for relative, expected in expected_source_outputs().items():
            path = contract_root / relative
            if not path.exists() or path.read_bytes() != expected:
                source_mismatches.append(relative.as_posix())
        record(
            "source-fixture-generator:deterministic",
            not source_mismatches,
            mismatches=source_mismatches,
        )
    except Exception as exc:
        record("source-fixture-generator:deterministic", False, error=str(exc))

    try:
        source_pdf = PdfReader(contract_root / "fixtures/source/minimal-pdf.pdf", strict=True)
        extracted = "\n".join(page.extract_text() or "" for page in source_pdf.pages)
        record(
            "source-pdf:parse-and-text",
            len(source_pdf.pages) == 1
            and "Controlled contract fixture" in extracted
            and "Disconnect electrical power." in extracted,
            pageCount=len(source_pdf.pages),
        )
    except Exception as exc:
        record("source-pdf:parse-and-text", False, error=str(exc))

    try:
        generated = expected_outputs(contract_root)
        mismatches = []
        for relative, expected in generated.items():
            path = contract_root / relative
            if not path.exists() or path.read_bytes() != expected:
                mismatches.append(relative.as_posix())
        record("fixture-generator:deterministic", not mismatches, mismatches=mismatches)
    except Exception as exc:
        record("fixture-generator:deterministic", False, error=str(exc))

    try:
        expected_manifest = render_freeze_manifest(expected_freeze_manifest(contract_root))
        freeze_manifest_path = contract_root / FREEZE_MANIFEST_RELATIVE
        actual_manifest = (
            freeze_manifest_path.read_bytes() if freeze_manifest_path.is_file() else b""
        )
        record(
            "freeze-manifest:actual-bytes",
            actual_manifest == expected_manifest,
            path=FREEZE_MANIFEST_RELATIVE.as_posix(),
            expectedByteLength=len(expected_manifest),
            actualByteLength=len(actual_manifest),
        )
    except Exception as exc:
        record("freeze-manifest:actual-bytes", False, error=str(exc))

    manifest = load_json(contract_root / "fixtures/manifest.json")
    positive_hashes: list[dict[str, str]] = []
    for item in manifest["positivePackages"]:
        package_path = contract_root / item["packagePath"]
        try:
            package = load_json(package_path)
            report = validate_package(
                package,
                contract_root=contract_root,
                artifact=item["packagePath"],
                mode="strict",
            )
            record(
                f"positive:{item['packagePath']}",
                report.ok and package["source"]["kind"] == item["sourceKind"],
                errors=[issue.as_dict() for issue in report.errors],
            )
            reader = read_parsed_package(
                package_path, contract_root=contract_root, mode="strict"
            )
            summary = reader.summary()
            record(
                f"reader:{item['packagePath']}",
                summary["sourceKind"] == item["sourceKind"],
                counts=summary["counts"],
            )
            sidecar = load_json(contract_root / item["artifactRecordPath"])
            sidecar_issues = validate_artifact_record(
                sidecar, contract_root=contract_root, artifact_path=package_path
            )
            record(
                f"artifact-record:{item['artifactRecordPath']}",
                not sidecar_issues,
                errors=[issue.as_dict() for issue in sidecar_issues],
            )
            positive_hashes.append(
                {
                    "path": item["packagePath"],
                    "packageId": package["packageId"],
                    **package["integrity"],
                }
            )
        except Exception as exc:
            record(f"positive:{item['packagePath']}:exception", False, error=str(exc))

    frozen_contract_root = contract_root.parent / "v1"
    try:
        frozen_2_dispatch = read_versioned_package(
            contract_root / "fixtures/positive/minimal-pdf-complete.json",
            candidate_contract_root=contract_root,
            frozen_contract_root=frozen_contract_root,
        )
        record(
            "version-dispatch:frozen-2",
            frozen_2_dispatch.selected_revision == "frozen.2",
            selectedRevision=frozen_2_dispatch.selected_revision,
        )
    except Exception as exc:
        record("version-dispatch:frozen-2", False, error=str(exc))
    try:
        frozen_dispatch = read_versioned_package(
            frozen_contract_root / "fixtures/positive/minimal-pdf-complete.json",
            candidate_contract_root=contract_root,
            frozen_contract_root=frozen_contract_root,
        )
        record(
            "version-dispatch:frozen-1",
            frozen_dispatch.selected_revision == "frozen.1",
            selectedRevision=frozen_dispatch.selected_revision,
        )
    except Exception as exc:
        record("version-dispatch:frozen-1", False, error=str(exc))
    try:
        read_versioned_package(
            contract_root / "fixtures/negative/contract-revision-mismatch.json",
            candidate_contract_root=contract_root,
            frozen_contract_root=frozen_contract_root,
        )
        record("version-dispatch:mixed-revision-rejected", False)
    except ValueError as exc:
        record(
            "version-dispatch:mixed-revision-rejected",
            "CONTRACT.REVISION_MISMATCH" in str(exc),
            error=str(exc),
        )
    try:
        read_versioned_package(
            contract_root / "fixtures/negative/contract-revision-unsupported.json",
            candidate_contract_root=contract_root,
            frozen_contract_root=frozen_contract_root,
        )
        record("version-dispatch:unknown-revision-rejected", False)
    except ValueError as exc:
        record(
            "version-dispatch:unknown-revision-rejected",
            "CONTRACT.REVISION_UNSUPPORTED" in str(exc),
            error=str(exc),
        )

    failure_path = contract_root / manifest["supportDocuments"]["parseFailureReport"]
    failure_issues = validate_parse_failure_report(
        load_json(failure_path), contract_root=contract_root
    )
    record(
        "support:parse-failure-report",
        not failure_issues,
        errors=[issue.as_dict() for issue in failure_issues],
    )
    for relative in manifest["supportDocuments"].get("nativeParseFailureReports", []):
        native_failure_issues = validate_parse_failure_report(
            load_json(contract_root / relative), contract_root=contract_root
        )
        record(
            f"support:native-parse-failure-report:{relative}",
            not native_failure_issues,
            errors=[issue.as_dict() for issue in native_failure_issues],
        )
    writer_path = contract_root / manifest["supportDocuments"]["writerProvenanceManifest"]
    writer_issues = validate_writer_provenance_manifest(
        load_json(writer_path), contract_root=contract_root
    )
    record(
        "support:writer-provenance-manifest",
        not writer_issues,
        errors=[issue.as_dict() for issue in writer_issues],
    )

    for item in manifest["negativePackages"]:
        package = load_json(contract_root / item["packagePath"])
        strict_report = validate_package(
            package,
            contract_root=contract_root,
            artifact=item["packagePath"],
            mode="strict",
        )
        actual_strict_errors = _codes(strict_report.issues, "error")
        expected_strict_errors = set(item["strictErrors"])
        record(
            f"negative:strict:{item['name']}",
            actual_strict_errors == expected_strict_errors,
            expected=sorted(expected_strict_errors),
            actual=sorted(actual_strict_errors),
        )
        if "forensicErrors" in item:
            forensic_report = validate_package(
                package,
                contract_root=contract_root,
                artifact=item["packagePath"],
                mode="forensic",
            )
            actual_forensic_errors = _codes(forensic_report.issues, "error")
            actual_forensic_warnings = _codes(forensic_report.issues, "warning")
            expected_forensic_errors = set(item["forensicErrors"])
            expected_forensic_warnings = set(item["forensicWarnings"])
            record(
                f"negative:forensic:{item['name']}",
                actual_forensic_errors == expected_forensic_errors
                and actual_forensic_warnings == expected_forensic_warnings,
                expectedErrors=sorted(expected_forensic_errors),
                actualErrors=sorted(actual_forensic_errors),
                expectedWarnings=sorted(expected_forensic_warnings),
                actualWarnings=sorted(actual_forensic_warnings),
            )

    for item in manifest["rawJsonFailures"]:
        try:
            load_json(contract_root / item["path"])
            record(f"raw-json:{item['name']}", False, error="input unexpectedly loaded")
        except DuplicateKeyError as exc:
            record(
                f"raw-json:{item['name']}",
                item["expectedCode"] == "JSON.DUPLICATE_KEY",
                code="JSON.DUPLICATE_KEY",
                message=str(exc),
            )
        except Exception as exc:
            record(f"raw-json:{item['name']}", False, error=str(exc))

    vectors_path = contract_root / manifest["canonicalizationVectors"]
    vectors = load_json(vectors_path)
    python_vector_failures = []
    for vector in vectors["vectors"]:
        canonical = jcs_restricted(vector["input"])
        digest = sha256_text(canonical)
        if canonical != vector["expectedCanonicalUtf8"] or digest != vector["expectedSha256"]:
            python_vector_failures.append(vector["name"])
    record(
        "canonicalization:python",
        not python_vector_failures,
        count=len(vectors["vectors"]),
        failures=python_vector_failures,
    )
    try:
        completed = subprocess.run(
            ["node", str(contract_root / "scripts/jcs.mjs"), "--vectors", str(vectors_path)],
            check=False,
            capture_output=True,
            text=True,
        )
        node_report = json.loads(completed.stdout) if completed.stdout else {}
        record(
            "canonicalization:node",
            completed.returncode == 0 and node_report.get("ok") is True,
            returnCode=completed.returncode,
            report=node_report,
            stderr=completed.stderr,
        )
    except Exception as exc:
        record("canonicalization:node", False, error=str(exc))

    return {
        "ok": not failures,
        "contractRevision": manifest["contractRevision"],
        "checks": checks,
        "failures": failures,
        "positivePackageHashes": positive_hashes,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--contract-root", required=True, type=Path)
    args = parser.parse_args()
    try:
        report = verify(args.contract_root.resolve())
    except Exception as exc:
        report = {"ok": False, "fatal": str(exc), "checks": [], "failures": []}
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
