#!/usr/bin/env python3
"""Build the rich native-S1000D U0 fixture and its fail-closed cases."""

from __future__ import annotations

import copy
import json
from collections import Counter
from pathlib import Path
from typing import Any, Mapping

from scripts.contract_core import (
    CONTRACT_REVISION,
    CONTRACT_SCHEMA_ID,
    CONTRACT_SCHEMA_VERSION,
    expected_artifact_id,
    expected_document_id,
    expected_module_id,
    expected_parse_failure_id,
    expected_source_package_hash,
    expected_source_ref_id,
    expected_source_segment_hash,
    expected_source_segment_id,
    expected_unit_id,
    refresh_integrity,
    sha256_bytes,
    sha256_object,
    sha256_text,
    urn_from_hash,
)


ZERO_HASH = "sha256:" + "0" * 64
ZERO_PACKAGE_ID = "urn:techpub:package:v1:sha256:" + "0" * 64
SOURCE_DIR = Path("fixtures/source/native-s1000d-issue-4-2")
SNAPSHOT_PATH = Path("fixtures/source/native-s1000d-issue-4-2.parsed.json")
REAL_BASELINE_PATH = Path("fixtures/source/real-issue-4-2-baseline.summary.json")
RICH_PACKAGE_PATH = Path("fixtures/positive/rich-native-s1000d-issue-4-2.json")


def render_json(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def stable_id(kind: str, namespace: str, value: Any) -> str:
    return urn_from_hash(kind, sha256_object({"namespace": namespace, "value": value}))


def sourced(value: str, source_ref_ids: list[str], *, normalized: bool = False) -> dict[str, Any]:
    return {
        "value": value,
        "authority": "parser_normalized" if normalized else "source_asserted",
        "mappingStatus": "normalized" if normalized else "exact",
        "sourceRefIds": source_ref_ids,
    }


def identifier(
    scheme: str,
    value: str,
    source_ref_ids: list[str],
    *,
    authority: str = "source_asserted",
    completeness: str = "complete",
    missing_components: list[str] | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "scheme": scheme,
        "value": value,
        "authority": authority,
        "completeness": completeness,
        "sourceRefIds": source_ref_ids,
    }
    if missing_components:
        result["missingComponents"] = missing_components
    return result


def target_identifier(
    scheme: str,
    value: str,
    *,
    completeness: str = "complete",
    missing_components: list[str] | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "scheme": scheme,
        "value": value,
        "completeness": completeness,
    }
    if missing_components:
        result["missingComponents"] = missing_components
    return result


def media_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".xml", ".xsd"}:
        return "application/xml"
    if suffix == ".png":
        return "image/png"
    if suffix == ".json":
        return "application/json"
    return "application/octet-stream"


def artifact(
    contract_root: Path,
    relative_path: Path,
    *,
    origin: str,
    role: str,
    normalized_path: str,
) -> dict[str, Any]:
    payload = (contract_root / relative_path).read_bytes()
    result = {
        "artifactId": "urn:techpub:artifact:v1:sha256:" + "0" * 64,
        "origin": origin,
        "role": role,
        "artifactRef": f"contract://{relative_path.as_posix()}",
        "sha256": sha256_bytes(payload),
        "mediaType": media_type(relative_path),
        "byteLength": len(payload),
        "normalizedPath": normalized_path,
    }
    result["artifactId"] = expected_artifact_id(result)
    return result


def xml_source_ref(
    source_artifacts: Mapping[str, Mapping[str, Any]],
    normalized_path: str,
    xpath: str,
    quote: str,
    *,
    element_id: str | None = None,
) -> dict[str, Any]:
    source_artifact = source_artifacts[normalized_path]
    result: dict[str, Any] = {
        "sourceRefId": "urn:techpub:source-ref:v1:sha256:" + "0" * 64,
        "kind": "xml",
        "artifactId": source_artifact["artifactId"],
        "normalizedPath": normalized_path,
        "xpath": xpath,
        "quote": quote,
        "anchorTextHash": sha256_text(quote),
    }
    if element_id:
        result["elementId"] = element_id
    result["sourceRefId"] = expected_source_ref_id(result)
    return result


def source_segment(
    package: Mapping[str, Any],
    continuity_key: str,
    expected_semantic: str,
    order: int,
    source_ref_ids: list[str],
) -> dict[str, Any]:
    result = {
        "sourceSegmentId": "urn:techpub:source-segment:v1:sha256:" + "0" * 64,
        "continuityKey": continuity_key,
        "kind": "xml_element",
        "expectedSemantic": expected_semantic,
        "order": order,
        "sourceRefIds": source_ref_ids,
        "segmentHash": ZERO_HASH,
        "coverageRequired": True,
    }
    result["segmentHash"] = expected_source_segment_hash(result)
    result["sourceSegmentId"] = expected_source_segment_id(package, result)
    return result


def make_unit(
    package: Mapping[str, Any],
    module: Mapping[str, Any],
    *,
    continuity_key: str,
    kind: str,
    order: int,
    depth: int,
    source_ref_ids: list[str],
    source_segment_ids: list[str],
    payload: dict[str, Any],
    parent_unit_id: str | None = None,
    normalized: bool = False,
    finding_ids: list[str] | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "unitId": "urn:techpub:unit:v1:sha256:" + "0" * 64,
        "continuityKey": continuity_key,
        "unitHash": ZERO_HASH,
        "moduleId": module["moduleId"],
        "kind": kind,
        "identityStability": "source_stable",
        "order": order,
        "depth": depth,
        "sourceRefIds": source_ref_ids,
        "sourceSegmentIds": source_segment_ids,
        "mapping": {
            "status": "mapped_with_normalization" if normalized else "mapped_exactly",
            "confidence": "deterministic",
            "findingIds": finding_ids or [],
        },
        "payload": payload,
    }
    if parent_unit_id:
        result["parentUnitId"] = parent_unit_id
    result["unitId"] = expected_unit_id(package, module, result)
    return result


def make_reference(
    *,
    reference_type: str,
    from_unit_id: str,
    target_kind: str,
    target: dict[str, Any],
    resolution_status: str,
    source_ref_ids: list[str],
    finding_ids: list[str] | None = None,
    authority: str = "parser_normalized",
) -> dict[str, Any]:
    seed = {
        "referenceType": reference_type,
        "fromUnitId": from_unit_id,
        "targetKind": target_kind,
        "target": target,
        "resolutionStatus": resolution_status,
        "sourceRefIds": source_ref_ids,
    }
    return {
        "referenceId": stable_id("reference", "techpub-reference-id-v1", seed),
        "referenceType": reference_type,
        "fromUnitId": from_unit_id,
        "target": {"kind": target_kind, "identifier": target},
        "resolutionStatus": resolution_status,
        "authority": authority,
        "sourceRefIds": source_ref_ids,
        "findingIds": finding_ids or [],
    }


