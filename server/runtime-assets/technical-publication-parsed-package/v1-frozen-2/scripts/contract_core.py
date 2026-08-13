#!/usr/bin/env python3
"""Shared reader, validator, identity, and hash implementation.

This implementation was rebuilt from the external review concepts recorded in
``audit/``.  It intentionally does not import either producer runtime.
"""

from __future__ import annotations

import copy
import hashlib
import json
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any, Iterable, Iterator, Mapping, Sequence

from jsonschema import Draft202012Validator, FormatChecker


SAFE_INTEGER_MAX = 9_007_199_254_740_991
CONTRACT_SCHEMA_ID = "urn:techpub:schema:v1:parsed-package:frozen-2"
CONTRACT_SCHEMA_VERSION = "techpub.parsed-package.v1"
CONTRACT_REVISION = "frozen.2"

FORBIDDEN_AUTHORITY_KEYS = {
    "actionreadiness",
    "airworthinessapproval",
    "approval",
    "approved",
    "closuresdecision",
    "closuredecision",
    "compliancesignoff",
    "engineeringdecision",
    "formaldetermination",
    "formaldeterminations",
    "releaseapproval",
    "releasedecision",
    "releasestatus",
}

ALLOWED_EXCLUSION_REASONS = {
    "pagination_artifact",
    "decorative_graphic",
    "blank",
    "schema_definition",
}


@dataclass(frozen=True, order=True)
class ContractIssue:
    code: str
    path: str
    message: str
    severity: str = "error"

    def as_dict(self) -> dict[str, str]:
        return {
            "code": self.code,
            "path": self.path,
            "message": self.message,
            "severity": self.severity,
        }


@dataclass
class ValidationReport:
    artifact: str
    mode: str
    issues: list[ContractIssue] = field(default_factory=list)
    package_id: str | None = None
    content_hash: str | None = None

    @property
    def errors(self) -> list[ContractIssue]:
        return [item for item in self.issues if item.severity == "error"]

    @property
    def warnings(self) -> list[ContractIssue]:
        return [item for item in self.issues if item.severity != "error"]

    @property
    def ok(self) -> bool:
        return not self.errors

    def as_dict(self) -> dict[str, Any]:
        return {
            "artifact": self.artifact,
            "mode": self.mode,
            "ok": self.ok,
            "packageId": self.package_id,
            "contentHash": self.content_hash,
            "errors": [item.as_dict() for item in self.errors],
            "warnings": [item.as_dict() for item in self.warnings],
        }


class DuplicateKeyError(ValueError):
    pass


