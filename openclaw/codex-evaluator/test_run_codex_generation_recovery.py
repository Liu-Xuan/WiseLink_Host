"""Exercise the real generation runner with an offline Codex executable.

The bridge server is controlled in-process; the fake CLI supplies local audit
and provider stream artifacts. No external model or credentials are used.
"""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
SPEC = importlib.util.spec_from_file_location("generation_runner_under_test", HERE / "run_codex_generation.py")
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class ClosedServer:
    def shutdown(self):
        pass

    def server_close(self):
        pass


class ClosedThread:
    def join(self, timeout=None):
        pass

    def is_alive(self):
        return False


@unittest.skipUnless(sys.platform.startswith("linux"), "requires Linux /proc identity and process groups; not validated here")
class RunnerRecoveryTests(unittest.TestCase):
    def fixture(self, root, mode):
        run = root / "run"
        run.mkdir()
        binding = b'{"version":1,"requestId":"offline-runner"}'
        (run / "generation-binding.json").write_bytes(binding + b"\n")
        config = root / "config.json"
        config.write_text('{"source":"offline-no-credentials"}')
        codex = root / "fake-codex"
        codex.write_text('''#!/usr/bin/env python3
import json,os,pathlib,sys,time
if sys.argv[1:] == ['--version']:
 print('codex-cli 0.164.0'); sys.exit(0)
run=pathlib.Path(os.environ['HOME']).parent
output=pathlib.Path(sys.argv[sys.argv.index('--output-last-message')+1])
sys.stdin.read()
output.write_text(json.dumps({'tool_name':'return_result','arguments':{'workJson':'{}'}}))
audit={'upstream_attempted':True,'upstream_models':['glm-5.3'],'usage':{'input_tokens':10,'output_tokens':5},'status':200,'finish_reason':'stop','tool_calls':0}
(run/'bridge.audit.jsonl').write_text(json.dumps(audit)+'\\n')
upstream_request={'model':'glm-5.3','messages':[{'role':'user','content':'offline'}]}
temporary=run/'upstream-request.json.tmp'; temporary.write_text(json.dumps(upstream_request))
os.replace(temporary,run/'upstream-request.json')
upstream={'format':'chat-completions-sse-events-v1','events':[{'model':'glm-5.3','choices':[{'index':0,'finish_reason':'stop'}]}]}
temporary=run/'upstream-response.json.tmp'; temporary.write_text(json.dumps(upstream))
os.replace(temporary,run/'upstream-response.json')
if %s:
 pid=os.fork()
 if pid == 0:
  null=os.open(os.devnull,os.O_RDWR)
  for fd in (0,1,2): os.dup2(null,fd)
  os.close(null)
  time.sleep(20); os._exit(0)
 (run/'descendant-pid').write_text(str(pid))
print(json.dumps({'type':'turn.completed'}))
''' % ("True" if mode == "descendant" else "False"))
        codex.chmod(0o700)
        request = {"run_directory": str(run), "config_path": str(config),
                   "codex_binary": str(codex), "prompt": "Return candidate",
                   "allowed_tool_names": ["return_result"], "timeout_seconds": 5,
                   "max_output_tokens": 128, "reasoning_effort": None,
                   "binding_sha256": hashlib.sha256(binding).hexdigest()}
        return run, request

    def execute(self, request):
        output = io.StringIO()
        def bridge_stub(config_path, model, audit_path, work_dir, **options):
            self.assertEqual(options["upstream_response_path"],
                Path(request["run_directory"]) / "upstream-response.json"
                if request.get("binding_sha256") else None)
            self.assertEqual(options["upstream_request_path"], Path(request["run_directory"]) / "upstream-request.json")
            prompt = Path(request["run_directory"]) / "codex-prompt.txt"
            self.assertEqual(prompt.read_bytes(), request["prompt"].encode("utf-8"))
            self.assertEqual(prompt.stat().st_mode & 0o077, 0)
            return ClosedServer(), ClosedThread(), 12345, "ephemeral-test-token"
        with mock.patch.object(runner, "start_server", bridge_stub), \
             mock.patch.object(sys, "stdin", io.StringIO(json.dumps(request))), \
             contextlib.redirect_stdout(output):
            code = runner.main()
        return code, json.loads(output.getvalue())

    def test_completed_runner_atomically_records_full_source_and_closed_receipt(self):
        with tempfile.TemporaryDirectory() as temporary:
            run, request = self.fixture(Path(temporary), "normal")
            code, summary = self.execute(request)
            self.assertEqual(code, 0, summary)
            receipt = json.loads((run / "generation-receipt.json").read_text())
            original = (run / "upstream-response.json").read_bytes()
            self.assertEqual(receipt["upstream_response_sha256"], hashlib.sha256(original).hexdigest())
            self.assertEqual(receipt["upstream_request_sha256"], hashlib.sha256(
                (run / "upstream-request.json").read_bytes()).hexdigest())
            self.assertEqual(receipt["transport"], summary)
            self.assertEqual(receipt["candidate"], json.loads((run / "contract-candidate.json").read_text()))
            self.assertEqual(summary["closure"], "completed")
            self.assertTrue(summary["process_group_closed"])
            self.assertTrue(summary["transport_passed"])
            self.assertFalse(any(path.name.endswith('.tmp') for path in run.iterdir()))
            self.assertNotIn("ephemeral-test-token", "".join(path.read_text() for path in
                (run / "generation-receipt.json", run / "transport-summary.json", run / "upstream-response.json",
                 run / "upstream-request.json", run / "codex-prompt.txt")))

    def test_live_descendant_prevents_successful_transport_even_after_turn_completed(self):
        with tempfile.TemporaryDirectory() as temporary:
            run, request = self.fixture(Path(temporary), "descendant")
            code, summary = self.execute(request)
            self.assertEqual(code, 1)
            self.assertEqual(summary["closure"], "completed")
            self.assertFalse(summary["transport_passed"])
            receipt = json.loads((run / "generation-receipt.json").read_text())
            self.assertFalse(receipt["transport"]["transport_passed"])

    def test_unindexed_generation_still_captures_complete_private_request_and_prompt(self):
        with tempfile.TemporaryDirectory() as temporary:
            run, request = self.fixture(Path(temporary), "normal")
            del request["binding_sha256"]
            (run / "generation-binding.json").unlink()
            run.rmdir()
            code, summary = self.execute(request)
            self.assertEqual(code, 0, summary)
            self.assertTrue(summary["upstream_request_present"])
            payload = (run / "upstream-request.json").read_bytes()
            self.assertEqual(summary["upstream_request_sha256"], hashlib.sha256(payload).hexdigest())
            self.assertEqual((run / "codex-prompt.txt").read_bytes(), request["prompt"].encode("utf-8"))
            self.assertEqual((run / "upstream-request.json").stat().st_mode & 0o077, 0)
            self.assertFalse((run / "generation-receipt.json").exists())



