#!/usr/bin/env python3
"""Build deterministic frozen revision 2 fixtures from checked-in source bytes."""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
from typing import Any

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
    expected_writer_generated_package_hash,
    expected_writer_manifest_id,
    refresh_integrity,
    sha256_bytes,
    sha256_object,
)
from scripts.build_native_fixtures import expected_native_outputs


ZERO_HASH = "sha256:" + "0" * 64
ZERO_PACKAGE_ID = "urn:techpub:package:v1:sha256:" + "0" * 64


def _sourced(value: str, source_ref_id: str, *, normalized: bool = False) -> dict[str, Any]:
    return {
        "value": value,
        "authority": "parser_normalized" if normalized else "source_asserted",
        "mappingStatus": "normalized" if normalized else "exact",
        "sourceRefIds": [source_ref_id],
    }


def _identifier(scheme: str, value: str, source_ref_id: str) -> dict[str, Any]:
    return {
        "scheme": scheme,
        "value": value,
        "authority": "source_asserted",
        "completeness": "complete",
        "sourceRefIds": [source_ref_id],
    }


def _artifact(contract_root: Path, source_kind: str) -> dict[str, Any]:
    if source_kind == "pdf":
        relative_path = "fixtures/source/minimal-pdf.pdf"
        role = "pdf"
        media_type = "application/pdf"
    else:
        relative_path = "fixtures/source/minimal-s1000d.xml"
        role = "xml"
        media_type = "application/xml"
    payload = (contract_root / relative_path).read_bytes()
    artifact = {
        "artifactId": "urn:techpub:artifact:v1:sha256:" + "0" * 64,
        "origin": "source",
        "role": role,
        "artifactRef": f"contract://{relative_path}",
        "sha256": sha256_bytes(payload),
        "mediaType": media_type,
        "byteLength": len(payload),
        "normalizedPath": Path(relative_path).name,
    }
    artifact["artifactId"] = expected_artifact_id(artifact)
    return artifact


def _file_artifact(
    contract_root: Path,
    relative_path: str,
    *,
    origin: str,
    role: str,
    media_type: str,
) -> dict[str, Any]:
    payload = (contract_root / relative_path).read_bytes()
    artifact = {
        "artifactId": "urn:techpub:artifact:v1:sha256:" + "0" * 64,
        "origin": origin,
        "role": role,
        "artifactRef": f"contract://{relative_path}",
        "sha256": sha256_bytes(payload),
        "mediaType": media_type,
        "byteLength": len(payload),
        "normalizedPath": Path(relative_path).name,
    }
    artifact["artifactId"] = expected_artifact_id(artifact)
    return artifact


def _source_ref(source_kind: str, artifact: dict[str, Any]) -> dict[str, Any]:
    quote = "Disconnect electrical power."
    if source_kind == "pdf":
        source_ref = {
            "sourceRefId": "urn:techpub:source-ref:v1:sha256:" + "0" * 64,
            "kind": "pdf",
            "artifactId": artifact["artifactId"],
            "pageStart": 1,
            "pageEnd": 1,
            "bbox": [100000, 100000, 900000, 300000],
            "quote": quote,
            "anchorTextHash": sha256_bytes(quote.encode("utf-8")),
        }
    else:
        source_ref = {
            "sourceRefId": "urn:techpub:source-ref:v1:sha256:" + "0" * 64,
            "kind": "xml",
            "artifactId": artifact["artifactId"],
            "normalizedPath": artifact["normalizedPath"],
            "xpath": "/dmodule/para[@id='p-1']",
            "elementId": "p-1",
            "quote": quote,
            "anchorTextHash": sha256_bytes(quote.encode("utf-8")),
        }
    source_ref["sourceRefId"] = expected_source_ref_id(source_ref)
    return source_ref


def _segment(
    package: dict[str, Any],
    source_ref: dict[str, Any],
    *,
    continuity_key: str,
    expected_semantic: str,
    order: int,
) -> dict[str, Any]:
    segment = {
        "sourceSegmentId": "urn:techpub:source-segment:v1:sha256:" + "0" * 64,
        "continuityKey": continuity_key,
        "kind": "text_block" if package["source"]["kind"] == "pdf" else "xml_element",
        "expectedSemantic": expected_semantic,
        "order": order,
        "sourceRefIds": [source_ref["sourceRefId"]],
        "segmentHash": ZERO_HASH,
        "coverageRequired": True,
    }
    segment["segmentHash"] = expected_source_segment_hash(segment)
    segment["sourceSegmentId"] = expected_source_segment_id(package, segment)
    return segment


