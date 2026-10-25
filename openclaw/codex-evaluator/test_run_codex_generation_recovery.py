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
            self.assertEqual(options["upstream_response_path"], Path(request["run_directory"]) / "upstream-response.json")
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
            self.assertEqual(receipt["transport"], summary)
            self.assertEqual(receipt["candidate"], json.loads((run / "contract-candidate.json").read_text()))
            self.assertEqual(summary["closure"], "completed")
            self.assertTrue(summary["process_group_closed"])
            self.assertTrue(summary["transport_passed"])
            self.assertFalse(any(path.name.endswith('.tmp') for path in run.iterdir()))
            self.assertNotIn("ephemeral-test-token", "".join(path.read_text() for path in
                (run / "generation-receipt.json", run / "transport-summary.json", run / "upstream-response.json")))

    def test_live_descendant_prevents_successful_transport_even_after_turn_completed(self):
        with tempfile.TemporaryDirectory() as temporary:
            run, request = self.fixture(Path(temporary), "descendant")
            code, summary = self.execute(request)
            self.assertEqual(code, 1)
            self.assertEqual(summary["closure"], "completed")
            self.assertFalse(summary["transport_passed"])
            receipt = json.loads((run / "generation-receipt.json").read_text())
            self.assertFalse(receipt["transport"]["transport_passed"])


if __name__ == "__main__":
    unittest.main()
