#!/usr/bin/env python3
"""Build an offline verification snapshot. Standard library only; no network."""
import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path


def records(path, key):
    if not path:
        return []
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    value = value.get(key) if isinstance(value, dict) else value
    if not isinstance(value, list):
        raise ValueError(f"{key}: expected an array or object containing that array")
    unique(value, key)
    return value


def unique(rows, label):
    if not isinstance(rows, list):
        raise ValueError(f"{label}: expected an array")
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("id"), str) or not row["id"].strip():
            raise ValueError(f"{label}: every record needs a nonempty string id")
        if row["id"] in seen:
            raise ValueError(f"{label}: duplicate id {row['id']}")
        seen.add(row["id"])
    return seen


QUALIFIED_ID = r"[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*"


def markdown_cells(line):
    """Split a GFM table row, preserving escaped pipes inside a cell."""
    raw = line.strip()
    cells, cell = [], []
    for char in raw:
        if char == "|":
            slashes = 0
            for previous in reversed(cell):
                if previous != "\\":
                    break
                slashes += 1
            if slashes % 2:
                cell.pop()  # Markdown's escape belongs to the literal pipe.
                cell.append("|")
            else:
                cells.append("".join(cell).strip())
                cell = []
        else:
            cell.append(char)
    if not cells:
        return None
    cells.append("".join(cell).strip())
    if raw.startswith("|"):
        cells.pop(0)
    if not cells[-1] and raw.endswith("|"):
        cells.pop()
    return cells


def identifier_cell(value):
    # A single inline-code wrapper does not change an identifier's meaning.
    match = re.fullmatch(r"`([^`]+)`", value)
    return match.group(1).strip() if match else value


def parse_contract(text):
    catalog = {"nodes": [], "edges": [], "scenarios": [], "rules": []}
    table = None
    section = None
    fence = None
    headers = {"nodes": ("nodeId", {4}), "edges": ("edgeId", {5, 7}),
               "scenarios": ("编号", {3}), "rules": ("规则", {3})}

    def finish_table():
        if table and (table["separator"] or not table["rows"]):
            raise ValueError(f"line {table['line']}: {table['kind']} table is incomplete")

    for number, line in enumerate(text.splitlines(), 1):
        raw = line.strip()
        marker = re.match(r"^(`{3,}|~{3,})", raw)
        if fence:
            if marker and marker.group(1)[0] == fence[0] and len(marker.group(1)) >= len(fence):
                fence = None
            continue
        if marker:
            finish_table()
            table = None
            fence = marker.group(1)
            continue
        heading = re.match(r"^##\s+(.+)$", raw)
        if heading:
            finish_table()
            table = None
            title = heading.group(1)
            appendix = re.match(r"附录\s+([ACD])(?:[.．、\s]|$)", title)
            section = ({"A": "nodes", "C": "edges", "D": "scenarios"}[appendix.group(1)]
                       if appendix else "rules" if re.match(r"2[.．]\s*", title) else None)
            continue
        if section is None:
            continue
        cells = markdown_cells(line)
        if cells is None:
            finish_table()
            table = None
            # A damaged record must not silently become explanatory prose.
            if re.match(rf"^`?(?:{QUALIFIED_ID}|V\d+|R\d+)`?(?:\s|$)", raw):
                raise ValueError(f"line {number}: catalog record is not a complete table row")
            continue
        if table is None:
            first = identifier_cell(cells[0]) if cells else ""
            label, widths = headers[section]
            if section == "rules" and first != label:
                if re.match(r"R\d+\b", first):
                    raise ValueError(f"line {number}: rule record has no recognized table header")
                continue  # Other prose tables in section 2 are not rule catalogs.
            if first != label or len(cells) not in widths or not all(cells):
                raise ValueError(f"line {number}: invalid {section} table header or column count")
            table = dict(kind=section, width=len(cells), line=number, separator=True, rows=0)
            continue
        if len(cells) != table["width"]:
            raise ValueError(f"line {number}: {section} row needs {table['width']} columns, got {len(cells)}")
        if table["separator"]:
            if not all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
                raise ValueError(f"line {number}: invalid {section} table separator")
            table["separator"] = False
            continue
        if not all(cells):
            raise ValueError(f"line {number}: {section} row has an empty required cell")
        key = identifier_cell(cells[0])
        if section in {"nodes", "edges"} and not re.fullmatch(QUALIFIED_ID, key):
            raise ValueError(f"line {number}: invalid {section} identifier {key!r}")
        if section == "nodes":
            row = dict(id=key, scope=cells[1], inputOutput=cells[2], successCriterion=cells[3])
        elif section == "edges":
            row = dict(id=key, kind=cells[1], endpointTemplate=cells[2], activation=cells[4] if len(cells) == 7 else cells[3], readback=cells[-1])
            if len(cells) == 7:
                row.update(artifactBinding=cells[3], changeImpact=cells[5])
        elif section == "scenarios":
            if not re.fullmatch(r"V\d+", key):
                raise ValueError(f"line {number}: invalid scenario identifier {key!r}")
            row = dict(id=key, scenario=cells[1], expected=cells[2], nodeIds=[], edgeIds=[], ruleIds=[])
        else:
            rule = re.fullmatch(r"(R\d+)\s+(.+)", key)
            if not rule:
                raise ValueError(f"line {number}: rule needs an identifier and title")
            row = dict(id=rule.group(1), title=rule.group(2), meaning=cells[1], detail=cells[2])
        catalog[section].append(row)
        table["rows"] += 1
    if fence:
        raise ValueError("contract has an unclosed code fence")
    finish_table()
    for name, rows in catalog.items():
        if not rows:
            raise ValueError(f"{name}: a nonempty catalog table is required")
        unique(rows, name)
    return catalog