def build_package(contract_root: Path, source_kind: str) -> dict[str, Any]:
    if source_kind not in {"pdf", "native_s1000d"}:
        raise ValueError(source_kind)
    artifact = _artifact(contract_root, source_kind)
    source_package_id = (
        "pdf:contract-fixture:minimal:R1:en-US"
        if source_kind == "pdf"
        else "s1000d:contract-fixture:DM-FIXTURE-001:4.2:en-US"
    )
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
        "artifacts": [artifact],
        "source": {
            "kind": source_kind,
            "sourcePackageId": source_package_id,
            "sourcePackageHash": ZERO_HASH,
            "identityAuthority": "source_asserted",
            "artifactIds": [artifact["artifactId"]],
            "deliveryObjects": [],
            "legacyIdentifiers": [],
        },
        "profile": {
            "canonicalModel": "technical-publication-core.v1",
            "sourceProfile": "minimal-contract-fixture",
            "mappingProfile": {
                "id": f"minimal-{source_kind}-to-techpub-v1",
                "version": "frozen.2",
                "hash": sha256_object(
                    {
                        "id": f"minimal-{source_kind}-to-techpub-v1",
                        "version": "frozen.2",
                    }
                ),
            },
        },
        "lineage": {
            "generatedAt": "2026-08-11T00:00:00Z",
            "producer": {
                "name": "techpub-contract-fixture-builder",
                "version": "frozen.2",
                "runtime": "python",
                "buildHash": sha256_object(
                    {
                        "name": "techpub-contract-fixture-builder",
                        "version": "frozen.2",
                    }
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
                "segmentationProfileId": f"minimal-{source_kind}-segments-v1",
                "segmentationProfileHash": sha256_object(
                    {"id": f"minimal-{source_kind}-segments-v1", "version": 1}
                ),
                "requiredSourceSegmentCount": 2,
            },
            "entries": [],
            "summary": {
                "requiredSourceSegmentCount": 2,
                "mappedExactlyCount": 2,
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
    if source_kind == "native_s1000d":
        package["profile"]["sourceStandard"] = {
            "name": "S1000D",
            "issue": "4.2",
            "profile": "controlled contract fixture",
        }
    package["source"]["sourcePackageHash"] = expected_source_package_hash(package)
    package["lineage"]["inputs"] = [
        {
            "role": "source_package",
            "schemaVersion": "application/pdf" if source_kind == "pdf" else "S1000D-4.2",
            "id": source_package_id,
            "hash": package["source"]["sourcePackageHash"],
            "artifactIds": [artifact["artifactId"]],
        }
    ]

    source_ref = _source_ref(source_kind, artifact)
    package["sourceRefs"] = [source_ref]
    heading_segment = _segment(
        package,
        source_ref,
        continuity_key="heading-1",
        expected_semantic="heading",
        order=0,
    )
    paragraph_segment = _segment(
        package,
        source_ref,
        continuity_key="paragraph-1",
        expected_semantic="text",
        order=1,
    )
    package["sourceSegments"] = [heading_segment, paragraph_segment]

    package["document"] = {
        "documentId": "urn:techpub:document:v1:sha256:" + "0" * 64,
        "documentType": _sourced("service_bulletin", source_ref["sourceRefId"], normalized=True),
        "title": _sourced("Controlled contract fixture", source_ref["sourceRefId"]),
        "identifiers": [
            _identifier(
                "oem_document_code" if source_kind == "pdf" else "s1000d_dmc",
                "SB-FIXTURE-001" if source_kind == "pdf" else "DM-FIXTURE-001",
                source_ref["sourceRefId"],
            )
        ],
        "language": _sourced("en-US", source_ref["sourceRefId"]),
        "revision": {
            "label": _sourced("R1" if source_kind == "pdf" else "001-00", source_ref["sourceRefId"])
        },
        "relationships": [],
    }
    package["document"]["documentId"] = expected_document_id(package)

    module = {
        "moduleId": "urn:techpub:module:v1:sha256:" + "0" * 64,
        "continuityKey": "logical-document" if source_kind == "pdf" else "DM-FIXTURE-001",
        "moduleKind": "logical_document" if source_kind == "pdf" else "data_module",
        "informationType": "procedural",
        "authority": "service_generated" if source_kind == "pdf" else "source_asserted",
        "identityStability": "generated_stable" if source_kind == "pdf" else "source_stable",
        "order": 0,
        "title": _sourced("Controlled contract fixture", source_ref["sourceRefId"]),
        "sourceRefIds": [source_ref["sourceRefId"]],
        "contentUnitIds": [],
    }
    if source_kind == "native_s1000d":
        module["standardIdentity"] = _identifier(
            "s1000d_dmc", "DM-FIXTURE-001", source_ref["sourceRefId"]
        )
    module["moduleId"] = expected_module_id(package, module)
    package["modules"] = [module]

    heading = {
        "unitId": "urn:techpub:unit:v1:sha256:" + "0" * 64,
        "continuityKey": "heading-1",
        "unitHash": ZERO_HASH,
        "moduleId": module["moduleId"],
        "kind": "heading",
        "identityStability": "revision_scoped",
        "order": 0,
        "depth": 0,
        "sourceRefIds": [source_ref["sourceRefId"]],
        "sourceSegmentIds": [heading_segment["sourceSegmentId"]],
        "mapping": {
            "status": "mapped_exactly",
            "confidence": "deterministic",
            "findingIds": [],
        },
        "payload": {"text": "Procedure", "level": 1},
    }
    heading["unitId"] = expected_unit_id(package, module, heading)
    paragraph = {
        "unitId": "urn:techpub:unit:v1:sha256:" + "0" * 64,
        "continuityKey": "paragraph-1",
        "unitHash": ZERO_HASH,
        "moduleId": module["moduleId"],
        "kind": "paragraph",
        "identityStability": "revision_scoped",
        "order": 0,
        "depth": 1,
        "parentUnitId": heading["unitId"],
        "sourceRefIds": [source_ref["sourceRefId"]],
        "sourceSegmentIds": [paragraph_segment["sourceSegmentId"]],
        "mapping": {
            "status": "mapped_exactly",
            "confidence": "deterministic",
            "findingIds": [],
        },
        "payload": {
            "text": "Disconnect electrical power.",
            "role": "body",
        },
    }
    paragraph["unitId"] = expected_unit_id(package, module, paragraph)
    package["contentUnits"] = [heading, paragraph]
    module["contentUnitIds"] = [heading["unitId"], paragraph["unitId"]]
    package["coverage"]["entries"] = [
        {
            "sourceSegmentId": heading_segment["sourceSegmentId"],
            "disposition": "mapped_exactly",
            "targetIds": [heading["unitId"]],
            "findingIds": [],
        },
        {
            "sourceSegmentId": paragraph_segment["sourceSegmentId"],
            "disposition": "mapped_exactly",
            "targetIds": [paragraph["unitId"]],
            "findingIds": [],
        },
    ]
    refresh_integrity(package)
    return package


def build_pdf_visual_lineage_package(contract_root: Path) -> dict[str, Any]:
    package = build_package(contract_root, "pdf")
    observation = _file_artifact(
        contract_root,
        "fixtures/source/minimal-visual-observation.json",
        origin="derived",
        role="visual_observation",
        media_type="application/json",
    )
    review = _file_artifact(
        contract_root,
        "fixtures/source/minimal-visual-review.json",
        origin="derived",
        role="visual_review",
        media_type="application/json",
    )
    package["artifacts"].extend([observation, review])
    package["lineage"]["inputs"].extend(
        [
            {
                "role": "visual_observation",
                "schemaVersion": "techpub.fixture.visual-observation.v1",
                "id": "VISUAL-OBSERVATION-FIXTURE-001",
                "hash": observation["sha256"],
                "artifactIds": [observation["artifactId"]],
            },
            {
                "role": "visual_review",
                "schemaVersion": "techpub.fixture.visual-review.v1",
                "id": "VISUAL-REVIEW-FIXTURE-001",
                "hash": review["sha256"],
                "artifactIds": [review["artifactId"]],
            },
        ]
    )
    payload = {
        "sourceUnitSet": {
            "id": "SUS-FIXTURE-001",
            "hash": sha256_object({"id": "SUS-FIXTURE-001", "version": 1}),
        },
        "structuredParsePackage": {
            "id": "SPP-FIXTURE-001",
            "contentHash": sha256_object({"id": "SPP-FIXTURE-001", "view": "content"}),
            "semanticOutputHash": sha256_object(
                {"id": "SPP-FIXTURE-001", "view": "semantic"}
            ),
        },
        "visualRuns": [
            {
                "runId": "VISUAL-OBSERVATION-FIXTURE-001",
                "mode": "SHADOW",
                "status": "SUCCEEDED",
                "artifactIds": [observation["artifactId"]],
                "promptHash": sha256_object({"prompt": "fixture-observation-v1"}),
                "modelId": "fixture-vision-model@1",
                "modelConfigHash": sha256_object({"temperature": "0"}),
                "outputHash": observation["sha256"],
                "review": {
                    "runId": "VISUAL-REVIEW-FIXTURE-001",
                    "result": "MATCH",
                    "artifactIds": [review["artifactId"]],
                },
            }
        ],
    }
    package["extensions"] = [
        {
            "namespace": "urn:techpub:ext:pdf-visual-lineage:v1",
            "schemaId": "urn:techpub:schema:v1:extension:pdf-visual-lineage:frozen-1",
            "version": "1.0.0",
            "targetIds": [package["contentUnits"][1]["unitId"]],
            "semanticImpact": False,
            "payloadHash": sha256_object(payload),
            "payload": payload,
        }
    ]
    refresh_integrity(package)
    return package


def build_parse_failure_report(contract_root: Path) -> dict[str, Any]:
    source_bytes = (contract_root / "fixtures/source/minimal-pdf.pdf").read_bytes()
    report: dict[str, Any] = {
        "$schema": "urn:techpub:schema:v1:parse-failure-report:frozen-2",
        "schemaVersion": "techpub.parse-failure-report.v1",
        "contractRevision": CONTRACT_REVISION,
        "failureId": "urn:techpub:parse-failure:v1:sha256:" + "0" * 64,
        "sourceKind": "pdf",
        "inputRef": "contract://fixtures/source/minimal-pdf.pdf",
        "inputHash": sha256_bytes(source_bytes),
        "stage": "parse",
        "code": "PARSER.SYNTHETIC_FAILURE",
        "message": "Synthetic blocking failure used to validate the fail-closed envelope.",
        "blocking": True,
        "packageProduced": False,
        "producer": {
            "name": "techpub-contract-fixture-builder",
            "version": "frozen.2",
            "buildHash": sha256_object(
                {"name": "techpub-contract-fixture-builder", "version": "frozen.2"}
            ),
        },
        "observedAt": "2026-08-11T00:00:00Z",
        "parameters": {"fixture": True, "attempt": 1},
    }
    report["failureId"] = expected_parse_failure_id(report)
    return report


def build_writer_manifest(contract_root: Path, input_package: dict[str, Any]) -> dict[str, Any]:
    generated_path = "fixtures/writer-output/DM-GENERATED-FIXTURE.xml"
    generated_bytes = (contract_root / generated_path).read_bytes()
    manifest: dict[str, Any] = {
        "$schema": "urn:techpub:schema:v1:writer-provenance-manifest:frozen-2",
        "schemaVersion": "techpub.writer-provenance-manifest.v1",
        "contractRevision": CONTRACT_REVISION,
        "manifestId": "urn:techpub:writer-manifest:v1:sha256:" + "0" * 64,
        "inputPackage": {
            "packageId": input_package["packageId"],
            "contentHash": input_package["integrity"]["contentHash"],
            "semanticHash": input_package["integrity"]["semanticHash"],
            "provenanceHash": input_package["integrity"]["provenanceHash"],
        },
        "writerProfile": {
            "id": "techpub.fixture.s1000d-writer",
            "version": "frozen.2",
            "hash": sha256_object(
                {"id": "techpub.fixture.s1000d-writer", "version": "frozen.2"}
            ),
        },
        "generatedPackageHash": ZERO_HASH,
        "generatedArtifacts": [
            {
                "normalizedPath": generated_path,
                "mediaType": "application/xml",
                "byteLength": len(generated_bytes),
                "sha256": sha256_bytes(generated_bytes),
            }
        ],
        "unitMappings": [
            {
                "originUnitId": input_package["contentUnits"][0]["unitId"],
                "originSourceRefIds": input_package["contentUnits"][0]["sourceRefIds"],
                "generatedPath": generated_path,
                "xpath": "/dmodule/content/description/title",
                "elementId": "u-heading-1",
            },
            {
                "originUnitId": input_package["contentUnits"][1]["unitId"],
                "originSourceRefIds": input_package["contentUnits"][1]["sourceRefIds"],
                "generatedPath": generated_path,
                "xpath": "/dmodule/content/description/para",
                "elementId": "u-paragraph-1",
            },
        ],
        "assetMappings": [],
        "noAuthority": {
            "oemIdentityClaimed": False,
            "approvalClaimed": False,
            "releaseClaimed": False,
            "airworthinessClaimed": False,
        },
        "createdAt": "2026-08-11T00:00:00Z",
    }
    manifest["generatedPackageHash"] = expected_writer_generated_package_hash(manifest)
    manifest["manifestId"] = expected_writer_manifest_id(manifest)
    return manifest


def build_negative_packages(contract_root: Path) -> dict[str, dict[str, Any]]:
    base = build_package(contract_root, "pdf")
    result: dict[str, dict[str, Any]] = {}

    schema_extra = copy.deepcopy(base)
    schema_extra["silentUnknown"] = True
    result["schema-extra-property"] = schema_extra

    false_complete = copy.deepcopy(base)
    false_complete["coverage"]["entries"][0]["disposition"] = "preserved_as_text"
    refresh_integrity(false_complete)
    result["coverage-false-complete"] = false_complete

    cycle = copy.deepcopy(base)
    first, second = cycle["sourceSegments"]
    first["parentSourceSegmentId"] = second["sourceSegmentId"]
    second["parentSourceSegmentId"] = first["sourceSegmentId"]
    first["order"] = 0
    second["order"] = 0
    refresh_integrity(cycle)
    result["source-segment-cycle"] = cycle

    no_target = copy.deepcopy(base)
    no_target["coverage"]["entries"][0]["targetIds"] = []
    refresh_integrity(no_target)
    result["mapped-without-target"] = no_target

    artifact_mismatch = copy.deepcopy(base)
    artifact_mismatch["artifacts"][0]["sha256"] = "sha256:" + "f" * 64
    refresh_integrity(artifact_mismatch)
    result["artifact-bytes-mismatch"] = artifact_mismatch

    unknown_extension = copy.deepcopy(base)
    unknown_payload = {"preserved": "unknown extension payload"}
    unknown_extension["extensions"] = [
        {
            "namespace": "urn:techpub:ext:unregistered-fixture:v1",
            "schemaId": "urn:techpub:schema:v1:extension:unregistered-fixture:frozen-2",
            "version": "1.0.0-frozen.2",
            "targetIds": [unknown_extension["document"]["documentId"]],
            "semanticImpact": False,
            "payloadHash": sha256_object(unknown_payload),
            "payload": unknown_payload,
        }
    ]
    refresh_integrity(unknown_extension)
    result["unknown-extension"] = unknown_extension

    invalid_extension = copy.deepcopy(base)
    invalid_payload = {"note": "reviewState is intentionally absent"}
    invalid_extension["extensions"] = [
        {
            "namespace": "urn:techpub:ext:review-note:v1",
            "schemaId": "urn:techpub:schema:v1:extension:review-note:frozen-1",
            "version": "1.0.0",
            "targetIds": [invalid_extension["document"]["documentId"]],
            "semanticImpact": False,
            "payloadHash": sha256_object(invalid_payload),
            "payload": invalid_payload,
        }
    ]
    refresh_integrity(invalid_extension)
    result["known-extension-invalid"] = invalid_extension
    return result


def render_json(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def sidecar_for(path: str, package_bytes: bytes, package: dict[str, Any]) -> dict[str, Any]:
    return {
        "$schema": "urn:techpub:schema:v1:artifact-record:frozen-2",
        "schemaVersion": "techpub.artifact-record.v1",
        "contractRevision": CONTRACT_REVISION,
        "artifactRef": f"contract://{path}",
        "mediaType": "application/json",
        "byteLength": len(package_bytes),
        "artifactHash": sha256_bytes(package_bytes),
        "packageId": package["packageId"],
        "contentHash": package["integrity"]["contentHash"],
    }


def expected_outputs(contract_root: Path) -> dict[Path, bytes]:
    result: dict[Path, bytes] = {}
    for source_kind, stem in (
        ("pdf", "minimal-pdf-complete"),
        ("native_s1000d", "minimal-native-s1000d-complete"),
    ):
        package = build_package(contract_root, source_kind)
        relative = Path("fixtures") / "positive" / f"{stem}.json"
        package_bytes = render_json(package)
        result[relative] = package_bytes
        sidecar = sidecar_for(relative.as_posix(), package_bytes, package)
        result[relative.with_suffix(".artifact-record.json")] = render_json(sidecar)
    visual_package = build_pdf_visual_lineage_package(contract_root)
    visual_relative = Path("fixtures/positive/minimal-pdf-visual-lineage.json")
    visual_bytes = render_json(visual_package)
    result[visual_relative] = visual_bytes
    result[visual_relative.with_suffix(".artifact-record.json")] = render_json(
        sidecar_for(visual_relative.as_posix(), visual_bytes, visual_package)
    )

    failure_relative = Path("fixtures/positive/minimal-parse-failure-report.json")
    result[failure_relative] = render_json(build_parse_failure_report(contract_root))

    pdf_package = build_package(contract_root, "pdf")
    writer_relative = Path("fixtures/positive/minimal-writer-provenance-manifest.json")
    result[writer_relative] = render_json(build_writer_manifest(contract_root, pdf_package))

    result.update(expected_native_outputs(contract_root))

    negative_cases = {
        "schema-extra-property": {
            "strictErrors": ["SCHEMA.INVALID"],
        },
        "coverage-false-complete": {
            "strictErrors": [
                "COVERAGE.SUMMARY_MISMATCH",
                "RESULT.DERIVATION_MISMATCH",
                "RESULT.STATUS_MISMATCH",
            ],
        },
        "source-segment-cycle": {
            "strictErrors": ["STRUCTURE.SOURCE_SEGMENT_CYCLE"],
        },
        "mapped-without-target": {
            "strictErrors": ["COVERAGE.MAPPED_WITHOUT_TARGET"],
        },
        "artifact-bytes-mismatch": {
            "strictErrors": [
                "HASH.ARTIFACT_BYTES_MISMATCH",
                "IDENTITY.ARTIFACT_ID_MISMATCH",
                "SOURCE.HASH_MISMATCH",
            ],
        },
        "unknown-extension": {
            "strictErrors": ["EXTENSION.UNKNOWN_SCHEMA"],
            "forensicErrors": [],
            "forensicWarnings": ["EXTENSION.UNKNOWN_SCHEMA"],
        },
        "known-extension-invalid": {
            "strictErrors": ["EXTENSION.PAYLOAD_INVALID"],
        },
        "native-resolved-reference-target-missing": {
            "strictErrors": ["REFERENCE.RESOLVED_TARGET_MISSING"],
        },
        "native-source-artifact-mismatch": {
            "strictErrors": [
                "HASH.ARTIFACT_BYTES_MISMATCH",
                "IDENTITY.ARTIFACT_ID_MISMATCH",
                "SOURCE.HASH_MISMATCH",
            ],
        },
        "assignment-missing-expression": {
            "strictErrors": ["REFERENCE.MISSING_APPLICABILITY_SOURCE"],
        },
        "assignment-missing-target": {
            "strictErrors": ["REFERENCE.MISSING_APPLICABILITY_TARGET"],
        },
        "assignment-invalid-target-shape": {
            "strictErrors": ["APPLICABILITY.INVALID_TARGET_SHAPE"],
        },
        "assignment-missing-source-ref": {
            "strictErrors": ["REFERENCE.MISSING_SOURCE_REF"],
        },
        "candidate-invalid-source-form": {
            "strictErrors": ["APPLICABILITY.INVALID_CANDIDATE_SOURCE_FORM"],
        },
        "table-column-count-mismatch": {
            "strictErrors": ["TABLE.COLUMN_COUNT_MISMATCH"],
        },
        "table-column-order-invalid": {
            "strictErrors": ["TABLE.COLUMN_ORDER_INVALID"],
        },
        "table-grid-bounds-invalid": {
            "strictErrors": ["TABLE.GRID_BOUNDS_INVALID"],
        },
        "table-grid-conflict": {
            "strictErrors": ["TABLE.GRID_CONFLICT"],
        },
        "schema-package-unbound": {
            "strictErrors": ["LINEAGE.SCHEMA_PACKAGE_UNBOUND"],
        },
        "schema-package-hash-mismatch": {
            "strictErrors": ["HASH.SCHEMA_PACKAGE_MISMATCH"],
        },
        "issue6-schema-binding-required": {
            "strictErrors": ["LINEAGE.SCHEMA_PACKAGE_UNBOUND"],
        },
        "contract-revision-mismatch": {
            "strictErrors": ["CONTRACT.REVISION_MISMATCH"],
        },
        "contract-revision-unsupported": {
            "strictErrors": ["CONTRACT.REVISION_MISMATCH"],
        },
    }
    for name, package in build_negative_packages(contract_root).items():
        result[Path("fixtures/negative") / f"{name}.json"] = render_json(package)
    result[Path("fixtures/negative/duplicate-key.json")] = b'{"schemaVersion":"techpub.parsed-package.v1","schemaVersion":"duplicate"}\n'

    manifest = {
        "schemaVersion": "techpub.contract-fixture-manifest.v1",
        "contractRevision": CONTRACT_REVISION,
        "positivePackages": [
            {
                "packagePath": "fixtures/positive/minimal-pdf-complete.json",
                "artifactRecordPath": "fixtures/positive/minimal-pdf-complete.artifact-record.json",
                "sourceKind": "pdf",
            },
            {
                "packagePath": "fixtures/positive/minimal-native-s1000d-complete.json",
                "artifactRecordPath": "fixtures/positive/minimal-native-s1000d-complete.artifact-record.json",
                "sourceKind": "native_s1000d",
            },
            {
                "packagePath": "fixtures/positive/minimal-pdf-visual-lineage.json",
                "artifactRecordPath": "fixtures/positive/minimal-pdf-visual-lineage.artifact-record.json",
                "sourceKind": "pdf",
            },
            {
                "packagePath": "fixtures/positive/rich-native-s1000d-issue-4-2.json",
                "artifactRecordPath": "fixtures/positive/rich-native-s1000d-issue-4-2.artifact-record.json",
                "sourceKind": "native_s1000d",
            },
        ],
        "supportDocuments": {
            "parseFailureReport": "fixtures/positive/minimal-parse-failure-report.json",
            "writerProvenanceManifest": "fixtures/positive/minimal-writer-provenance-manifest.json",
            "nativeParseFailureReports": [
                "fixtures/positive/native-local-schema-missing.json",
                "fixtures/positive/native-unsupported-profile.json",
                "fixtures/positive/native-unsupported-mapping.json",
            ],
        },
        "negativePackages": [
            {
                "name": name,
                "packagePath": f"fixtures/negative/{name}.json",
                **expectations,
            }
            for name, expectations in negative_cases.items()
        ],
        "rawJsonFailures": [
            {
                "name": "duplicate-key",
                "path": "fixtures/negative/duplicate-key.json",
                "expectedCode": "JSON.DUPLICATE_KEY",
            }
        ],
        "canonicalizationVectors": "fixtures/canonicalization/jcs-test-vectors.json",
    }
    result[Path("fixtures/manifest.json")] = render_json(manifest)
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--contract-root", required=True, type=Path)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--write", action="store_true")
    action.add_argument("--check", action="store_true")
    args = parser.parse_args()
    contract_root = args.contract_root.resolve()
    outputs = expected_outputs(contract_root)
    mismatches: list[str] = []
    for relative, expected in outputs.items():
        path = contract_root / relative
        if args.write:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(expected)
        elif not path.exists() or path.read_bytes() != expected:
            mismatches.append(relative.as_posix())
    if mismatches:
        print(json.dumps({"ok": False, "mismatches": mismatches}, ensure_ascii=False))
        return 1
    print(json.dumps({"ok": True, "files": [item.as_posix() for item in outputs]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