class PreDispatchPersistenceTests(unittest.TestCase):
    def test_prompt_publish_failure_blocks_bridge_and_cli_spawn(self):
        # Only identity lookup is synthetic: exercise real main() ordering on
        # every OS without pretending Linux process lifecycle was validated.
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            request = {"run_directory": str(root / "run"), "prompt": "完整中文输入",
                       "timeout_seconds": 1, "max_output_tokens": 128}
            with mock.patch.object(runner, "runner_identity", return_value={"synthetic": True}), \
                 mock.patch.object(runner, "atomic_bytes", side_effect=OSError("offline prompt fsync failed")), \
                 mock.patch.object(runner, "start_server") as bridge_start, \
                 mock.patch.object(runner.subprocess, "Popen") as cli_spawn, \
                 mock.patch.object(sys, "stdin", io.StringIO(json.dumps(request))):
                with self.assertRaisesRegex(OSError, "offline prompt fsync failed"):
                    runner.main()
                bridge_start.assert_not_called()
                cli_spawn.assert_not_called()


class GenerationDeadlineTests(unittest.TestCase):
    def execute(self, *, version_elapsed=13, bridge_elapsed=0, version_timeout=False,
                cli_timeout=False, cleanup_timeout=False):
        # The clock and CLI are synthetic. Exercise main's real deadline,
        # configuration and durable summaries without claiming /proc coverage.
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        config = root / "config.json"
        config.write_text('{"source":"offline-no-credentials"}')
        run = root / "run"
        request = {"run_directory": str(run), "config_path": str(config),
                   "codex_binary": "/offline/codex", "prompt": "Return candidate",
                   "allowed_tool_names": ["return_result"], "timeout_seconds": 600,
                   "max_output_tokens": 128}
        clock = [100.0]
        observed = {}
        process = mock.Mock(returncode=0)
        process.poll.return_value = 0

        def bridge_stub(*args, **options):
            observed["bridge"] = options
            clock[0] += bridge_elapsed
            return ClosedServer(), ClosedThread(), 12345, "ephemeral-test-token"

        def version(*args, **options):
            observed["version_timeout"] = options["timeout"]
            if version_timeout:
                raise runner.subprocess.TimeoutExpired(args[0], options["timeout"])
            clock[0] += version_elapsed
            return mock.Mock(stdout="codex-cli 0.164.0\n")

        def communicate(prompt=None, *, timeout):
            if prompt is None:
                observed["cleanup_timeout"] = timeout
                if cleanup_timeout:
                    raise runner.subprocess.TimeoutExpired("offline-codex-cleanup", timeout)
                return '{"type":"turn.failed"}\n', ""
            observed["cli_timeout"] = timeout
            self.assertEqual(prompt, request["prompt"])
            if cli_timeout:
                (run / "bridge.audit.jsonl").write_text(json.dumps({"upstream_attempted": True,
                    "status": 502, "upstream_models": ["glm-5.3"], "error_code": "upstream_timeout"}) + "\n")
                raise runner.subprocess.TimeoutExpired("offline-codex-generation", timeout)
            (run / "final.txt").write_text(json.dumps({"tool_name": "return_result",
                "arguments": {"workJson": "{}"}}))
            (run / "bridge.audit.jsonl").write_text(json.dumps({"upstream_attempted": True,
                "status": 200, "upstream_models": ["glm-5.3"], "finish_reason": "stop"}) + "\n")
            (run / "upstream-request.json").write_text('{"model":"glm-5.3"}')
            return '{"type":"turn.completed"}\n', ""

        process.communicate.side_effect = communicate
        output = io.StringIO()
        with mock.patch.object(runner, "runner_identity", return_value={"synthetic": True}), \
             mock.patch.object(runner.time, "monotonic", side_effect=lambda: clock[0]), \
             mock.patch.object(runner, "start_server", side_effect=bridge_stub), \
             mock.patch.object(runner.subprocess, "run", side_effect=version) as version_call, \
             mock.patch.object(runner.subprocess, "Popen", return_value=process) as spawn, \
             mock.patch.object(runner, "close_process_group", return_value=(True, False)), \
             mock.patch.object(sys, "stdin", io.StringIO(json.dumps(request))), \
             contextlib.redirect_stdout(output):
            code = runner.main()
        return code, json.loads(output.getvalue()), observed, run, version_call, spawn

    def test_one_deadline_reaches_bridge_version_cli_and_codex_idle_limit(self):
        code, summary, observed, run, _, spawn = self.execute()
        self.assertEqual(code, 0, summary)
        self.assertEqual(observed["bridge"]["timeout"], 600)
        self.assertEqual(observed["bridge"]["deadline"], 700)
        self.assertEqual(observed["bridge"]["max_requests"], 1)
        self.assertEqual(observed["version_timeout"], 15)
        self.assertEqual(observed["cli_timeout"], 587)
        spawn.assert_called_once()
        config = (run / "codex-home" / "config.toml").read_text()
        self.assertIn("stream_idle_timeout_ms = 600000", config)
        self.assertIn("request_max_retries = 0", config)
        self.assertIn("stream_max_retries = 0", config)
        self.assertEqual(summary["model_requests"], 1)

    def test_expired_setup_cannot_start_version_probe_or_cli(self):
        code, summary, _, _, version, spawn = self.execute(bridge_elapsed=601)
        self.assertEqual(code, 1)
        self.assertTrue(summary["timed_out"])
        self.assertEqual(summary["failure"], "generation_deadline_exceeded")
        self.assertEqual(summary["failure_phase"], "codex_version")
        self.assertEqual(summary["model_requests"], 0)
        version.assert_not_called()
        spawn.assert_not_called()

    def test_version_and_generation_cleanup_timeouts_keep_the_original_phase(self):
        code, summary, _, _, _, spawn = self.execute(version_timeout=True)
        self.assertEqual(code, 1)
        self.assertTrue(summary["timed_out"])
        self.assertEqual(summary["failure"], "codex_version_timeout")
        self.assertEqual(summary["failure_phase"], "codex_version")
        self.assertEqual(summary["model_requests"], 0)
        spawn.assert_not_called()
        for cleanup_timeout in (False, True):
            with self.subTest(cleanup_timeout=cleanup_timeout):
                code, summary, observed, _, _, spawn = self.execute(
                    cli_timeout=True, cleanup_timeout=cleanup_timeout)
                self.assertEqual(code, 1)
                self.assertTrue(summary["timed_out"])
                self.assertEqual(summary["failure"], "generation_deadline_exceeded")
                self.assertEqual(summary["failure_phase"], "codex_generation")
                self.assertEqual(observed["cli_timeout"], 587)
                self.assertEqual(observed["cleanup_timeout"], 5)
                self.assertEqual(summary["model_requests"], 1)
                spawn.assert_called_once()


if __name__ == "__main__":
    unittest.main()
