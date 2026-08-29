from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator
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
    refresh_integrity,
    sha256_object,
    sha256_text,
    validate_artifact_record,
    validate_package,
    validate_parse_failure_report,
    validate_writer_provenance_manifest,
)
from scripts.version_dispatch import read_versioned_package


CONTRACT_ROOT = Path(__file__).resolve().parents[1]


def issue_codes(report, severity: str = "error") -> set[str]:
    return {item.code for item in report.issues if item.severity == severity}


class ContractConformanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.manifest = load_json(CONTRACT_ROOT / "fixtures/manifest.json")

    def test_all_schemas_are_valid_draft_2020_12(self) -> None:
        paths = [
            "schema/parsed-package.schema.json",
            "schema/artifact-record.schema.json",
            "schema/parse-failure-report.schema.json",
            "schema/writer-provenance-manifest.schema.json",
            "schema/extension-registry.schema.json",
            "extensions/review-note.schema.json",
            "extensions/pdf-visual-lineage.schema.json",
            "extensions/s1000d-native-lineage.schema.json",
        ]
        for relative in paths:
            with self.subTest(relative=relative):
                Draft202012Validator.check_schema(load_json(CONTRACT_ROOT / relative))

    def test_fixture_generator_is_byte_deterministic(self) -> None:
        for relative, expected in expected_source_outputs().items():
            with self.subTest(relative=relative.as_posix()):
                self.assertEqual((CONTRACT_ROOT / relative).read_bytes(), expected)

    def test_frozen_contract_manifest_binds_all_executable_and_fixture_bytes(self) -> None:
        expected = expected_freeze_manifest(CONTRACT_ROOT)
        self.assertEqual(expected["contractRevision"], "frozen.2")
        self.assertEqual(
            expected["contractSchemaId"],
            "urn:techpub:schema:v1:parsed-package:frozen-2",
        )
        self.assertEqual(
            (CONTRACT_ROOT / FREEZE_MANIFEST_RELATIVE).read_bytes(),
            render_freeze_manifest(expected),
        )
        for relative, expected in expected_outputs(CONTRACT_ROOT).items():
            with self.subTest(relative=relative.as_posix()):
                self.assertEqual((CONTRACT_ROOT / relative).read_bytes(), expected)

    def test_pdf_source_fixture_is_readable_and_has_expected_text(self) -> None:
        reader = PdfReader(CONTRACT_ROOT / "fixtures/source/minimal-pdf.pdf", strict=True)
        self.assertEqual(len(reader.pages), 1)
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
        self.assertIn("Controlled contract fixture", text)
        self.assertIn("Disconnect electrical power.", text)

    def test_positive_packages_validate_and_read_through_one_reader(self) -> None:
        observed_kinds = set()
        for item in self.manifest["positivePackages"]:
            with self.subTest(path=item["packagePath"]):
                path = CONTRACT_ROOT / item["packagePath"]
                package = load_json(path)
                report = validate_package(
                    package,
                    contract_root=CONTRACT_ROOT,
                    artifact=item["packagePath"],
                    mode="strict",
                )
                self.assertTrue(report.ok, report.as_dict())
                reader = read_parsed_package(
                    path, contract_root=CONTRACT_ROOT, mode="strict"
                )
                summary = reader.summary()
                self.assertEqual(summary["sourceKind"], item["sourceKind"])
                self.assertEqual(summary["result"]["status"], "complete")
                if "rich-native" not in item["packagePath"]:
                    self.assertEqual(
                        [unit["kind"] for unit in reader.package["contentUnits"]],
                        ["heading", "paragraph"],
                    )
                observed_kinds.add(summary["sourceKind"])
        self.assertEqual(observed_kinds, {"pdf", "native_s1000d"})

    def test_frozen_2_public_deltas_are_present_without_pdf_s1000d_fabrication(self) -> None:
        pdf = load_json(CONTRACT_ROOT / "fixtures/positive/minimal-pdf-complete.json")
        native = load_json(
            CONTRACT_ROOT / "fixtures/positive/rich-native-s1000d-issue-4-2.json"
        )
        self.assertEqual(pdf["applicability"]["assignments"], [])
        self.assertFalse(
            any(
                item["namespace"] == "urn:techpub:ext:s1000d-native-lineage:v1"
                for item in pdf["extensions"]
            )
        )
        self.assertEqual(
            native["applicability"]["sourceExpressions"][0]["form"],
            "logical_expression",
        )
        self.assertEqual(len(native["applicability"]["assignments"]), 1)
        table = next(item for item in native["contentUnits"] if item["kind"] == "table")
        self.assertEqual(len(table["payload"]["columns"]), table["payload"]["columnCount"])
        self.assertEqual(
            native["extensions"][0]["schemaId"],
            "urn:techpub:schema:v1:extension:s1000d-native-lineage:frozen-2",
        )
        reader = read_parsed_package(
            CONTRACT_ROOT / "fixtures/positive/rich-native-s1000d-issue-4-2.json",
            contract_root=CONTRACT_ROOT,
        )
        self.assertEqual(len(reader.applicability_assignments(target_kind="module")), 1)
        self.assertEqual(len(reader.table_columns(table["unitId"])), 2)
        self.assertEqual(reader.summary()["counts"]["applicabilityAssignments"], 1)

    def test_assignment_and_table_columns_change_semantic_hash(self) -> None:
        base = load_json(
            CONTRACT_ROOT / "fixtures/positive/rich-native-s1000d-issue-4-2.json"
        )
        assignment_change = copy.deepcopy(base)
        assignment_change["applicability"]["assignments"][0][
            "sourceReferenceId"
        ] = "app-fixture-2"
        refresh_integrity(assignment_change)
        self.assertNotEqual(
            base["integrity"]["semanticHash"],
            assignment_change["integrity"]["semanticHash"],
        )

        column_change = copy.deepcopy(base)
        table = next(
            item for item in column_change["contentUnits"] if item["kind"] == "table"
        )
        table["payload"]["columns"][0]["width"] = "2*"
        refresh_integrity(column_change)
        self.assertNotEqual(
            base["integrity"]["semanticHash"],
            column_change["integrity"]["semanticHash"],
        )

    def test_native_raw_table_style_is_nonsemantic_lineage(self) -> None:
        base = load_json(
            CONTRACT_ROOT / "fixtures/positive/rich-native-s1000d-issue-4-2.json"
        )
        changed = copy.deepcopy(base)
        extension = changed["extensions"][0]
        extension["payload"]["tableSourceStyles"][0]["frame"] = "topbot"
        extension["payloadHash"] = sha256_object(extension["payload"])
        refresh_integrity(changed)
        self.assertEqual(
            base["integrity"]["semanticHash"], changed["integrity"]["semanticHash"]
        )
        self.assertNotEqual(
            base["integrity"]["provenanceHash"],
            changed["integrity"]["provenanceHash"],
        )

    def test_reader_dispatches_frozen_1_and_frozen_2_explicitly(self) -> None:
        frozen_root = CONTRACT_ROOT.parent / "v1"
        candidate = read_versioned_package(
            CONTRACT_ROOT / "fixtures/positive/minimal-pdf-complete.json",
            candidate_contract_root=CONTRACT_ROOT,
            frozen_contract_root=frozen_root,
        )
        frozen = read_versioned_package(
            frozen_root / "fixtures/positive/minimal-pdf-complete.json",
            candidate_contract_root=CONTRACT_ROOT,
            frozen_contract_root=frozen_root,
        )
        self.assertEqual(candidate.selected_revision, "frozen.2")
        self.assertEqual(frozen.selected_revision, "frozen.1")
        self.assertEqual(candidate.reader.package["applicability"]["assignments"], [])
        self.assertNotIn("assignments", frozen.reader.package["applicability"])

    def test_reader_rejects_mixed_revision_in_strict_and_forensic_modes(self) -> None:
        path = CONTRACT_ROOT / "fixtures/negative/contract-revision-mismatch.json"
        frozen_root = CONTRACT_ROOT.parent / "v1"
        for mode in ("strict", "forensic"):
            with self.subTest(mode=mode), self.assertRaisesRegex(
                ValueError, "CONTRACT.REVISION_MISMATCH"
            ):
                read_versioned_package(
                    path,
                    candidate_contract_root=CONTRACT_ROOT,
                    frozen_contract_root=frozen_root,
                    mode=mode,
                )
        unsupported_path = (
            CONTRACT_ROOT / "fixtures/negative/contract-revision-unsupported.json"
        )
        for mode in ("strict", "forensic"):
            with self.subTest(mode=mode, revision="unsupported"), self.assertRaisesRegex(
                ValueError, "CONTRACT.REVISION_UNSUPPORTED"
            ):
                read_versioned_package(
                    unsupported_path,
                    candidate_contract_root=CONTRACT_ROOT,
                    frozen_contract_root=frozen_root,
                    mode=mode,
                )

    def test_positive_artifact_records_bind_actual_package_bytes(self) -> None:
        for item in self.manifest["positivePackages"]:
            with self.subTest(path=item["artifactRecordPath"]):
                issues = validate_artifact_record(
                    load_json(CONTRACT_ROOT / item["artifactRecordPath"]),
                    contract_root=CONTRACT_ROOT,
                    artifact_path=CONTRACT_ROOT / item["packagePath"],
                )
                self.assertEqual(issues, [])

    def test_negative_manifest_has_exact_stable_error_code_sets(self) -> None:
        for item in self.manifest["negativePackages"]:
            with self.subTest(name=item["name"]):
                package = load_json(CONTRACT_ROOT / item["packagePath"])
                report = validate_package(
                    package,
                    contract_root=CONTRACT_ROOT,
                    artifact=item["packagePath"],
                    mode="strict",
                )
                self.assertEqual(issue_codes(report), set(item["strictErrors"]))

    def test_unknown_extension_is_warning_only_in_forensic_mode(self) -> None:
        item = next(
            value
            for value in self.manifest["negativePackages"]
            if value["name"] == "unknown-extension"
        )
        package = load_json(CONTRACT_ROOT / item["packagePath"])
        strict = validate_package(
            package, contract_root=CONTRACT_ROOT, artifact=item["packagePath"], mode="strict"
        )
        forensic = validate_package(
            package,
            contract_root=CONTRACT_ROOT,
            artifact=item["packagePath"],
            mode="forensic",
        )
        self.assertEqual(issue_codes(strict), {"EXTENSION.UNKNOWN_SCHEMA"})
        self.assertEqual(issue_codes(forensic), set())
        self.assertEqual(issue_codes(forensic, "warning"), {"EXTENSION.UNKNOWN_SCHEMA"})

    def test_duplicate_json_keys_fail_before_schema_validation(self) -> None:
        with self.assertRaises(DuplicateKeyError):
            load_json(CONTRACT_ROOT / "fixtures/negative/duplicate-key.json")

    def test_python_jcs_vectors_and_restricted_domain(self) -> None:
        vectors = load_json(
            CONTRACT_ROOT / self.manifest["canonicalizationVectors"]
        )["vectors"]
        for vector in vectors:
            with self.subTest(name=vector["name"]):
                canonical = jcs_restricted(vector["input"])
                self.assertEqual(canonical, vector["expectedCanonicalUtf8"])
                self.assertEqual(sha256_text(canonical), vector["expectedSha256"])
        with self.assertRaisesRegex(ValueError, "floats are forbidden"):
            jcs_restricted(1.5)
        with self.assertRaisesRegex(ValueError, "safe range"):
            jcs_restricted(9_007_199_254_740_992)
        with self.assertRaisesRegex(ValueError, "lone surrogate"):
            jcs_restricted("\ud800")

    def test_generated_at_and_artifact_location_do_not_change_immutable_identity(self) -> None:
        package = load_json(CONTRACT_ROOT / "fixtures/positive/minimal-pdf-complete.json")
        original_id = package["packageId"]
        original_integrity = copy.deepcopy(package["integrity"])
        package["lineage"]["generatedAt"] = "2030-01-01T00:00:00Z"
        package["artifacts"][0]["artifactRef"] = "memory://same-pdf-bytes"
        refresh_integrity(package)
        self.assertEqual(package["packageId"], original_id)
        self.assertEqual(package["integrity"], original_integrity)
        report = validate_package(
            package,
            contract_root=CONTRACT_ROOT,
            artifact="in-memory-location-independent-package",
        )
        self.assertTrue(report.ok, report.as_dict())

    def test_nonsemantic_visual_lineage_changes_provenance_not_semantics(self) -> None:
        plain = load_json(CONTRACT_ROOT / "fixtures/positive/minimal-pdf-complete.json")
        visual = load_json(
            CONTRACT_ROOT / "fixtures/positive/minimal-pdf-visual-lineage.json"
        )
        self.assertEqual(
            plain["integrity"]["semanticHash"], visual["integrity"]["semanticHash"]
        )
        self.assertNotEqual(
            plain["integrity"]["provenanceHash"], visual["integrity"]["provenanceHash"]
        )
        self.assertNotEqual(plain["packageId"], visual["packageId"])

    def test_currentness_is_external_and_rejected_as_package_content(self) -> None:
        package = load_json(CONTRACT_ROOT / "fixtures/positive/minimal-pdf-complete.json")
        package["current"] = True
        report = validate_package(
            package, contract_root=CONTRACT_ROOT, artifact="currentness-mutation"
        )
        self.assertEqual(issue_codes(report), {"SCHEMA.INVALID"})

    def test_pdf_character_offsets_are_explicit_unicode_scalar_ranges(self) -> None:
        package = load_json(CONTRACT_ROOT / "fixtures/positive/minimal-pdf-complete.json")
        package["sourceRefs"][0]["charStart"] = 0
        report = validate_package(
            package, contract_root=CONTRACT_ROOT, artifact="partial-char-range"
        )
        self.assertEqual(issue_codes(report), {"SCHEMA.INVALID"})

    def test_bbox_is_page_specific(self) -> None:
        package = load_json(CONTRACT_ROOT / "fixtures/positive/minimal-pdf-complete.json")
        package["sourceRefs"][0]["pageEnd"] = 2
        report = validate_package(
            package, contract_root=CONTRACT_ROOT, artifact="cross-page-bbox"
        )
        self.assertIn("LOCATOR.BBOX_REQUIRES_SINGLE_PAGE", issue_codes(report))

    def test_forensic_mode_never_allows_authority_claims(self) -> None:
        package = load_json(CONTRACT_ROOT / "fixtures/negative/unknown-extension.json")
        package["extensions"][0]["payload"] = {"approved": True}
        package["extensions"][0]["payloadHash"] = sha256_object(
            package["extensions"][0]["payload"]
        )
        refresh_integrity(package)
        report = validate_package(
            package,
            contract_root=CONTRACT_ROOT,
            artifact="forensic-authority-claim",
            mode="forensic",
        )
        self.assertIn("AUTHORITY.FORBIDDEN_FIELD", issue_codes(report))

    def test_support_documents_validate_with_actual_output_bytes(self) -> None:
        failure = load_json(
            CONTRACT_ROOT / self.manifest["supportDocuments"]["parseFailureReport"]
        )
        writer = load_json(
            CONTRACT_ROOT / self.manifest["supportDocuments"]["writerProvenanceManifest"]
        )
        self.assertEqual(
            validate_parse_failure_report(failure, contract_root=CONTRACT_ROOT), []
        )
        self.assertEqual(
            validate_writer_provenance_manifest(writer, contract_root=CONTRACT_ROOT), []
        )
        for relative in self.manifest["supportDocuments"]["nativeParseFailureReports"]:
            with self.subTest(relative=relative):
                self.assertEqual(
                    validate_parse_failure_report(
                        load_json(CONTRACT_ROOT / relative), contract_root=CONTRACT_ROOT
                    ),
                    [],
                )

    def test_rich_native_fixture_exercises_s1000d_projection(self) -> None:
        path = CONTRACT_ROOT / "fixtures/positive/rich-native-s1000d-issue-4-2.json"
        package = load_json(path)
        reader = read_parsed_package(path, contract_root=CONTRACT_ROOT, mode="strict")
        self.assertEqual(reader.summary()["result"]["status"], "complete")
        self.assertEqual(len(package["modules"]), 2)
        self.assertEqual(len(package["source"]["deliveryObjects"]), 2)
        self.assertEqual(len(package["publicationStructures"]), 1)
        self.assertEqual(len(package["contentUnits"]), 13)
        self.assertEqual(len(package["sourceSegments"]), 24)
        self.assertEqual(len(package["references"]), 4)
        self.assertEqual(len(package["assets"]), 1)
        self.assertEqual(
            {unit["kind"] for unit in package["contentUnits"]},
            {
                "heading",
                "paragraph",
                "step",
                "advisory",
                "list",
                "list_item",
                "table",
                "figure",
                "reference",
            },
        )
        self.assertEqual(
            {unit["payload"]["advisoryType"] for unit in package["contentUnits"] if unit["kind"] == "advisory"},
            {"warning", "caution", "note"},
        )
        self.assertEqual(
            {reference["resolutionStatus"] for reference in package["references"]},
            {"resolved", "external"},
        )
        self.assertEqual(len(package["applicability"]["sourceExpressions"]), 1)
        self.assertEqual(len(package["applicability"]["normalizedCandidates"]), 1)
        self.assertEqual(
            package["applicability"]["normalizedCandidates"][0]["authority"],
            "parser_candidate",
        )

    def test_native_snapshot_and_real_baseline_have_bounded_claims(self) -> None:
        snapshot = load_json(
            CONTRACT_ROOT / "fixtures/source/native-s1000d-issue-4-2.parsed.json"
        )
        baseline = load_json(
            CONTRACT_ROOT / "fixtures/source/real-issue-4-2-baseline.summary.json"
        )
        package = load_json(
            CONTRACT_ROOT / "fixtures/positive/rich-native-s1000d-issue-4-2.json"
        )
        self.assertEqual(
            snapshot["package"]["source"],
            "contract://fixtures/source/native-s1000d-issue-4-2",
        )
        self.assertEqual(snapshot["summary"]["moduleCount"], 4)
        self.assertEqual(snapshot["summary"]["findingCount"], 0)
        self.assertEqual(baseline["counts"]["files"], 73)
        self.assertEqual(baseline["counts"]["publicationModules"], 0)
        self.assertEqual(
            baseline["sourcePolicy"],
            "controlled_local_path_no_manufacturer_body_committed",
        )
        self.assertEqual(
            set(baseline),
            {
                "schemaVersion",
                "sourcePolicy",
                "profileVersion",
                "parserPackageHash",
                "counts",
                "contentUnitCounts",
                "referenceCounts",
                "applicabilityShapeCounts",
                "verification",
            },
        )
        baseline_text = json.dumps(baseline).lower()
        self.assertNotIn("sourcepath", baseline_text)
        self.assertNotIn("package.source", baseline_text)
        self.assertNotEqual(
            package["source"]["sourcePackageHash"], snapshot["package"]["hash"]
        )
        self.assertEqual(
            package["source"]["legacyIdentifiers"][0]["value"],
            snapshot["package"]["hash"],
        )


if __name__ == "__main__":
    unittest.main()
