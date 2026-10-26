"""Only f1a seven-field selection/auth wiring; reuse existing offline streams."""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# Reuse established network guard/stream bytes; no old scenario is re-run.
import test_program_agent_litellm_adapter as streams
from program_agent_litellm_adapter import dispatch_litellm_candidate, TerminalRejected

HERE = Path(__file__).resolve().parent
SELECTION = json.loads((HERE / "fixtures/program-agent-host-f1a-task.json").read_text())["executionModel"]
SHA = lambda value: hashlib.sha256(value).hexdigest()


class ContractChat(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_):
        pass

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            self.send_error(404)
            return
        body = self.rfile.read(int(self.headers["Content-Length"]))
        self.server.posts.append({"body": json.loads(body), "sha256": SHA(body),
            "separateBearerMatches": self.headers.get("Authorization") == "Bearer synthetic-bearer-only",
            "separateXApiKeyMatches": self.headers.get("x-api-key") == "synthetic-header-only"})
        wire = streams.CASES["normal"]["wire"].encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(wire)))
        self.end_headers()
        self.wfile.write(wire)
        self.wfile.flush()


class HostContractAdapterTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        retained = os.environ.get("WISELINK_PROGRAM_AGENT_ADAPTER_ARTIFACT_ROOT")
        if retained:
            Path(retained).mkdir(parents=True, exist_ok=True)
        self.root = Path(tempfile.mkdtemp(prefix=self._testMethodName + "-", dir=retained))
        if not retained:
            import shutil
            self.addCleanup(shutil.rmtree, self.root)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), ContractChat)
        self.server.daemon_threads = True
        self.server.posts = []
        self.base = f"http://127.0.0.1:{self.server.server_port}/v1"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    async def asyncTearDown(self):
        (self.root / "fake-chat-posts.json").write_text(json.dumps(self.server.posts, indent=2) + "\n")
        await asyncio.to_thread(self.server.shutdown)
        self.server.server_close()
        self.thread.join()

    async def test_exact_host_selection_reaches_actual_adapter_two_posts_and_original_save_tail(self):
        # Same short loopback-only child wrapper used by the existing lifecycle
        # fixture; it blocks external DNS/connect in the spawned interpreter.
        python = self.root / "offline-python"
        python.write_text(f"#!{sys.executable}\n" + '''import runpy, socket, sys
original_connect, original_dns = socket.socket.connect, socket.getaddrinfo
def connect(sock, address):
    if not isinstance(address, tuple) or address[0] not in {'127.0.0.1', '::1'}:
        raise OSError('OFFLINE_TEST_NON_LOOPBACK_BLOCKED')
    return original_connect(sock, address)
def dns(host, *args, **kwargs):
    if host not in {'127.0.0.1', '::1', 'localhost'}:
        raise OSError('OFFLINE_TEST_DNS_BLOCKED')
    return original_dns(host, *args, **kwargs)
socket.socket.connect, socket.getaddrinfo = connect, dns
sys.dont_write_bytecode = True
sys.argv = sys.argv[1:]
if sys.argv[0] == '-B': sys.argv.pop(0)
runpy.run_path(sys.argv[0], run_name='__main__')
''')
        python.chmod(0o700)
        command = ["node", str(HERE / "program-agent-host-adapter.fixture.mjs"),
                   self.base, str(self.root), str(python)]
        process = await asyncio.create_subprocess_exec(*command, stdout=asyncio.subprocess.PIPE,
                                                      stderr=asyncio.subprocess.STDOUT)
        output, _ = await asyncio.wait_for(process.communicate(), 35)
        (self.root / "node.log").write_bytes(output)
        self.assertEqual(process.returncode, 0, output.decode())
        result = json.loads((self.root / "contract-adapter-result.json").read_text())
        self.assertEqual(len(self.server.posts), 2)
        for index, post in enumerate(self.server.posts):
            self.assertEqual(post["body"]["max_tokens"], 131072)
            self.assertTrue(post["separateBearerMatches"])
            self.assertTrue(post["separateXApiKeyMatches"])
            self.assertEqual(result["receipts"][index]["upstreamRequestSha256"], post["sha256"])
        self.assertEqual(result["selection"], SELECTION)
        self.assertEqual(result["saveCalls"], 1)
        self.assertEqual(result["recoveryDispatches"], 0)
        self.assertEqual(result["outcome"]["status"], "INITIAL_STAGE_SAVED")
        self.assertIsNone(result["actualUsageTokens"])

    async def test_invalid_v2_budget_or_header_fails_before_any_http_attempt(self):
        client = json.dumps({"model": "glm-5.3", "stream": True, "input": []}).encode()
        effective = json.dumps({"model": "glm-5.3", "stream": True, "input": [], "max_output_tokens": 131072}).encode()
        cases = [
            ("budget-mismatch", {**SELECTION, "maxOutputTokens": 64000}, {}),
            ("unsafe-budget", {**SELECTION, "maxOutputTokens": 9007199254740992}, {}),
            ("boolean-budget", {**SELECTION, "maxOutputTokens": True}, {}),
            ("missing-version", {k: v for k, v in SELECTION.items() if k != "schemaVersion"}, {}),
            ("extra-field", {**SELECTION, "extra": True}, {}),
            ("unsaved-settings", {**SELECTION, "settingsRevision": 0}, {}),
            ("unauthorized-header", SELECTION, {"Cookie": "synthetic"}),
            ("header-injection", SELECTION, {"x-api-key": "synthetic\r\nextra"}),
        ]
        evidence = []
        for name, selection, headers in cases:
            with self.subTest(case=name):
                directory = self.root / name
                with self.assertRaisesRegex(TerminalRejected, "ADAPTER_(SELECTION_BINDING|HEADER)_INVALID"):
                    await dispatch_litellm_candidate(client_request_bytes=client, effective_request_bytes=effective,
                        execution_model=selection, max_output_tokens=131072,
                        native_admission={"version": 1, "requestId": "synthetic-v2-rejection", "ordinal": 1,
                            "bindingSha256": "a" * 64, "clientRequestSha256": SHA(client),
                            "effectiveRequestSha256": SHA(effective), "executionModel": selection,
                            "maxOutputTokens": 131072}, directory=directory, api_base=self.base,
                        api_key="synthetic-bearer-only", headers=headers, timeout_seconds=10)
                self.assertEqual(len(self.server.posts), 0)
                self.assertFalse(directory.exists())
                evidence.append({"case": name, "httpAttempts": 0, "adapterDirectoryCreated": False})
        (self.root / "pre-dispatch-rejections.json").write_text(json.dumps(evidence, indent=2) + "\n")


if __name__ == "__main__":
    unittest.main(verbosity=2)
