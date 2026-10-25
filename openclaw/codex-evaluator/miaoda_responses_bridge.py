"""Opt-in, loopback-only Responses bridge for the configured Miaoda model."""
import hmac, http.client, json, os, secrets, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

MODEL = "glm-5.3"
BASE = "https://innerapi.aiforce.cloud/innerapi/api/v1/sgw/model/proxy"
MAX_BODY = 1048576

class Rejected(Exception):
    pass

def require(condition, code):
    if not condition:
        raise Rejected(code)

def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def provider(config):
    value = config["models"]["providers"]["miaoda"]
    require(value.get("baseUrl", value.get("baseURL", "")).rstrip("/") == BASE, "upstream_not_allowed")
    return value

def resolve(config, ref):
    require(isinstance(ref, dict) and ref.get("source") == "file", "file_secret_required")
    spec = config["secrets"]["providers"][ref["provider"]]
    require(spec.get("source") == "file", "file_secret_required")
    with open(os.path.expanduser(spec["path"]), encoding="utf-8") as f:
        raw = f.read(65537)
    require(len(raw) <= 65536, "secret_file_too_large")
    if spec.get("mode") == "singleValue":
        require(ref["id"] == "value", "invalid_single_value_reference")
        value = raw.strip()
    else:
        require(spec.get("mode", "json") == "json" and ref["id"].startswith("/"), "invalid_json_reference")
        value = json.loads(raw)
        for part in ref["id"].split("/")[1:]:
            part = part.replace("~1", "/").replace("~0", "~")
            value = value[int(part)] if isinstance(value, list) else value[part]
    require(isinstance(value, str) and value and "\r" not in value and "\n" not in value, "invalid_secret_value")
    return value

def text_content(content, kind):
    if isinstance(content, str):
        return content
    require(isinstance(content, list), "text_content_required")
    chunks = []
    for part in content:
        require(isinstance(part, dict) and part.get("type") in kind and isinstance(part.get("text"), str), "unsupported_content_type")
        chunks.append(part["text"])
    return "".join(chunks)

def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate_json_key")
        result[key] = value
    return result

def flat_tool_name(name, namespace, allowed_tools):
    """Resolve one Responses function identity against the exact runtime allowlist."""
    require(isinstance(name, str) and name, "invalid_function_name")
    if namespace is None:
        flat = name
    else:
        require(isinstance(namespace, str) and namespace.startswith("mcp__") and name != namespace, "tool_not_allowed")
        flat = namespace + "__" + name
    require(flat in allowed_tools, "tool_not_allowed")
    return flat

