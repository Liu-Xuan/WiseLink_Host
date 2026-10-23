"""Exercise snapshot parsing and import boundaries using temporary inputs only."""
import copy
import hashlib
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
from build_verification import validate  # noqa: E402

root = Path(__file__).resolve().parent
contract = Path(sys.argv[1]) if len(sys.argv) > 1 else root.parents[1] / "docs/WISELINK_MAINLINE_GRAPH_CONTRACT.md"
source = contract.read_text(encoding="utf-8-sig")
checks = []


def edit_row(text, identifier, replacement):
    pattern = re.compile(r"^\|\s*" + re.escape(identifier) + r"(?=\s|\|)")
    lines = text.splitlines(keepends=True)
    matches = [i for i, line in enumerate(lines) if pattern.match(line)]
    assert len(matches) == 1, (identifier, matches)
    index = matches[0]
    lines[index] = replacement(lines[index].rstrip("\n")) + "\n"
    return "".join(lines)


def without_records(text, identifiers):
    pattern = re.compile(r"^\|\s*(\S+)")
    return "".join(line for line in text.splitlines(keepends=True)
                   if not (pattern.match(line) and pattern.match(line).group(1) in identifiers))


with tempfile.TemporaryDirectory(prefix="wiselink-snapshot-qa-") as folder:
    work = Path(folder)
    output = work / "snapshot.json"
    selected = dict(changedNodeIds=[], changedEdgeIds=["research.overall"], scenarioIds=["V12"], reason="QA only")

    def run_case(label, *, contract_text=None, evidence=None, selection_data=None,
                 target=True, expected_error=None, bindings=None, work_packages=None):
        input_contract = contract
        if contract_text is not None:
            input_contract = work / "contract.md"
            input_contract.write_text(contract_text, encoding="utf-8")
        selection = work / "selection.json"
        selection.write_text(json.dumps(selected if selection_data is None else selection_data), encoding="utf-8")
        command = [sys.executable, str(root / "build_verification.py"), "--contract", str(input_contract),
                   "--output", str(output), "--selection", str(selection)]
        if target:
            command.extend(["--source-revision", "qa-source", "--environment", "qa-environment"])
        for flag, value in (("--evidence", evidence), ("--bindings", bindings), ("--work-packages", work_packages)):
            if value is not None:
                path = work / (flag.removeprefix("--") + ".json")
                path.write_text(json.dumps(value), encoding="utf-8")
                command.extend([flag, str(path)])
        previous = output.read_bytes() if output.exists() else None
        run = subprocess.run(command, capture_output=True, text=True)
        if expected_error:
            assert run.returncode == 2 and expected_error in run.stderr, (label, run.returncode, run.stderr)
            assert (output.read_bytes() if output.exists() else None) == previous, label
            result = None
        else:
            assert run.returncode == 0, (label, run.stderr)
            result = json.loads(output.read_text(encoding="utf-8"))
        checks.append(label)
        return result

    base = run_case("准确契约哈希、显式目标和选中场景；不生成通过证据")
    categories = ("nodes", "edges", "scenarios", "rules")
    counts = {key: len(base["catalog"][key]) for key in categories}
    assert all(counts.values())
    assert base["snapshot"]["contract"]["sourceRevision"] == hashlib.sha256(contract.read_bytes()).hexdigest()
    assert base["snapshot"]["target"] == dict(sourceRevision="qa-source", environmentId="qa-environment")
    assert base["selection"] == selected and base["evidence"] == []
    assert all(row[field] == [] for row in base["catalog"]["scenarios"] for field in ("nodeIds", "edgeIds", "ruleIds"))

    packages = [{"id": "P0", "label": "候选交付", "bindingIds": ["research.overall"], "scenarioIds": ["V12"]}]
    packaged = run_case("工作包只增加筛选信息，不推导证据或验收分母", work_packages=packages)
    assert packaged["snapshot"]["workPackages"] == packages
    assert packaged["selection"] == selected and packaged["evidence"] == []
    run_case("工作包悬空接线不被静默接受", work_packages=[{**packages[0], "bindingIds": ["missing.binding"]}], expected_error="dangling reference")
    run_case("重复工作包被拒绝且保留旧输出", work_packages=packages * 2, expected_error="duplicate id")
    run_case("缺工作包目录时拒绝悬空引用", bindings=[{"id": "research.overall", "workPackageIds": ["P0"]}], expected_error="dangling reference")
    run_case("缺口不合法时不生成无法导入的快照", bindings=[{"id": "research.overall", "gaps": [{"id": "gap1", "kind": "unknown", "reason": "", "nextAction": ""}]}], expected_error="invalid kind")
    run_case("缺口缺少下一动作被拒绝", bindings=[{"id": "research.overall", "gaps": [{"id": "gap1", "kind": "test", "reason": "缺证据", "nextAction": ""}]}], expected_error="nonempty nextAction")

    progress_package = {**packages[0], "nextAction": "核对准确请求", "progress": {
        "delivered": "本地接线已实现", "remaining": "生产读回待核对",
        "owner": "Host", "acceptance": "请求与结果准确对应", "evidenceIds": ["qa-source-review"]}}
    progress_evidence = [{"id": "qa-source-review", "kind": "source_review", "status": "passed", "bindingIds": ["research.overall"]}]
    progress_snapshot = run_case("进展摘要不改变原证据或测试范围", work_packages=[progress_package], evidence=progress_evidence)
    assert progress_snapshot["evidence"] == progress_evidence and progress_snapshot["selection"] == selected
    broken_progress = copy.deepcopy(progress_package)
    broken_progress["progress"]["evidenceIds"] = ["missing"]
    run_case("进展摘要拒绝悬空依据", work_packages=[broken_progress], evidence=progress_evidence, expected_error="dangling reference")
    broken_progress["progress"]["evidenceIds"] = []
    run_case("进展摘要必须附有依据", work_packages=[broken_progress], expected_error="progress requires evidenceIds")
    broken_progress = copy.deepcopy(progress_package)
    del broken_progress["progress"]["acceptance"]
    run_case("进展摘要必须写明完成条件", work_packages=[broken_progress], evidence=progress_evidence, expected_error="progress.acceptance required")
    broken_progress = copy.deepcopy(progress_package)
    del broken_progress["nextAction"]
    run_case("进展摘要必须给出下一步", work_packages=[broken_progress], evidence=progress_evidence, expected_error="progress requires nextAction")

    from build_previews import build as build_preview
    injection = copy.deepcopy(base)
    injection["evidence"] = [{"id": "qa-marker", "kind": "test", "status": "inconclusive", "summary": "SETUP PAYLOAD </script><script>neverRun()</script>"}]
    marker_input, marker_output = work / "markers.json", work / "markers.html"
    marker_input.write_text(json.dumps(injection), encoding="utf-8")
    component = root.parents[1] / "client/src/pages/DocumentParsingPage/runtime-monitor/wiselink-monitor.js"
    build_preview(marker_input, marker_output, component)
    html = marker_output.read_text(encoding="utf-8")
    assert ";SETUP" not in html and "m.updateInputs({allowVerification:true" in html
    assert "SETUP PAYLOAD \\u003c/script>" in html and "<script>neverRun()" not in html
    checks.append("证据中的模板标记与脚本结束符不改变页面初始化或成为脚本")

    untargeted = run_case("未指定目标仍可生成空证据目录和未选择范围", target=False, selection_data={})
    assert untargeted["snapshot"]["target"] == dict(sourceRevision=None, environmentId=None)
    assert untargeted["selection"]["scenarioIds"] == [] and untargeted["evidence"] == []

    changed_only = run_case("只声明变更边不会自动推理或补选场景", selection_data={"changedEdgeIds": ["research.overall"]})
    assert changed_only["selection"]["scenarioIds"] == []

    added = source
    for anchor, row in (
        ("source.register", "| qa.extra_node2 | 处理；隔离测试 | 输入 → 输出 | 结果可读 |"),
        ("source.intake", "| qa.extra_edge2 | 消费 | input.engineer → qa.extra_node2 | 准确输入 | 显式请求 | 有关变化 | 独立读回 |"),
        ("V54", "| V901 | 合法新增场景 | 保留准确结果 |"),
        ("R10", "| R901 合法新增规则 | 仅测试目录扩展 | QA |"),
    ):
        added = edit_row(added, anchor, lambda line, new=row: line + "\n" + new)
    expanded = run_case("四类目录均可合法新增，支持含数字的稳定ID", contract_text=added)
    assert all(len(expanded["catalog"][key]) == counts[key] + 1 for key in categories)

    removed_node = "business.adoption"
    removed_edges = {row["id"] for row in base["catalog"]["edges"] if removed_node in row["endpointTemplate"]}
    reduced_source = without_records(source, {removed_node, "V54", "R10"} | removed_edges)
    reduced = run_case("合法删除非必需目录及其关联边，不受固定数量限制", contract_text=reduced_source)
    assert len(reduced["catalog"]["nodes"]) == counts["nodes"] - 1
    assert len(reduced["catalog"]["edges"]) == counts["edges"] - len(removed_edges)
    assert len(reduced["catalog"]["scenarios"]) == counts["scenarios"] - 1
    assert len(reduced["catalog"]["rules"]) == counts["rules"] - 1

    escaped = edit_row(source, "source.register", lambda line: line.replace("原生身份、版本", r"原生身份 \| 版本 `A\|B`、版本"))
    escaped_data = run_case("转义管道和行内代码保持单元格内容", contract_text=escaped)
    text = next(row["inputOutput"] for row in escaped_data["catalog"]["nodes"] if row["id"] == "source.register")
    assert "原生身份 | 版本 `A|B`" in text

    optional_bars = edit_row(source, "source.register", lambda line: line.strip().removeprefix("|").removesuffix("|").strip())
    run_case("Markdown表格行可省略两侧管道", contract_text=optional_bars)
    run_case("错误节点标识不被静默跳过", contract_text=edit_row(source, "source.register", lambda line: line.replace("source.register", "source register", 1)), expected_error="invalid nodes identifier")
    run_case("节点缺列被拒绝且不覆盖旧输出", contract_text=edit_row(source, "source.register", lambda line: "|".join(line.split("|")[:-2]) + "|"), expected_error="row needs 4 columns")
    run_case("场景空必填单元格被拒绝", contract_text=edit_row(source, "V54", lambda line: "| V54 | | 必须有场景描述 |"), expected_error="empty required cell")
    run_case("多余未转义管道被拒绝", contract_text=edit_row(source, "V54", lambda line: line.replace("AEO 有", "AEO | 有", 1)), expected_error="row needs 3 columns")
    run_case("重复目录ID被拒绝", contract_text=edit_row(source, "source.register", lambda line: line + "\n" + line), expected_error="duplicate id source.register")
    run_case("目录端点悬空被拒绝", contract_text=edit_row(source, "source.intake", lambda line: line.replace("source.register", "qa.absent")), expected_error="dangling endpoint qa.absent")

    lines = source.splitlines(keepends=True)
    header = next(i for i, line in enumerate(lines) if re.match(r"^\|\s*nodeId\s*\|", line))
    bad_separator = list(lines)
    bad_separator[header + 1] = "| -- | --- | --- | --- |\n"
    run_case("表头分隔行格式异常被拒绝", contract_text="".join(bad_separator), expected_error="invalid nodes table separator")
    incomplete = list(lines)
    incomplete.insert(header + 1, "\n")
    run_case("表头与分隔行不完整被拒绝", contract_text="".join(incomplete), expected_error="table is incomplete")
    run_case("缺失目录表头不生成假完整快照", contract_text="".join(lines[:header] + lines[header + 1:]), expected_error="invalid nodes table header")

    research_edges = {row["id"] for row in base["catalog"]["edges"] if "assessment.research" in row["endpointTemplate"]}
    run_case("删除默认接线仍必需的节点时拒绝悬空绑定", contract_text=without_records(source, {"assessment.research"} | research_edges), selection_data={}, expected_error="dangling reference assessment.research")

    evidence = dict(id="qa:history", kind="runtime", status="inconclusive", bindingIds=["research.overall"])
    run_case("重复证据被拒绝且保留旧输出", evidence=[evidence, evidence], expected_error="duplicate id")
    run_case("悬空场景被拒绝且保留旧输出", evidence=[{**evidence, "scenarioIds": ["V999999"]}], expected_error="dangling reference")
    run_case("不明时区观察时间被拒绝", evidence=[{**evidence, "observedAt": "2026-10-22 10:00"}], expected_error="timezone-qualified")
    invalid_date = [{**evidence, "observedAt": "2026-02-30T10:00:00Z"}]
    invalid_snapshot = copy.deepcopy(base)
    invalid_snapshot["evidence"] = invalid_date
    try:
        validate(invalid_snapshot)
    except ValueError:
        pass
    else:
        raise AssertionError("invalid calendar date must raise ValueError")
    # CPython changes the calendar error wording. Check the stable CLI category,
    # exit code and unchanged output, while retaining the ValueError assertion.
    run_case("实际不存在的日历日期被拒绝且不覆盖旧输出", evidence=invalid_date, expected_error="validation failed:")
    run_case("不合法的时区分钟不被自动归一化", evidence=[{**evidence, "observedAt": "2026-10-22T10:00:00+01:99"}], expected_error="invalid timezone offset")
    run_case("错误证据字段类型被拒绝", evidence=[{**evidence, "sourceRevision": 7}], expected_error="sourceRevision must be a string")
    run_case("引用数组中的空引用被拒绝", evidence=[{**evidence, "inputRefs": [""]}], expected_error="array of nonempty references")
    run_case("未知测试层级被拒绝", evidence=[{**evidence, "kind": "test", "testLevel": "probably-unit"}], expected_error="invalid testLevel")

    historical = [dict(id="qa:incomplete", kind="runtime", status="passed", contractRevision=None,
                       sourceRevision="", reportRef=None, inputRefs=None, outputRefs=[], observedAt="")]
    retained = run_case("历史passed缺项原样保留，不补契约、报告或当前充分性", evidence=historical)
    assert retained["evidence"] == historical
    assert "verified" not in retained and "currentPassed" not in retained["evidence"][0]

    scoped = [dict(id=f"qa:{kind}:{level or 'none'}", kind=kind, status="passed", testLevel=level,
                  contractRevision=base["snapshot"]["contract"]["sourceRevision"], sourceRevision="qa-source",
                  reportRef="qa-report", observedAt="2026-10-22T10:00:00Z", scenarioIds=["V12"])
              for kind, level in (("source_review", None), ("test", "unit"), ("test", "contract"), ("test", None))]
    scoped_result = run_case("保留测试层级及无环境证据；当前匹配由UI按种类判定", evidence=scoped)
    assert scoped_result["evidence"] == scoped
    run_case("未知selection字段被拒绝", selection_data={"automaticImpact": True}, expected_error="selection: expected object")
    run_case("本次范围的悬空节点被拒绝", selection_data={"changedNodeIds": ["qa.absent"]}, expected_error="dangling reference")

    no_version = re.sub(r"^版本[^\n]*\n", "", source, count=1, flags=re.M)
    run_case("契约缺声明版本被拒绝", contract_text=no_version, expected_error="declared version")
    empty_version = re.sub(r"^版本[^\n]*\n", "版本：\n", source, count=1, flags=re.M)
    run_case("空版本不能误读下一行正文作为版本", contract_text=empty_version, expected_error="declared version")

    for field in ("version", "source", "sourceRevision", "sourceRevisionType"):
        invalid = copy.deepcopy(base)
        invalid["snapshot"]["contract"].pop(field)
        try:
            validate(invalid)
        except ValueError:
            pass
        else:
            raise AssertionError(f"missing snapshot contract identity accepted: {field}")
    checks.append("快照比较基准缺任一契约身份字段均被拒绝，不能同缺匹配")

print(json.dumps(dict(passed=len(checks), checks=checks), ensure_ascii=False, indent=2))
