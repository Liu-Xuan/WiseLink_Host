"""Self-contained offline deadline/cancellation regressions for pinned SDKs.

Run with Python 3.10.12 and LiteLLM 1.106.4 / OpenAI 2.54.0:
    python -B -m unittest -v test_program_agent_python310_deadline
The SDK environment also needs mcp 2.3.0, as in the original adapter test package.
Only loopback is allowed, including in the SIGTERM child. All inputs are synthetic.
Set WISELINK_PY310_TEST_ARTIFACT_ROOT to retain per-case receipts and HTTP evidence.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import socket
import sys
import tempfile
import time
import unittest
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path
from unittest.mock import patch

from program_agent_litellm_adapter import (
    TerminalRejected, _await_until_deadline, dispatch_litellm_candidate,
)

HERE = Path(__file__).resolve().parent
SHA = lambda value: hashlib.sha256(value).hexdigest()
SELECTION = {
    "schemaVersion": "wiselink.3_1.execution_model_selection.v2",
    "modelRef": "miaoda/glm-5.3", "displayName": "synthetic GLM 5.3",
    "providerKind": "miaoda", "settingsRevision": 1,
    "selectedAt": "2026-10-26T00:00:00.000Z", "maxOutputTokens": 131072,
}
OFFLINE_ENV = {
    "LITELLM_LOCAL_MODEL_COST_MAP": "True", "DO_NOT_TRACK": "1",
    "LITELLM_TELEMETRY": "False", "LITELLM_DISABLE_TELEMETRY": "True",
    "OTEL_SDK_DISABLED": "true", "PYTHONDONTWRITEBYTECODE": "1",
}
NETWORK_GUARD = '''import runpy, socket, sys
connect, connect_ex, dns = socket.socket.connect, socket.socket.connect_ex, socket.getaddrinfo
def check(address):
    if not isinstance(address, tuple) or address[0] not in {'127.0.0.1', '::1'}:
        raise OSError('OFFLINE_TEST_NON_LOOPBACK_BLOCKED')
def guarded_connect(sock, address):
    check(address)
    return connect(sock, address)
def guarded_connect_ex(sock, address):
    check(address)
    return connect_ex(sock, address)
def guarded_dns(host, *args, **kwargs):
    if host not in {'127.0.0.1', '::1', 'localhost'}:
        raise OSError('OFFLINE_TEST_DNS_BLOCKED')
    return dns(host, *args, **kwargs)
socket.socket.connect, socket.socket.connect_ex = guarded_connect, guarded_connect_ex
socket.getaddrinfo = guarded_dns
'''


def setUpModule():
    global _environment, _network
    _environment = patch.dict(os.environ, OFFLINE_ENV)
    _environment.start()
    guard = {}
    exec(NETWORK_GUARD, guard)
    _network = guard


def tearDownModule():
    socket.socket.connect = _network["connect"]
    socket.socket.connect_ex = _network["connect_ex"]
    socket.getaddrinfo = _network["dns"]
    _environment.stop()


def deadline_after(seconds):
    return datetime.fromtimestamp(time.time() + seconds, timezone.utc).isoformat()


async def observe_cancellation(coro, observed):
    # 3.10 does not retain msg when a cancelled Task is awaited. Observe the
    # original propagated exception inside that Task, before that boundary.
    try:
        return await coro
    except asyncio.CancelledError as exc:
        observed.append(exc.args)
        raise


def chat_chunk(delta, reason=None, usage=None):
    value = {"id": "chatcmpl-synthetic-python310", "object": "chat.completion.chunk",
             "created": 1, "model": "glm-5.3",
             "choices": [{"index": 0, "delta": delta, "finish_reason": reason}]}
    if usage is not None:
        value["choices"], value["usage"] = [], usage
    return ("data: " + json.dumps(value) + "\n\n").encode()


PARTIAL_WIRE = chat_chunk({"role": "assistant", "content": "synthetic partial"})
NORMAL_WIRE = (PARTIAL_WIRE + chat_chunk({}, "stop") + chat_chunk({}, usage={
    "prompt_tokens": 2, "completion_tokens": 3, "total_tokens": 5}) + b"data: [DONE]\n\n")


class DeadlineWaitTests(unittest.IsolatedAsyncioTestCase):
    async def test_normal_completion_and_exception_propagate(self):
        async def work():
            await asyncio.sleep(0)
            return "completed"
        self.assertEqual(await _await_until_deadline(work(), self._deadline()), "completed")
        failure = ValueError("synthetic")
        async def failing():
            raise failure
        with self.assertRaises(ValueError) as caught:
            await _await_until_deadline(failing(), self._deadline())
        self.assertIs(caught.exception, failure)

    def _deadline(self):
        return asyncio.get_running_loop().time() + 10

    async def test_deadline_waits_for_cancel_cleanup(self):
        cleaned = asyncio.Event()
        async def work():
            try:
                await asyncio.sleep(10)
            finally:
                await asyncio.sleep(0)
                cleaned.set()
        with self.assertRaises(TimeoutError):
            await _await_until_deadline(work(), asyncio.get_running_loop().time() + 0.02)
        self.assertTrue(cleaned.is_set())

    async def test_expired_deadline_closes_unstarted_generation(self):
        started = asyncio.Event()
        async def work():
            started.set()
            await asyncio.sleep(0)
        coro = work()
        with self.assertRaises(TimeoutError):
            await _await_until_deadline(coro, asyncio.get_running_loop().time() - 1)
        self.assertFalse(started.is_set())
        self.assertIsNone(coro.cr_frame, "expired generation coroutine must be closed")

    async def test_external_cancel_wins_when_child_completes_same_turn(self):
        completed = asyncio.Event()
        observed = []
        async def work():
            completed.set()
            parent.cancel("synthetic external")
            return "must not escape"
        parent = asyncio.create_task(observe_cancellation(
            _await_until_deadline(work(), self._deadline()), observed))
        with self.assertRaises(asyncio.CancelledError) as caught:
            await parent
        self.assertEqual(observed, [("synthetic external",)])
        self.assertTrue(completed.is_set())
        self.assertTrue(parent.cancelled())

    async def test_external_cancel_during_deadline_cleanup_stays_cancelled(self):
        cleanup_started, cleanup_done = asyncio.Event(), asyncio.Event()
        release = asyncio.Event()
        observed = []
        async def work():
            try:
                await asyncio.sleep(10)
            finally:
                cleanup_started.set()
                await release.wait()
                cleanup_done.set()
        parent = asyncio.create_task(observe_cancellation(_await_until_deadline(
            work(), asyncio.get_running_loop().time() + 0.02), observed))
        await asyncio.wait_for(cleanup_started.wait(), 2)
        parent.cancel("external during deadline drain")
        await asyncio.sleep(0)
        release.set()
        with self.assertRaises(asyncio.CancelledError) as caught:
            await parent
        self.assertEqual(observed, [("external during deadline drain",)])
        self.assertTrue(cleanup_done.is_set())

    async def test_repeated_external_cancel_waits_for_cleanup(self):
        started, cleanup_started, cleanup_done = (asyncio.Event() for _ in range(3))
        release = asyncio.Event()
        observed = []
        async def work():
            started.set()
            try:
                await asyncio.sleep(10)
            finally:
                cleanup_started.set()
                await release.wait()
                cleanup_done.set()
        parent = asyncio.create_task(observe_cancellation(
            _await_until_deadline(work(), self._deadline()), observed))
        await started.wait()
        parent.cancel("first external")
        await cleanup_started.wait()
        parent.cancel("second external")
        await asyncio.sleep(0)
        release.set()
        with self.assertRaises(asyncio.CancelledError) as caught:
            await parent
        self.assertEqual(observed, [("first external",)])
        self.assertTrue(cleanup_done.is_set())

    async def test_cleanup_failure_does_not_replace_external_cancel(self):
        started = asyncio.Event()
        observed = []
        async def work():
            started.set()
            try:
                await asyncio.sleep(10)
            finally:
                raise ValueError("synthetic cleanup failure")
        parent = asyncio.create_task(observe_cancellation(
            _await_until_deadline(work(), self._deadline()), observed))
        await started.wait()
        parent.cancel("external")
        with self.assertRaises(asyncio.CancelledError) as caught:
            await parent
        self.assertEqual(observed, [("external",)])

    async def test_child_cancel_is_not_reclassified_as_deadline(self):
        async def work():
            raise asyncio.CancelledError("child cancellation")
        with self.assertRaises(asyncio.CancelledError) as caught:
            await _await_until_deadline(work(), self._deadline())

    async def test_absolute_deadline_cancels_before_same_turn_completion(self):
        loop = asyncio.get_running_loop()
        release, completed = asyncio.Event(), asyncio.Event()
        deadline = loop.time() + 0.02
        # Register release first: a relative wait timeout would let the child
        # return before its parent resumes. The absolute callback must cancel it.
        loop.call_at(deadline, release.set)
        async def work():
            await release.wait()
            completed.set()
            return "must not escape after deadline"
        with self.assertRaises(TimeoutError):
            await _await_until_deadline(work(), deadline)
        self.assertFalse(completed.is_set())

    async def test_deadline_preserves_cleanup_exception_and_suppression(self):
        async def cleanup_failure():
            try:
                await asyncio.sleep(10)
            finally:
                raise ValueError("cleanup")
        with self.assertRaises(ValueError):
            await _await_until_deadline(cleanup_failure(), asyncio.get_running_loop().time() + 0.02)
        async def suppress():
            try:
                await asyncio.sleep(10)
            except asyncio.CancelledError:
                return "same as native timeout context"
        self.assertEqual(await _await_until_deadline(
            suppress(), asyncio.get_running_loop().time() + 0.02), "same as native timeout context")


class AdapterDeadlineTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.assertEqual(version("litellm"), "1.106.4")
        self.assertEqual(version("openai"), "2.54.0")
        # Warm imports outside the short synthetic generation budgets.
        import litellm
        import openai
        retained = os.environ.get("WISELINK_PY310_TEST_ARTIFACT_ROOT")
        if retained:
            Path(retained).mkdir(parents=True, exist_ok=True)
        self.root = Path(tempfile.mkdtemp(prefix=self._testMethodName + "-", dir=retained))
        if not retained:
            self.addCleanup(shutil.rmtree, self.root)
        self.posts, self.handlers, self.writers = [], set(), set()
        self.mode, self.stop_stream = "normal", asyncio.Event()
        self.server = await asyncio.start_server(self._handle, "127.0.0.1", 0)
        self.base = "http://127.0.0.1:%d/v1" % self.server.sockets[0].getsockname()[1]

    async def asyncTearDown(self):
        self.stop_stream.set()
        self.server.close()
        await self.server.wait_closed()
        for writer in list(self.writers):
            writer.close()
        if self.handlers:
            await asyncio.gather(*list(self.handlers), return_exceptions=True)
        (self.root / "fake-http-posts.json").write_text(json.dumps(self.posts, indent=2) + "\n")
        pending = [task for task in asyncio.all_tasks()
                   if "dispatch_litellm_candidate.<locals>.generate" in task.get_coro().__qualname__]
        self.assertEqual(pending, [], "generation task outlived adapter/evidence cleanup")

    async def _handle(self, reader, writer):
        task = asyncio.current_task()
        self.handlers.add(task)
        self.writers.add(writer)
        try:
            header = await reader.readuntil(b"\r\n\r\n")
            lines = header.decode().split("\r\n")
            headers = dict(line.split(": ", 1) for line in lines[1:] if line)
            lower = {key.lower(): value for key, value in headers.items()}
            body = await reader.readexactly(int(lower["content-length"]))
            self.posts.append({"requestLine": lines[0], "body": json.loads(body),
                "sha256": SHA(body), "bearerMatches": lower.get("authorization") == "Bearer synthetic-key",
                "headerMatches": lower.get("x-api-key") == "synthetic-header"})
            if self.mode == "slow":
                writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n"
                             b"Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n")
                part = PARTIAL_WIRE
                while not self.stop_stream.is_set():
                    writer.write(("%x\r\n" % len(part)).encode() + part + b"\r\n")
                    await writer.drain()
                    await asyncio.sleep(0.025)
                    part = b": synthetic keepalive\n\n"
            else:
                payload = (b'{"error":{"message":"synthetic unavailable"}}' if self.mode == "503"
                           else PARTIAL_WIRE if self.mode == "eof" else NORMAL_WIRE)
                status = b"503 Service Unavailable" if self.mode == "503" else b"200 OK"
                writer.write(b"HTTP/1.1 " + status + b"\r\nContent-Type: text/event-stream\r\n"
                             b"Content-Length: " + str(len(payload)).encode() +
                             b"\r\nConnection: close\r\n\r\n" + payload)
                await writer.drain()
        except (ConnectionError, asyncio.IncompleteReadError):
            pass
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except ConnectionError:
                pass
            self.writers.discard(writer)
            self.handlers.discard(task)

    def _request(self, *, deadline=None, timeout=10):
        client = json.dumps({"model": "glm-5.3", "stream": True,
            "input": [{"role": "user", "content": "synthetic test only"}]}).encode()
        effective = json.dumps({**json.loads(client), "max_output_tokens": 131072}).encode()
        deadline = deadline if deadline is not None else deadline_after(10)
        admission = {"version": 1, "requestId": "synthetic-python310", "ordinal": 1,
            "bindingSha256": "a" * 64, "clientRequestSha256": SHA(client),
            "effectiveRequestSha256": SHA(effective), "executionModel": SELECTION,
            "maxOutputTokens": 131072, "generationDeadlineAt": deadline}
        return dict(client_request_bytes=client, effective_request_bytes=effective,
            execution_model=SELECTION, max_output_tokens=131072, native_admission=admission,
            directory=self.root / "adapter", api_base=self.base, api_key="synthetic-key",
            headers={"x-api-key": "synthetic-header"}, timeout_seconds=timeout,
            generation_deadline_at=deadline)

    async def _partial_saved(self):
        path = self.root / "adapter/upstream-response.body"
        until = asyncio.get_running_loop().time() + 10
        while not path.exists() or path.stat().st_size == 0:
            if asyncio.get_running_loop().time() >= until:
                self.fail("synthetic partial response was not persisted")
            await asyncio.sleep(0.005)

    def _receipt(self):
        return json.loads((self.root / "adapter/receipt.json").read_text())

    def _assert_unknown_evidence(self, code, deadline):
        receipt = self._receipt()
        self.assertFalse(receipt["complete"])
        self.assertTrue(receipt["cancelled"])
        self.assertEqual(receipt["errorCode"], code)
        self.assertEqual(receipt["generationDeadlineAt"], deadline)
        self.assertEqual(receipt["deadlineBasis"], "SEALED_ABSOLUTE")
        self.assertEqual(receipt["internalHttpAttemptCount"], 1)
        self.assertEqual(receipt["blockedAdditionalHttpAttempts"], 0)
        self.assertFalse(receipt["transportCleanEnd"])
        body = (self.root / "adapter/upstream-response.body").read_bytes()
        self.assertTrue(body.startswith(PARTIAL_WIRE))
        self.assertEqual(receipt["upstreamResponseSha256"], SHA(body))
        self.assertEqual(receipt["upstreamResponseByteLength"], len(body))
        self.assertEqual((self.root / "adapter/response.sse").read_bytes(), b"")
        self.assertEqual(receipt["responseSha256"], SHA(b""))
        self.assertEqual(json.loads((self.root / "adapter/parsed-response-events.json").read_text()), [])
        self.assertEqual(len(self.posts), 1)

    async def test_normal_completion_keeps_bound_receipt_and_single_post(self):
        request = self._request()
        result = await dispatch_litellm_candidate(**request)
        receipt = result["receipt"]
        self.assertTrue(receipt["complete"])
        self.assertEqual(receipt["nativeAdmission"], request["native_admission"])
        self.assertEqual(receipt["executionModel"], SELECTION)
        self.assertEqual(receipt["generationDeadlineAt"], request["generation_deadline_at"])
        self.assertEqual(receipt["terminal"]["usageAfterTerminalCount"], 1)
        self.assertEqual(receipt["internalHttpAttemptCount"], 1)
        self.assertEqual(receipt["blockedAdditionalHttpAttempts"], 0)
        self.assertEqual(len(self.posts), 1)
        self.assertEqual(self.posts[0]["requestLine"], "POST /v1/chat/completions HTTP/1.1")
        self.assertEqual(self.posts[0]["body"]["max_tokens"], 131072)
        self.assertTrue(self.posts[0]["bearerMatches"] and self.posts[0]["headerMatches"])
        self.assertEqual(receipt["upstreamRequestSha256"], self.posts[0]["sha256"])
        self.assertEqual(result["upstreamResponseBytes"], NORMAL_WIRE)
        self.assertIn(b"event: response.completed\n", result["responseBytes"])

    async def test_expired_sealed_deadline_rejects_before_http(self):
        request = self._request(deadline=deadline_after(-1))
        with self.assertRaisesRegex(TerminalRejected, "^ADAPTER_DEADLINE_EXPIRED$"):
            await dispatch_litellm_candidate(**request)
        self.assertEqual(self.posts, [])
        self.assertFalse(request["directory"].exists())

    async def test_slow_chunks_do_not_renew_sealed_deadline_and_unknown_is_not_replayed(self):
        self.mode = "slow"
        request = self._request(deadline=deadline_after(0.35), timeout=10)
        start = time.monotonic()
        result = await dispatch_litellm_candidate(**request)
        self.assertLess(time.monotonic() - start, 2)
        self.assertEqual(result["responseBytes"], b"")
        self._assert_unknown_evidence("ADAPTER_DEADLINE_EXPIRED_UNKNOWN", request["generation_deadline_at"])
        before = {p.name: p.read_bytes() for p in request["directory"].iterdir()}
        # A fresh synthetic allowance cannot authorize reuse of an UNKNOWN directory.
        retry = self._request()
        with self.assertRaisesRegex(TerminalRejected, "^ADAPTER_OUTCOME_UNKNOWN$"):
            await dispatch_litellm_candidate(**retry)
        self.assertEqual(len(self.posts), 1)
        self.assertEqual(before, {p.name: p.read_bytes() for p in request["directory"].iterdir()})

    async def test_setup_time_is_deducted_from_original_deadline(self):
        from program_agent_litellm_adapter import durable_json
        request = self._request(deadline=deadline_after(0.1))
        def delayed_admission(path, value):
            durable_json(path, value)
            if path.name == "admission.json":
                time.sleep(0.15)
        with patch("program_agent_litellm_adapter.durable_json", delayed_admission):
            result = await dispatch_litellm_candidate(**request)
        self.assertEqual(self.posts, [])
        self.assertFalse(result["receipt"]["complete"])
        self.assertEqual(result["receipt"]["internalHttpAttemptCount"], 0)
        self.assertEqual(result["receipt"]["generationDeadlineAt"], request["generation_deadline_at"])
        self.assertEqual(result["receipt"]["errorCode"], "ADAPTER_DEADLINE_EXPIRED_UNKNOWN")

    async def test_external_cancel_preserves_partial_evidence_and_propagates(self):
        self.mode = "slow"
        request = self._request()
        observed = []
        parent = asyncio.create_task(observe_cancellation(
            dispatch_litellm_candidate(**request), observed))
        await self._partial_saved()
        parent.cancel("synthetic external cancellation")
        with self.assertRaises(asyncio.CancelledError) as caught:
            await parent
        self.assertEqual(observed, [("synthetic external cancellation",)])
        self._assert_unknown_evidence("ADAPTER_CANCELLED_UNKNOWN", request["generation_deadline_at"])

    async def test_eof_without_terminal_keeps_partial_bytes_without_completion(self):
        self.mode = "eof"
        result = await dispatch_litellm_candidate(**self._request())
        self.assertFalse(result["receipt"]["complete"])
        self.assertEqual(result["receipt"]["errorCode"], "CHAT_EOF_WITHOUT_VALID_TERMINAL")
        self.assertEqual(result["responseBytes"], b"")
        self.assertEqual(result["upstreamResponseBytes"], PARTIAL_WIRE)
        self.assertEqual(len(self.posts), 1)
        self.assertEqual(result["receipt"]["blockedAdditionalHttpAttempts"], 0)

    async def test_provider_error_does_not_retry(self):
        self.mode = "503"
        result = await dispatch_litellm_candidate(**self._request())
        self.assertFalse(result["receipt"]["complete"])
        self.assertEqual(result["responseBytes"], b"")
        self.assertEqual(result["receipt"]["internalHttpAttemptCount"], 1)
        self.assertEqual(result["receipt"]["blockedAdditionalHttpAttempts"], 0)
        self.assertEqual(len(self.posts), 1)

    async def test_stdio_sigterm_stops_http_preserves_evidence_and_exits_130(self):
        import base64
        self.mode = "slow"
        request = self._request()
        value = {"clientRequestBytes": base64.b64encode(request["client_request_bytes"]).decode(),
            "effectiveRequestBytes": base64.b64encode(request["effective_request_bytes"]).decode(),
            "executionModel": SELECTION, "maxOutputTokens": 131072,
            "nativeAdmission": request["native_admission"], "directory": str(request["directory"]),
            "apiBase": self.base, "apiKey": "synthetic-key", "headers": request["headers"],
            "timeoutSeconds": 10, "generationDeadlineAt": request["generation_deadline_at"]}
        bootstrap = NETWORK_GUARD + "\nsys.argv=sys.argv[1:]\nrunpy.run_path(sys.argv[0], run_name='__main__')\n"
        process = await asyncio.create_subprocess_exec(sys.executable, "-B", "-c", bootstrap,
            str(HERE / "program_agent_litellm_adapter.py"), "--dispatch-stdio",
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            env={**os.environ, **OFFLINE_ENV})
        try:
            process.stdin.write(json.dumps(value).encode())
            await process.stdin.drain()
            process.stdin.close()
            await self._partial_saved()
            process.terminate()
            stdout, stderr = await asyncio.wait_for(process.communicate(), 5)
        finally:
            if process.returncode is None:
                process.kill()
                await process.wait()
        (self.root / "child-process.json").write_text(json.dumps({"exitCode": process.returncode,
            "stdoutBytes": len(stdout), "stderrBytes": len(stderr)}) + "\n")
        self.assertEqual(process.returncode, 130)
        self.assertEqual(stdout, b"")
        self.assertNotIn(b"synthetic-key", stderr)
        self._assert_unknown_evidence("ADAPTER_CANCELLED_UNKNOWN", request["generation_deadline_at"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