def _reject_duplicate_keys(pairs: Sequence[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise DuplicateKeyError(f"duplicate JSON object key: {key}")
        result[key] = value
    return result


def load_json(path: Path) -> Any:
    return json.loads(
        path.read_text(encoding="utf-8"),
        object_pairs_hook=_reject_duplicate_keys,
        parse_constant=lambda value: (_ for _ in ()).throw(
            ValueError(f"non-I-JSON numeric constant: {value}")
        ),
    )


def utf16_sort_key(value: str) -> tuple[int, ...]:
    try:
        raw = value.encode("utf-16-be")
    except UnicodeEncodeError as exc:
        raise ValueError("lone surrogate is not permitted") from exc
    return tuple(int.from_bytes(raw[i : i + 2], "big") for i in range(0, len(raw), 2))


def jcs_restricted(value: Any) -> str:
    """RFC 8785 serializer for the contract's integer-only numeric domain."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int) and not isinstance(value, bool):
        if abs(value) > SAFE_INTEGER_MAX:
            raise ValueError(f"integer outside I-JSON safe range: {value}")
        return str(value)
    if isinstance(value, float):
        raise ValueError("hash-critical floats are forbidden by techpub.hash.v1")
    if isinstance(value, str):
        try:
            value.encode("utf-8")
        except UnicodeEncodeError as exc:
            raise ValueError("lone surrogate is not permitted") from exc
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, list):
        return "[" + ",".join(jcs_restricted(item) for item in value) + "]"
    if isinstance(value, dict):
        if not all(isinstance(key, str) for key in value):
            raise TypeError("JSON object keys must be strings")
        keys = sorted(value, key=utf16_sort_key)
        return "{" + ",".join(
            jcs_restricted(key) + ":" + jcs_restricted(value[key]) for key in keys
        ) + "}"
    raise TypeError(f"unsupported JSON type: {type(value).__name__}")


def sha256_bytes(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


def sha256_text(value: str) -> str:
    return sha256_bytes(value.encode("utf-8"))


def sha256_object(value: Any) -> str:
    return sha256_text(jcs_restricted(value))


def urn_from_hash(kind: str, digest: str) -> str:
    if not digest.startswith("sha256:") or len(digest) != 71:
        raise ValueError(f"invalid SHA-256 digest: {digest}")
    return f"urn:techpub:{kind}:v1:sha256:{digest.split(':', 1)[1]}"


def normalize_relative_path(value: str) -> str:
    if "\\" in value:
        raise ValueError("backslash is not allowed in normalizedPath")
    path = PurePosixPath(value)
    if path.is_absolute():
        raise ValueError("absolute normalizedPath is forbidden")
    parts: list[str] = []
    for part in path.parts:
        if part in ("", "."):
            continue
        if part == "..":
            raise ValueError("parent traversal is forbidden in normalizedPath")
        parts.append(unicodedata.normalize("NFC", part))
    if not parts:
        raise ValueError("normalizedPath is empty")
    return "/".join(parts)


def _strip_artifact_locations(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: _strip_artifact_locations(item)
            for key, item in value.items()
            if key not in {"artifactRef", "originalPath"}
        }
    if isinstance(value, list):
        return [_strip_artifact_locations(item) for item in value]
    return copy.deepcopy(value)


def coverage_hash_view(package: Mapping[str, Any]) -> dict[str, Any]:
    entries = sorted(
        copy.deepcopy(package["coverage"]["entries"]),
        key=lambda item: item["sourceSegmentId"],
    )
    return {
        "basis": copy.deepcopy(package["coverage"]["basis"]),
        "entries": entries,
        "summary": copy.deepcopy(package["coverage"]["summary"]),
    }


def provenance_view(package: Mapping[str, Any]) -> dict[str, Any]:
    return _strip_artifact_locations(
        {
            "artifacts": package["artifacts"],
            "source": package["source"],
            "profile": package["profile"],
            "lineage": {
                key: value
                for key, value in package["lineage"].items()
                if key != "generatedAt"
            },
            "sourceRefs": package["sourceRefs"],
            "sourceSegments": package["sourceSegments"],
            "mappings": [
                {
                    "unitId": unit["unitId"],
                    "sourceRefIds": unit["sourceRefIds"],
                    "sourceSegmentIds": unit["sourceSegmentIds"],
                    "mapping": unit["mapping"],
                }
                for unit in package["contentUnits"]
            ],
            "coverage": package["coverage"],
            "extensions": sorted(
                [
                    {
                        "namespace": item["namespace"],
                        "schemaId": item["schemaId"],
                        "version": item["version"],
                        "targetIds": sorted(item["targetIds"]),
                        "semanticImpact": item["semanticImpact"],
                        "payloadHash": item["payloadHash"],
                    }
                    for item in package["extensions"]
                ],
                key=lambda item: (item["namespace"], item["version"], item["schemaId"]),
            ),
        }
    )


def content_view(package: Mapping[str, Any]) -> dict[str, Any]:
    value = _strip_artifact_locations(package)
    value.pop("packageId", None)
    value.pop("integrity", None)
    if isinstance(value.get("lineage"), dict):
        value["lineage"].pop("generatedAt", None)
    return value


def _flatten_publication_nodes(nodes: Iterable[Mapping[str, Any]]) -> Iterator[Mapping[str, Any]]:
    for node in nodes:
        yield node
        yield from _flatten_publication_nodes(node["children"])


def semantic_view(package: Mapping[str, Any]) -> dict[str, Any]:
    """Source-neutral semantic comparison view; excludes locators and producer IDs."""
    modules = sorted(package["modules"], key=lambda item: (item["order"], item["moduleId"]))
    module_order = {module["moduleId"]: module["order"] for module in modules}
    units_by_parent: dict[str | None, list[Mapping[str, Any]]] = defaultdict(list)
    for unit in package["contentUnits"]:
        units_by_parent[unit.get("parentUnitId")].append(unit)
    for items in units_by_parent.values():
        items.sort(key=lambda unit: (module_order[unit["moduleId"]], unit["order"], unit["kind"], unit["unitId"]))

    structural: dict[str, str] = {}

    def walk(parent_id: str | None, prefix: str) -> None:
        for index, unit in enumerate(units_by_parent.get(parent_id, [])):
            key = f"{prefix}/{module_order[unit['moduleId']]}:{unit['order']}:{unit['kind']}:{index}"
            structural[unit["unitId"]] = key
            walk(unit["unitId"], key)

    walk(None, "doc")
    for unit in package["contentUnits"]:
        structural.setdefault(unit["unitId"], f"orphan/{unit['kind']}")

    references = {item["referenceId"]: item for item in package["references"]}
    assets = {item["assetId"]: item for item in package["assets"]}
    source_refs = {item["sourceRefId"]: item for item in package["sourceRefs"]}

    def clean_source_locator(source_ref_id: str) -> dict[str, Any]:
        source_ref = source_refs.get(source_ref_id)
        if source_ref is None:
            return {"kind": "missing"}
        if source_ref["kind"] == "xml":
            return {
                "kind": "xml",
                "normalizedPath": source_ref["normalizedPath"],
                "xpath": source_ref["xpath"],
                "elementId": source_ref.get("elementId"),
            }
        return {
            "kind": "pdf",
            "pageStart": source_ref["pageStart"],
            "pageEnd": source_ref["pageEnd"],
            "bbox": source_ref.get("bbox"),
            "charStart": source_ref.get("charStart"),
            "charEnd": source_ref.get("charEnd"),
            "charOffsetUnit": source_ref.get("charOffsetUnit"),
        }

    def clean_reference(reference_id: str) -> dict[str, Any]:
        reference = references[reference_id]
        target = reference["target"]
        return {
            "referenceType": reference["referenceType"],
            "from": structural.get(reference["fromUnitId"], "unknown"),
            "target": {
                "kind": target["kind"],
                "scheme": target["identifier"]["scheme"],
                "value": target["identifier"]["value"],
                "completeness": target["identifier"]["completeness"],
                "missingComponents": target["identifier"].get("missingComponents", []),
            },
            "resolutionStatus": reference["resolutionStatus"],
        }

    def clean_asset(asset_id: str) -> dict[str, Any]:
        asset = assets[asset_id]
        return {
            "logicalType": asset["logicalType"],
            "title": asset.get("title", {}).get("value"),
            "standardIdentity": (
                {
                    key: asset["standardIdentity"][key]
                    for key in ("scheme", "value", "completeness")
                }
                if "standardIdentity" in asset
                else None
            ),
            "renditions": [
                {
                    "role": item["role"],
                    "mediaType": item["mediaType"],
                    "sha256": item["sha256"],
                }
                for item in asset["renditions"]
            ],
        }

    semantic_units: list[dict[str, Any]] = []
    for unit in sorted(package["contentUnits"], key=lambda item: structural[item["unitId"]]):
        payload = copy.deepcopy(unit["payload"])
        if unit["kind"] == "list":
            payload["itemUnitIds"] = [structural[item] for item in payload["itemUnitIds"]]
        elif unit["kind"] == "advisory":
            payload["scope"]["targetUnitIds"] = [
                structural[item] for item in payload["scope"]["targetUnitIds"]
            ]
        elif unit["kind"] == "table" and payload["layout"] == "grid":
            for column in payload.get("columns", []):
                column.pop("columnId", None)
                column.pop("sourceRefIds", None)
            for group in payload["rowGroups"]:
                group.pop("rowGroupId", None)
                for row in group["rows"]:
                    row.pop("rowId", None)
                    row.pop("sourceRefIds", None)
                    for cell in row["cells"]:
                        cell.pop("cellId", None)
                        cell.pop("sourceRefIds", None)
                        for inline in cell["inlineContent"]:
                            inline.pop("inlineId", None)
                            inline.pop("sourceRefIds", None)
        elif unit["kind"] == "table":
            payload["findingIds"] = ["finding" for _ in payload.get("findingIds", [])]
        elif unit["kind"] == "figure":
            payload["assetIds"] = [clean_asset(item) for item in payload["assetIds"]]
            payload["referenceIds"] = [clean_reference(item) for item in payload["referenceIds"]]
            payload.pop("figureId", None)
        elif unit["kind"] == "reference":
            payload["referenceIds"] = [clean_reference(item) for item in payload["referenceIds"]]
        semantic_units.append(
            {
                "key": structural[unit["unitId"]],
                "kind": unit["kind"],
                "order": unit["order"],
                "depth": unit["depth"],
                "parent": structural.get(unit.get("parentUnitId")),
                "payload": payload,
            }
        )

    document = package["document"]
    semantic_document = {
        "documentType": document["documentType"]["value"],
        "title": document["title"]["value"],
        "identifiers": [
            {
                "scheme": item["scheme"],
                "value": item["value"],
                "completeness": item["completeness"],
                "missingComponents": item.get("missingComponents", []),
            }
            for item in document["identifiers"]
        ],
        "language": document["language"]["value"],
        "revision": (
            {key: value["value"] for key, value in document.get("revision", {}).items()}
            if "revision" in document
            else None
        ),
        "relationships": [
            {
                "type": item["relationshipType"],
                "target": {
                    "scheme": item["targetIdentifier"]["scheme"],
                    "value": item["targetIdentifier"]["value"],
                },
            }
            for item in document["relationships"]
        ],
    }

    semantic_modules = [
        {
            "moduleKind": module["moduleKind"],
            "informationType": module["informationType"],
            "order": module["order"],
            "title": module["title"]["value"],
            "standardIdentity": (
                {
                    key: module["standardIdentity"][key]
                    for key in ("scheme", "value", "completeness")
                }
                if "standardIdentity" in module
                else None
            ),
        }
        for module in modules
    ]

    def clean_publication_node(node: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "order": node["order"],
            "title": node["title"]["value"],
            "moduleOrders": [module_order[item] for item in node["moduleIds"]],
            "children": [clean_publication_node(item) for item in node["children"]],
        }

    publication_structures = [
        {
            "kind": item["kind"],
            "order": item["order"],
            "title": item["title"]["value"],
            "nodes": [clean_publication_node(node) for node in item["nodes"]],
        }
        for item in sorted(package["publicationStructures"], key=lambda value: value["order"])
    ]

    source_expressions = package["applicability"]["sourceExpressions"]
    source_expression_order = {
        item["expressionId"]: index for index, item in enumerate(source_expressions)
    }
    semantic_assignments: list[dict[str, Any]] = []
    for assignment in package["applicability"]["assignments"]:
        target = assignment["target"]
        target_kind = target["kind"]
        if target_kind == "module":
            target_key: Any = module_order.get(target.get("targetId"), "missing")
        elif target_kind == "content_unit":
            target_key = structural.get(target.get("targetId"), "missing")
        else:
            target_key = sorted(
                [clean_source_locator(item) for item in target["sourceRefIds"]],
                key=jcs_restricted,
            )
        semantic_assignments.append(
            {
                "sourceExpressionOrder": source_expression_order.get(
                    assignment["expressionId"], "missing"
                ),
                "targetKind": target_kind,
                "target": target_key,
                "sourceLocators": sorted(
                    [clean_source_locator(item) for item in target["sourceRefIds"]],
                    key=jcs_restricted,
                ),
                "sourceReferenceId": assignment.get("sourceReferenceId"),
                "authority": assignment["authority"],
            }
        )
    semantic_assignments.sort(key=jcs_restricted)
    semantic_applicability = {
        "sourceExpressions": [
            {"form": item["form"], "text": item["text"]}
            for item in source_expressions
        ],
        "normalizedCandidates": [
            {
                "language": item["language"],
                "sourceExpressionOrders": sorted(
                    (
                        source_expression_order.get(value, "missing")
                        for value in item["sourceExpressionIds"]
                    ),
                    key=str,
                ),
                "expression": item["expression"],
            }
            for item in package["applicability"]["normalizedCandidates"]
        ],
        "assignments": semantic_assignments,
    }
    semantic_extensions = [
        {
            "namespace": item["namespace"],
            "version": item["version"],
            "payloadHash": item["payloadHash"],
        }
        for item in package["extensions"]
        if item["semanticImpact"]
    ]
    return {
        "document": semantic_document,
        "publicationStructures": publication_structures,
        "modules": semantic_modules,
        "contentUnits": semantic_units,
        "applicability": semantic_applicability,
        "semanticExtensions": semantic_extensions,
    }


def artifact_identity_view(artifact: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "namespace": "techpub-artifact-id-v1",
        **{
            key: copy.deepcopy(value)
            for key, value in artifact.items()
            if key not in {"artifactId", "artifactRef", "originalPath"}
        },
    }


def expected_artifact_id(artifact: Mapping[str, Any]) -> str:
    return urn_from_hash("artifact", sha256_object(artifact_identity_view(artifact)))


def source_ref_identity_view(source_ref: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "namespace": "techpub-source-ref-id-v1",
        **{key: copy.deepcopy(value) for key, value in source_ref.items() if key != "sourceRefId"},
    }


def expected_source_ref_id(source_ref: Mapping[str, Any]) -> str:
    return urn_from_hash("source-ref", sha256_object(source_ref_identity_view(source_ref)))


def source_segment_hash_view(segment: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "kind": segment["kind"],
        "expectedSemantic": segment["expectedSemantic"],
        "sourceRefIds": sorted(segment["sourceRefIds"]),
    }


def expected_source_segment_hash(segment: Mapping[str, Any]) -> str:
    return sha256_object(source_segment_hash_view(segment))


def expected_source_segment_id(package: Mapping[str, Any], segment: Mapping[str, Any]) -> str:
    view = {
        "namespace": "techpub-source-segment-id-v1",
        "sourcePackageId": package["source"]["sourcePackageId"],
        "continuityKey": segment["continuityKey"],
        "kind": segment["kind"],
    }
    return urn_from_hash("source-segment", sha256_object(view))


def expected_document_id(package: Mapping[str, Any]) -> str:
    view = {
        "namespace": "techpub-document-id-v1",
        "sourcePackageId": package["source"]["sourcePackageId"],
    }
    return urn_from_hash("document", sha256_object(view))


def expected_module_id(package: Mapping[str, Any], module: Mapping[str, Any]) -> str:
    view = {
        "namespace": "techpub-module-id-v1",
        "sourcePackageId": package["source"]["sourcePackageId"],
        "continuityKey": module["continuityKey"],
        "moduleKind": module["moduleKind"],
    }
    return urn_from_hash("module", sha256_object(view))


def expected_unit_id(
    package: Mapping[str, Any], module: Mapping[str, Any], unit: Mapping[str, Any]
) -> str:
    view = {
        "namespace": "techpub-unit-id-v1",
        "sourcePackageId": package["source"]["sourcePackageId"],
        "moduleAnchorKey": module["continuityKey"],
        "sourceAnchorKey": unit["continuityKey"],
        "kind": unit["kind"],
    }
    return urn_from_hash("unit", sha256_object(view))


def unit_hash_view(unit: Mapping[str, Any]) -> dict[str, Any]:
    return {key: copy.deepcopy(value) for key, value in unit.items() if key != "unitHash"}


def expected_unit_hash(unit: Mapping[str, Any]) -> str:
    return sha256_object(unit_hash_view(unit))


def source_segment_set_view(package: Mapping[str, Any]) -> list[dict[str, Any]]:
    return sorted(
        [
            {
                "sourceSegmentId": item["sourceSegmentId"],
                "segmentHash": item["segmentHash"],
                "coverageRequired": item["coverageRequired"],
            }
            for item in package["sourceSegments"]
        ],
        key=lambda item: item["sourceSegmentId"],
    )


def expected_segment_set_hash(package: Mapping[str, Any]) -> str:
    return sha256_object(source_segment_set_view(package))


def expected_source_package_hash(package: Mapping[str, Any]) -> str | None:
    artifacts = {item["artifactId"]: item for item in package["artifacts"]}
    try:
        source_artifacts = [artifacts[item] for item in package["source"]["artifactIds"]]
    except KeyError:
        return None
    if package["source"]["kind"] == "pdf":
        pdfs = [item for item in source_artifacts if item["mediaType"] == "application/pdf"]
        return pdfs[0]["sha256"] if len(pdfs) == 1 else None
    manifest: list[dict[str, Any]] = []
    for artifact in source_artifacts:
        if "normalizedPath" not in artifact:
            return None
        manifest.append(
            {
                "normalizedPath": artifact["normalizedPath"],
                "sha256": artifact["sha256"],
                "byteLength": artifact.get("byteLength"),
                "mediaType": artifact["mediaType"],
            }
        )
    manifest.sort(key=lambda item: item["normalizedPath"])
    return sha256_object(manifest)


def parse_failure_identity_view(report: Mapping[str, Any]) -> dict[str, Any]:
    """Stable failure identity; wall-clock time and storage location are excluded."""
    return {
        "namespace": "techpub-parse-failure-id-v1",
        "sourceKind": report.get("sourceKind", "unknown"),
        "inputHash": report.get("inputHash"),
        "stage": report["stage"],
        "code": report["code"],
        "producerBuildHash": report["producer"]["buildHash"],
        "parameters": copy.deepcopy(report["parameters"]),
    }


def expected_parse_failure_id(report: Mapping[str, Any]) -> str:
    return urn_from_hash("parse-failure", sha256_object(parse_failure_identity_view(report)))


def writer_generated_package_view(manifest: Mapping[str, Any]) -> list[dict[str, Any]]:
    return sorted(
        [
            {
                "normalizedPath": normalize_relative_path(item["normalizedPath"]),
                "mediaType": item["mediaType"],
                "byteLength": item["byteLength"],
                "sha256": item["sha256"],
            }
            for item in manifest["generatedArtifacts"]
        ],
        key=lambda item: item["normalizedPath"],
    )


def expected_writer_generated_package_hash(manifest: Mapping[str, Any]) -> str:
    return sha256_object(writer_generated_package_view(manifest))


def writer_manifest_identity_view(manifest: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "namespace": "techpub-writer-manifest-id-v1",
        **{
            key: copy.deepcopy(value)
            for key, value in manifest.items()
            if key not in {"manifestId", "createdAt"}
        },
    }


def expected_writer_manifest_id(manifest: Mapping[str, Any]) -> str:
    return urn_from_hash("writer-manifest", sha256_object(writer_manifest_identity_view(manifest)))


def refresh_integrity(package: dict[str, Any]) -> None:
    for unit in package["contentUnits"]:
        unit["unitHash"] = expected_unit_hash(unit)
    segment_set_hash = expected_segment_set_hash(package)
    package["coverage"]["basis"]["segmentSetHash"] = segment_set_hash
    package["coverage"]["basis"]["segmentSetId"] = urn_from_hash(
        "source-segment-set", segment_set_hash
    )
    package["integrity"] = {
        "hashSpecVersion": "techpub.hash.v1",
        "canonicalization": "RFC8785-JCS",
        "digestAlgorithm": "SHA-256",
        "contentHash": "sha256:" + "0" * 64,
        "semanticHash": sha256_object(semantic_view(package)),
        "provenanceHash": sha256_object(provenance_view(package)),
        "coverageHash": sha256_object(coverage_hash_view(package)),
    }
    content_hash = sha256_object(content_view(package))
    package["integrity"]["contentHash"] = content_hash
    package["packageId"] = urn_from_hash("package", content_hash)


def _json_pointer(parts: Iterable[Any]) -> str:
    encoded = [str(item).replace("~", "~0").replace("/", "~1") for item in parts]
    return "/" + "/".join(encoded) if encoded else ""


def _issue(issues: list[ContractIssue], code: str, path: str, message: str, severity: str = "error") -> None:
    issues.append(ContractIssue(code=code, path=path, message=message, severity=severity))


def _check_unique(values: Sequence[str], code: str, path: str, issues: list[ContractIssue]) -> None:
    duplicates = sorted(value for value, count in Counter(values).items() if count > 1)
    if duplicates:
        _issue(issues, code, path, f"duplicate identities: {duplicates}")


def _walk_keys(value: Any, path: str = "") -> Iterator[tuple[str, str]]:
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}/{key}" if path else f"/{key}"
            yield key, child_path
            yield from _walk_keys(child, child_path)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from _walk_keys(child, f"{path}/{index}")


def _walk_key_values(
    value: Any, path: str = ""
) -> Iterator[tuple[str, Any, str]]:
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}/{key}" if path else f"/{key}"
            yield key, child, child_path
            yield from _walk_key_values(child, child_path)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from _walk_key_values(child, f"{path}/{index}")


def _collect_nested_ids(package: Mapping[str, Any]) -> list[str]:
    values: list[str] = []
    for structure in package["publicationStructures"]:
        values.extend(node["nodeId"] for node in _flatten_publication_nodes(structure["nodes"]))
    for unit in package["contentUnits"]:
        payload = unit["payload"]
        if unit["kind"] == "figure":
            values.append(payload["figureId"])
        if unit["kind"] == "table" and payload["layout"] == "grid":
            values.extend(item["columnId"] for item in payload.get("columns", []))
            for group in payload["rowGroups"]:
                values.append(group["rowGroupId"])
                for row in group["rows"]:
                    values.append(row["rowId"])
                    for cell in row["cells"]:
                        values.append(cell["cellId"])
                        values.extend(item["inlineId"] for item in cell["inlineContent"])
    for asset in package["assets"]:
        values.extend(item["renditionId"] for item in asset["renditions"])
    return values


def _derive_coverage(package: Mapping[str, Any]) -> dict[str, Any]:
    entries = package["coverage"]["entries"]
    counts = Counter(item["disposition"] for item in entries)
    summary = {
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
    blocking_structured = any(
        item["blocking"] and "structured_coverage" in item["blocks"]
        for item in package["findings"]
    )
    if blocking_structured:
        summary["structuredCoverageComplete"] = False
    summary["status"] = (
        "complete"
        if summary["accountingComplete"]
        and summary["contentPreserved"]
        and summary["structuredCoverageComplete"]
        else "partial"
    )
    return summary


def validate_package(
    package: Mapping[str, Any],
    *,
    contract_root: Path,
    artifact: str,
    mode: str = "strict",
) -> ValidationReport:
    if mode not in {"strict", "forensic"}:
        raise ValueError(f"unsupported validation mode: {mode}")
    report = ValidationReport(
        artifact=artifact,
        mode=mode,
        package_id=package.get("packageId") if isinstance(package, Mapping) else None,
        content_hash=(
            package.get("integrity", {}).get("contentHash")
            if isinstance(package, Mapping)
            else None
        ),
    )
    issues = report.issues

    if not isinstance(package, Mapping):
        _issue(
            issues,
            "CONTRACT.REVISION_MISMATCH",
            "",
            "package must be a JSON object with an explicit contract revision",
        )
        return report
    observed_schema = package.get("$schema")
    observed_version = package.get("schemaVersion")
    observed_revision = package.get("contractRevision")
    if (
        observed_schema != CONTRACT_SCHEMA_ID
        or observed_version != CONTRACT_SCHEMA_VERSION
        or observed_revision != CONTRACT_REVISION
    ):
        _issue(
            issues,
            "CONTRACT.REVISION_MISMATCH",
            "",
            (
                f"expected {CONTRACT_SCHEMA_ID} / {CONTRACT_SCHEMA_VERSION} / "
                f"{CONTRACT_REVISION}; observed {observed_schema} / "
                f"{observed_version} / {observed_revision}"
            ),
        )
        return report

    schema_path = contract_root / "schema" / "parsed-package.schema.json"
    schema = load_json(schema_path)
    schema_validator = Draft202012Validator(schema, format_checker=FormatChecker())
    schema_errors = sorted(schema_validator.iter_errors(package), key=lambda item: list(item.absolute_path))
    for error in schema_errors:
        _issue(issues, "SCHEMA.INVALID", _json_pointer(error.absolute_path), error.message)
    if schema_errors:
        report.issues.sort()
        return report

    for key, path in _walk_keys(package):
        normalized = "".join(character for character in key.lower() if character.isalnum())
        if normalized in FORBIDDEN_AUTHORITY_KEYS:
            _issue(issues, "AUTHORITY.FORBIDDEN_FIELD", path, f"forbidden authority field: {key}")

    identity_groups: dict[str, list[str]] = {
        "artifact": [item["artifactId"] for item in package["artifacts"]],
        "sourceRef": [item["sourceRefId"] for item in package["sourceRefs"]],
        "sourceSegment": [item["sourceSegmentId"] for item in package["sourceSegments"]],
        "module": [item["moduleId"] for item in package["modules"]],
        "unit": [item["unitId"] for item in package["contentUnits"]],
        "reference": [item["referenceId"] for item in package["references"]],
        "asset": [item["assetId"] for item in package["assets"]],
        "finding": [item["findingId"] for item in package["findings"]],
        "deliveryObject": [item["deliveryObjectId"] for item in package["source"]["deliveryObjects"]],
        "publicationStructure": [
            item["publicationStructureId"] for item in package["publicationStructures"]
        ],
        "applicabilitySource": [
            item["expressionId"] for item in package["applicability"]["sourceExpressions"]
        ],
        "applicabilityCandidate": [
            item["candidateId"] for item in package["applicability"]["normalizedCandidates"]
        ],
        "applicabilityAssignment": [
            item["assignmentId"] for item in package["applicability"]["assignments"]
        ],
        "nested": _collect_nested_ids(package),
    }
    for label, values in identity_groups.items():
        _check_unique(values, "IDENTITY.DUPLICATE", f"/{label}", issues)
    all_ids = [value for values in identity_groups.values() for value in values]
    all_ids.append(package["document"]["documentId"])
    _check_unique(all_ids, "IDENTITY.CROSS_TYPE_DUPLICATE", "", issues)
    known_ids = set(all_ids)
    known_ids.add(package["packageId"])

    artifacts = {item["artifactId"]: item for item in package["artifacts"]}
    source_refs = {item["sourceRefId"]: item for item in package["sourceRefs"]}
    segments = {item["sourceSegmentId"]: item for item in package["sourceSegments"]}
    modules = {item["moduleId"]: item for item in package["modules"]}
    units = {item["unitId"]: item for item in package["contentUnits"]}
    references = {item["referenceId"]: item for item in package["references"]}
    assets = {item["assetId"]: item for item in package["assets"]}
    findings = {item["findingId"]: item for item in package["findings"]}

    for key, value, path in _walk_key_values(package):
        if path.startswith("/extensions/"):
            continue
        if key == "sourceRefIds" and not set(value) <= set(source_refs):
            _issue(
                issues,
                "REFERENCE.MISSING_SOURCE_REF",
                path,
                "core object references an unknown sourceRef",
            )
        elif key == "findingIds" and not set(value) <= set(findings):
            _issue(
                issues,
                "REFERENCE.MISSING_FINDING",
                path,
                "core object references an unknown finding",
            )
        elif (
            key == "authority"
            and value == "parser_candidate"
            and not path.startswith("/applicability/normalizedCandidates/")
        ):
            _issue(
                issues,
                "AUTHORITY.PARSER_CANDIDATE_OUTSIDE_APPLICABILITY",
                path,
                "parser_candidate authority is reserved for applicability candidates",
            )

    for input_index, lineage_input in enumerate(package["lineage"]["inputs"]):
        if not set(lineage_input["artifactIds"]) <= set(artifacts):
            _issue(
                issues,
                "REFERENCE.MISSING_LINEAGE_ARTIFACT",
                f"/lineage/inputs/{input_index}/artifactIds",
                "lineage input references an unknown artifact",
            )

    for index, artifact_item in enumerate(package["artifacts"]):
        path = f"/artifacts/{index}"
        if artifact_item["artifactId"] != expected_artifact_id(artifact_item):
            _issue(issues, "IDENTITY.ARTIFACT_ID_MISMATCH", f"{path}/artifactId", "artifactId is not derived from the stable artifact view")
        if "normalizedPath" in artifact_item:
            try:
                normalized = normalize_relative_path(artifact_item["normalizedPath"])
                if normalized != artifact_item["normalizedPath"]:
                    _issue(issues, "PATH.NOT_CANONICAL", f"{path}/normalizedPath", f"expected {normalized}")
            except ValueError as exc:
                _issue(issues, "PATH.INVALID", f"{path}/normalizedPath", str(exc))
        artifact_ref = artifact_item["artifactRef"]
        if artifact_ref.startswith("contract://"):
            relative_value = artifact_ref.removeprefix("contract://")
            try:
                relative_value = normalize_relative_path(relative_value)
                resolved = (contract_root / relative_value).resolve()
                if contract_root.resolve() not in resolved.parents:
                    raise ValueError("contract artifact path escapes contract root")
                payload = resolved.read_bytes()
                actual_hash = sha256_bytes(payload)
                if artifact_item["sha256"] != actual_hash:
                    _issue(issues, "HASH.ARTIFACT_BYTES_MISMATCH", f"{path}/sha256", f"expected {actual_hash}")
                if artifact_item.get("byteLength") != len(payload):
                    _issue(issues, "HASH.ARTIFACT_LENGTH_MISMATCH", f"{path}/byteLength", f"expected {len(payload)}")
            except (OSError, ValueError) as exc:
                _issue(issues, "ARTIFACT.CONTRACT_REF_UNREADABLE", f"{path}/artifactRef", str(exc))
    normalized_paths = [item["normalizedPath"] for item in package["artifacts"] if "normalizedPath" in item]
    _check_unique(normalized_paths, "PATH.DUPLICATE", "/artifacts", issues)

    expected_source_hash = expected_source_package_hash(package)
    if expected_source_hash is None:
        _issue(issues, "SOURCE.HASH_UNRESOLVABLE", "/source/sourcePackageHash", "source artifacts do not define one deterministic source hash")
    elif package["source"]["sourcePackageHash"] != expected_source_hash:
        _issue(issues, "SOURCE.HASH_MISMATCH", "/source/sourcePackageHash", f"expected {expected_source_hash}")
    for artifact_id in package["source"]["artifactIds"]:
        if artifact_id not in artifacts:
            _issue(issues, "REFERENCE.MISSING_ARTIFACT", "/source/artifactIds", artifact_id)
    for index, delivery in enumerate(package["source"]["deliveryObjects"]):
        path = f"/source/deliveryObjects/{index}"
        if not set(delivery["artifactIds"]) <= set(artifacts):
            _issue(
                issues,
                "REFERENCE.MISSING_DELIVERY_ARTIFACT",
                f"{path}/artifactIds",
                "delivery object references an unknown artifact",
            )
        if not set(delivery["sourceRefIds"]) <= set(source_refs):
            _issue(
                issues,
                "REFERENCE.MISSING_SOURCE_REF",
                f"{path}/sourceRefIds",
                "delivery object references an unknown sourceRef",
            )

    expected_ref_kind = "pdf" if package["source"]["kind"] == "pdf" else "xml"
    for index, source_ref in enumerate(package["sourceRefs"]):
        path = f"/sourceRefs/{index}"
        if source_ref["artifactId"] not in artifacts:
            _issue(issues, "REFERENCE.MISSING_ARTIFACT", f"{path}/artifactId", source_ref["artifactId"])
        if source_ref["kind"] != expected_ref_kind:
            _issue(issues, "LOCATOR.SOURCE_KIND_MISMATCH", f"{path}/kind", f"expected {expected_ref_kind}")
        if source_ref["sourceRefId"] != expected_source_ref_id(source_ref):
            _issue(issues, "IDENTITY.SOURCE_REF_ID_MISMATCH", f"{path}/sourceRefId", "sourceRefId is not derived from the locator view")
        if source_ref["kind"] == "pdf":
            if source_ref["pageEnd"] < source_ref["pageStart"]:
                _issue(issues, "LOCATOR.PAGE_RANGE_INVALID", path, "pageEnd precedes pageStart")
            if "bbox" in source_ref and source_ref["pageStart"] != source_ref["pageEnd"]:
                _issue(
                    issues,
                    "LOCATOR.BBOX_REQUIRES_SINGLE_PAGE",
                    f"{path}/bbox",
                    "a bbox is page-specific; use multiple sourceRefs for a cross-page object",
                )
            if "charStart" in source_ref and "charEnd" in source_ref and source_ref["charEnd"] < source_ref["charStart"]:
                _issue(issues, "LOCATOR.CHAR_RANGE_INVALID", path, "charEnd precedes charStart")
        else:
            try:
                normalized = normalize_relative_path(source_ref["normalizedPath"])
                if normalized != source_ref["normalizedPath"]:
                    _issue(issues, "PATH.NOT_CANONICAL", f"{path}/normalizedPath", f"expected {normalized}")
            except ValueError as exc:
                _issue(issues, "PATH.INVALID", f"{path}/normalizedPath", str(exc))
        if "quote" in source_ref:
            expected_anchor_hash = sha256_text(source_ref["quote"])
            if source_ref["anchorTextHash"] != expected_anchor_hash:
                _issue(
                    issues,
                    "HASH.SOURCE_REF_ANCHOR_MISMATCH",
                    f"{path}/anchorTextHash",
                    f"expected {expected_anchor_hash}",
                )

    for index, segment in enumerate(package["sourceSegments"]):
        path = f"/sourceSegments/{index}"
        if not set(segment["sourceRefIds"]) <= set(source_refs):
            _issue(issues, "REFERENCE.MISSING_SOURCE_REF", f"{path}/sourceRefIds", "source segment references an unknown sourceRef")
        if segment["segmentHash"] != expected_source_segment_hash(segment):
            _issue(issues, "HASH.SOURCE_SEGMENT_MISMATCH", f"{path}/segmentHash", "segmentHash does not match the stable segment view")
        if segment["sourceSegmentId"] != expected_source_segment_id(package, segment):
            _issue(issues, "IDENTITY.SOURCE_SEGMENT_ID_MISMATCH", f"{path}/sourceSegmentId", "sourceSegmentId does not match continuityKey")
        parent = segment.get("parentSourceSegmentId")
        if parent is not None and parent not in segments:
            _issue(issues, "REFERENCE.MISSING_SOURCE_SEGMENT_PARENT", f"{path}/parentSourceSegmentId", parent)
    for segment_id in segments:
        seen: set[str] = set()
        current: str | None = segment_id
        while current is not None and current in segments:
            if current in seen:
                _issue(issues, "STRUCTURE.SOURCE_SEGMENT_CYCLE", "/sourceSegments", f"cycle includes {current}")
                break
            seen.add(current)
            current = segments[current].get("parentSourceSegmentId")
    segment_sibling_orders: dict[str | None, list[int]] = defaultdict(list)
    for segment in package["sourceSegments"]:
        segment_sibling_orders[segment.get("parentSourceSegmentId")].append(segment["order"])
    for parent, orders in segment_sibling_orders.items():
        expected_orders = list(range(len(orders)))
        if sorted(orders) != expected_orders:
            _issue(
                issues,
                "STRUCTURE.SOURCE_SEGMENT_ORDER_NON_CONTIGUOUS",
                "/sourceSegments",
                f"parent {parent}: {sorted(orders)} expected {expected_orders}",
            )

    if package["document"]["documentId"] != expected_document_id(package):
        _issue(issues, "IDENTITY.DOCUMENT_ID_MISMATCH", "/document/documentId", "documentId is not derived from sourcePackageId")

    listed_units: list[str] = []
    module_orders: set[int] = set()
    for index, module in enumerate(package["modules"]):
        path = f"/modules/{index}"
        if module["moduleId"] != expected_module_id(package, module):
            _issue(issues, "IDENTITY.MODULE_ID_MISMATCH", f"{path}/moduleId", "moduleId does not match continuityKey")
        if module["order"] in module_orders:
            _issue(issues, "STRUCTURE.DUPLICATE_MODULE_ORDER", f"{path}/order", str(module["order"]))
        module_orders.add(module["order"])
        if not set(module["sourceRefIds"]) <= set(source_refs):
            _issue(issues, "REFERENCE.MISSING_SOURCE_REF", f"{path}/sourceRefIds", "module references an unknown sourceRef")
        if not set(module["contentUnitIds"]) <= set(units):
            _issue(issues, "REFERENCE.MISSING_UNIT", f"{path}/contentUnitIds", "module lists an unknown unit")
        listed_units.extend(module["contentUnitIds"])
    if Counter(listed_units) != Counter(units.keys()):
        _issue(issues, "STRUCTURE.MODULE_UNIT_PARTITION", "/modules", "module.contentUnitIds must partition contentUnits exactly once")
    expected_module_orders = list(range(len(module_orders)))
    if sorted(module_orders) != expected_module_orders:
        _issue(
            issues,
            "STRUCTURE.MODULE_ORDER_NON_CONTIGUOUS",
            "/modules",
            f"{sorted(module_orders)} expected {expected_module_orders}",
        )

    sibling_orders: dict[tuple[str, str | None], list[int]] = defaultdict(list)
    for index, unit in enumerate(package["contentUnits"]):
        path = f"/contentUnits/{index}"
        module = modules.get(unit["moduleId"])
        if module is None:
            _issue(issues, "REFERENCE.MISSING_MODULE", f"{path}/moduleId", unit["moduleId"])
        else:
            if unit["unitId"] != expected_unit_id(package, module, unit):
                _issue(issues, "IDENTITY.UNIT_ID_MISMATCH", f"{path}/unitId", "unitId does not match the v1 identity preimage")
        if unit["unitHash"] != expected_unit_hash(unit):
            _issue(issues, "HASH.UNIT_MISMATCH", f"{path}/unitHash", "unitHash does not match the stable unit view")
        if not set(unit["sourceRefIds"]) <= set(source_refs):
            _issue(issues, "REFERENCE.MISSING_SOURCE_REF", f"{path}/sourceRefIds", "unit references an unknown sourceRef")
        if not set(unit["sourceSegmentIds"]) <= set(segments):
            _issue(issues, "REFERENCE.MISSING_SOURCE_SEGMENT", f"{path}/sourceSegmentIds", "unit references an unknown sourceSegment")
        if not set(unit["mapping"]["findingIds"]) <= set(findings):
            _issue(issues, "REFERENCE.MISSING_FINDING", f"{path}/mapping/findingIds", "unit mapping references an unknown finding")
        parent_id = unit.get("parentUnitId")
        if parent_id is None:
            if unit["depth"] != 0:
                _issue(issues, "STRUCTURE.ROOT_DEPTH", f"{path}/depth", "root unit depth must be zero")
        elif parent_id not in units:
            _issue(issues, "REFERENCE.MISSING_UNIT_PARENT", f"{path}/parentUnitId", parent_id)
        else:
            parent = units[parent_id]
            if parent["moduleId"] != unit["moduleId"]:
                _issue(issues, "STRUCTURE.CROSS_MODULE_PARENT", f"{path}/parentUnitId", parent_id)
            if parent["depth"] + 1 != unit["depth"]:
                _issue(issues, "STRUCTURE.DEPTH_MISMATCH", f"{path}/depth", f"expected {parent['depth'] + 1}")
        sibling_orders[(unit["moduleId"], parent_id)].append(unit["order"])

        payload = unit["payload"]
        if unit["kind"] == "advisory" and not set(payload["scope"]["targetUnitIds"]) <= set(units):
            _issue(issues, "REFERENCE.MISSING_ADVISORY_TARGET", f"{path}/payload/scope/targetUnitIds", "unknown unit")
        elif unit["kind"] == "list" and not set(payload["itemUnitIds"]) <= set(units):
            _issue(issues, "REFERENCE.MISSING_LIST_ITEM", f"{path}/payload/itemUnitIds", "unknown unit")
        elif unit["kind"] == "figure":
            if not set(payload["assetIds"]) <= set(assets):
                _issue(issues, "REFERENCE.MISSING_ASSET", f"{path}/payload/assetIds", "unknown asset")
            if not set(payload["referenceIds"]) <= set(references):
                _issue(issues, "REFERENCE.MISSING_REFERENCE", f"{path}/payload/referenceIds", "unknown reference")
        elif unit["kind"] == "reference" and not set(payload["referenceIds"]) <= set(references):
            _issue(issues, "REFERENCE.MISSING_REFERENCE", f"{path}/payload/referenceIds", "unknown reference")
        elif unit["kind"] == "table" and payload["layout"] == "grid":
            columns = payload.get("columns")
            if columns is not None:
                if len(columns) != payload["columnCount"]:
                    _issue(
                        issues,
                        "TABLE.COLUMN_COUNT_MISMATCH",
                        f"{path}/payload/columns",
                        f"expected {payload['columnCount']} columns, observed {len(columns)}",
                    )
                column_orders = [column["order"] for column in columns]
                if sorted(column_orders) != list(range(len(column_orders))):
                    _issue(
                        issues,
                        "TABLE.COLUMN_ORDER_INVALID",
                        f"{path}/payload/columns",
                        f"orders {sorted(column_orders)} must be contiguous from zero",
                    )
            for group_index, group in enumerate(payload["rowGroups"]):
                row_orders = [row["order"] for row in group["rows"]]
                if sorted(row_orders) != list(range(len(row_orders))):
                    _issue(issues, "STRUCTURE.TABLE_ROW_ORDER_NON_CONTIGUOUS", f"{path}/payload/rowGroups/{group_index}/rows", str(sorted(row_orders)))
                occupied: dict[tuple[int, int], str] = {}
                for row_index, row in enumerate(group["rows"]):
                    for cell_index, cell in enumerate(row["cells"]):
                        cell_path = f"{path}/payload/rowGroups/{group_index}/rows/{row_index}/cells/{cell_index}"
                        column_end = cell["columnStart"] + cell["colSpan"]
                        row_end = row_index + cell["rowSpan"]
                        if (
                            cell["columnStart"] < 0
                            or column_end > payload["columnCount"]
                            or row_end > len(group["rows"])
                        ):
                            _issue(
                                issues,
                                "TABLE.GRID_BOUNDS_INVALID",
                                cell_path,
                                "cell rectangle exceeds table column or row-group bounds",
                            )
                        conflict = False
                        for occupied_row in range(row_index, min(row_end, len(group["rows"]))):
                            for occupied_column in range(
                                cell["columnStart"],
                                min(column_end, payload["columnCount"]),
                            ):
                                coordinate = (occupied_row, occupied_column)
                                if coordinate in occupied:
                                    conflict = True
                                else:
                                    occupied[coordinate] = cell_path
                        if conflict:
                            _issue(
                                issues,
                                "TABLE.GRID_CONFLICT",
                                cell_path,
                                "cell rectangle overlaps an earlier cell or row span",
                            )
                        if not set(cell["sourceRefIds"]) <= set(source_refs):
                            _issue(issues, "REFERENCE.MISSING_SOURCE_REF", f"{path}/payload/rowGroups/{group_index}/rows/{row_index}/cells/{cell_index}/sourceRefIds", "unknown sourceRef")
                        for inline_index, inline in enumerate(cell["inlineContent"]):
                            if not set(inline["sourceRefIds"]) <= set(source_refs):
                                _issue(issues, "REFERENCE.MISSING_SOURCE_REF", f"{path}/payload/rowGroups/{group_index}/rows/{row_index}/cells/{cell_index}/inlineContent/{inline_index}/sourceRefIds", "unknown sourceRef")

    for key, orders in sibling_orders.items():
        expected = list(range(len(orders)))
        if sorted(orders) != expected:
            _issue(issues, "STRUCTURE.SIBLING_ORDER_NON_CONTIGUOUS", "/contentUnits", f"{key}: {sorted(orders)} expected {expected}")
    for unit_id in units:
        seen: set[str] = set()
        current: str | None = unit_id
        while current is not None and current in units:
            if current in seen:
                _issue(issues, "STRUCTURE.UNIT_PARENT_CYCLE", "/contentUnits", f"cycle includes {current}")
                break
            seen.add(current)
            current = units[current].get("parentUnitId")

    for structure_index, structure in enumerate(package["publicationStructures"]):
        if not set(structure["sourceRefIds"]) <= set(source_refs):
            _issue(issues, "REFERENCE.MISSING_SOURCE_REF", f"/publicationStructures/{structure_index}/sourceRefIds", "unknown sourceRef")
        for node in _flatten_publication_nodes(structure["nodes"]):
            if not set(node["moduleIds"]) <= set(modules):
                _issue(issues, "REFERENCE.MISSING_MODULE", f"/publicationStructures/{structure_index}/nodes", "unknown module")

    for index, reference in enumerate(package["references"]):
        path = f"/references/{index}"
        if reference["fromUnitId"] not in units:
            _issue(issues, "REFERENCE.MISSING_FROM_UNIT", f"{path}/fromUnitId", reference["fromUnitId"])
        if not set(reference["sourceRefIds"]) <= set(source_refs):
            _issue(issues, "REFERENCE.MISSING_SOURCE_REF", f"{path}/sourceRefIds", "unknown sourceRef")
        if not set(reference["findingIds"]) <= set(findings):
            _issue(issues, "REFERENCE.MISSING_FINDING", f"{path}/findingIds", "unknown finding")
        if reference["resolutionStatus"] in {"missing", "ambiguous"} and not reference["findingIds"]:
            _issue(issues, "REFERENCE.UNRESOLVED_WITHOUT_FINDING", path, "missing/ambiguous reference requires a finding")
        target = reference["target"]
        target_value = target["identifier"]["value"]
        if reference["resolutionStatus"] == "resolved":
            target_universes = {
                "unit": set(units),
                "module": set(modules),
                "asset": set(assets),
                "publication": {
                    item["publicationStructureId"]
                    for item in package["publicationStructures"]
                },
            }
            universe = target_universes.get(target["kind"])
            if universe is None or target_value not in universe:
                _issue(
                    issues,
                    "REFERENCE.RESOLVED_TARGET_MISSING",
                    f"{path}/target/identifier/value",
                    "resolved target must name an existing core entity of the declared kind",
                )
        if reference["resolutionStatus"] == "external" and target["kind"] != "external":
            _issue(
                issues,
                "REFERENCE.EXTERNAL_TARGET_KIND",
                f"{path}/target/kind",
                "external resolution requires target.kind=external",
            )

    for index, asset in enumerate(package["assets"]):
        path = f"/assets/{index}"
        if not asset["renditions"]:
            _issue(
                issues,
                "ASSET.RENDITION_REQUIRED",
                f"{path}/renditions",
                "asset must bind at least one rendition",
            )
        if not set(asset["sourceRefIds"]) <= set(source_refs):
            _issue(issues, "REFERENCE.MISSING_SOURCE_REF", f"{path}/sourceRefIds", "unknown sourceRef")
        for rendition_index, rendition in enumerate(asset["renditions"]):
            if rendition["artifactId"] not in artifacts:
                _issue(issues, "REFERENCE.MISSING_ARTIFACT", f"{path}/renditions/{rendition_index}/artifactId", rendition["artifactId"])
            elif rendition["sha256"] != artifacts[rendition["artifactId"]]["sha256"]:
                _issue(issues, "HASH.RENDITION_ARTIFACT_MISMATCH", f"{path}/renditions/{rendition_index}/sha256", "rendition and artifact hashes differ")
            if not set(rendition["sourceRefIds"]) <= set(source_refs):
                _issue(issues, "REFERENCE.MISSING_SOURCE_REF", f"{path}/renditions/{rendition_index}/sourceRefIds", "unknown sourceRef")

    applicability_sources = {
        item["expressionId"]: item
        for item in package["applicability"]["sourceExpressions"]
    }
    for index, expression in enumerate(package["applicability"]["sourceExpressions"]):
        if not set(expression["sourceRefIds"]) <= set(source_refs):
            _issue(issues, "REFERENCE.MISSING_SOURCE_REF", f"/applicability/sourceExpressions/{index}/sourceRefIds", "unknown sourceRef")
    for index, candidate in enumerate(package["applicability"]["normalizedCandidates"]):
        candidate_source_ids = set(candidate["sourceExpressionIds"])
        if not candidate_source_ids <= set(applicability_sources):
            _issue(issues, "REFERENCE.MISSING_APPLICABILITY_SOURCE", f"/applicability/normalizedCandidates/{index}/sourceExpressionIds", "unknown expression")
        elif any(
            applicability_sources[source_id]["form"] != "logical_expression"
            for source_id in candidate_source_ids
        ):
            _issue(
                issues,
                "APPLICABILITY.INVALID_CANDIDATE_SOURCE_FORM",
                f"/applicability/normalizedCandidates/{index}/sourceExpressionIds",
                "normalized candidates may only use logical_expression sources",
            )
    for index, assignment in enumerate(package["applicability"]["assignments"]):
        path = f"/applicability/assignments/{index}"
        if assignment["expressionId"] not in applicability_sources:
            _issue(
                issues,
                "REFERENCE.MISSING_APPLICABILITY_SOURCE",
                f"{path}/expressionId",
                "assignment references an unknown source expression",
            )
        target = assignment["target"]
        target_kind = target["kind"]
        target_id = target.get("targetId")
        invalid_shape = (
            target_kind == "source_element" and target_id is not None
        ) or (
            target_kind in {"module", "content_unit"} and target_id is None
        )
        if invalid_shape:
            _issue(
                issues,
                "APPLICABILITY.INVALID_TARGET_SHAPE",
                f"{path}/target",
                "module/content_unit require targetId; source_element forbids targetId",
            )
        elif target_kind == "module" and target_id not in modules:
            _issue(
                issues,
                "REFERENCE.MISSING_APPLICABILITY_TARGET",
                f"{path}/target/targetId",
                "assignment references an unknown module",
            )
        elif target_kind == "content_unit" and target_id not in units:
            _issue(
                issues,
                "REFERENCE.MISSING_APPLICABILITY_TARGET",
                f"{path}/target/targetId",
                "assignment references an unknown content unit",
            )

    for index, finding in enumerate(package["findings"]):
        path = f"/findings/{index}"
        if not set(finding["sourceRefIds"]) <= set(source_refs):
            _issue(issues, "REFERENCE.MISSING_SOURCE_REF", f"{path}/sourceRefIds", "unknown sourceRef")
        if not set(finding["sourceSegmentIds"]) <= set(segments):
            _issue(issues, "REFERENCE.MISSING_SOURCE_SEGMENT", f"{path}/sourceSegmentIds", "unknown sourceSegment")
        if not set(finding["affectedUnitIds"]) <= set(units):
            _issue(issues, "REFERENCE.MISSING_UNIT", f"{path}/affectedUnitIds", "unknown unit")
        detail = finding.get("detailArtifactId")
        if detail is not None and detail not in artifacts:
            _issue(issues, "REFERENCE.MISSING_ARTIFACT", f"{path}/detailArtifactId", detail)

    entries = package["coverage"]["entries"]
    required_segments = {
        item["sourceSegmentId"] for item in package["sourceSegments"] if item["coverageRequired"]
    }
    entry_segments = [item["sourceSegmentId"] for item in entries]
    if len(entry_segments) != len(set(entry_segments)):
        _issue(issues, "COVERAGE.DUPLICATE_ENTRY", "/coverage/entries", "duplicate sourceSegmentId")
    if set(entry_segments) != required_segments:
        _issue(issues, "COVERAGE.UNIVERSE_MISMATCH", "/coverage/entries", "entries must exactly equal coverageRequired source segments")
    for index, entry in enumerate(entries):
        path = f"/coverage/entries/{index}"
        if not set(entry["targetIds"]) <= known_ids:
            _issue(issues, "COVERAGE.MISSING_TARGET", f"{path}/targetIds", "unknown target")
        if not set(entry["findingIds"]) <= set(findings):
            _issue(issues, "REFERENCE.MISSING_FINDING", f"{path}/findingIds", "unknown finding")
        disposition = entry["disposition"]
        if disposition in {"mapped_exactly", "mapped_with_normalization", "preserved_as_text"}:
            if not entry["targetIds"]:
                _issue(issues, "COVERAGE.MAPPED_WITHOUT_TARGET", f"{path}/targetIds", disposition)
            if "reasonCode" in entry:
                _issue(issues, "COVERAGE.UNEXPECTED_REASON", f"{path}/reasonCode", disposition)
        elif disposition == "blocked_with_finding":
            if not entry["findingIds"]:
                _issue(issues, "COVERAGE.BLOCKED_WITHOUT_FINDING", f"{path}/findingIds", disposition)
            if "reasonCode" in entry:
                _issue(issues, "COVERAGE.UNEXPECTED_REASON", f"{path}/reasonCode", disposition)
        else:
            if entry.get("reasonCode") not in ALLOWED_EXCLUSION_REASONS:
                _issue(issues, "COVERAGE.EXCLUSION_REASON", f"{path}/reasonCode", "missing or unsupported exclusion reason")
            if entry["targetIds"] or entry["findingIds"]:
                _issue(issues, "COVERAGE.EXCLUSION_HAS_TARGET", path, "excluded entry cannot claim target/finding")

    derived = _derive_coverage(package)
    summary = package["coverage"]["summary"]
    for key, expected in derived.items():
        if key == "status":
            continue
        if summary[key] != expected:
            _issue(issues, "COVERAGE.SUMMARY_MISMATCH", f"/coverage/summary/{key}", f"expected {expected}")
    if package["coverage"]["basis"]["requiredSourceSegmentCount"] != len(required_segments):
        _issue(issues, "COVERAGE.BASIS_COUNT_MISMATCH", "/coverage/basis/requiredSourceSegmentCount", f"expected {len(required_segments)}")
    expected_set_hash = expected_segment_set_hash(package)
    if package["coverage"]["basis"]["segmentSetHash"] != expected_set_hash:
        _issue(issues, "HASH.SEGMENT_SET_MISMATCH", "/coverage/basis/segmentSetHash", f"expected {expected_set_hash}")
    expected_set_id = urn_from_hash("source-segment-set", expected_set_hash)
    if package["coverage"]["basis"]["segmentSetId"] != expected_set_id:
        _issue(issues, "IDENTITY.SEGMENT_SET_ID_MISMATCH", "/coverage/basis/segmentSetId", f"expected {expected_set_id}")
    result = package["result"]
    for key in ("accountingComplete", "contentPreserved", "structuredCoverageComplete"):
        if result[key] != derived[key]:
            _issue(issues, "RESULT.DERIVATION_MISMATCH", f"/result/{key}", f"expected {derived[key]}")
    if result["status"] != derived["status"]:
        _issue(issues, "RESULT.STATUS_MISMATCH", "/result/status", f"expected {derived['status']}")

    registry = load_json(contract_root / "extensions" / "registry.json")
    registered = {
        (item["namespace"], item["schemaId"], item["version"]): item
        for item in registry["extensions"]
    }
    extension_keys = [
        (item["namespace"], item["schemaId"], item["version"])
        for item in package["extensions"]
    ]
    duplicate_extension_keys = sorted(
        key for key, count in Counter(extension_keys).items() if count > 1
    )
    if duplicate_extension_keys:
        _issue(
            issues,
            "EXTENSION.DUPLICATE",
            "/extensions",
            f"duplicate extension envelopes: {duplicate_extension_keys}",
        )
    source_standard = package["profile"].get("sourceStandard", {})
    if (
        package["source"]["kind"] == "native_s1000d"
        and source_standard.get("name") == "S1000D"
        and str(source_standard.get("issue", "")).startswith("6")
    ):
        native_lineage_extensions = [
            item
            for item in package["extensions"]
            if item["namespace"] == "urn:techpub:ext:s1000d-native-lineage:v1"
        ]
        if not native_lineage_extensions or not all(
            "schemaBinding" in item.get("payload", {})
            for item in native_lineage_extensions
        ):
            _issue(
                issues,
                "LINEAGE.SCHEMA_PACKAGE_UNBOUND",
                "/extensions",
                "native S1000D Issue 6 requires an explicit schema package binding",
            )
    for index, extension in enumerate(package["extensions"]):
        path = f"/extensions/{index}"
        expected_payload_hash = sha256_object(extension["payload"])
        if extension["payloadHash"] != expected_payload_hash:
            _issue(issues, "HASH.EXTENSION_PAYLOAD_MISMATCH", f"{path}/payloadHash", f"expected {expected_payload_hash}")
        if not set(extension["targetIds"]) <= known_ids:
            _issue(issues, "EXTENSION.MISSING_TARGET", f"{path}/targetIds", "unknown target")
        key = (extension["namespace"], extension["schemaId"], extension["version"])
        registration = registered.get(key)
        if registration is None:
            severity = "error" if mode == "strict" else "warning"
            _issue(issues, "EXTENSION.UNKNOWN_SCHEMA", path, str(key), severity)
            continue
        schema_path_value = normalize_relative_path(registration["schemaPath"])
        extension_schema_path = (contract_root / schema_path_value).resolve()
        if contract_root.resolve() not in extension_schema_path.parents:
            _issue(issues, "EXTENSION.SCHEMA_PATH_ESCAPE", path, schema_path_value)
            continue
        extension_schema = load_json(extension_schema_path)
        extension_validator = Draft202012Validator(extension_schema, format_checker=FormatChecker())
        for error in extension_validator.iter_errors(extension["payload"]):
            _issue(issues, "EXTENSION.PAYLOAD_INVALID", path + "/payload" + _json_pointer(error.absolute_path), error.message)
        if extension["namespace"] == "urn:techpub:ext:pdf-visual-lineage:v1":
            payload_artifact_ids: list[str] = []
            for run in extension["payload"].get("visualRuns", []):
                payload_artifact_ids.extend(run.get("artifactIds", []))
                review = run.get("review")
                if review:
                    payload_artifact_ids.extend(review.get("artifactIds", []))
            if not set(payload_artifact_ids) <= set(artifacts):
                _issue(issues, "EXTENSION.PDF_VISUAL_MISSING_ARTIFACT", path + "/payload", "visual lineage references an unknown artifact")
        elif extension["namespace"] == "urn:techpub:ext:s1000d-native-lineage:v1":
            payload = extension["payload"]
            schema_binding = payload.get("schemaBinding")
            payload_artifact_ids = {
                payload.get("parser", {}).get("snapshotArtifactId"),
                payload.get("realControlledBaseline", {}).get("summaryArtifactId"),
            }
            payload_artifact_ids.discard(None)
            if not payload_artifact_ids <= set(artifacts):
                _issue(
                    issues,
                    "EXTENSION.S1000D_LINEAGE_MISSING_ARTIFACT",
                    path + "/payload",
                    "native S1000D lineage references an unknown snapshot/summary artifact",
                )
            mapped_module_ids = {
                item.get("coreModuleId") for item in payload.get("moduleMappings", [])
            }
            mapped_module_ids.discard(None)
            if not mapped_module_ids <= set(modules):
                _issue(
                    issues,
                    "EXTENSION.S1000D_LINEAGE_MISSING_MODULE",
                    path + "/payload/moduleMappings",
                    "native S1000D lineage references an unknown core module",
                )
            delivery_ids = {
                item["deliveryObjectId"]
                for item in package["source"]["deliveryObjects"]
            }
            mapped_delivery_ids = {
                item.get("deliveryObjectId")
                for item in payload.get("deliveryObjectMappings", [])
            }
            mapped_delivery_ids.discard(None)
            if not mapped_delivery_ids <= delivery_ids:
                _issue(
                    issues,
                    "EXTENSION.S1000D_LINEAGE_MISSING_DELIVERY_OBJECT",
                    path + "/payload/deliveryObjectMappings",
                    "native S1000D lineage references an unknown delivery object",
                )
            if schema_binding is not None:
                schema_artifact_id = schema_binding["artifactId"]
                schema_artifact = artifacts.get(schema_artifact_id)
                matching_inputs = [
                    lineage_input
                    for lineage_input in package["lineage"]["inputs"]
                    if lineage_input["role"] == "s1000d_schema_package"
                    and schema_artifact_id in lineage_input["artifactIds"]
                    and lineage_input["hash"] == schema_binding["sha256"]
                ]
                if schema_artifact is None or not matching_inputs:
                    _issue(
                        issues,
                        "LINEAGE.SCHEMA_PACKAGE_UNBOUND",
                        path + "/payload/schemaBinding",
                        "schema package must be bound by an actual artifact and lineage input",
                    )
                elif schema_artifact["sha256"] != schema_binding["sha256"]:
                    _issue(
                        issues,
                        "HASH.SCHEMA_PACKAGE_MISMATCH",
                        path + "/payload/schemaBinding/sha256",
                        "schema binding hash differs from the actual artifact hash",
                    )
            table_column_ids = {
                column["columnId"]
                for unit in package["contentUnits"]
                if unit["kind"] == "table" and unit["payload"]["layout"] == "grid"
                for column in unit["payload"].get("columns", [])
            }
            for style_index, style in enumerate(payload.get("tableSourceStyles", [])):
                style_path = path + f"/payload/tableSourceStyles/{style_index}"
                if style["coreUnitId"] not in units:
                    _issue(
                        issues,
                        "EXTENSION.S1000D_LINEAGE_MISSING_UNIT",
                        style_path + "/coreUnitId",
                        "table source style references an unknown core unit",
                    )
                if not set(style["sourceRefIds"]) <= set(source_refs):
                    _issue(
                        issues,
                        "REFERENCE.MISSING_SOURCE_REF",
                        style_path + "/sourceRefIds",
                        "table source style references an unknown sourceRef",
                    )
                style_column_ids = {
                    item["coreColumnId"] for item in style.get("columnStyles", [])
                }
                if not style_column_ids <= table_column_ids:
                    _issue(
                        issues,
                        "EXTENSION.S1000D_LINEAGE_MISSING_TABLE_COLUMN",
                        style_path + "/columnStyles",
                        "table source style references an unknown core column",
                    )

    expected_hashes = {
        "coverageHash": sha256_object(coverage_hash_view(package)),
        "semanticHash": sha256_object(semantic_view(package)),
        "provenanceHash": sha256_object(provenance_view(package)),
        "contentHash": sha256_object(content_view(package)),
    }
    for key, expected in expected_hashes.items():
        if package["integrity"][key] != expected:
            _issue(issues, f"HASH.{key.upper()}_MISMATCH", f"/integrity/{key}", f"expected {expected}")
    expected_package_id_value = urn_from_hash("package", expected_hashes["contentHash"])
    if package["packageId"] != expected_package_id_value:
        _issue(issues, "IDENTITY.PACKAGE_ID_MISMATCH", "/packageId", f"expected {expected_package_id_value}")

    report.issues.sort()
    return report


def read_parsed_package(
    path: Path,
    *,
    contract_root: Path,
    mode: str = "strict",
) -> "ParsedPackageReader":
    package = load_json(path)
    report = validate_package(
        package,
        contract_root=contract_root,
        artifact=str(path),
        mode=mode,
    )
    if not report.ok:
        rendered = "; ".join(f"{item.code}@{item.path}: {item.message}" for item in report.errors)
        raise ValueError(rendered)
    return ParsedPackageReader(package=package, report=report)


@dataclass(frozen=True)
class ParsedPackageReader:
    package: Mapping[str, Any]
    report: ValidationReport

    def summary(self) -> dict[str, Any]:
        return {
            "schemaVersion": self.package["schemaVersion"],
            "contractRevision": self.package["contractRevision"],
            "packageId": self.package["packageId"],
            "sourceKind": self.package["source"]["kind"],
            "sourcePackageId": self.package["source"]["sourcePackageId"],
            "documentId": self.package["document"]["documentId"],
            "title": self.package["document"]["title"]["value"],
            "result": copy.deepcopy(self.package["result"]),
            "counts": {
                "modules": len(self.package["modules"]),
                "contentUnits": len(self.package["contentUnits"]),
                "sourceRefs": len(self.package["sourceRefs"]),
                "sourceSegments": len(self.package["sourceSegments"]),
                "references": len(self.package["references"]),
                "assets": len(self.package["assets"]),
                "findings": len(self.package["findings"]),
                "applicabilitySourceExpressions": len(
                    self.package["applicability"]["sourceExpressions"]
                ),
                "normalizedApplicabilityCandidates": len(
                    self.package["applicability"]["normalizedCandidates"]
                ),
                "applicabilityAssignments": len(
                    self.package["applicability"]["assignments"]
                ),
                "gridTables": sum(
                    1
                    for unit in self.package["contentUnits"]
                    if unit["kind"] == "table"
                    and unit["payload"]["layout"] == "grid"
                ),
                "tableColumns": sum(
                    len(unit["payload"].get("columns", []))
                    for unit in self.package["contentUnits"]
                    if unit["kind"] == "table"
                    and unit["payload"]["layout"] == "grid"
                ),
            },
            "integrity": copy.deepcopy(self.package["integrity"]),
        }

    def unit(self, unit_id: str) -> Mapping[str, Any]:
        for unit in self.package["contentUnits"]:
            if unit["unitId"] == unit_id:
                return unit
        raise KeyError(unit_id)

    def source_refs_for_unit(self, unit_id: str) -> list[Mapping[str, Any]]:
        unit = self.unit(unit_id)
        source_refs = {item["sourceRefId"]: item for item in self.package["sourceRefs"]}
        return [source_refs[item] for item in unit["sourceRefIds"]]

    def applicability_assignments(
        self, *, target_kind: str | None = None
    ) -> list[Mapping[str, Any]]:
        assignments = self.package["applicability"]["assignments"]
        if target_kind is None:
            return list(assignments)
        if target_kind not in {"module", "content_unit", "source_element"}:
            raise ValueError(f"unsupported applicability target kind: {target_kind}")
        return [
            item for item in assignments if item["target"]["kind"] == target_kind
        ]

    def table_columns(self, unit_id: str) -> list[Mapping[str, Any]]:
        unit = self.unit(unit_id)
        if unit["kind"] != "table" or unit["payload"]["layout"] != "grid":
            raise ValueError(f"content unit is not a grid table: {unit_id}")
        return list(unit["payload"].get("columns", []))


def validate_artifact_record(record: Mapping[str, Any], *, contract_root: Path, artifact_path: Path) -> list[ContractIssue]:
    schema = load_json(contract_root / "schema" / "artifact-record.schema.json")
    issues: list[ContractIssue] = []
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    for error in validator.iter_errors(record):
        _issue(issues, "ARTIFACT_RECORD.SCHEMA_INVALID", _json_pointer(error.absolute_path), error.message)
    if issues:
        return sorted(issues)
    payload = artifact_path.read_bytes()
    if record["byteLength"] != len(payload):
        _issue(issues, "ARTIFACT_RECORD.BYTE_LENGTH_MISMATCH", "/byteLength", f"expected {len(payload)}")
    actual_hash = sha256_bytes(payload)
    if record["artifactHash"] != actual_hash:
        _issue(issues, "ARTIFACT_RECORD.HASH_MISMATCH", "/artifactHash", f"expected {actual_hash}")
    package = load_json(artifact_path)
    if record["packageId"] != package.get("packageId"):
        _issue(issues, "ARTIFACT_RECORD.PACKAGE_ID_MISMATCH", "/packageId", "sidecar/package mismatch")
    if record["contentHash"] != package.get("integrity", {}).get("contentHash"):
        _issue(issues, "ARTIFACT_RECORD.CONTENT_HASH_MISMATCH", "/contentHash", "sidecar/package mismatch")
    return sorted(issues)


def validate_parse_failure_report(
    report: Mapping[str, Any], *, contract_root: Path
) -> list[ContractIssue]:
    schema = load_json(contract_root / "schema" / "parse-failure-report.schema.json")
    issues: list[ContractIssue] = []
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    for error in validator.iter_errors(report):
        _issue(
            issues,
            "PARSE_FAILURE.SCHEMA_INVALID",
            _json_pointer(error.absolute_path),
            error.message,
        )
    if issues:
        return sorted(issues)
    expected_id = expected_parse_failure_id(report)
    if report["failureId"] != expected_id:
        _issue(
            issues,
            "PARSE_FAILURE.ID_MISMATCH",
            "/failureId",
            f"expected {expected_id}",
        )
    return sorted(issues)


def validate_writer_provenance_manifest(
    manifest: Mapping[str, Any], *, contract_root: Path
) -> list[ContractIssue]:
    schema = load_json(contract_root / "schema" / "writer-provenance-manifest.schema.json")
    issues: list[ContractIssue] = []
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    for error in validator.iter_errors(manifest):
        _issue(
            issues,
            "WRITER_MANIFEST.SCHEMA_INVALID",
            _json_pointer(error.absolute_path),
            error.message,
        )
    if issues:
        return sorted(issues)

    normalized_paths: list[str] = []
    contract_root_resolved = contract_root.resolve()
    for index, artifact in enumerate(manifest["generatedArtifacts"]):
        path = f"/generatedArtifacts/{index}"
        try:
            normalized = normalize_relative_path(artifact["normalizedPath"])
            normalized_paths.append(normalized)
            if normalized != artifact["normalizedPath"]:
                _issue(
                    issues,
                    "WRITER_MANIFEST.PATH_NOT_CANONICAL",
                    f"{path}/normalizedPath",
                    f"expected {normalized}",
                )
            resolved = (contract_root_resolved / normalized).resolve()
            if contract_root_resolved not in resolved.parents:
                raise ValueError("generated artifact path escapes contract root")
            payload = resolved.read_bytes()
            actual_hash = sha256_bytes(payload)
            if artifact["sha256"] != actual_hash:
                _issue(
                    issues,
                    "WRITER_MANIFEST.ARTIFACT_HASH_MISMATCH",
                    f"{path}/sha256",
                    f"expected {actual_hash}",
                )
            if artifact["byteLength"] != len(payload):
                _issue(
                    issues,
                    "WRITER_MANIFEST.ARTIFACT_LENGTH_MISMATCH",
                    f"{path}/byteLength",
                    f"expected {len(payload)}",
                )
        except (OSError, ValueError) as exc:
            _issue(
                issues,
                "WRITER_MANIFEST.ARTIFACT_UNREADABLE",
                f"{path}/normalizedPath",
                str(exc),
            )
    _check_unique(
        normalized_paths,
        "WRITER_MANIFEST.DUPLICATE_PATH",
        "/generatedArtifacts",
        issues,
    )
    for index, mapping in enumerate(manifest["unitMappings"]):
        try:
            normalize_relative_path(mapping["generatedPath"])
        except ValueError as exc:
            _issue(
                issues,
                "WRITER_MANIFEST.PATH_INVALID",
                f"/unitMappings/{index}/generatedPath",
                str(exc),
            )
    for index, mapping in enumerate(manifest["assetMappings"]):
        try:
            normalize_relative_path(mapping["generatedPath"])
        except ValueError as exc:
            _issue(
                issues,
                "WRITER_MANIFEST.PATH_INVALID",
                f"/assetMappings/{index}/generatedPath",
                str(exc),
            )

    try:
        expected_package_hash = expected_writer_generated_package_hash(manifest)
        if manifest["generatedPackageHash"] != expected_package_hash:
            _issue(
                issues,
                "WRITER_MANIFEST.PACKAGE_HASH_MISMATCH",
                "/generatedPackageHash",
                f"expected {expected_package_hash}",
            )
    except ValueError as exc:
        _issue(issues, "WRITER_MANIFEST.PATH_INVALID", "/generatedArtifacts", str(exc))
    expected_manifest_id = expected_writer_manifest_id(manifest)
    if manifest["manifestId"] != expected_manifest_id:
        _issue(
            issues,
            "WRITER_MANIFEST.ID_MISMATCH",
            "/manifestId",
            f"expected {expected_manifest_id}",
        )
    return sorted(issues)