def defaults():
    result = []
    for bid, title, nodes, edges, scenarios in [
        ("research.overall", "JobAid 保存 → Overall 实际消费", ["assessment.research", "assessment.overall"], ["research.overall"], ["V12"]),
        ("translation.reading", "翻译块保存 → 检查/选用 → 阅读", ["document.translation", "surface.reading"], ["artifact.reading"], ["V04", "V05"]),
        ("save.finish", "业务保存 → 执行收尾", [], [], ["V08", "V10"]),
    ]:
        result.append(dict(id=bid, title=title, nodeIds=nodes, edgeIds=edges, consistencyScenarioIds=scenarios, sourceRevision=None, consumer=None, authority=dict(requestRecord=None, artifactRecord=None, consumedInputField=None), executionOwner=None, decisionEntry=None, projectionEntry=None, readEntry=None, actionEntries=None))
    return result


def validate(data):
    if not isinstance(data, dict) or type(data.get("formatVersion")) is not int or data["formatVersion"] != 1:
        raise ValueError("snapshot: unsupported formatVersion")
    snapshot = data.get("snapshot")
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get("contract"), dict):
        raise ValueError("snapshot.contract: complete contract identity is required")
    if not isinstance(snapshot.get("generatedAt"), str) or not snapshot["generatedAt"].strip():
        raise ValueError("snapshot.generatedAt: a generation timestamp is required")
    if (snapshot.get("dataMode") not in ("snapshot", "demo")
            or ("mode" in snapshot and snapshot["mode"] not in ("snapshot", "demo"))):
        raise ValueError("snapshot: mode must describe an offline snapshot or demo")
    contract = snapshot["contract"]
    for field in ("version", "source"):
        if not isinstance(contract.get(field), str) or not contract[field].strip():
            raise ValueError(f"snapshot.contract.{field}: nonempty string required")
    if (contract.get("sourceRevisionType") != "sha256"
            or not isinstance(contract.get("sourceRevision"), str)
            or not re.fullmatch(r"[0-9a-f]{64}", contract["sourceRevision"])):
        raise ValueError("snapshot.contract: an explicit SHA256 identity is required")
    target = snapshot.get("target")
    if not isinstance(target, dict):
        raise ValueError("snapshot.target: expected object")
    for field in ("sourceRevision", "environmentId"):
        if field not in target or (target[field] is not None and (not isinstance(target[field], str) or not target[field].strip())):
            raise ValueError(f"snapshot.target.{field}: expected nonempty string or null")
    cat = data["catalog"]
    if not isinstance(cat, dict):
        raise ValueError("catalog: expected object")
    indexes = {name: unique(cat[name], name) for name in ("nodes", "edges", "scenarios", "rules")}
    if any(not values for values in indexes.values()):
        raise ValueError("catalog: nodes, edges, scenarios and rules must each be nonempty")
    indexes["bindings"] = unique(data["bindings"], "bindings")
    indexes["workPackages"] = unique(snapshot.get("workPackages", []), "snapshot.workPackages")
    for package in snapshot.get("workPackages", []):
        if not isinstance(package.get("label"), str) or not package["label"].strip():
            raise ValueError(f"work package {package['id']}: nonempty label required")
        if "nextAction" in package and (not isinstance(package["nextAction"], str) or not package["nextAction"].strip()):
            raise ValueError(f"work package {package['id']}: nonempty nextAction required")
    for binding in data["bindings"]:
        gaps = binding.get("gaps", [])
        unique(gaps, f"binding {binding['id']} gaps")
        for gap in gaps:
            if gap.get("kind") not in {"source_review", "test", "deployment", "runtime"}:
                raise ValueError(f"gap {gap['id']}: invalid kind")
            for field in ("reason", "nextAction"):
                if not isinstance(gap.get(field), str) or not gap[field].strip():
                    raise ValueError(f"gap {gap['id']}: nonempty {field} required")
    unique(data["evidence"], "evidence")
    selection = data.get("selection")
    if (not isinstance(selection, dict)
            or set(selection) != {"changedNodeIds", "changedEdgeIds", "scenarioIds", "reason"}
            or not isinstance(selection.get("reason"), str)):
        raise ValueError("selection: explicit changedNodeIds/changedEdgeIds/scenarioIds arrays and reason required")
    relation_fields = {"nodeIds": "nodes", "changedNodeIds": "nodes", "edgeIds": "edges", "changedEdgeIds": "edges", "scenarioIds": "scenarios", "consistencyScenarioIds": "scenarios", "ruleIds": "rules", "bindingIds": "bindings"}
    relation_fields["workPackageIds"] = "workPackages"

    def visit(value, location):
        if isinstance(value, dict):
            for key, item in value.items():
                if key in relation_fields:
                    if not isinstance(item, list) or any(not isinstance(v, str) for v in item):
                        raise ValueError(f"{location}.{key}: expected string array")
                    for ref in item:
                        if ref not in indexes[relation_fields[key]]:
                            raise ValueError(f"{location}.{key}: dangling reference {ref}")
                if key.endswith("At") and item not in (None, ""):
                    if not isinstance(item, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})", item):
                        raise ValueError(f"{location}.{key}: expected timezone-qualified ISO timestamp")
                    offset = re.search(r"[+-](\d{2}):(\d{2})$", item)
                    if offset and (int(offset.group(1)) >= 24 or int(offset.group(2)) >= 60):
                        raise ValueError(f"{location}.{key}: invalid timezone offset")
                    datetime.fromisoformat(item.replace("Z", "+00:00"))
                visit(item, f"{location}.{key}")
        elif isinstance(value, list):
            for i, item in enumerate(value):
                visit(item, f"{location}[{i}]")

    visit(data, "snapshot")
    for row in data["evidence"]:
        if row.get("kind") not in {"source_review", "test", "deployment", "runtime"}:
            raise ValueError(f"evidence {row['id']}: invalid kind")
        if row.get("status") not in {"not_run", "passed", "failed", "inconclusive", "not_applicable"}:
            raise ValueError(f"evidence {row['id']}: invalid status")
        for field in ("contractRevision", "sourceRevision", "environmentId", "deploymentRef", "subjectRef", "requestRef", "readbackRef", "reportRef", "testLevel", "summary"):
            if row.get(field) is not None and not isinstance(row[field], str):
                raise ValueError(f"evidence {row['id']}: {field} must be a string or null")
        if row.get("testLevel") not in (None, "", "unit", "contract", "integration", "e2e"):
            raise ValueError(f"evidence {row['id']}: invalid testLevel")
        for field in ("inputRefs", "outputRefs"):
            refs = row.get(field)
            if refs is not None and (not isinstance(refs, list) or any(not isinstance(ref, str) or not ref.strip() for ref in refs)):
                raise ValueError(f"evidence {row['id']}: {field} must be an array of nonempty references or null")
        # Missing historical evidence stays missing. No status is promoted here;
        # current matching and sufficiency belong to the read-only renderer.
    # Validate explicit identifiers while keeping composite/natural-language endpoints opaque.
    ports = {"input.sources", "input.tdms_documents", "input.target_facts", "input.references", "input.engineer", "input.business_records", "input.lcm_configuration", "input.policy", "control.execution", "control.authorization"}
    for edge in cat["edges"]:
        for endpoint in re.findall(rf"\b{QUALIFIED_ID}\b", edge["endpointTemplate"]):
            if endpoint not in indexes["nodes"] | ports:
                raise ValueError(f"edge {edge['id']}: dangling endpoint {endpoint}")


