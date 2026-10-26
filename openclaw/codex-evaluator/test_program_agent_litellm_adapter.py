"""Scoped offline terminal/attempt tests; never import the old probe's main."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import socket
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

for key, value in {"LITELLM_LOCAL_MODEL_COST_MAP": "True", "DO_NOT_TRACK": "1",
        "LITELLM_TELEMETRY": "False", "LITELLM_DISABLE_TELEMETRY": "True",
        "OTEL_SDK_DISABLED": "true"}.items():
    os.environ[key] = value

# Test-only network guard, installed before the adapter imports either SDK.
original_connect, original_getaddrinfo = socket.socket.connect, socket.getaddrinfo


def local_connect(sock, address):
    if not isinstance(address, tuple) or address[0] not in {"127.0.0.1", "::1"}:
        raise OSError("OFFLINE_TEST_NON_LOOPBACK_BLOCKED")
    return original_connect(sock, address)


def local_getaddrinfo(host, *args, **kwargs):
    if host not in {"127.0.0.1", "::1", "localhost"}:
        raise OSError("OFFLINE_TEST_DNS_BLOCKED")
    return original_getaddrinfo(host, *args, **kwargs)


socket.socket.connect, socket.getaddrinfo = local_connect, local_getaddrinfo
from program_agent_litellm_adapter import dispatch_litellm_candidate, TerminalRejected

HERE = Path(__file__).resolve().parent
CASES = json.loads((HERE / "fixtures/program-agent-stream-cases.json").read_text())["cases"]
MODEL = {"modelRef": "miaoda/glm-5.3", "displayName": "Synthetic", "providerKind": "BUILT_IN",
         "settingsRevision": 1, "selectedAt": "2026-10-26T00:00:00Z"}
SHA = lambda value: hashlib.sha256(value).hexdigest()


class FakeUpstream(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_):
        pass

    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        if self.path == "/synthetic-adapter":
            # Only the Node gateway fixture uses this test-only invocation
            # boundary. The product adapter defines no HTTP service.
            data = json.loads(body)
            result = asyncio.run(dispatch_litellm_candidate(
                client_request_bytes=base64.b64decode(data["clientRequestBytes"]),
                effective_request_bytes=base64.b64decode(data["effectiveRequestBytes"]),
                execution_model=data["executionModel"], max_output_tokens=data["maxOutputTokens"],
                native_admission=data["nativeAdmission"],
                directory=Path(data["directory"]), api_base=self.server.base,
                api_key="synthetic-not-a-credential", timeout_seconds=data["timeoutSeconds"],
                generation_deadline_at=data["generationDeadlineAt"]))
            response = json.dumps({key: base64.b64encode(value).decode() if isinstance(value, bytes) else value
                                   for key, value in result.items()}).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(response)))
            self.end_headers()
            self.wfile.write(response)
            return
        if self.path != "/v1/chat/completions":
            self.send_error(404)
            return
        self.server.posts.append({"path": self.path, "body": json.loads(body), "bodySha256": SHA(body)})
        case = self.server.case
        status = 503 if case == "http_503" else 200
        wire = (b'{"error":{"message":"synthetic 503"}}' if status == 503 else
                CASES["eof_no_finish" if case == "cancel" else case]["wire"].encode())
        self.send_response(status)
        self.send_header("Content-Type", "application/json" if status == 503 else "text/event-stream")
        self.send_header("Content-Length", str(len(wire) + (100 if case == "cancel" else 0)))
        self.end_headers()
        self.wfile.write(wire)
        self.wfile.flush()
        if case == "cancel":
            self.server.partial_sent.set()
            self.server.release.wait(20)
            self.close_connection = True


class AdapterTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        retained = os.environ.get("WISELINK_PROGRAM_AGENT_ADAPTER_ARTIFACT_ROOT")
        if retained:
            Path(retained).mkdir(parents=True, exist_ok=True)
        self.root = Path(tempfile.mkdtemp(prefix=self._testMethodName + "-", dir=retained))
        if not retained:
            import shutil
            self.addCleanup(shutil.rmtree, self.root)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), FakeUpstream)
        self.server.daemon_threads = True
        self.server.posts, self.server.case = [], "normal"
        self.server.base = f"http://127.0.0.1:{self.server.server_port}/v1"
        self.server.release, self.server.partial_sent = threading.Event(), threading.Event()
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    async def asyncTearDown(self):
        (self.root / "fake-upstream-posts.json").write_text(json.dumps(self.server.posts, indent=2) + "\n")
        self.server.release.set()
        await asyncio.to_thread(self.server.shutdown)
        self.server.server_close()
        self.thread.join()

    async def dispatch(self, case):
        self.server.case = case
        client = {"model": "glm-5.3", "stream": True,
                  "input": [{"role": "user", "content": "Synthetic terminal boundary fixture."}]}
        client_bytes = json.dumps(client).encode()
        effective_bytes = json.dumps({**client, "max_output_tokens": 131072}).encode()
        return await dispatch_litellm_candidate(client_request_bytes=client_bytes,
            effective_request_bytes=effective_bytes,
            native_admission={"version": 1, "ordinal": 1, "requestId": "synthetic-adapter-terminal",
                "bindingSha256": "a" * 64, "clientRequestSha256": SHA(client_bytes),
                "effectiveRequestSha256": SHA(effective_bytes), "executionModel": MODEL, "maxOutputTokens": 131072},
            execution_model=MODEL, max_output_tokens=131072, directory=self.root / "adapter",
            api_base=self.server.base, api_key="synthetic-not-a-credential", timeout_seconds=30)

    async def check_case(self, case):
        result = await self.dispatch(case)
        receipt = result["receipt"]
        self.assertEqual(len(self.server.posts), 1)
        self.assertEqual(receipt["internalHttpAttemptCount"], 1)
        self.assertEqual(receipt["blockedAdditionalHttpAttempts"], 0)
        self.assertEqual(self.server.posts[0]["body"]["max_tokens"], 131072)
        self.assertEqual(receipt["upstreamRequestSha256"], self.server.posts[0]["bodySha256"])
        self.assertEqual(receipt["upstreamResponseSha256"], SHA(result["upstreamResponseBytes"]))
        self.assertEqual(receipt["nativeAdmission"]["ordinal"], 1)
        self.assertEqual(receipt["nativeAdmission"]["effectiveRequestSha256"], receipt["effectiveRequestSha256"])
        events = json.loads((self.root / "adapter/parsed-response-events.json").read_text())
        types = [event["type"] for event in events]
        if case in {"normal", "finish_stop_no_done", "finish_then_usage", "tool_first"}:
            self.assertTrue(receipt["complete"], receipt)
            self.assertEqual(types[-1], "response.completed")
            self.assertTrue(receipt["terminal"]["seenValidTerminal"])
            self.assertTrue(receipt["terminal"]["sdkStreamExhausted"])
            if case == "finish_then_usage":
                self.assertEqual(receipt["terminal"]["usageAfterTerminalCount"], 1)
                self.assertEqual(events[-1]["response"]["usage"]["total_tokens"], 10)
            if case == "tool_first":
                self.assertEqual(receipt["upstreamFinishReason"], "tool_calls")
        else:
            self.assertFalse(receipt["complete"])
            self.assertNotIn("response.completed", types)
            if case in {"length", "content_filter"}:
                self.assertEqual(types[-1], "response.incomplete")
            else:
                self.assertEqual(result["responseBytes"], b"")
                self.assertIsNotNone(receipt["errorCode"])
        before = (self.root / "adapter/receipt.json").read_bytes()
        with self.assertRaisesRegex(TerminalRejected, "ADAPTER_OUTCOME_UNKNOWN"):
            await self.dispatch(case)
        self.assertEqual(len(self.server.posts), 1)
        self.assertEqual((self.root / "adapter/receipt.json").read_bytes(), before)
        self.assertNotIn("synthetic-not-a-credential", before.decode())

    async def test_http_503_retains_one_attempt_without_replay(self):
        await self.check_case("http_503")

    async def test_cancel_keeps_original_attempt_partial_bytes_and_unknown(self):
        task = asyncio.create_task(self.dispatch("cancel"))
        self.assertTrue(await asyncio.to_thread(self.server.partial_sent.wait, 10))
        # Server write/flush alone did not prove the client captured a byte.
        # Synchronize cancellation with the adapter's actual durable first block.
        async with asyncio.timeout(5):
            while not (self.root / "adapter/upstream-response.body").exists() or not (
                    self.root / "adapter/upstream-response.body").stat().st_size:
                await asyncio.sleep(0.01)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        receipt = json.loads((self.root / "adapter/receipt.json").read_text())
        self.assertFalse(receipt["complete"])
        self.assertTrue(receipt["cancelled"])
        self.assertEqual(receipt["errorCode"], "ADAPTER_CANCELLED_UNKNOWN")
        self.assertEqual(receipt["internalHttpAttemptCount"], 1)
        retained = (self.root / "adapter/upstream-response.body").read_bytes()
        self.assertGreater(len(retained), 0)
        self.assertEqual(retained, CASES["eof_no_finish"]["wire"].encode())
        self.assertEqual(receipt["upstreamResponseByteLength"], len(retained))
        self.assertEqual(receipt["upstreamResponseSha256"], SHA(retained))
        self.assertEqual(len(self.server.posts), 1)
        self.assertEqual((self.root / "adapter/response.sse").read_bytes(), b"")
        with self.assertRaisesRegex(TerminalRejected, "ADAPTER_OUTCOME_UNKNOWN"):
            await self.dispatch("cancel")
        self.assertEqual(len(self.server.posts), 1)

    async def gateway(self, case):
        self.server.case = case
        command = ["node", str(HERE / "program-agent-adapter.fixture.mjs"),
                   self.server.base.replace("/v1", "/synthetic-adapter"), str(self.root), case]
        process = await asyncio.create_subprocess_exec(*command, stdout=asyncio.subprocess.PIPE,
                                                      stderr=asyncio.subprocess.STDOUT)
        output, _ = await process.communicate()
        (self.root / "node.log").write_bytes(output)
        self.assertEqual(process.returncode, 0, output.decode())
        self.assertEqual(len(self.server.posts), 1)
        self.assertEqual(self.server.posts[0]["body"]["max_tokens"], 131072)

    async def test_actual_gateway_to_official_adapter_to_chat_131072_without_done(self):
        await self.gateway("finish_stop_no_done")

    async def test_gateway_tool_round_terminal_cannot_close_final_candidate(self):
        await self.gateway("tool_first")


for name in CASES:
    async def scoped(self, case=name):
        await self.check_case(case)
    setattr(AdapterTests, "test_terminal_" + name, scoped)

if __name__ == "__main__":
    unittest.main(verbosity=2)
