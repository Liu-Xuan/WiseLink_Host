"""Only the affected gateway/process/adapter lifecycle; no real CLI/model/Host."""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# Reuse the established no-external-network guard and exact stream byte fixtures.
# Importing this module does not execute its tests.
import test_program_agent_litellm_adapter as terminal_fixture

HERE = Path(__file__).resolve().parent


class LifecycleUpstream(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_):
        pass

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            self.send_error(404)
            return
        body = self.rfile.read(int(self.headers["Content-Length"]))
        self.server.posts.append({"body": json.loads(body), "sha256": hashlib.sha256(body).hexdigest()})
        complete = self.server.scenario == "normal"
        wire = terminal_fixture.CASES["normal" if complete else "eof_no_finish"]["wire"].encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(wire) + (0 if complete else 128)))
        self.end_headers()
        self.wfile.write(wire)
        self.wfile.flush()
        if not complete:
            # No terminal: the adapter must really close this active connection.
            self.connection.settimeout(12)
            try:
                if self.connection.recv(1) == b"":
                    self.server.disconnected.set()
            except OSError:
                pass
            self.close_connection = True


class LifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def run_case(self, scenario):
        retained = os.environ.get("WISELINK_PROGRAM_AGENT_ADAPTER_ARTIFACT_ROOT")
        if retained:
            Path(retained).mkdir(parents=True, exist_ok=True)
        root = Path(tempfile.mkdtemp(prefix=f"runtime-{scenario}-", dir=retained))
        if not retained:
            import shutil
            self.addCleanup(shutil.rmtree, root)
        server = ThreadingHTTPServer(("127.0.0.1", 0), LifecycleUpstream)
        server.daemon_threads = True
        server.scenario, server.posts, server.disconnected = scenario, [], threading.Event()
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        # Keep the actual pinned Python interpreter/adapter while blocking all
        # non-loopback connections in the independently spawned child too.
        import sys
        python = root / "offline-python"
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
        try:
            command = ["node", str(HERE / "program-agent-runtime.fixture.mjs"),
                       f"http://127.0.0.1:{server.server_port}/v1", str(root), scenario, str(python)]
            process = await asyncio.create_subprocess_exec(*command, stdout=asyncio.subprocess.PIPE,
                                                          stderr=asyncio.subprocess.STDOUT)
            output, _ = await asyncio.wait_for(process.communicate(), 35)
            (root / "node.log").write_bytes(output)
            self.assertEqual(process.returncode, 0, output.decode())
            result = json.loads((root / "runtime-result.json").read_text())
            self.assertEqual(len(server.posts), 1)
            self.assertEqual(server.posts[0]["body"]["max_tokens"], 131072)
            self.assertEqual(result["receipt"]["upstreamRequestSha256"], server.posts[0]["sha256"])
            self.assertEqual(result["providerCalls"], 1)
            self.assertEqual(result["saveCalls"], 0)
            self.assertEqual(result["recoveryDispatches"], 0)
            self.assertTrue(result["parentSignalForwarded"])
            if scenario != "normal":
                self.assertTrue(await asyncio.to_thread(server.disconnected.wait, 2),
                                "actual upstream socket must be closed before the test returns")
                capture = json.loads((root / "capture-before-stop.json").read_text())
                retained_bytes = next(root.glob("runs/*/dispatch-1.adapter/upstream-response.body")).read_bytes()
                self.assertGreater(capture["byteLength"], 0)
                self.assertEqual(capture["sha256"], hashlib.sha256(retained_bytes).hexdigest())
                self.assertEqual(retained_bytes, terminal_fixture.CASES["eof_no_finish"]["wire"].encode())
                self.assertEqual(result["receipt"]["upstreamResponseByteLength"], len(retained_bytes))
            else:
                self.assertTrue(result["receipt"]["complete"])
                self.assertEqual(result["processReceipt"]["exitCode"], 0)
        finally:
            (root / "fake-upstream-posts.json").write_text(json.dumps(server.posts, indent=2) + "\n")
            await asyncio.to_thread(server.shutdown)
            server.server_close()
            thread.join()

    async def test_parent_cancel_closes_actual_adapter_after_durable_first_chunk(self):
        await self.run_case("cancel")

    async def test_lease_failure_closes_actual_adapter_after_durable_first_chunk(self):
        await self.run_case("lease")

    async def test_sealed_remaining_deadline_closes_actual_adapter_without_renewal(self):
        await self.run_case("deadline")

    async def test_normal_actual_process_adapter_keeps_complete_receipt_and_exact_cap(self):
        await self.run_case("normal")


if __name__ == "__main__":
    unittest.main(verbosity=2)