def convert_request(body, allowed_tools, max_tokens, tool_map=None):
    require(isinstance(body, dict) and body.get("model") == MODEL, "model_not_allowed")
    require(body.get("stream") is True, "stream_required")
    allowed = {"model", "input", "instructions", "tools", "tool_choice", "parallel_tool_calls", "max_output_tokens", "stream", "store", "reasoning", "include", "text", "truncation", "metadata", "prompt_cache_key", "client_metadata"}
    require(not (set(body) - allowed), "unsupported_request_field")
    require(body.get("store", False) is False, "unsupported_storage")
    # Codex 0.164 sends these optional Responses hints by default. This bridge
    # does not provide prompt caching, client telemetry, or encrypted reasoning
    # items. It returns text/function items only, never a fabricated reasoning item.
    require(body.get("include", []) in ([], ["reasoning.encrypted_content"]), "unsupported_include")
    require("prompt_cache_key" not in body or isinstance(body["prompt_cache_key"], str) and len(body["prompt_cache_key"]) <= 4096, "invalid_prompt_cache_key")
    require("client_metadata" not in body or isinstance(body["client_metadata"], dict) and len(json.dumps(body["client_metadata"])) <= 8192, "invalid_client_metadata")
    require(body.get("reasoning", {}) in ({}, {"summary": "none"}), "unsupported_reasoning_control")
    require(body.get("text", {}) in ({}, {"format": {"type": "text"}}), "unsupported_text_format")
    require(body.get("truncation", "disabled") == "disabled" and body.get("metadata", {}) == {}, "unsupported_request_control")
    limit = body.get("max_output_tokens", max_tokens)
    require(type(limit) is int and limit > 0, "invalid_token_limit")
    messages, pending, seen, returned = [], set(), set(), []
    if body.get("instructions") is not None:
        require(isinstance(body["instructions"], str), "invalid_instructions")
        messages.append({"role": "system", "content": body["instructions"]})
    items = body.get("input", [])
    if isinstance(items, str):
        items = [{"type": "message", "role": "user", "content": items}]
    require(isinstance(items, list) and items, "input_required")
    for item in items:
        require(isinstance(item, dict), "invalid_input_item")
        kind = item.get("type", "message")
        if kind == "function_call":
            call_id, name, arguments = item.get("call_id"), item.get("name"), item.get("arguments")
            require(all(isinstance(v, str) and v for v in (call_id, name, arguments)) and call_id not in seen, "invalid_function_call")
            name = flat_tool_name(name, item.get("namespace"), allowed_tools)
            try:
                parsed = json.loads(arguments, object_pairs_hook=unique_object)
            except json.JSONDecodeError as exc:
                raise Rejected("invalid_tool_arguments") from exc
            require(isinstance(parsed, dict), "invalid_tool_arguments")
            require(not pending or (messages and messages[-1]["role"] == "assistant" and "tool_calls" in messages[-1]), "interleaved_tool_calls")
            if not messages or "tool_calls" not in messages[-1]:
                messages.append({"role": "assistant", "content": None, "tool_calls": []})
            messages[-1]["tool_calls"].append({"id": call_id, "type": "function", "function": {"name": name, "arguments": arguments}})
            pending.add(call_id); seen.add(call_id)
        elif kind == "function_call_output":
            call_id = item.get("call_id")
            require(isinstance(call_id, str) and call_id in pending, "orphan_tool_output")
            messages.append({"role": "tool", "tool_call_id": call_id, "content": text_content(item.get("output"), {"input_text", "output_text"})})
            pending.remove(call_id); returned.append(call_id)
        else:
            require(kind == "message" and not pending, "unsupported_or_incomplete_input")
            role = item.get("role")
            require(role in ("system", "developer", "user", "assistant"), "unsupported_message_role")
            messages.append({"role": "system" if role == "developer" else role, "content": text_content(item.get("content"), {"input_text", "output_text"})})
    require(not pending, "missing_tool_output")
    tools = []
    require(isinstance(body.get("tools", []), list), "invalid_tools")
    names = set()
    selected = {}
    for tool in body.get("tools", []):
        require(isinstance(tool, dict), "invalid_tool_schema")
        if tool.get("type") == "namespace":
            namespace = tool.get("name")
            if not isinstance(namespace, str) or not any(name.startswith(namespace + "__") for name in allowed_tools):
                continue
            require(namespace.startswith("mcp__") and isinstance(tool.get("tools"), list), "invalid_allowed_namespace")
            require(not (set(tool) - {"type", "name", "description", "tools"}), "unsupported_allowed_namespace")
            for nested in tool["tools"]:
                require(isinstance(nested, dict), "invalid_nested_tool_schema")
                short = nested.get("name")
                if not isinstance(short, str) or namespace + "__" + short not in allowed_tools:
                    continue
                require(nested.get("type") == "function", "unsupported_allowed_tool_type")
                require(isinstance(nested.get("parameters", {}), dict), "invalid_function_schema")
                require(not (set(nested) - {"type", "name", "description", "parameters", "strict", "defer_loading"}) and nested.get("defer_loading", False) is False, "unsupported_function_schema")
                flat = namespace + "__" + short
                require(flat not in names, "duplicate_allowed_tool")
                names.add(flat); selected[flat] = (namespace, short)
                schema = {k: v for k, v in nested.items() if k not in ("type", "name", "defer_loading")}
                tools.append({"type": "function", "function": {"name": flat, **schema}})
            continue
        name = tool.get("name")
        if not isinstance(name, str) or name not in allowed_tools:
            continue
        require(tool.get("type") == "function", "unsupported_allowed_tool_type")
        require(isinstance(tool.get("name"), str) and tool["name"] and isinstance(tool.get("parameters", {}), dict), "invalid_function_schema")
        require(not (set(tool) - {"type", "name", "description", "parameters", "strict"}), "unsupported_function_schema")
        require(name not in names, "duplicate_allowed_tool")
        names.add(name)
        selected[name] = None
        tools.append({"type": "function", "function": {k: v for k, v in tool.items() if k != "type"}})
    require(names == allowed_tools, "allowed_tool_schema_missing")
    if tool_map is not None:
        tool_map.update(selected)
    payload = {"model": MODEL, "messages": messages, "stream": True, "stream_options": {"include_usage": True}, "max_tokens": min(limit, max_tokens)}
    if tools:
        payload["tools"] = tools
    if "parallel_tool_calls" in body:
        require(type(body["parallel_tool_calls"]) is bool, "invalid_parallel_tools")
        payload["parallel_tool_calls"] = body["parallel_tool_calls"]
    if "tool_choice" in body:
        choice = body["tool_choice"]
        if isinstance(choice, dict):
            require(set(choice) in ({"type", "name"}, {"type", "name", "namespace"}) and choice["type"] == "function", "unsupported_tool_choice")
            chosen = flat_tool_name(choice["name"], choice.get("namespace"), allowed_tools)
            expected = (choice["namespace"], choice["name"]) if "namespace" in choice else None
            require(chosen in names and selected[chosen] == expected, "unsupported_tool_choice")
            choice = {"type": "function", "function": {"name": chosen}}
        else:
            require(choice in ("auto", "none", "required"), "unsupported_tool_choice")
        payload["tool_choice"] = choice
    return payload, returned

