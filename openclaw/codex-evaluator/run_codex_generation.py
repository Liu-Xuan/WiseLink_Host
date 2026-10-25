#!/usr/bin/env python3
"""One Codex CLI generation through the configured Miaoda Responses bridge.

The final text is a structured candidate for the caller's function contract.
No business MCP is mounted and no model-selected operation is executed here.
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
import uuid

from miaoda_responses_bridge import start_server, MODEL


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate_json_key")
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError("invalid_json_constant")


def stop(process):
    if process is None or process.poll() is not None:
        return
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            return
        try:
            process.wait(timeout=3)
            return
        except subprocess.TimeoutExpired:
            pass


def interrupted(_signum, _frame):
    raise InterruptedError("generation_interrupted")


def atomic_json(path, value):
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    with open(temporary, "x", encoding="utf-8") as file:
        json.dump(value, file, ensure_ascii=False)
        file.write("\n")
        file.flush()
        os.fsync(file.fileno())
    os.replace(temporary, path)
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def atomic_bytes(path, value):
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as file:
        file.write(value)
        file.flush()
        os.fsync(file.fileno())
    os.replace(temporary, path)
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def runner_identity():
    stat = Path("/proc/self/stat").read_text()
    # /proc can be mounted from the host while the runner has a private PID
    # namespace; the stat file's first field is the PID usable with this mount.
    return {"pid": int(stat.split(" ", 1)[0]), "bootId": Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
            "startTime": stat[stat.rfind(")") + 2:].split()[19]}


def close_process_group(process):
    if process is None:
        return True, False
    try:
        os.killpg(process.pid, 0)
    except ProcessLookupError:
        return True, False
    # The CLI may have exited while descendants remain. Never mark a response
    # closed while a process in its private session can still act.
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            return True, True
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            try:
                os.killpg(process.pid, 0)
            except ProcessLookupError:
                return True, True
            time.sleep(.05)
    return False, True


def remaining_seconds(deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("generation_deadline_exceeded")
    return remaining


def configure(run, port, timeout):
    catalog = {"models": [{
        "slug": MODEL, "display_name": "Miaoda bounded generation",
        "description": "One request, structured final text, no business tools",
        "default_reasoning_level": None, "supported_reasoning_levels": [],
        "shell_type": "unified_exec", "visibility": "list", "supported_in_api": True,
        "priority": 1, "availability_nux": None, "upgrade": None,
        "model_messages": {"instructions_template": "Return only the requested JSON object. Do not call tools."},
        "supports_reasoning_summary_parameter": False, "default_reasoning_summary": "none",
        "support_verbosity": False, "default_verbosity": None,
        "apply_patch_tool_type": None, "truncation_policy": {"mode": "bytes", "limit": 300000},
        "experimental_supported_tools": [], "input_modalities": ["text"],
        "tool_mode": "direct", "node_repl_disabled": True,
        "include_apps_usage_instructions": False,
    }]}
    catalog_path = run / "models.json"
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False))
    config = f'''model = "{MODEL}"
model_provider = "miaoda-generation"
model_catalog_json = {json.dumps(str(catalog_path))}
web_search = "disabled"
sandbox_mode = "read-only"
approval_policy = "never"
allow_login_shell = false
cli_auth_credentials_store = "file"
check_for_update_on_startup = false

[model_providers.miaoda-generation]
name = "Miaoda bounded generation bridge"
base_url = "http://127.0.0.1:{port}/v1"
wire_api = "responses"
requires_openai_auth = false
env_key = "WISELINK_CODEX_BRIDGE_TOKEN"
supports_websockets = false
request_max_retries = 0
stream_max_retries = 0
stream_idle_timeout_ms = {int(timeout * 1000)}

[model_providers.miaoda-generation.capabilities]
external_web_access = false
remote_compaction = "unsupported"

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


def redact(value, token):
    if token:
        value = value.replace(token, "[REDACTED]")
    return re.sub(r"(?i)\bBearer[ \t]+[A-Za-z0-9._~+/=-]+", "Bearer [REDACTED]", value)


def main():
    os.umask(0o077)
    request = json.load(sys.stdin, object_pairs_hook=unique_object)
    run = Path(request["run_directory"]).resolve()
    binding_sha256 = request.get("binding_sha256")
    if binding_sha256 is not None:
        if not isinstance(binding_sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", binding_sha256):
            raise ValueError("invalid_recovery_binding")
        binding = (run / "generation-binding.json").read_bytes().strip()
        if hashlib.sha256(binding).hexdigest() != binding_sha256:
            raise ValueError("recovery_binding_mismatch")
        run.mkdir(parents=True, exist_ok=True, mode=0o700)
    else:
        run.mkdir(parents=True, exist_ok=False, mode=0o700)
    atomic_json(run / "runner-identity.json", runner_identity())
    for name in ("codex-home", "user-home", "tmp", "work"):
        (run / name).mkdir(mode=0o700)
    timeout = request.get("timeout_seconds", 600)
    if type(timeout) not in (int, float) or not 1 <= timeout <= 3600:
        raise ValueError("invalid_timeout")
    if type(request.get("max_output_tokens")) is not int or not 1 <= request["max_output_tokens"] <= 32768:
        raise ValueError("invalid_token_budget")
    if not isinstance(request.get("prompt"), str):
        raise ValueError("invalid_prompt")
    prompt_bytes = request["prompt"].encode("utf-8")
    prompt_path = run / "codex-prompt.txt"
    if prompt_path.exists():
        if prompt_path.read_bytes() != prompt_bytes:
            raise ValueError("recovery_prompt_mismatch")
    else:
        atomic_bytes(prompt_path, prompt_bytes)
    config_path = request["config_path"]
    before = hashlib.sha256(Path(config_path).read_bytes()).hexdigest()
    started = time.monotonic()
    deadline = started + timeout
    server = thread = process = None
    token = ""
    stdout = stderr = ""
    summary = {"run_directory": str(run), "model": MODEL, "codex_version": None,
               "codex_exit_code": None, "timed_out": False, "failure": None, "failure_phase": None,
               "provider_requires_openai_auth": False,
               "openai_credentials_in_child_environment": False,
               "source_config_sha256_before": before, "source_config_sha256_after": None,
               "source_config_unchanged": False, "auth_json_present": False,
               "model_requests": 0, "upstream_models": [], "input_tokens": 0,
               "output_tokens": 0, "terminal_events": [], "closure": None,
               "structured_final_to_contract": False, "bridge_errors": [],
               "transport_passed": False}
    handlers = {sig: signal.signal(sig, interrupted) for sig in (signal.SIGTERM, signal.SIGINT)}
    phase = "bridge_start"
    try:
        server, thread, port, token = start_server(config_path, MODEL, run / "bridge.audit.jsonl",
            run / "work", allowed_tools=frozenset(), max_requests=1,
            timeout=timeout, deadline=deadline,
            max_tokens=request["max_output_tokens"], reasoning_effort=request.get("reasoning_effort"),
            upstream_response_path=run / "upstream-response.json" if binding_sha256 is not None else None,
            upstream_request_path=run / "upstream-request.json")
        configure(run, port, timeout)
        env = {"PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
               "HOME": str(run / "user-home"), "CODEX_HOME": str(run / "codex-home"),
               "TMPDIR": str(run / "tmp"), "LANG": "C.UTF-8", "TERM": "dumb",
               "WISELINK_CODEX_BRIDGE_TOKEN": token}
        phase = "codex_version"
        version = subprocess.run([request["codex_binary"], "--version"], env=env,
            capture_output=True, text=True, timeout=min(15, remaining_seconds(deadline)), check=True).stdout.strip()
        if version != "codex-cli 0.164.0":
            raise ValueError("unvalidated_codex_version")
        summary["codex_version"] = version
        command = [request["codex_binary"], "exec", "--sandbox", "read-only",
                   "--ephemeral", "--json", "--output-last-message", str(run / "final.txt"),
                   "--skip-git-repo-check", "--cd", str(run / "work"), "-"]
        phase = "codex_generation"
        remaining_seconds(deadline)
        process = subprocess.Popen(command, cwd=run / "work", env=env, stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8",
            errors="replace", start_new_session=True)
        try:
            stdout, stderr = process.communicate(request["prompt"], timeout=remaining_seconds(deadline))
        except subprocess.TimeoutExpired:
            summary["timed_out"] = True
            summary.update(failure="generation_deadline_exceeded", failure_phase=phase)
            stop(process)
            stdout, stderr = process.communicate(timeout=5)
        summary["codex_exit_code"] = process.returncode
    except subprocess.TimeoutExpired:
        summary.update(timed_out=True, failure=summary["failure"] or (
            "codex_version_timeout" if phase == "codex_version" else "generation_deadline_exceeded"),
            failure_phase=phase)
    except TimeoutError:
        summary.update(timed_out=True, failure="generation_deadline_exceeded", failure_phase=phase)
    except Exception as error:
        summary["failure"] = str(error) if isinstance(error, (ValueError, InterruptedError)) else type(error).__name__
        summary["failure_phase"] = phase
    finally:
        for sig in handlers:
            signal.signal(sig, signal.SIG_IGN)
        stop(process)
        summary["process_group_closed"], summary["process_group_had_members"] = close_process_group(process)
        if server:
            server.shutdown(); server.server_close()
        if thread:
            thread.join(timeout=5)
        (run / "codex.events.jsonl").write_text(redact(stdout, token))
        (run / "codex.stderr.log").write_text(redact(stderr, token))
        final_path = run / "final.txt"
        if final_path.exists():
            final_path.write_text(redact(final_path.read_text(), token))
        audit_path = run / "bridge.audit.jsonl"
        audit = [json.loads(line) for line in audit_path.read_text().splitlines()] if audit_path.exists() else []
        summary["model_requests"] = sum(row.get("upstream_attempted") is True for row in audit)
        summary["upstream_models"] = sorted({v for row in audit for v in row.get("upstream_models", [])})
        summary["input_tokens"] = sum((row.get("usage") or {}).get("input_tokens", 0) for row in audit)
        summary["output_tokens"] = sum((row.get("usage") or {}).get("output_tokens", 0) for row in audit)
        summary["bridge_errors"] = [row["error_code"] for row in audit if row.get("error_code")]
        events = []
        tool_items = []
        for line in stdout.splitlines():
            try:
                event = json.loads(line, object_pairs_hook=unique_object)
                kind = event.get("type")
                if kind in ("turn.completed", "turn.failed", "error"):
                    events.append(kind)
                item = event.get("item")
                if isinstance(item, dict) and item.get("type") in ("mcp_tool_call", "command_execution", "file_change", "web_search"):
                    tool_items.append(item["type"])
            except ValueError:
                events.append("invalid_event_json")
        summary["terminal_events"] = events
        summary["tool_items"] = tool_items
        summary["closure"] = "completed" if events.count("turn.completed") == 1 and not any(v in events for v in ("turn.failed", "error", "invalid_event_json")) else "incomplete"
        summary["source_config_sha256_after"] = hashlib.sha256(Path(config_path).read_bytes()).hexdigest()
        summary["source_config_unchanged"] = before == summary["source_config_sha256_after"]
        summary["auth_json_present"] = any((run / "codex-home").rglob("auth.json"))
        summary["upstream_response_present"] = (run / "upstream-response.json").is_file() if binding_sha256 is not None else None
        summary["upstream_response_sha256"] = (hashlib.sha256((run / "upstream-response.json").read_bytes()).hexdigest()
            if summary["upstream_response_present"] else None)
        summary["upstream_request_present"] = (run / "upstream-request.json").is_file()
        summary["upstream_request_sha256"] = (hashlib.sha256((run / "upstream-request.json").read_bytes()).hexdigest()
            if summary["upstream_request_present"] else None)
        try:
            final = json.loads(final_path.read_text(), object_pairs_hook=unique_object,
                parse_constant=reject_constant)
            if not isinstance(final, dict) or set(final) != {"tool_name", "arguments"} or \
               not isinstance(final["tool_name"], str) or final["tool_name"] not in request["allowed_tool_names"] or \
               not isinstance(final["arguments"], dict):
                raise ValueError("invalid_structured_final")
            # This is a local final-to-contract conversion; no business function ran in Codex.
            atomic_json(run / "contract-candidate.json", final)
            summary["structured_final_to_contract"] = True
        except (ValueError, OSError) as error:
            # A parser exception is diagnostic only; never project model text.
            summary["final_error"] = "invalid_structured_final" if isinstance(error, ValueError) else "final_unavailable"
        summary["duration_ms"] = round((time.monotonic() - started) * 1000)
        summary["transport_passed"] = (summary["codex_exit_code"] == 0 and not summary["timed_out"]
            and not summary["failure"] and summary["closure"] == "completed"
            and summary["model_requests"] == 1 and len(audit) == 1 and audit[0]["status"] == 200
            and summary["upstream_models"] == [MODEL]
            and audit[0].get("finish_reason") == "stop" and not audit[0].get("tool_calls")
            and not summary["tool_items"] and not summary["bridge_errors"]
            and summary["structured_final_to_contract"] and summary["source_config_unchanged"]
            and not summary["auth_json_present"] and thread is not None and not thread.is_alive()
            and summary["process_group_closed"] and not summary["process_group_had_members"]
            and summary["upstream_request_present"]
            and (binding_sha256 is None or summary["upstream_response_present"]))
        atomic_json(run / "transport-summary.json", summary)
        if binding_sha256 is not None:
            candidate_path = run / "contract-candidate.json"
            candidate = json.loads(candidate_path.read_text()) if candidate_path.exists() else {}
            atomic_json(run / "generation-receipt.json", {"version": 1,
                "binding_sha256": binding_sha256, "run_directory": str(run),
                "transport": summary, "candidate": candidate,
                "upstream_request_sha256": summary["upstream_request_sha256"],
                "upstream_response_sha256": summary["upstream_response_sha256"]})
        for sig, handler in handlers.items():
            signal.signal(sig, handler)
    print(json.dumps(summary, ensure_ascii=False))
    return 0 if summary["transport_passed"] else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        print('{"transport_passed":false,"failure":"runner_failed"}')
        sys.exit(1)