def coverage_summary(entries: list[dict[str, Any]]) -> dict[str, Any]:
    counts = Counter(item["disposition"] for item in entries)
    return {
        "requiredSourceSegmentCount": len(entries),
        "mappedExactlyCount": counts["mapped_exactly"],
        "mappedWithNormalizationCount": counts["mapped_with_normalization"],
        "preservedAsTextCount": counts["preserved_as_text"],
        "intentionallyExcludedCount": counts["intentionally_excluded_with_reason"],
        "blockedCount": counts["blocked_with_finding"],
        "accountingComplete": True,
        "contentPreserved": counts["blocked_with_finding"] == 0,
        "structuredCoverageComplete": (
            counts["blocked_with_finding"] == 0 and counts["preserved_as_text"] == 0
        ),
    }


def build_native_package(contract_root: Path) -> dict[str, Any]:
    snapshot = json.loads((contract_root / SNAPSHOT_PATH).read_text(encoding="utf-8"))
    baseline = json.loads((contract_root / REAL_BASELINE_PATH).read_text(encoding="utf-8"))
    parser_modules = {item["moduleType"]: item for item in snapshot["modules"]}
    if set(parser_modules) != {"dm", "pm", "dml", "ddn"}:
        raise ValueError("synthetic parser snapshot must contain exactly DM, PM, DML, and DDN")
    if snapshot["summary"] != {
        "valid": True,
        "fileCount": 9,
        "moduleCount": 4,
        "contentUnitCount": 9,
        "referenceCount": 6,
        "assetCount": 1,
        "findingCount": 0,
        "referenceCounts": {
            "delivery_file:resolved": 2,
            "internal:resolved": 1,
            "external_publication:external": 1,
            "dm:resolved": 2,
        },
    }:
        raise ValueError("synthetic parser snapshot summary changed; review the U0 mapping")

    source_paths = sorted(
        item.relative_to(contract_root / SOURCE_DIR).as_posix()
        for item in (contract_root / SOURCE_DIR).rglob("*")
        if item.is_file()
    )
    snapshot_paths = sorted(item["path"] for item in snapshot["package"]["files"])
    if source_paths != snapshot_paths:
        raise ValueError("snapshot package inventory does not match checked-in source bytes")
    snapshot_files = {item["path"]: item for item in snapshot["package"]["files"]}
    for normalized_path in source_paths:
        payload = (contract_root / SOURCE_DIR / normalized_path).read_bytes()
        observed = snapshot_files[normalized_path]
        if observed["sha256"] != sha256_bytes(payload).removeprefix("sha256:"):
            raise ValueError(f"snapshot member hash does not bind source bytes: {normalized_path}")
        if observed["size"] != len(payload):
            raise ValueError(f"snapshot member size does not bind source bytes: {normalized_path}")
        expected_parser_media_type = (
            "application/octet-stream"
            if Path(normalized_path).suffix.lower() == ".xsd"
            else media_type(Path(normalized_path))
        )
        if observed["mediaType"] != expected_parser_media_type:
            raise ValueError(f"snapshot member media type changed: {normalized_path}")

    source_artifacts_list: list[dict[str, Any]] = []
    for normalized_path in source_paths:
        relative_path = SOURCE_DIR / normalized_path
        suffix = Path(normalized_path).suffix.lower()
        role = "information_entity" if suffix == ".png" else ("schema" if suffix == ".xsd" else "xml")
        source_artifacts_list.append(
            artifact(
                contract_root,
                relative_path,
                origin="source",
                role=role,
                normalized_path=normalized_path,
            )
        )
    source_artifacts = {item["normalizedPath"]: item for item in source_artifacts_list}
    snapshot_artifact = artifact(
        contract_root,
        SNAPSHOT_PATH,
        origin="derived",
        role="producer_snapshot",
        normalized_path="lineage/native-s1000d-issue-4-2.parsed.json",
    )
    baseline_artifact = artifact(
        contract_root,
        REAL_BASELINE_PATH,
        origin="derived",
        role="controlled_real_baseline_summary",
        normalized_path="lineage/real-issue-4-2-baseline.summary.json",
    )

    source_package_id = "s1000d:controlled-fixture-package:issue-4.2:001"
    package: dict[str, Any] = {
        "$schema": CONTRACT_SCHEMA_ID,
        "schemaVersion": CONTRACT_SCHEMA_VERSION,
        "contractRevision": CONTRACT_REVISION,
        "packageId": ZERO_PACKAGE_ID,
        "integrity": {
            "hashSpecVersion": "techpub.hash.v1",
            "canonicalization": "RFC8785-JCS",
            "digestAlgorithm": "SHA-256",
            "contentHash": ZERO_HASH,
            "semanticHash": ZERO_HASH,
            "provenanceHash": ZERO_HASH,
            "coverageHash": ZERO_HASH,
        },
        "result": {
            "status": "complete",
            "accountingComplete": True,
            "contentPreserved": True,
            "structuredCoverageComplete": True,
        },
        "artifacts": source_artifacts_list + [snapshot_artifact, baseline_artifact],
        "source": {
            "kind": "native_s1000d",
            "sourcePackageId": source_package_id,
            "sourcePackageHash": ZERO_HASH,
            "identityAuthority": "service_observed",
            "artifactIds": [item["artifactId"] for item in source_artifacts_list],
            "deliveryObjects": [],
            "legacyIdentifiers": [
                {
                    "namespace": "s1000d-service.parser-package-hash.v1",
                    "value": snapshot["package"]["hash"],
                }
            ],
        },
        "profile": {
            "canonicalModel": "technical-publication-core.v1",
            "sourceProfile": "S1000D_4-2",
            "sourceStandard": {
                "name": "S1000D",
                "issue": "4.2",
                "profile": "controlled-synthetic-contract-fixture",
            },
            "mappingProfile": {
                "id": "s1000d-issue-4.2-to-techpub-core-v1",
                "version": "frozen.2",
                "hash": sha256_object(
                    {
                        "id": "s1000d-issue-4.2-to-techpub-core-v1",
                        "version": "frozen.2",
                        "projection": "DM+PM+DML+DDN+ICN",
                    }
                ),
            },
        },
        "lineage": {
            "generatedAt": "2026-08-11T00:00:00Z",
            "producer": {
                "name": "techpub-s1000d-u0-fixture-projector",
                "version": "frozen.2",
                "runtime": "python",
                "buildHash": sha256_object(
                    {"name": "techpub-s1000d-u0-fixture-projector", "version": "frozen.2"}
                ),
            },
            "inputs": [],
        },
        "document": {},
        "publicationStructures": [],
        "modules": [],
        "sourceRefs": [],
        "sourceSegments": [],
        "contentUnits": [],
        "references": [],
        "assets": [],
        "applicability": {
            "sourceExpressions": [],
            "normalizedCandidates": [],
            "assignments": [],
        },
        "coverage": {
            "basis": {
                "segmentSetId": "urn:techpub:source-segment-set:v1:sha256:" + "0" * 64,
                "segmentSetHash": ZERO_HASH,
                "segmentationProfileId": "s1000d-issue-4.2-semantic-elements-v1",
                "segmentationProfileHash": sha256_object(
                    {"id": "s1000d-issue-4.2-semantic-elements-v1", "version": 1}
                ),
                "requiredSourceSegmentCount": 0,
            },
            "entries": [],
            "summary": {
                "requiredSourceSegmentCount": 0,
                "mappedExactlyCount": 0,
                "mappedWithNormalizationCount": 0,
                "preservedAsTextCount": 0,
                "intentionallyExcludedCount": 0,
                "blockedCount": 0,
                "accountingComplete": True,
                "contentPreserved": True,
                "structuredCoverageComplete": True,
            },
        },
        "findings": [],
        "extensions": [],
    }
    package["source"]["sourcePackageHash"] = expected_source_package_hash(package)
    package["lineage"]["inputs"] = [
        {
            "role": "source_package",
            "schemaVersion": "S1000D_4-2",
            "id": source_package_id,
            "hash": package["source"]["sourcePackageHash"],
            "artifactIds": package["source"]["artifactIds"],
        },
        {
            "role": "producer_snapshot",
            "schemaVersion": snapshot["schemaVersion"],
            "id": "s1000d-parser-snapshot:controlled-fixture:001",
            "hash": snapshot_artifact["sha256"],
            "artifactIds": [snapshot_artifact["artifactId"]],
        },
        {
            "role": "controlled_real_baseline_summary",
            "schemaVersion": baseline["schemaVersion"],
            "id": "s1000d-real-controlled-baseline:issue-4.2:2026-08-11",
            "hash": baseline_artifact["sha256"],
            "artifactIds": [baseline_artifact["artifactId"]],
        },
    ]

    ref_specs = {
        "dm_meta": ("DMC-FIXTURE.XML", "/dmodule/identAndStatusSection/dmAddress", "Fixture equipment Controlled procedure", None),
        "pm_meta": ("PMC-FIXTURE.XML", "/pm/identAndStatusSection/pmAddress", "Controlled fixture publication", None),
        "dml": ("DML-FIXTURE.XML", "/dml", "FIXTURE", None),
        "ddn": ("DDN-FIXTURE.XML", "/ddn", "DMC-FIXTURE.XML ICN-FIXTURE-001.png", None),
        "heading": ("DMC-FIXTURE.XML", "/dmodule/content/description/levelledPara/title", "Controlled fixture overview", None),
        "paragraph": ("DMC-FIXTURE.XML", "/dmodule/content/description/levelledPara/para", "This synthetic module contains no manufacturer instruction.", None),
        "step": ("DMC-FIXTURE.XML", "/dmodule/content/procedure/mainProcedure/proceduralStep", "Disconnect the synthetic test power source.", "step-fixture-1"),
        "warning": ("DMC-FIXTURE.XML", "/dmodule/content/procedure/mainProcedure/proceduralStep/warning", "Use only the synthetic test set.", "warning-fixture-1"),
        "caution": ("DMC-FIXTURE.XML", "/dmodule/content/procedure/mainProcedure/proceduralStep/caution", "Protect the fixture connector.", "caution-fixture-1"),
        "note": ("DMC-FIXTURE.XML", "/dmodule/content/procedure/mainProcedure/proceduralStep/note", "This note has no engineering authority.", "note-fixture-1"),
        "list": ("DMC-FIXTURE.XML", "/dmodule/content/procedure/mainProcedure/proceduralStep/randomList", "Inspect the synthetic label.", None),
        "list_item": ("DMC-FIXTURE.XML", "/dmodule/content/procedure/mainProcedure/proceduralStep/randomList/listItem", "Inspect the synthetic label.", None),
        "table": ("DMC-FIXTURE.XML", "/dmodule/content/procedure/mainProcedure/proceduralStep/table", "Fixture parts Item Status Fixture label CHECK", "table-fixture-1"),
        "figure": ("DMC-FIXTURE.XML", "/dmodule/content/procedure/mainProcedure/proceduralStep/figure", "Fixture connection", "figure-fixture-1"),
        "graphic": ("DMC-FIXTURE.XML", "/dmodule/content/procedure/mainProcedure/proceduralStep/figure/graphic", "ICN-FIXTURE-001", "graphic-fixture-1"),
        "internal_ref": ("DMC-FIXTURE.XML", "/dmodule/content/procedure/mainProcedure/proceduralStep/internalRef", "step-fixture-1", None),
        "external_ref": ("DMC-FIXTURE.XML", "/dmodule/content/procedure/mainProcedure/proceduralStep/externalPubRef", "FIXTURE-MANUAL-001", None),
        "applicability": ("DMC-FIXTURE.XML", "/dmodule/identAndStatusSection/dmStatus/applic", "TEST ASSET GROUP ALPHA ONLY", "app-fixture-1"),
        "pm_entry": ("PMC-FIXTURE.XML", "/pm/content/pmEntry", "Fixture procedure", None),
        "pm_dm_ref": ("PMC-FIXTURE.XML", "/pm/content/pmEntry/dmRef", "FIXTURE", None),
    }
    refs: dict[str, dict[str, Any]] = {}
    for key, (normalized_path, xpath, quote, element_id) in ref_specs.items():
        refs[key] = xml_source_ref(
            source_artifacts,
            normalized_path,
            xpath,
            quote,
            element_id=element_id,
        )
    for schema_path in ("SCHEMA/ddn.xsd", "SCHEMA/descript.xsd", "SCHEMA/dml.xsd", "SCHEMA/pm.xsd"):
        refs[f"schema:{schema_path}"] = xml_source_ref(
            source_artifacts,
            schema_path,
            "/xs:schema",
            "<xs:schema",
        )
    package["sourceRefs"] = list(refs.values())

    dm_parser = parser_modules["dm"]
    pm_parser = parser_modules["pm"]
    dm_module = {
        "moduleId": "urn:techpub:module:v1:sha256:" + "0" * 64,
        "continuityKey": dm_parser["identity"],
        "moduleKind": "data_module",
        "informationType": "descriptive",
        "authority": "source_asserted",
        "identityStability": "source_stable",
        "order": 0,
        "standardIdentity": identifier("s1000d_dm_identity", dm_parser["identity"], [refs["dm_meta"]["sourceRefId"]]),
        "title": sourced(dm_parser["title"], [refs["dm_meta"]["sourceRefId"]]),
        "sourceRefIds": [refs["dm_meta"]["sourceRefId"]],
        "contentUnitIds": [],
    }
    dm_module["moduleId"] = expected_module_id(package, dm_module)
    pm_module = {
        "moduleId": "urn:techpub:module:v1:sha256:" + "0" * 64,
        "continuityKey": pm_parser["identity"],
        "moduleKind": "other",
        "informationType": "publication",
        "authority": "source_asserted",
        "identityStability": "source_stable",
        "order": 1,
        "standardIdentity": identifier("s1000d_pm_identity", pm_parser["identity"], [refs["pm_meta"]["sourceRefId"]]),
        "title": sourced(pm_parser["title"], [refs["pm_meta"]["sourceRefId"]]),
        "sourceRefIds": [refs["pm_meta"]["sourceRefId"]],
        "contentUnitIds": [],
    }
    pm_module["moduleId"] = expected_module_id(package, pm_module)
    package["modules"] = [dm_module, pm_module]

    package["document"] = {
        "documentId": "urn:techpub:document:v1:sha256:" + "0" * 64,
        "documentType": sourced("publication", [refs["pm_meta"]["sourceRefId"]], normalized=True),
        "title": sourced(pm_parser["title"], [refs["pm_meta"]["sourceRefId"]]),
        "identifiers": [
            identifier("s1000d_pm_identity", pm_parser["identity"], [refs["pm_meta"]["sourceRefId"]])
        ],
        "language": sourced(pm_parser["language"], [refs["pm_meta"]["sourceRefId"]]),
        "revision": {
            "label": sourced(
                f"{pm_parser['issueNumber']}-{pm_parser['inWork']}",
                [refs["pm_meta"]["sourceRefId"]],
            )
        },
        "relationships": [],
    }
    package["document"]["documentId"] = expected_document_id(package)

    publication_id = stable_id(
        "publication-structure", "techpub-publication-structure-id-v1", pm_parser["identity"]
    )
    publication_node_id = stable_id(
        "publication-node", "techpub-publication-node-id-v1", {"pm": pm_parser["identity"], "entry": 0}
    )
    package["publicationStructures"] = [
        {
            "publicationStructureId": publication_id,
            "continuityKey": pm_parser["identity"],
            "kind": "s1000d_publication_module",
            "authority": "source_asserted",
            "order": 0,
            "standardIdentity": identifier("s1000d_pm_identity", pm_parser["identity"], [refs["pm_meta"]["sourceRefId"]]),
            "title": sourced(pm_parser["title"], [refs["pm_meta"]["sourceRefId"]]),
            "sourceRefIds": [refs["pm_meta"]["sourceRefId"], refs["pm_entry"]["sourceRefId"]],
            "nodes": [
                {
                    "nodeId": publication_node_id,
                    "continuityKey": "pm-entry-fixture-procedure",
                    "order": 0,
                    "title": sourced("Fixture procedure", [refs["pm_entry"]["sourceRefId"]]),
                    "moduleIds": [dm_module["moduleId"]],
                    "children": [],
                }
            ],
        }
    ]

    delivery_objects = []
    for module_type, ref_key in (("dml", "dml"), ("ddn", "ddn")):
        parser_record = parser_modules[module_type]
        delivery_objects.append(
            {
                "deliveryObjectId": stable_id(
                    "delivery-object", "techpub-delivery-object-id-v1", parser_record["identity"]
                ),
                "kind": module_type,
                "identifier": identifier(
                    f"s1000d_{module_type}_identity",
                    parser_record["identity"],
                    [refs[ref_key]["sourceRefId"]],
                ),
                "artifactIds": [source_artifacts[parser_record["sourcePath"]]["artifactId"]],
                "sourceRefIds": [refs[ref_key]["sourceRefId"]],
            }
        )
    package["source"]["deliveryObjects"] = delivery_objects

    segment_specs: list[tuple[str, str, list[str]]] = []
    for schema_path in ("SCHEMA/ddn.xsd", "SCHEMA/descript.xsd", "SCHEMA/dml.xsd", "SCHEMA/pm.xsd"):
        segment_specs.append((f"schema:{schema_path}", "other", [refs[f"schema:{schema_path}"]["sourceRefId"]]))
    segment_specs.extend(
        [
            ("dm-metadata", "metadata", [refs["dm_meta"]["sourceRefId"]]),
            ("pm-metadata", "metadata", [refs["pm_meta"]["sourceRefId"]]),
            ("dml-delivery-object", "other", [refs["dml"]["sourceRefId"]]),
            ("ddn-delivery-object", "other", [refs["ddn"]["sourceRefId"]]),
            ("dm-heading", "heading", [refs["heading"]["sourceRefId"]]),
            ("dm-paragraph", "text", [refs["paragraph"]["sourceRefId"]]),
            ("dm-step", "step", [refs["step"]["sourceRefId"]]),
            ("dm-warning", "advisory", [refs["warning"]["sourceRefId"]]),
            ("dm-caution", "advisory", [refs["caution"]["sourceRefId"]]),
            ("dm-note", "advisory", [refs["note"]["sourceRefId"]]),
            ("dm-list", "list", [refs["list"]["sourceRefId"]]),
            ("dm-list-item", "list", [refs["list_item"]["sourceRefId"]]),
            ("dm-table", "table", [refs["table"]["sourceRefId"]]),
            ("dm-figure", "figure", [refs["figure"]["sourceRefId"]]),
            ("dm-asset", "asset", [refs["graphic"]["sourceRefId"]]),
            ("dm-internal-reference", "reference", [refs["internal_ref"]["sourceRefId"]]),
            ("dm-external-reference", "reference", [refs["external_ref"]["sourceRefId"]]),
            ("dm-applicability", "applicability", [refs["applicability"]["sourceRefId"]]),
            ("pm-entry-heading", "heading", [refs["pm_entry"]["sourceRefId"]]),
            ("pm-dm-reference", "reference", [refs["pm_dm_ref"]["sourceRefId"]]),
        ]
    )
    segments: dict[str, dict[str, Any]] = {}
    for order, (key, expected_semantic, source_ref_ids) in enumerate(segment_specs):
        segments[key] = source_segment(package, key, expected_semantic, order, source_ref_ids)
    package["sourceSegments"] = list(segments.values())

    heading = make_unit(
        package,
        dm_module,
        continuity_key="section-overview/title",
        kind="heading",
        order=0,
        depth=0,
        source_ref_ids=[refs["heading"]["sourceRefId"]],
        source_segment_ids=[segments["dm-heading"]["sourceSegmentId"]],
        payload={"text": "Controlled fixture overview", "level": 1},
    )
    paragraph = make_unit(
        package,
        dm_module,
        continuity_key="section-overview/paragraph-1",
        kind="paragraph",
        order=0,
        depth=1,
        parent_unit_id=heading["unitId"],
        source_ref_ids=[refs["paragraph"]["sourceRefId"]],
        source_segment_ids=[segments["dm-paragraph"]["sourceSegmentId"]],
        payload={"text": "This synthetic module contains no manufacturer instruction.", "role": "body"},
    )
    step = make_unit(
        package,
        dm_module,
        continuity_key="step-fixture-1",
        kind="step",
        order=1,
        depth=0,
        source_ref_ids=[refs["step"]["sourceRefId"]],
        source_segment_ids=[segments["dm-step"]["sourceSegmentId"]],
        payload={
            "stepRole": "procedural",
            "label": "1",
            "instructionText": "Disconnect the synthetic test power source.",
        },
        normalized=True,
    )
    warning = make_unit(
        package,
        dm_module,
        continuity_key="warning-fixture-1",
        kind="advisory",
        order=0,
        depth=1,
        parent_unit_id=step["unitId"],
        source_ref_ids=[refs["warning"]["sourceRefId"]],
        source_segment_ids=[segments["dm-warning"]["sourceSegmentId"]],
        payload={
            "advisoryType": "warning",
            "text": "Use only the synthetic test set.",
            "scope": {"kind": "explicit_units", "targetUnitIds": [step["unitId"]]},
        },
        normalized=True,
    )
    caution = make_unit(
        package,
        dm_module,
        continuity_key="caution-fixture-1",
        kind="advisory",
        order=1,
        depth=1,
        parent_unit_id=step["unitId"],
        source_ref_ids=[refs["caution"]["sourceRefId"]],
        source_segment_ids=[segments["dm-caution"]["sourceSegmentId"]],
        payload={
            "advisoryType": "caution",
            "text": "Protect the fixture connector.",
            "scope": {"kind": "explicit_units", "targetUnitIds": [step["unitId"]]},
        },
        normalized=True,
    )
    note = make_unit(
        package,
        dm_module,
        continuity_key="note-fixture-1",
        kind="advisory",
        order=2,
        depth=1,
        parent_unit_id=step["unitId"],
        source_ref_ids=[refs["note"]["sourceRefId"]],
        source_segment_ids=[segments["dm-note"]["sourceSegmentId"]],
        payload={
            "advisoryType": "note",
            "text": "This note has no engineering authority.",
            "scope": {"kind": "explicit_units", "targetUnitIds": [step["unitId"]]},
        },
        normalized=True,
    )
    list_container = make_unit(
        package,
        dm_module,
        continuity_key="random-list-fixture-1",
        kind="list",
        order=3,
        depth=1,
        parent_unit_id=step["unitId"],
        source_ref_ids=[refs["list"]["sourceRefId"]],
        source_segment_ids=[segments["dm-list"]["sourceSegmentId"]],
        payload={"listType": "unordered", "itemUnitIds": []},
        normalized=True,
    )
    list_item = make_unit(
        package,
        dm_module,
        continuity_key="random-list-fixture-1/item-1",
        kind="list_item",
        order=0,
        depth=2,
        parent_unit_id=list_container["unitId"],
        source_ref_ids=[refs["list_item"]["sourceRefId"]],
        source_segment_ids=[segments["dm-list-item"]["sourceSegmentId"]],
        payload={"marker": "•", "text": "Inspect the synthetic label."},
    )
    list_container["payload"]["itemUnitIds"] = [list_item["unitId"]]

    table_ref_ids = [refs["table"]["sourceRefId"]]
    table_seed = "table-fixture-1"
    rows = []
    for row_order, values in enumerate((("Item", "Status"), ("Fixture label", "CHECK"))):
        cells = []
        for column, value in enumerate(values):
            inline_id = stable_id(
                "inline", "techpub-inline-id-v1", {"table": table_seed, "row": row_order, "column": column}
            )
            cells.append(
                {
                    "cellId": stable_id(
                        "table-cell", "techpub-table-cell-id-v1", {"table": table_seed, "row": row_order, "column": column}
                    ),
                    "order": column,
                    "columnStart": column,
                    "rowSpan": 1,
                    "colSpan": 1,
                    "role": "header" if row_order == 0 else "data",
                    "inlineContent": [
                        {
                            "inlineId": inline_id,
                            "kind": "text",
                            "text": value,
                            "sourceRefIds": table_ref_ids,
                        }
                    ],
                    "sourceRefIds": table_ref_ids,
                }
            )
        rows.append(
            {
                "rowId": stable_id("table-row", "techpub-table-row-id-v1", {"table": table_seed, "row": row_order}),
                "order": row_order,
                "cells": cells,
                "sourceRefIds": table_ref_ids,
            }
        )
    table = make_unit(
        package,
        dm_module,
        continuity_key=table_seed,
        kind="table",
        order=4,
        depth=1,
        parent_unit_id=step["unitId"],
        source_ref_ids=table_ref_ids,
        source_segment_ids=[segments["dm-table"]["sourceSegmentId"]],
        payload={
            "layout": "grid",
            "caption": "Fixture parts",
            "columnCount": 2,
            "columns": [
                {
                    "columnId": stable_id(
                        "table-column",
                        "techpub-table-column-id-v1",
                        {"table": table_seed, "order": column_order},
                    ),
                    "order": column_order,
                    "name": column_name,
                    "width": "1*",
                    "align": "left",
                    "sourceRefIds": table_ref_ids,
                }
                for column_order, column_name in enumerate(("item", "status"))
            ],
            "rowGroups": [
                {
                    "rowGroupId": stable_id("table-row-group", "techpub-table-row-group-id-v1", table_seed),
                    "kind": "tbody",
                    "order": 0,
                    "rows": rows,
                }
            ],
        },
        normalized=True,
    )

    asset_id = stable_id(
        "asset",
        "techpub-asset-id-v1",
        {"identity": "ICN-FIXTURE-001", "sha256": source_artifacts["ICN-FIXTURE-001.png"]["sha256"]},
    )
    rendition_id = stable_id(
        "rendition", "techpub-rendition-id-v1", {"assetId": asset_id, "role": "source_original"}
    )
    package["assets"] = [
        {
            "assetId": asset_id,
            "logicalType": "s1000d_information_entity",
            "authority": "source_asserted",
            "standardIdentity": identifier(
                "s1000d_icn", "ICN-FIXTURE-001", [refs["graphic"]["sourceRefId"]]
            ),
            "title": sourced("Fixture connection", [refs["figure"]["sourceRefId"]]),
            "sourceRefIds": [refs["graphic"]["sourceRefId"]],
            "renditions": [
                {
                    "renditionId": rendition_id,
                    "role": "source_original",
                    "artifactId": source_artifacts["ICN-FIXTURE-001.png"]["artifactId"],
                    "mediaType": "image/png",
                    "sha256": source_artifacts["ICN-FIXTURE-001.png"]["sha256"],
                    "pixelWidth": 1,
                    "pixelHeight": 1,
                    "sourceRefIds": [refs["graphic"]["sourceRefId"]],
                }
            ],
        }
    ]

    figure = make_unit(
        package,
        dm_module,
        continuity_key="figure-fixture-1",
        kind="figure",
        order=5,
        depth=1,
        parent_unit_id=step["unitId"],
        source_ref_ids=[refs["figure"]["sourceRefId"]],
        source_segment_ids=[segments["dm-figure"]["sourceSegmentId"]],
        payload={
            "figureId": stable_id("figure", "techpub-figure-id-v1", "figure-fixture-1"),
            "caption": "Fixture connection",
            "assetIds": [asset_id],
            "referenceIds": [],
        },
        normalized=True,
    )
    dm_reference_unit = make_unit(
        package,
        dm_module,
        continuity_key="step-fixture-1/references",
        kind="reference",
        order=6,
        depth=1,
        parent_unit_id=step["unitId"],
        source_ref_ids=[refs["internal_ref"]["sourceRefId"], refs["external_ref"]["sourceRefId"]],
        source_segment_ids=[
            segments["dm-internal-reference"]["sourceSegmentId"],
            segments["dm-external-reference"]["sourceSegmentId"],
        ],
        payload={"referenceIds": []},
        normalized=True,
    )
    pm_heading = make_unit(
        package,
        pm_module,
        continuity_key="pm-entry-fixture-procedure/title",
        kind="heading",
        order=0,
        depth=0,
        source_ref_ids=[refs["pm_entry"]["sourceRefId"]],
        source_segment_ids=[segments["pm-entry-heading"]["sourceSegmentId"]],
        payload={"text": "Fixture procedure", "level": 1},
    )
    pm_reference_unit = make_unit(
        package,
        pm_module,
        continuity_key="pm-entry-fixture-procedure/dm-ref",
        kind="reference",
        order=0,
        depth=1,
        parent_unit_id=pm_heading["unitId"],
        source_ref_ids=[refs["pm_dm_ref"]["sourceRefId"]],
        source_segment_ids=[segments["pm-dm-reference"]["sourceSegmentId"]],
        payload={"referenceIds": []},
        normalized=True,
    )

    external_finding = {
        "findingId": stable_id(
            "finding",
            "techpub-finding-id-v1",
            {"code": "S1000D.EXTERNAL_REFERENCE_PARTIAL", "target": "FIXTURE-MANUAL-001"},
        ),
        "code": "S1000D.EXTERNAL_REFERENCE_PARTIAL",
        "severity": "warning",
        "message": "The external publication reference has no source revision; it remains a partial identifier.",
        "stage": "projection",
        "blocking": False,
        "blocks": [],
        "sourceRefIds": [refs["external_ref"]["sourceRefId"]],
        "sourceSegmentIds": [segments["dm-external-reference"]["sourceSegmentId"]],
        "affectedUnitIds": [dm_reference_unit["unitId"]],
        "parameters": {"targetCode": "FIXTURE-MANUAL-001", "missingComponents": ["revision"]},
    }
    package["findings"] = [external_finding]
    dm_reference_unit["mapping"]["findingIds"] = [external_finding["findingId"]]

    internal_reference = make_reference(
        reference_type="internal_anchor",
        from_unit_id=dm_reference_unit["unitId"],
        target_kind="unit",
        target=target_identifier("techpub_core_unit_id", step["unitId"]),
        resolution_status="resolved",
        source_ref_ids=[refs["internal_ref"]["sourceRefId"]],
    )
    external_reference = make_reference(
        reference_type="external_reference",
        from_unit_id=dm_reference_unit["unitId"],
        target_kind="external",
        target=target_identifier(
            "external_publication_code",
            "FIXTURE-MANUAL-001",
            completeness="partial",
            missing_components=["revision"],
        ),
        resolution_status="external",
        source_ref_ids=[refs["external_ref"]["sourceRefId"]],
        finding_ids=[external_finding["findingId"]],
        authority="source_asserted",
    )
    asset_reference = make_reference(
        reference_type="asset_reference",
        from_unit_id=figure["unitId"],
        target_kind="asset",
        target=target_identifier("techpub_core_asset_id", asset_id),
        resolution_status="resolved",
        source_ref_ids=[refs["graphic"]["sourceRefId"]],
    )
    pm_dm_reference = make_reference(
        reference_type="module_reference",
        from_unit_id=pm_reference_unit["unitId"],
        target_kind="module",
        target=target_identifier("techpub_core_module_id", dm_module["moduleId"]),
        resolution_status="resolved",
        source_ref_ids=[refs["pm_dm_ref"]["sourceRefId"]],
    )
    package["references"] = [
        internal_reference,
        external_reference,
        asset_reference,
        pm_dm_reference,
    ]
    dm_reference_unit["payload"]["referenceIds"] = [
        internal_reference["referenceId"],
        external_reference["referenceId"],
    ]
    figure["payload"]["referenceIds"] = [asset_reference["referenceId"]]
    pm_reference_unit["payload"]["referenceIds"] = [pm_dm_reference["referenceId"]]

    package["contentUnits"] = [
        heading,
        paragraph,
        step,
        warning,
        caution,
        note,
        list_container,
        list_item,
        table,
        figure,
        dm_reference_unit,
        pm_heading,
        pm_reference_unit,
    ]
    dm_module["contentUnitIds"] = [
        heading["unitId"],
        paragraph["unitId"],
        step["unitId"],
        warning["unitId"],
        caution["unitId"],
        note["unitId"],
        list_container["unitId"],
        list_item["unitId"],
        table["unitId"],
        figure["unitId"],
        dm_reference_unit["unitId"],
    ]
    pm_module["contentUnitIds"] = [pm_heading["unitId"], pm_reference_unit["unitId"]]

    applicability_source_id = stable_id(
        "applicability-source", "techpub-applicability-source-id-v1", "app-fixture-1"
    )
    applicability_candidate_id = stable_id(
        "applicability-candidate", "techpub-applicability-candidate-id-v1", "app-fixture-1:ALPHA"
    )
    applicability_assignment_id = stable_id(
        "applicability-assignment",
        "techpub-applicability-assignment-id-v1",
        {"expression": "app-fixture-1", "target": dm_module["moduleId"]},
    )
    package["applicability"] = {
        "sourceExpressions": [
            {
                "expressionId": applicability_source_id,
                "text": "TEST ASSET GROUP ALPHA ONLY",
                "form": "logical_expression",
                "authority": "source_asserted",
                "sourceRefIds": [refs["applicability"]["sourceRefId"]],
            }
        ],
        "normalizedCandidates": [
            {
                "candidateId": applicability_candidate_id,
                "language": "techpub-applicability-expr.v1",
                "confidence": "deterministic",
                "sourceExpressionIds": [applicability_source_id],
                "expression": {
                    "operator": "predicate",
                    "predicate": {
                        "property": "fixture-group",
                        "comparator": "eq",
                        "values": ["ALPHA"],
                    },
                },
                "authority": "parser_candidate",
            }
        ],
        "assignments": [
            {
                "assignmentId": applicability_assignment_id,
                "expressionId": applicability_source_id,
                "target": {
                    "kind": "module",
                    "targetId": dm_module["moduleId"],
                    "sourceRefIds": [refs["applicability"]["sourceRefId"]],
                },
                "sourceReferenceId": "app-fixture-1",
                "authority": "source_asserted",
            }
        ],
    }

    extension_payload = {
        "parser": {
            "profileVersion": snapshot["profileVersion"],
            "schemaVersion": snapshot["schemaVersion"],
            "packageHash": snapshot["package"]["hash"],
            "snapshotArtifactId": snapshot_artifact["artifactId"],
            "summary": snapshot["summary"],
        },
        "realControlledBaseline": {
            "summaryArtifactId": baseline_artifact["artifactId"],
            "sourcePolicy": baseline["sourcePolicy"],
            "profileVersion": baseline["profileVersion"],
            "parserPackageHash": baseline["parserPackageHash"],
            "counts": baseline["counts"],
            "publicationModuleCoverage": "absent_in_real_baseline_covered_by_synthetic_fixture",
        },
        "moduleMappings": [
            {
                "coreModuleId": dm_module["moduleId"],
                "moduleType": "dm",
                "schemaName": dm_parser["schemaName"],
                "parserIdentity": dm_parser["identity"],
                "sourcePath": dm_parser["sourcePath"],
            },
            {
                "coreModuleId": pm_module["moduleId"],
                "moduleType": "pm",
                "schemaName": pm_parser["schemaName"],
                "parserIdentity": pm_parser["identity"],
                "sourcePath": pm_parser["sourcePath"],
            },
        ],
        "deliveryObjectMappings": [
            {
                "deliveryObjectId": delivery_objects[index]["deliveryObjectId"],
                "moduleType": module_type,
                "schemaName": parser_modules[module_type]["schemaName"],
                "parserIdentity": parser_modules[module_type]["identity"],
                "sourcePath": parser_modules[module_type]["sourcePath"],
            }
            for index, module_type in enumerate(("dml", "ddn"))
        ],
        "tableSourceStyles": [
            {
                "coreUnitId": table["unitId"],
                "styleName": "CALS-fixture",
                "frame": "all",
                "rowSeparator": "1",
                "columnSeparator": "1",
                "sourceRefIds": table_ref_ids,
                "columnStyles": [
                    {
                        "coreColumnId": column["columnId"],
                        "order": column["order"],
                        "sourceName": column["name"],
                        "width": column["width"],
                        "align": column["align"],
                    }
                    for column in table["payload"]["columns"]
                ],
            }
        ],
    }
    package["extensions"] = [
        {
            "namespace": "urn:techpub:ext:s1000d-native-lineage:v1",
            "schemaId": "urn:techpub:schema:v1:extension:s1000d-native-lineage:frozen-2",
            "version": "1.1.0",
            "targetIds": [dm_module["moduleId"], pm_module["moduleId"]],
            "semanticImpact": False,
            "payloadHash": sha256_object(extension_payload),
            "payload": extension_payload,
        }
    ]

    exact_targets = {
        "dm-metadata": [dm_module["moduleId"]],
        "pm-metadata": [package["document"]["documentId"], pm_module["moduleId"], publication_id],
        "dml-delivery-object": [delivery_objects[0]["deliveryObjectId"]],
        "ddn-delivery-object": [delivery_objects[1]["deliveryObjectId"]],
        "dm-heading": [heading["unitId"]],
        "dm-paragraph": [paragraph["unitId"]],
        "dm-list-item": [list_item["unitId"]],
        "dm-figure": [figure["unitId"]],
        "pm-entry-heading": [pm_heading["unitId"]],
        "pm-dm-reference": [pm_reference_unit["unitId"], pm_dm_reference["referenceId"]],
    }
    normalized_targets = {
        "dm-step": [step["unitId"]],
        "dm-warning": [warning["unitId"]],
        "dm-caution": [caution["unitId"]],
        "dm-note": [note["unitId"]],
        "dm-list": [list_container["unitId"]],
        "dm-table": [table["unitId"]],
        "dm-asset": [asset_id, asset_reference["referenceId"]],
        "dm-internal-reference": [dm_reference_unit["unitId"], internal_reference["referenceId"]],
        "dm-external-reference": [dm_reference_unit["unitId"], external_reference["referenceId"]],
        "dm-applicability": [
            applicability_source_id,
            applicability_candidate_id,
            applicability_assignment_id,
        ],
    }
    coverage_entries: list[dict[str, Any]] = []
    for key, segment in segments.items():
        if key.startswith("schema:"):
            coverage_entries.append(
                {
                    "sourceSegmentId": segment["sourceSegmentId"],
                    "disposition": "intentionally_excluded_with_reason",
                    "targetIds": [],
                    "findingIds": [],
                    "reasonCode": "schema_definition",
                }
            )
        elif key in exact_targets:
            coverage_entries.append(
                {
                    "sourceSegmentId": segment["sourceSegmentId"],
                    "disposition": "mapped_exactly",
                    "targetIds": exact_targets[key],
                    "findingIds": [],
                }
            )
        else:
            finding_ids = [external_finding["findingId"]] if key == "dm-external-reference" else []
            coverage_entries.append(
                {
                    "sourceSegmentId": segment["sourceSegmentId"],
                    "disposition": "mapped_with_normalization",
                    "targetIds": normalized_targets[key],
                    "findingIds": finding_ids,
                }
            )
    package["coverage"]["entries"] = coverage_entries
    package["coverage"]["basis"]["requiredSourceSegmentCount"] = len(coverage_entries)
    package["coverage"]["summary"] = coverage_summary(coverage_entries)
    package["result"] = {
        "status": "complete",
        "accountingComplete": package["coverage"]["summary"]["accountingComplete"],
        "contentPreserved": package["coverage"]["summary"]["contentPreserved"],
        "structuredCoverageComplete": package["coverage"]["summary"]["structuredCoverageComplete"],
    }
    refresh_integrity(package)
    return package