def chat_events(response, connection, deadline):
    data = []
    while True:
        remaining = deadline - time.monotonic()
        require(remaining > 0, "upstream_timeout")
        sock = connection.sock or response.fp.raw._sock
        sock.settimeout(remaining)
        line = response.readline(MAX_BODY + 1)
        require(line and len(line) <= MAX_BODY, "upstream_stream_truncated")
        line = line.decode("utf-8").rstrip("\r\n")
        if line.startswith("data:"):
            data.append(line[5:].lstrip())
            require(sum(map(len, data)) <= MAX_BODY, "upstream_event_too_large")
        elif not line and data:
            value = "\n".join(data); data = []
            if value == "[DONE]":
                return
            yield json.loads(value)

class Emitter:
    def __init__(self, handler, allowed_tools, tool_map=None):
        self.handler, self.sequence, self.items, self.calls, self.message, self.usage = handler, 0, [], {}, None, None
        self.allowed_tools = allowed_tools
        self.tool_map = tool_map or {}
        self.response = {"id": "resp_" + secrets.token_hex(12), "object": "response", "created_at": int(time.time()), "status": "in_progress", "model": MODEL, "output": self.items, "usage": None, "error": None}
    def send(self, kind, **fields):
        value = {"type": kind, "sequence_number": self.sequence, **fields}; self.sequence += 1
        self.handler.wfile.write(("event: " + kind + "\ndata: " + json.dumps(value, ensure_ascii=False) + "\n\n").encode())
        self.handler.wfile.flush()
    def added(self, item):
        index = len(self.items); self.items.append(item)
        self.send("response.output_item.added", output_index=index, item=item)
        return index
    def delta(self, delta):
        require(not delta.get("refusal"), "upstream_refusal")
        text = delta.get("content")
        if text:
            require(isinstance(text, str), "unsupported_upstream_content")
            if self.message is None:
                item = {"id": "msg_" + secrets.token_hex(12), "type": "message", "role": "assistant", "status": "in_progress", "content": []}
                self.message = (self.added(item), item)
                part = {"type": "output_text", "text": "", "annotations": []}; item["content"].append(part)
                self.send("response.content_part.added", item_id=item["id"], output_index=self.message[0], content_index=0, part=part)
            index, item = self.message; item["content"][0]["text"] += text
            self.send("response.output_text.delta", item_id=item["id"], output_index=index, content_index=0, delta=text)
        for value in delta.get("tool_calls", []):
            index = value.get("index")
            require(type(index) is int and value.get("type", "function") == "function", "unsupported_upstream_tool")
            state = self.calls.setdefault(index, {"id": "", "name": "", "arguments": ""})
            function = value.get("function", {})
            require(isinstance(function, dict), "invalid_upstream_tool")
            for key, fragment in (("id", value.get("id")), ("name", function.get("name"))):
                if fragment:
                    require(isinstance(fragment, str) and (not state[key] or state[key] == fragment), "changing_tool_identity")
                    state[key] = fragment
            fragment = function.get("arguments", "")
            require(isinstance(fragment, str), "invalid_tool_arguments")
            state["arguments"] += fragment
            require(len(state["arguments"]) <= MAX_BODY, "tool_arguments_too_large")
    def complete(self):
        ids = set()
        for state in self.calls.values():
            require(state["id"] and state["id"] not in ids and state["name"] in self.allowed_tools, "tool_not_allowed")
            ids.add(state["id"])
            try:
                parsed = json.loads(state["arguments"], object_pairs_hook=unique_object)
            except json.JSONDecodeError as exc:
                raise Rejected("invalid_tool_arguments") from exc
            require(isinstance(parsed, dict), "invalid_tool_arguments")
        # No function-call event reaches Codex until every upstream call passes validation.
        for state in self.calls.values():
            identity = self.tool_map.get(state["name"])
            item = {"id": "fc_" + secrets.token_hex(12), "type": "function_call", "call_id": state["id"], "name": identity[1] if identity else state["name"], "arguments": state["arguments"], "status": "in_progress"}
            if identity:
                item["namespace"] = identity[0]
            index = self.added(item)
            self.send("response.function_call_arguments.delta", item_id=item["id"], output_index=index, delta=item["arguments"])
        for index, item in enumerate(self.items):
            if item["type"] == "message":
                part = item["content"][0]
                self.send("response.output_text.done", item_id=item["id"], output_index=index, content_index=0, text=part["text"])
                self.send("response.content_part.done", item_id=item["id"], output_index=index, content_index=0, part=part)
            else:
                self.send("response.function_call_arguments.done", item_id=item["id"], output_index=index, arguments=item["arguments"])
            item["status"] = "completed"; self.send("response.output_item.done", output_index=index, item=item)
        self.response.update(status="completed", usage=self.usage)
        self.send("response.completed", response=self.response)