def build(contract, output, evidence_path=None, bindings_path=None, source_revision=None, environment=None, selection_path=None, work_packages_path=None):
    raw = Path(contract).read_bytes()
    text = raw.decode("utf-8-sig")
    catalog = parse_contract(text)
    bindings = {row["id"]: row for row in defaults()}
    # Supplied records replace same-ID defaults; records are not silently field-merged.
    for row in records(bindings_path, "bindings"):
        bindings[row["id"]] = row
    version = re.search(r"^[ \t]*版本[ \t]*[：:][ \t]*([^·\r\n]*)", text, re.M)
    if not version or not version.group(1).strip():
        raise ValueError("contract: a nonempty declared version is required")
    selection = dict(changedNodeIds=[], changedEdgeIds=[], scenarioIds=[], reason="尚未选择本次验收场景")
    if selection_path:
        supplied = json.loads(Path(selection_path).read_text(encoding="utf-8"))
        if not isinstance(supplied, dict) or set(supplied) - set(selection):
            raise ValueError("selection: expected object with changedNodeIds/changedEdgeIds/scenarioIds/reason only")
        selection.update(supplied)
    if not isinstance(selection["reason"], str):
        raise ValueError("selection.reason: expected string")
    for label, value in (("source-revision", source_revision), ("environment", environment)):
        if value is not None and (not isinstance(value, str) or not value.strip()):
            raise ValueError(f"{label}: expected nonempty string when supplied")
    data = dict(formatVersion=1, snapshot=dict(dataMode="snapshot", generatedAt=datetime.now(timezone.utc).isoformat(), contract=dict(version=version.group(1).strip(), source=Path(contract).name, sourceRevision=hashlib.sha256(raw).hexdigest(), sourceRevisionType="sha256"), target=dict(sourceRevision=source_revision, environmentId=environment)), catalog=catalog, bindings=list(bindings.values()), selection=selection, evidence=records(evidence_path, "evidence"))
    if work_packages_path:
        data["snapshot"]["workPackages"] = records(work_packages_path, "workPackages")
    validate(data)
    Path(output).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--evidence")
    parser.add_argument("--bindings")
    parser.add_argument("--source-revision", help="Explicit target source commit; never inferred from evidence")
    parser.add_argument("--environment", help="Explicit target environment id")
    parser.add_argument("--selection", help="JSON object selecting changed nodes/edges and scenarios")
    parser.add_argument("--work-packages", help="Work-package records for filtering; does not change evidence or selected scenarios")
    args = parser.parse_args()
    try:
        data = build(args.contract, args.output, args.evidence, args.bindings, args.source_revision, args.environment, args.selection, args.work_packages)
    except (ValueError, OSError, KeyError, TypeError, IndexError) as exc:
        print(f"validation failed: {exc}", file=sys.stderr)
        return 2
    print(f"Snapshot written: {len(data['catalog']['nodes'])} nodes, {len(data['catalog']['edges'])} edge templates, {len(data['catalog']['scenarios'])} scenarios; {len(data['evidence'])} evidence records")
    return 0


if __name__ == "__main__":
    sys.exit(main())