def sidecar_for(package_bytes: bytes, package: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "$schema": "urn:techpub:schema:v1:artifact-record:frozen-2",
        "schemaVersion": "techpub.artifact-record.v1",
        "contractRevision": CONTRACT_REVISION,
        "artifactRef": f"contract://{RICH_PACKAGE_PATH.as_posix()}",
        "mediaType": "application/json",
        "byteLength": len(package_bytes),
        "artifactHash": sha256_bytes(package_bytes),
        "packageId": package["packageId"],
        "contentHash": package["integrity"]["contentHash"],
    }


def build_native_negative_packages(contract_root: Path) -> dict[str, dict[str, Any]]:
    base = build_native_package(contract_root)
    result: dict[str, dict[str, Any]] = {}

    broken_reference = copy.deepcopy(base)
    broken_reference["references"][0]["target"]["identifier"]["value"] = stable_id(
        "unit", "techpub-missing-unit-fixture-v1", "absent"
    )
    refresh_integrity(broken_reference)
    result["native-resolved-reference-target-missing"] = broken_reference

    artifact_mismatch = copy.deepcopy(base)
    artifact_mismatch["artifacts"][0]["sha256"] = "sha256:" + "f" * 64
    refresh_integrity(artifact_mismatch)
    result["native-source-artifact-mismatch"] = artifact_mismatch

    missing_expression = copy.deepcopy(base)
    missing_expression["applicability"]["assignments"][0]["expressionId"] = stable_id(
        "applicability-source",
        "techpub-missing-applicability-source-v1",
        "absent",
    )
    refresh_integrity(missing_expression)
    result["assignment-missing-expression"] = missing_expression

    missing_target = copy.deepcopy(base)
    missing_target["applicability"]["assignments"][0]["target"]["targetId"] = stable_id(
        "module",
        "techpub-missing-applicability-target-v1",
        "absent",
    )
    refresh_integrity(missing_target)
    result["assignment-missing-target"] = missing_target

    invalid_target_shape = copy.deepcopy(base)
    invalid_target_shape["applicability"]["assignments"][0]["target"][
        "kind"
    ] = "source_element"
    refresh_integrity(invalid_target_shape)
    result["assignment-invalid-target-shape"] = invalid_target_shape

    missing_assignment_ref = copy.deepcopy(base)
    missing_assignment_ref["applicability"]["assignments"][0]["target"][
        "sourceRefIds"
    ] = [stable_id("source-ref", "techpub-missing-source-ref-v1", "absent")]
    refresh_integrity(missing_assignment_ref)
    result["assignment-missing-source-ref"] = missing_assignment_ref

    invalid_candidate_form = copy.deepcopy(base)
    invalid_candidate_form["applicability"]["sourceExpressions"][0][
        "form"
    ] = "external_identity_reference"
    refresh_integrity(invalid_candidate_form)
    result["candidate-invalid-source-form"] = invalid_candidate_form

    column_count = copy.deepcopy(base)
    table_payload = next(
        unit["payload"]
        for unit in column_count["contentUnits"]
        if unit["kind"] == "table"
    )
    table_payload["columns"].pop()
    column_count_extension = column_count["extensions"][0]
    column_count_extension["payload"]["tableSourceStyles"][0][
        "columnStyles"
    ].pop()
    column_count_extension["payloadHash"] = sha256_object(
        column_count_extension["payload"]
    )
    refresh_integrity(column_count)
    result["table-column-count-mismatch"] = column_count

    column_order = copy.deepcopy(base)
    table_payload = next(
        unit["payload"]
        for unit in column_order["contentUnits"]
        if unit["kind"] == "table"
    )
    for column in table_payload["columns"]:
        column["order"] += 1
    refresh_integrity(column_order)
    result["table-column-order-invalid"] = column_order

    grid_bounds = copy.deepcopy(base)
    table_payload = next(
        unit["payload"]
        for unit in grid_bounds["contentUnits"]
        if unit["kind"] == "table"
    )
    table_payload["rowGroups"][0]["rows"][0]["cells"][0]["columnStart"] = 2
    refresh_integrity(grid_bounds)
    result["table-grid-bounds-invalid"] = grid_bounds

    grid_conflict = copy.deepcopy(base)
    table_payload = next(
        unit["payload"]
        for unit in grid_conflict["contentUnits"]
        if unit["kind"] == "table"
    )
    table_payload["rowGroups"][0]["rows"][0]["cells"][1]["columnStart"] = 0
    refresh_integrity(grid_conflict)
    result["table-grid-conflict"] = grid_conflict

    schema_unbound = copy.deepcopy(base)
    extension = schema_unbound["extensions"][0]
    extension["payload"]["schemaBinding"] = {
        "profileVersion": "S1000D_6",
        "artifactId": stable_id(
            "artifact", "techpub-missing-schema-package-v1", "absent"
        ),
        "sha256": ZERO_HASH,
        "catalogMode": "offline",
        "validation": {
            "xsdParsed": 49,
            "flatEntrypointsCompiled": 33,
            "xmlValidated": 116,
        },
    }
    extension["payloadHash"] = sha256_object(extension["payload"])
    refresh_integrity(schema_unbound)
    result["schema-package-unbound"] = schema_unbound

    schema_hash_mismatch = copy.deepcopy(base)
    schema_artifact = next(
        item for item in schema_hash_mismatch["artifacts"] if item["role"] == "schema"
    )
    wrong_schema_hash = "sha256:" + "f" * 64
    extension = schema_hash_mismatch["extensions"][0]
    extension["payload"]["schemaBinding"] = {
        "profileVersion": "S1000D_6",
        "artifactId": schema_artifact["artifactId"],
        "sha256": wrong_schema_hash,
        "catalogMode": "offline",
        "validation": {
            "xsdParsed": 49,
            "flatEntrypointsCompiled": 33,
            "xmlValidated": 116,
        },
    }
    schema_hash_mismatch["lineage"]["inputs"].append(
        {
            "role": "s1000d_schema_package",
            "schemaVersion": "S1000D_6",
            "id": "s1000d-schema-package:negative-hash-fixture",
            "hash": wrong_schema_hash,
            "artifactIds": [schema_artifact["artifactId"]],
        }
    )
    extension["payloadHash"] = sha256_object(extension["payload"])
    refresh_integrity(schema_hash_mismatch)
    result["schema-package-hash-mismatch"] = schema_hash_mismatch

    issue6_binding_required = copy.deepcopy(base)
    issue6_binding_required["profile"]["sourceProfile"] = "S1000D_6"
    issue6_binding_required["profile"]["sourceStandard"]["issue"] = "6"
    refresh_integrity(issue6_binding_required)
    result["issue6-schema-binding-required"] = issue6_binding_required

    revision_mismatch = copy.deepcopy(base)
    revision_mismatch["contractRevision"] = "frozen.1"
    result["contract-revision-mismatch"] = revision_mismatch

    revision_unsupported = copy.deepcopy(base)
    revision_unsupported["$schema"] = (
        "urn:techpub:schema:v1:parsed-package:candidate-99"
    )
    revision_unsupported["contractRevision"] = "candidate.99"
    result["contract-revision-unsupported"] = revision_unsupported
    return result


