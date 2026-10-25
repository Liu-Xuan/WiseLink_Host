"""Focused tests for the opt-in Responses bridge, with no upstream requests."""
import importlib.util
import io
import json
import pathlib
import tempfile
import unittest
from unittest import mock

MODULE = pathlib.Path(__file__).with_name("miaoda_responses_bridge.py")
spec = importlib.util.spec_from_file_location("miaoda_responses_bridge", MODULE)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

ALLOWED = frozenset({"mcp__assessment__read_current", "mcp__assessment__list_sources"})


def body(input_items=None):
    return {
        "model": bridge.MODEL,
        "stream": True,
        "input": input_items or [{"role": "user", "content": [{"type": "input_text", "text": "Assess"}]}],
        "tools": [
            {"type": "function", "name": name, "parameters": {"type": "object", "properties": {}}}
            for name in sorted(ALLOWED)
        ] + [
            {"type": "function", "name": "exec_command", "parameters": {"type": "object"}},
            {"type": "web_search"},
        ],
    }

def namespaced_body(input_items=None):
    result = body(input_items)
    result["tools"] = [
        {"type": "namespace", "name": "mcp__assessment", "description": "Assessment tools", "tools": [
            {"type": "function", "name": "read_current", "parameters": {"type": "object"}},
            {"type": "function", "name": "list_sources", "parameters": {"type": "object"}},
            {"type": "function", "name": "unlisted", "parameters": {"type": "object"}},
        ]},
        {"type": "namespace", "name": "mcp__other", "tools": [{"type": "function", "name": "execute", "parameters": {"type": "object"}}]},
        {"type": "function", "name": "exec_command", "parameters": {"type": "object"}},
    ]
    return result


class Handler:
    def __init__(self):
        self.wfile = io.BytesIO()


def events(handler):
    return [json.loads(chunk.split("data: ", 1)[1]) for chunk in handler.wfile.getvalue().decode().split("\n\n") if "data: " in chunk]