def start_server(config_path, model, audit_path, work_dir, *, allowed_tools, max_requests=24, max_tokens=8192, timeout=90, reasoning_effort=None):
    """Return (loopback server, serving thread, ephemeral port, ephemeral bearer token)."""
    require(model == MODEL, "model_not_allowed"); provider(read_json(config_path))
    require(isinstance(allowed_tools, (set, frozenset)) and allowed_tools and all(isinstance(n, str) and n and n.startswith("mcp__") for n in allowed_tools), "invalid_allowed_tools")
    allowed_tools = frozenset(allowed_tools)
    require(all(type(n) is int and n > 0 for n in (max_requests, max_tokens, timeout)), "invalid_budget")
    require(reasoning_effort in (None, "low", "high", "max"), "invalid_glm_reasoning_effort")
    require(os.path.isdir(work_dir), "invalid_work_dir")
    token, lock, count, issued_ids, returned_ids = secrets.token_urlsafe(32), threading.Lock(), [0], set(), set()
    audit_fd = os.open(audit_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    os.close(audit_fd)
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        def log_message(self, *args):
            pass
        def error(self, status, code):
            data = json.dumps({"error": {"type": "bridge_error", "code": code, "message": code}}).encode()
            self.send_response(status); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(data))); self.send_header("Connection", "close"); self.end_headers()
            self.wfile.write(data); self.close_connection = True
        def do_GET(self):
            self.error(404, "route_not_allowed")
        def do_POST(self):
            if not hmac.compare_digest(self.headers.get("Authorization", "").encode(), ("Bearer " + token).encode()):
                self.error(401, "unauthorized"); return
            record = {"route": "/v1/responses", "model": MODEL, "status": 400, "tools": 0, "tool_calls": 0, "tool_results": 0, "call_ids": [], "returned_ids": [], "usage": None, "upstream_attempted": False, "error_code": None, "upstream_models": [], "finish_reason": None}
            emitter, connection = None, None
            try:
                require(self.path in ("/responses", "/v1/responses"), "route_not_allowed")
                size = int(self.headers.get("Content-Length", "0")); require(0 < size <= MAX_BODY and not self.headers.get("Transfer-Encoding"), "invalid_body_length")
                self.connection.settimeout(timeout)
                body = json.loads(self.rfile.read(size))
                if isinstance(body, dict):
                    record["request_fields"] = sorted(body)
                    offered = body.get("tools", []) if isinstance(body.get("tools", []), list) else []
                    record["provided_tool_names"] = [t["name"] for t in offered if isinstance(t, dict) and isinstance(t.get("name"), str)][:128]
                    record["provided_tool_types"] = sorted({t.get("type", "missing") for t in offered if isinstance(t, dict) and isinstance(t.get("type", "missing"), str)})
                    record["provided_namespaces"] = [
                        {"name": t.get("name") if isinstance(t.get("name"), str) else None, "keys": sorted(t), "tools": [
                            {"name": child.get("name") if isinstance(child.get("name"), str) else None, "type": child.get("type") if isinstance(child.get("type"), str) else None} for child in t.get("tools", [])[:128] if isinstance(child, dict)
                        ] if isinstance(t.get("tools"), list) else None}
                        for t in offered[:128] if isinstance(t, dict) and t.get("type") == "namespace"
                    ]
                    record["optional_hints_not_forwarded"] = [k for k in ("prompt_cache_key", "client_metadata", "include") if k in body]
                tool_map = {}
                payload, returned = convert_request(body, allowed_tools, max_tokens, tool_map)
                # GLM-5.3 cannot disable thinking. This caller setting does not
                # fabricate or export a Responses reasoning item.
                if reasoning_effort is not None:
                    payload["reasoning_effort"] = reasoning_effort
                record["requested_reasoning_effort"] = reasoning_effort
                with lock:
                    require(set(returned) <= issued_ids, "unknown_tool_result")
                    new_returned = [call_id for call_id in returned if call_id not in returned_ids]
                record.update(tools=len(payload.get("tools", [])), tool_results=len(new_returned), returned_ids=new_returned)
                config = read_json(config_path); entry = provider(config)
                headers = {"Content-Type": "application/json", "Accept": "text/event-stream", "Authorization": "Bearer " + resolve(config, entry["apiKey"]), "x-api-key": resolve(config, entry["headers"]["x-api-key"])}
                with lock:
                    if count[0] >= max_requests:
                        record["status"] = 429; raise Rejected("request_budget_exhausted")
                    count[0] += 1
                record.update(upstream_attempted=True, status=502)
                target = urlsplit(BASE); deadline = time.monotonic() + timeout
                connection = http.client.HTTPSConnection(target.hostname, timeout=timeout)
                connection.request("POST", target.path + "/chat/completions", json.dumps(payload).encode(), headers)
                upstream = connection.getresponse()
                require(upstream.status == 200, "upstream_http_" + str(upstream.status))
                self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.send_header("Cache-Control", "no-cache"); self.send_header("Connection", "close"); self.end_headers(); self.close_connection = True
                emitter = Emitter(self, allowed_tools, tool_map); emitter.send("response.created", response=emitter.response); emitter.send("response.in_progress", response=emitter.response)
                finish = None
                for event in chat_events(upstream, connection, deadline):
                    require(isinstance(event, dict) and not event.get("error"), "upstream_stream_error")
                    if "model" in event:
                        require(isinstance(event["model"], str) and len(event["model"]) <= 256, "invalid_upstream_model_field")
                        if event["model"] not in record["upstream_models"]:
                            record["upstream_models"].append(event["model"])
                    usage = event.get("usage")
                    if usage and all(type(usage.get(k)) is int for k in ("prompt_tokens", "completion_tokens", "total_tokens")):
                        emitter.usage = {"input_tokens": usage["prompt_tokens"], "output_tokens": usage["completion_tokens"], "total_tokens": usage["total_tokens"]}
                    for choice in event.get("choices", []):
                        require(choice.get("index", 0) == 0, "multiple_upstream_choices")
                        emitter.delta(choice.get("delta", {})); finish = choice.get("finish_reason") or finish
                record["finish_reason"] = finish
                require(finish != "length", "upstream_output_length")
                require(finish in ("stop", "tool_calls") and (emitter.items or emitter.calls), "upstream_incomplete_output")
                require((finish == "tool_calls") == bool(emitter.calls), "upstream_finish_mismatch")
                with lock:
                    require(not (set(s["id"] for s in emitter.calls.values()) & issued_ids), "duplicate_tool_call_id")
                    emitter.complete()
                    issued_ids.update(s["id"] for s in emitter.calls.values())
                    returned_ids.update(new_returned)
                record.update(status=200, finish_reason=finish)
            except Exception as exc:
                code = str(exc) if isinstance(exc, Rejected) else "bridge_internal_error"
                record["error_code"] = code
                if emitter is None:
                    try: self.error(record["status"], code)
                    except Exception: pass
                else:
                    emitter.response.update(status="failed", error={"code": code, "message": code})
                    try: emitter.send("response.failed", response=emitter.response)
                    except Exception: pass
            finally:
                if connection is not None: connection.close()
                if emitter is not None:
                    record.update(tool_calls=len(emitter.calls), call_ids=[s["id"] for s in emitter.calls.values()], usage=emitter.usage)
                with lock:
                    with open(audit_path, "a", encoding="utf-8") as f: f.write(json.dumps(record) + "\n")
    class Server(ThreadingHTTPServer):
        daemon_threads = True
        def handle_error(self, *args):
            pass
    server = Server(("127.0.0.1", 0), Handler)
    server.work_dir = os.path.realpath(work_dir)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    return server, thread, server.server_port, token