def build_native_failure_reports(contract_root: Path) -> dict[str, dict[str, Any]]:
    source_hash = build_native_package(contract_root)["source"]["sourcePackageHash"]
    scenarios = {
        "native-local-schema-missing": (
            "schema_binding",
            "S1000D.LOCAL_SCHEMA_MISSING",
            "A referenced local S1000D schema is absent; no parsed package is produced.",
        ),
        "native-unsupported-profile": (
            "schema_binding",
            "S1000D.UNSUPPORTED_PROFILE",
            "The declared S1000D issue/profile is unsupported; no parsed package is produced.",
        ),
        "native-unsupported-mapping": (
            "projection",
            "S1000D.UNSUPPORTED_MAPPING",
            "The parsed source construct has no approved U0 mapping; no parsed package is produced.",
        ),
    }
    producer = {
        "name": "techpub-s1000d-u0-fixture-projector",
        "version": "frozen.2",
        "buildHash": sha256_object(
            {"name": "techpub-s1000d-u0-fixture-projector", "version": "frozen.2"}
        ),
    }
    result: dict[str, dict[str, Any]] = {}
    for name, (stage, code, message) in scenarios.items():
        report: dict[str, Any] = {
            "$schema": "urn:techpub:schema:v1:parse-failure-report:frozen-2",
            "schemaVersion": "techpub.parse-failure-report.v1",
            "contractRevision": CONTRACT_REVISION,
            "failureId": "urn:techpub:parse-failure:v1:sha256:" + "0" * 64,
            "sourceKind": "native_s1000d",
            "inputRef": f"contract://{SOURCE_DIR.as_posix()}",
            "inputHash": source_hash,
            "stage": stage,
            "code": code,
            "message": message,
            "blocking": True,
            "packageProduced": False,
            "producer": producer,
            "observedAt": "2026-08-11T00:00:00Z",
            "parameters": {"fixture": True, "scenario": name},
        }
        report["failureId"] = expected_parse_failure_id(report)
        result[name] = report
    return result


def expected_native_outputs(contract_root: Path) -> dict[Path, bytes]:
    result: dict[Path, bytes] = {}
    package = build_native_package(contract_root)
    package_bytes = render_json(package)
    result[RICH_PACKAGE_PATH] = package_bytes
    result[RICH_PACKAGE_PATH.with_suffix(".artifact-record.json")] = render_json(
        sidecar_for(package_bytes, package)
    )
    for name, negative in build_native_negative_packages(contract_root).items():
        result[Path("fixtures/negative") / f"{name}.json"] = render_json(negative)
    for name, report in build_native_failure_reports(contract_root).items():
        result[Path("fixtures/positive") / f"{name}.json"] = render_json(report)
    return result
