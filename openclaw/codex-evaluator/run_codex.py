#!/usr/bin/env python3
"""One bounded Codex session. The caller supplies authorized business hooks.

No login, global configuration changes, package installation, or custom model
iteration. Codex owns continuation. The local bridge adapts the tested Miaoda
Chat Completions transport to Responses; inference stays on that provider.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time

from miaoda_responses_bridge import start_server

MODEL = "glm-5.3"
TOOL = "mcp__assessment__assessment_step"


def interrupted(_signum, _frame):
    raise InterruptedError("session_interrupted")


def file_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def stop(process):
    if process is None:
        return
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            pass


def configuration(run, port, request):
    catalog = {"models": [{
        "slug": MODEL, "display_name": "Miaoda assessment executor",
        "description": "Bounded assessment using registered business tools",
        "default_reasoning_level": None, "supported_reasoning_levels": [],
        "shell_type": "unified_exec", "visibility": "list", "supported_in_api": True,
        "priority": 1, "availability_nux": None, "upgrade": None,
        "model_messages": {"instructions_template": request["instructions"]},
        "supports_reasoning_summary_parameter": False, "default_reasoning_summary": "none",
        "support_verbosity": False, "default_verbosity": None, "apply_patch_tool_type": None,
        "truncation_policy": {"mode": "bytes", "limit": 300000},
        "experimental_supported_tools": [], "input_modalities": ["text"],
        "tool_mode": "direct", "node_repl_disabled": True,
        "include_apps_usage_instructions": False,
    }]}
    catalog_path = run / "models.json"
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False))
    config = f'''model = "{MODEL}"
model_provider = "miaoda-assessment"
model_catalog_json = {json.dumps(str(catalog_path))}
web_search = "disabled"
sandbox_mode = "read-only"
approval_policy = "never"
allow_login_shell = false
cli_auth_credentials_store = "file"
check_for_update_on_startup = false
mcp_optional_startup_grace_ms = 0

[model_providers.miaoda-assessment]
name = "Miaoda assessment loopback bridge"
base_url = "http://127.0.0.1:{port}/v1"
wire_api = "responses"
requires_openai_auth = false
env_key = "WISELINK_CODEX_BRIDGE_TOKEN"
supports_websockets = false
request_max_retries = 0
stream_max_retries = 0
stream_idle_timeout_ms = 100000

[model_providers.miaoda-assessment.capabilities]
external_web_access = false
remote_compaction = "unsupported"

[mcp_servers.assessment]
enabled = true
required = true
command = {json.dumps(sys.executable)}
args = [{json.dumps(str(Path(__file__).with_name('mcp_stdio.py')))}]
env_vars = ["WISELINK_ASSESSMENT_URL", "WISELINK_ASSESSMENT_TOKEN"]
enabled_tools = ["assessment_step"]
startup_timeout_sec = 20
tool_timeout_sec = 120

# This one caller-bound business tool is the requested automation surface.
# Global shell/other-tool approvals remain unavailable; bridge allows only this tool.
[mcp_servers.assessment.tools.assessment_step]
approval_mode = "approve"

[agents]
enabled = false

[features]
apps = false
multi_agent = false
hooks = false
enable_request_compression = false

[analytics]
enabled = false
[feedback]
enabled = false
[otel]
exporter = "none"
metrics_exporter = "none"
trace_exporter = "none"
[shell_environment_policy]
inherit = "none"
set = {{ PATH = "/usr/bin:/bin" }}
'''
    (run / "codex-home" / "config.toml").write_text(config)


def summarize(run):
    audit = [json.loads(x) for x in (run / "bridge.audit.jsonl").read_text().splitlines()] if (run / "bridge.audit.jsonl").exists() else []
    calls = {v for row in audit for v in row.get("call_ids", [])}
    returned = {v for row in audit for v in row.get("returned_ids", [])}
    return {
        "model_requests": sum(row.get("upstream_attempted") is True for row in audit),
        "http_200": sum(row.get("status") == 200 for row in audit),
        "upstream_models": sorted({v for row in audit for v in row.get("upstream_models", [])}),
        "unique_tool_calls": len(calls), "unique_tool_results": len(returned),
        "matched_tool_roundtrips": len(calls & returned),
        "unmatched_tool_results": len(returned - calls),
        "tool_calls_without_return": len(calls - returned),
        "input_tokens": sum((row.get("usage") or {}).get("input_tokens", 0) for row in audit),
        "output_tokens": sum((row.get("usage") or {}).get("output_tokens", 0) for row in audit),
        "bridge_errors": [row["error_code"] for row in audit if row.get("error_code")],
    }


def main():
    os.umask(0o077)
    request = json.load(sys.stdin)
    run = Path(request["run_directory"]).resolve()
    run.mkdir(parents=True, exist_ok=True, mode=0o700)
    for name in ("codex-home", "user-home", "tmp", "work"):
        (run / name).mkdir(mode=0o700)
    timeout = request.get("timeout_seconds", 600)
    if not isinstance(timeout, (int, float)) or not 1 <= timeout <= 3600:
        raise ValueError("invalid_timeout")
    config_path = request["config_path"]
    binary = request["codex_binary"]
    before = file_hash(config_path)
    server = thread = process = None
    token = ""
    output = error_output = ""
    summary = {"run_directory": str(run), "model": MODEL, "codex_version": None,
               "codex_exit_code": None, "timed_out": False, "failure": None,
               "provider_requires_openai_auth": False, "openai_credentials_in_child_environment": False,
               "source_config_sha256_before": before, "cleanup_errors": [],
               "host_mode": request.get("host_mode", "bound-hooks"),
               "egress_audit": "not_performed"}
    started = time.monotonic()
    previous_handlers = {sig: signal.signal(sig, interrupted) for sig in (signal.SIGTERM, signal.SIGINT)}
    try:
        server, thread, port, token = start_server(config_path, MODEL, run / "bridge.audit.jsonl",
            run / "work", allowed_tools={TOOL}, max_requests=request.get("max_model_requests", 24),
            max_tokens=request.get("max_output_tokens", 8192),
            reasoning_effort=request.get("reasoning_effort"))
        configuration(run, port, request)
        env = {"PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
               "HOME": str(run / "user-home"), "CODEX_HOME": str(run / "codex-home"),
               "TMPDIR": str(run / "tmp"), "LANG": "C.UTF-8", "TERM": "dumb",
               "WISELINK_CODEX_BRIDGE_TOKEN": token,
               "WISELINK_ASSESSMENT_URL": request["broker_url"],
               "WISELINK_ASSESSMENT_TOKEN": request["broker_token"]}
        version = subprocess.run([binary, "--version"], env=env, capture_output=True, text=True, timeout=15, check=True).stdout.strip()
        if version != "codex-cli 0.164.0":
            raise ValueError("unvalidated_codex_version")
        summary["codex_version"] = version
        command = [binary, "exec", "--sandbox", "read-only", "--ephemeral", "--json",
                   "--output-last-message", str(run / "final.txt"), "--skip-git-repo-check",
                   "--cd", str(run / "work"), "-"]
        process = subprocess.Popen(command, cwd=run / "work", env=env, stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                   encoding="utf-8", errors="replace", start_new_session=True)
        try:
            output, error_output = process.communicate(request["prompt"], timeout=timeout)
        except subprocess.TimeoutExpired:
            summary["timed_out"] = True
            stop(process)
            output, error_output = process.communicate(timeout=5)
        summary["codex_exit_code"] = process.returncode
    except Exception as error:
        summary["failure"] = type(error).__name__
    finally:
        for sig in previous_handlers:
            signal.signal(sig, signal.SIG_IGN)
        stop(process)
        if server:
            server.shutdown()
            server.server_close()
        if thread:
            thread.join(timeout=5)
            if thread.is_alive():
                summary["cleanup_errors"].append("bridge_thread_alive")
        def redact(value):
            for secret in (token, request["broker_token"]):
                if secret:
                    value = value.replace(secret, "[REDACTED]")
            return re.sub(r"(?i)\bBearer[ \t]+[A-Za-z0-9._~+/=-]+", "Bearer [REDACTED]", value)
        # Business results may be present here; these files stay private on the instance.
        (run / "codex.events.jsonl").write_text(redact(output))
        (run / "codex.stderr.log").write_text(redact(error_output))
        if (run / "final.txt").exists():
            (run / "final.txt").write_text(redact((run / "final.txt").read_text()))
        events = []
        successful_mcp_ids, failed_mcp_ids = set(), set()
        for line in output.splitlines():
            try:
                event = json.loads(line)
                if event.get("type") in ("turn.completed", "turn.failed", "error"):
                    events.append(event["type"])
                item = event.get("item", {})
                if event.get("type") == "item.completed" and item.get("type") == "mcp_tool_call":
                    tool_result = item.get("result") or {}
                    # Codex JSON events preserve a rejected MCP result as item.status
                    # even when their result projection omits the MCP isError field.
                    destination = failed_mcp_ids if item.get("status") == "failed" or item.get("error") or tool_result.get("isError", tool_result.get("is_error", False)) else successful_mcp_ids
                    destination.add(item.get("id"))
            except ValueError:
                pass
        summary.update(summarize(run))
        summary["terminal_events"] = events
        summary["successful_mcp_calls"] = len(successful_mcp_ids)
        summary["failed_mcp_calls"] = len(failed_mcp_ids)
        summary["source_config_sha256_after"] = file_hash(config_path)
        summary["source_config_unchanged"] = before == summary["source_config_sha256_after"]
        summary["auth_json_present"] = any((run / "codex-home").rglob("auth.json"))
        summary["duration_ms"] = round((time.monotonic() - started) * 1000)
        summary["transport_passed"] = (summary["codex_exit_code"] == 0 and not summary["failure"]
            and not summary["timed_out"] and not summary["bridge_errors"] and not summary["cleanup_errors"]
            and "turn.completed" in events and summary["source_config_unchanged"]
            and not summary["auth_json_present"] and summary["matched_tool_roundtrips"] > 0
            and summary["successful_mcp_calls"] > 0
            and summary["unmatched_tool_results"] == 0 and summary["tool_calls_without_return"] == 0)
        (run / "transport-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
        for sig, handler in previous_handlers.items():
            signal.signal(sig, handler)
    print(json.dumps(summary, ensure_ascii=False))
    return 0 if summary["transport_passed"] else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        print('{"transport_passed":false,"failure":"runner_failed"}')
        sys.exit(1)