class BridgeTests(unittest.TestCase):
    def test_generation_empty_allowlist_filters_all_builtin_tools_and_rejects_calls(self):
        offered = body()
        payload, returned = bridge.convert_request(offered, frozenset(), 512)
        self.assertNotIn("tools", payload)
        self.assertEqual(returned, [])
        emitter = bridge.Emitter(Handler(), frozenset())
        emitter.delta({"tool_calls": [{"index": 0, "id": "call_builtin", "function": {"name": "exec_command", "arguments": "{}"}}]})
        with self.assertRaisesRegex(bridge.Rejected, "tool_not_allowed"):
            emitter.complete()

    def test_namespace_only_flattens_exact_allowed_children(self):
        selected = {}
        payload, returned = bridge.convert_request(namespaced_body(), ALLOWED, 8192, selected)
        self.assertEqual({t["function"]["name"] for t in payload["tools"]}, ALLOWED)
        self.assertEqual(selected["mcp__assessment__read_current"], ("mcp__assessment", "read_current"))
        self.assertEqual(returned, [])
        missing = namespaced_body()
        missing["tools"][0]["tools"] = missing["tools"][0]["tools"][1:]
        with self.assertRaisesRegex(bridge.Rejected, "allowed_tool_schema_missing"):
            bridge.convert_request(missing, ALLOWED, 8192)
        wrong_type = namespaced_body()
        wrong_type["tools"][0]["tools"][0]["type"] = "custom"
        with self.assertRaisesRegex(bridge.Rejected, "unsupported_allowed_tool_type"):
            bridge.convert_request(wrong_type, ALLOWED, 8192)

    def test_namespace_history_and_emission_roundtrip(self):
        history = [
            {"type": "function_call", "namespace": "mcp__assessment", "name": "read_current", "call_id": "call_NS", "arguments": "{}"},
            {"type": "function_call_output", "call_id": "call_NS", "output": "observed"},
            {"role": "user", "content": "continue"},
        ]
        selected = {}
        payload, returned = bridge.convert_request(namespaced_body(history), ALLOWED, 8192, selected)
        self.assertEqual(payload["messages"][0]["tool_calls"][0]["function"]["name"], "mcp__assessment__read_current")
        self.assertEqual(payload["messages"][1]["tool_call_id"], "call_NS")
        self.assertEqual(returned, ["call_NS"])
        handler = Handler()
        emitter = bridge.Emitter(handler, ALLOWED, selected)
        emitter.delta({"tool_calls": [{"index": 0, "id": "call_NEW", "function": {"name": "mcp__assessment__read_current", "arguments": "{}"}}]})
        emitter.complete()
        item = next(e["item"] for e in events(handler) if e["type"] == "response.output_item.done")
        self.assertEqual((item["namespace"], item["name"], item["call_id"]), ("mcp__assessment", "read_current", "call_NEW"))
        history[0]["namespace"] = "mcp__other"
        with self.assertRaisesRegex(bridge.Rejected, "tool_not_allowed"):
            bridge.convert_request(namespaced_body(history), ALLOWED, 8192)

    def test_only_registered_mcp_schemas_reach_upstream(self):
        payload, returned = bridge.convert_request(body(), ALLOWED, 8192)
        self.assertEqual({t["function"]["name"] for t in payload["tools"]}, ALLOWED)
        self.assertEqual(payload["max_tokens"], 8192)
        self.assertEqual(returned, [])
        missing = body()
        missing["tools"] = missing["tools"][1:]
        with self.assertRaisesRegex(bridge.Rejected, "allowed_tool_schema_missing"):
            bridge.convert_request(missing, ALLOWED, 8192)

    def test_history_preserves_ids_and_text_and_rejects_foreign_names(self):
        items = [
            {"type": "function_call", "call_id": "call_A", "name": "mcp__assessment__read_current", "arguments": '{"matterId":"M1"}'},
            {"type": "function_call_output", "call_id": "call_A", "output": [{"type": "input_text", "text": "alpha"}, {"type": "input_text", "text": "beta"}]},
            {"role": "user", "content": "continue"},
        ]
        payload, returned = bridge.convert_request(body(items), ALLOWED, 400)
        self.assertEqual(payload["messages"][0]["tool_calls"][0]["id"], "call_A")
        self.assertEqual(payload["messages"][1], {"role": "tool", "tool_call_id": "call_A", "content": "alphabeta"})
        self.assertEqual(returned, ["call_A"])
        items[0]["name"] = "exec_command"
        with self.assertRaisesRegex(bridge.Rejected, "tool_not_allowed"):
            bridge.convert_request(body(items), ALLOWED, 400)

    def test_forbidden_upstream_call_never_emits_function_event(self):
        handler = Handler()
        emitter = bridge.Emitter(handler, ALLOWED)
        emitter.delta({"tool_calls": [{"index": 0, "id": "call_B", "type": "function", "function": {"name": "exec_command", "arguments": "{}"}}]})
        with self.assertRaisesRegex(bridge.Rejected, "tool_not_allowed"):
            emitter.complete()
        self.assertFalse(any(e["type"].startswith("response.function_call") for e in events(handler)))

    def test_allowed_upstream_call_preserves_id_and_arguments(self):
        handler = Handler()
        emitter = bridge.Emitter(handler, ALLOWED)
        emitter.delta({"content": "Hello ", "tool_calls": [{"index": 0, "id": "call_C", "type": "function", "function": {"name": "mcp__assessment__read_current", "arguments": '{"matterId":'}}]})
        emitter.delta({"content": "world", "tool_calls": [{"index": 0, "function": {"arguments": '"M1"}'}}]})
        emitter.complete()
        done = events(handler)
        self.assertEqual(next(e for e in done if e["type"] == "response.function_call_arguments.done")["arguments"], '{"matterId":"M1"}')
        self.assertEqual(next(e for e in done if e["type"] == "response.output_item.done" and e["item"]["type"] == "function_call")["item"]["call_id"], "call_C")
        self.assertEqual(next(e for e in done if e["type"] == "response.output_text.done")["text"], "Hello world")

    def test_duplicate_argument_keys_rejected(self):
        items = [{"type": "function_call", "call_id": "call_D", "name": "mcp__assessment__read_current", "arguments": '{"x":1,"x":2}'}, {"type": "function_call_output", "call_id": "call_D", "output": "ignored"}]
        with self.assertRaisesRegex(bridge.Rejected, "duplicate_json_key"):
            bridge.convert_request(body(items), ALLOWED, 8192)
        emitter = bridge.Emitter(Handler(), ALLOWED)
        emitter.delta({"tool_calls": [{"index": 0, "id": "call_E", "function": {"name": "mcp__assessment__read_current", "arguments": '{"x":1,"x":2}'}}]})
        with self.assertRaisesRegex(bridge.Rejected, "duplicate_json_key"):
            emitter.complete()

    def test_handler_reasoning_ceiling_and_length_audit(self):
        class Socket:
            def settimeout(self, value):
                pass

        class FakeUpstream:
            made = 0
            payloads = []
            request_path = None
            def __init__(self, *args, **kwargs):
                FakeUpstream.made += 1
                self.sock = Socket()
            def request(self, method, path, body, headers):
                self.assert_request_persisted(body, headers)
                FakeUpstream.payloads.append(json.loads(body))
            def assert_request_persisted(self, body, headers):
                artifact = FakeUpstream.request_path
                assert artifact.read_bytes() == body
                assert artifact.stat().st_mode & 0o077 == 0
                assert b'test-only' not in artifact.read_bytes()
            def getresponse(self):
                response = self
                self.status = 200
                if FakeUpstream.made == 1:
                    delta = {"tool_calls": [{"index": 0, "id": "call_unique", "function": {"name": "mcp__assessment__read_current", "arguments": "{}"}}]}
                    finish = "tool_calls"
                elif FakeUpstream.made == 2:
                    delta = {"content": "Done"}
                    finish = "stop"
                else:
                    delta = {"content": "Partial"}
                    finish = "length"
                self.lines = io.BytesIO(("data: " + json.dumps({"choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}) + "\n\ndata: [DONE]\n\n").encode())
                return response
            def readline(self, size):
                return self.lines.readline(size)
            def close(self):
                pass

        class FakeServer:
            server_port = 12345
            def __init__(self, address, handler):
                self.handler = handler
            def serve_forever(self):
                pass
            def shutdown(self):
                pass
            def server_close(self):
                pass

        with tempfile.TemporaryDirectory() as tmp:
            config = pathlib.Path(tmp, "config.json")
            audit = pathlib.Path(tmp, "audit.jsonl")
            upstream_response = pathlib.Path(tmp, "upstream-response.json")
            upstream_request = pathlib.Path(tmp, "upstream-request.json")
            FakeUpstream.request_path = upstream_request
            config.write_text(json.dumps({"models": {"providers": {"miaoda": {"baseUrl": bridge.BASE, "apiKey": {}, "headers": {"x-api-key": {}}}}}}))
            with mock.patch.object(bridge, "resolve", return_value="test-only"), mock.patch.object(bridge.http.client, "HTTPSConnection", FakeUpstream), mock.patch.object(bridge, "ThreadingHTTPServer", FakeServer):
                with self.assertRaisesRegex(bridge.Rejected, "invalid_glm_reasoning_effort"):
                    bridge.start_server(str(config), bridge.MODEL, str(audit), tmp, allowed_tools=ALLOWED, reasoning_effort="medium")
                server, thread, port, token = bridge.start_server(str(config), bridge.MODEL, str(audit), tmp, allowed_tools=ALLOWED, max_requests=5, max_tokens=16384, reasoning_effort="low", upstream_response_path=upstream_response, upstream_request_path=upstream_request)
                def post(data):
                    payload = json.dumps(data).encode()
                    handler = object.__new__(server.handler)
                    handler.path = "/v1/responses"
                    handler.headers = {"Authorization": "Bearer " + token, "Content-Length": str(len(payload))}
                    handler.connection = Socket()
                    handler.rfile = io.BytesIO(payload)
                    handler.wfile = io.BytesIO()
                    statuses = []
                    handler.send_response = statuses.append
                    handler.send_header = lambda *args: None
                    handler.end_headers = lambda: None
                    handler.do_POST()
                    return statuses[0], handler.wfile.getvalue().decode()
                try:
                    first = post(namespaced_body())
                    self.assertEqual(first[0], 200, first[1])
                    persisted = json.loads(upstream_response.read_text())
                    self.assertEqual(persisted["format"], "chat-completions-sse-events-v1")
                    self.assertTrue(persisted["events"])
                    self.assertIn('"namespace": "mcp__assessment"', first[1])
                    history = [
                        {"type": "function_call", "call_id": "call_unique", "namespace": "mcp__assessment", "name": "read_current", "arguments": "{}"},
                        {"type": "function_call_output", "call_id": "call_unique", "output": "result"},
                        {"role": "user", "content": "continue"},
                    ]
                    self.assertEqual(post(namespaced_body(history))[0], 200)
                    truncated = post(namespaced_body(history))
                    self.assertEqual(truncated[0], 200)
                    self.assertIn("response.failed", truncated[1])
                    history[-1]["content"] = "interrupted before upstream dispatch"
                    with mock.patch.object(bridge.http.client, "HTTPSConnection", side_effect=InterruptedError("offline interruption")):
                        interrupted = post(namespaced_body(history))
                    self.assertEqual(interrupted[0], 400)
                    self.assertEqual(json.loads(upstream_request.read_bytes())["messages"][-1]["content"],
                                     "interrupted before upstream dispatch")
                    self.assertFalse(json.loads(audit.read_text().splitlines()[-1])["upstream_attempted"])
                    with mock.patch.object(bridge, "atomic_bytes", side_effect=OSError("offline request fsync failed")), \
                         mock.patch.object(bridge.http.client, "HTTPSConnection") as connection_factory:
                        unpublished = post(namespaced_body(history))
                        self.assertEqual(unpublished[0], 400)
                        connection_factory.assert_not_called()
                    self.assertFalse(json.loads(audit.read_text().splitlines()[-1])["upstream_attempted"])
                    self.assertEqual(post(namespaced_body(history))[0], 429)
                    self.assertEqual(FakeUpstream.made, 3)
                finally:
                    server.shutdown()
                    server.server_close()
                    thread.join(timeout=3)
            records = [json.loads(line) for line in audit.read_text().splitlines()]
            self.assertEqual([r["tool_results"] for r in records], [0, 1, 0, 0, 0, 0])
            self.assertEqual([r["status"] for r in records], [200, 200, 502, 400, 400, 429])
            self.assertEqual(records[2]["finish_reason"], "length")
            self.assertEqual(records[2]["error_code"], "upstream_output_length")
            self.assertEqual(FakeUpstream.payloads[0]["reasoning_effort"], "low")
            self.assertEqual(FakeUpstream.payloads[0]["max_tokens"], 16384)
            self.assertTrue(all(r["requested_reasoning_effort"] == "low" for r in records))
            self.assertEqual(records[0]["provided_namespaces"][0]["name"], "mcp__assessment")
            self.assertEqual(records[0]["provided_namespaces"][0]["tools"][0], {"name": "read_current", "type": "function"})


if __name__ == "__main__":
    unittest.main()
