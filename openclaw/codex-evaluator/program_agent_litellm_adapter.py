"""Isolated, explicitly injected LiteLLM candidate; no provider registration.

OpenAI SDK parses SSE. A per-client raw Chat iterator checks terminal values
before LiteLLM can normalize them. LiteLLM owns all Responses/tool conversion.
The caller owns the existing gateway dispatch reservation and private run root.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
from importlib.metadata import version
from pathlib import Path

CONTRACT = "wiselink.chat-terminal-receipt.v1"
PROTOCOL = "litellm-1.106.4-chat-completions-sse"
VALID_TERMINALS = {"stop", "tool_calls", "length", "content_filter"}


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def durable(path: Path, value: bytes) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb", closefd=False) as stream:
            stream.write(value)
            stream.flush()
            os.fsync(fd)
    finally:
        os.close(fd)
    parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)


def durable_json(path: Path, value) -> None:
    durable(path, (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode())


class TerminalRejected(RuntimeError):
    """Fixed diagnostic only; never include a provider error body or secret."""


class RawChatTerminal:
    def __init__(self):
        self.receipt = {"schemaVersion": CONTRACT, "basis": "openai-sdk-raw-chat",
                        "seenValidTerminal": False, "rawFinishReason": None,
                        "sdkStreamExhausted": False, "chunkCount": 0,
                        "usageAfterTerminalCount": 0, "errorCode": None}

    def reject(self, code):
        self.receipt["errorCode"] = code
        raise TerminalRejected(code)

    async def checked(self, source):
        # Hold the terminal (and trailing usage) until the SDK exhausts its
        # stream normally. This prevents a completed event escaping early.
        terminal_tail = []
        async for chunk in source:
            value = chunk.model_dump() if hasattr(chunk, "model_dump") else chunk
            self.receipt["chunkCount"] += 1
            if not isinstance(value, dict):
                self.reject("CHAT_CHUNK_INVALID")
            if value.get("error") or value.get("type") in {"error", "abort"}:
                self.reject("CHAT_EXPLICIT_ERROR")
            choices = value.get("choices")
            if not isinstance(choices, list):
                self.reject("CHAT_CHOICES_INVALID")
            if not choices:
                if value.get("usage") is None:
                    self.reject("CHAT_EMPTY_CHUNK")
                if self.receipt["seenValidTerminal"]:
                    self.receipt["usageAfterTerminalCount"] += 1
                    terminal_tail.append(chunk)
                else:
                    yield chunk
                continue
            if len(choices) != 1 or choices[0].get("index") != 0:
                self.reject("CHAT_CHOICE_SCOPE_INVALID")
            reason = choices[0].get("finish_reason")
            if reason is not None:
                # Retain bounded enumerations only, not arbitrary error text.
                self.receipt["rawFinishReason"] = reason if reason in VALID_TERMINALS | {"error", "abort", "network_error"} else "UNKNOWN_VALUE"
                if reason not in VALID_TERMINALS:
                    self.reject("CHAT_TERMINAL_REJECTED")
            if self.receipt["seenValidTerminal"]:
                self.reject("CHAT_OUTPUT_AFTER_TERMINAL")
            if reason is not None:
                self.receipt["seenValidTerminal"] = True
                terminal_tail.append(chunk)
            else:
                yield chunk
        self.receipt["sdkStreamExhausted"] = True
        if not self.receipt["seenValidTerminal"]:
            self.reject("CHAT_EOF_WITHOUT_VALID_TERMINAL")
        for chunk in terminal_tail:
            yield chunk


async def dispatch_litellm_candidate(*, client_request_bytes: bytes,
        effective_request_bytes: bytes, execution_model: dict, max_output_tokens: int,
        native_admission: dict, directory: Path, api_base: str, api_key: str, timeout_seconds: int):
    """Return buffered Responses bytes and a private, bound attempt receipt.

    A fresh exclusive directory belongs to ONE existing gateway ordinal.
    Re-entry is UNKNOWN, never a new HTTP call. This is not Host admission or
    a production endpoint; callers must explicitly inject it for review.
    """
    if version("litellm") != "1.106.4" or version("openai") != "2.54.0":
        raise TerminalRejected("ADAPTER_PINNED_VERSION_REQUIRED")
    import httpx
    import litellm
    from openai import AsyncOpenAI

    body = json.loads(effective_request_bytes)
    client_body = json.loads(client_request_bytes)
    if (execution_model.get("modelRef") != "miaoda/glm-5.3" or
            type(max_output_tokens) is not int or max_output_tokens < 1 or
            body.get("max_output_tokens") != max_output_tokens or
            body.get("model") != "glm-5.3" or body.get("stream") is not True or
            body != {**client_body, "max_output_tokens": max_output_tokens} or
            native_admission.get("version") != 1 or not isinstance(native_admission.get("requestId"), str) or
            not native_admission["requestId"] or type(native_admission.get("ordinal")) is not int or
            native_admission["ordinal"] < 1 or len(native_admission.get("bindingSha256", "")) != 64 or
            native_admission.get("clientRequestSha256") != digest(client_request_bytes) or
            native_admission.get("effectiveRequestSha256") != digest(effective_request_bytes) or
            native_admission.get("executionModel") != execution_model or
            native_admission.get("maxOutputTokens") != max_output_tokens):
        raise TerminalRejected("ADAPTER_INPUT_BINDING_INVALID")
    directory = Path(directory)
    try:
        directory.mkdir(mode=0o700)
    except FileExistsError:
        raise TerminalRejected("ADAPTER_OUTCOME_UNKNOWN") from None
    terminal = RawChatTerminal()
    capture = {"internalHttpAttemptCount": 0, "blockedAdditionalHttpAttempts": 0,
               "upstreamHttpStatus": None, "transportCleanEnd": False,
               "cancelled": False, "request": b"", "response": bytearray()}
    effective_sha = digest(effective_request_bytes)
    durable_json(directory / "admission.json", {"scope": "NATIVE_ORDINAL_ONLY_NOT_HOST_ADMISSION",
                                              "nativeAdmission": native_admission})

    class OneAttemptTransport(httpx.AsyncBaseTransport):
        def __init__(self):
            self.transport = httpx.AsyncHTTPTransport(retries=0)

        async def handle_async_request(self, request):
            if capture["internalHttpAttemptCount"]:
                capture["blockedAdditionalHttpAttempts"] += 1
                raise TerminalRejected("ADAPTER_HTTP_REDISPATCH_BLOCKED")
            request_bytes = await request.aread()
            payload = json.loads(request_bytes)
            if (request.method != "POST" or str(request.url) != api_base.rstrip("/") + "/chat/completions" or
                    payload.get("max_tokens") != max_output_tokens or
                    any(key in payload for key in ("max_output_tokens", "max_completion_tokens")) or
                    payload.get("stream") is not True or payload.get("n", 1) != 1):
                raise TerminalRejected("ADAPTER_UPSTREAM_ROUTE_OR_BUDGET_INVALID")
            capture["request"] = request_bytes
            durable(directory / "upstream-request.body", request_bytes)
            # Reservation before transport entry is conservative: it is NOT
            # proof the remote endpoint received a request.
            capture["internalHttpAttemptCount"] = 1
            durable_json(directory / "http-attempt-1.started.json", {
                "ordinal": 1, "requestSha256": digest(request_bytes),
                "effectiveRequestSha256": effective_sha, "maxOutputTokens": max_output_tokens})
            response = await self.transport.handle_async_request(request)
            capture["upstreamHttpStatus"] = response.status_code
            # Match the existing gateway's buffered boundary. Capture the HTTP
            # entity to a clean transport end before the SDK parses it. The
            # SDK may stop at DONE without draining an otherwise valid body;
            # that short circuit must not masquerade as a full body capture.
            try:
                async for part in response.stream:
                    capture["response"].extend(part)
                capture["transportCleanEnd"] = True
            finally:
                await response.aclose()
            return httpx.Response(response.status_code, headers=response.headers,
                                  content=bytes(capture["response"]), extensions=response.extensions)

        async def aclose(self):
            await self.transport.aclose()

    http = httpx.AsyncClient(transport=OneAttemptTransport(), trust_env=False,
                            follow_redirects=False, timeout=timeout_seconds)
    client = AsyncOpenAI(api_key=api_key, base_url=api_base, max_retries=0,
                         timeout=timeout_seconds, http_client=http)
    original_create = client.chat.completions.with_raw_response.create

    class GuardedResponse:
        def __init__(self, response):
            self.response = response
            self.headers = response.headers

        def parse(self):
            return terminal.checked(self.response.parse())

    async def guarded_create(*args, **kwargs):
        return GuardedResponse(await original_create(*args, **kwargs))

    # Per-client seam in pinned OpenAIChatCompletion.async_streaming, before
    # CustomStreamWrapper/map_finish_reason. No global patch or SSE parser.
    client.chat.completions.with_raw_response.create = guarded_create
    events, error_code, cancelled = [], None, None
    try:
        call = {**body, "model": "custom_openai/glm-5.3", "api_base": api_base,
                "api_key": api_key, "client": client, "num_retries": 0,
                "max_retries": 0, "drop_params": False, "timeout": timeout_seconds}
        stream = await litellm.aresponses(**call)
        async for event in stream:
            events.append(event.model_dump(exclude_none=True))
        if (not terminal.receipt["sdkStreamExhausted"] or not capture["transportCleanEnd"] or
                capture["internalHttpAttemptCount"] != 1 or capture["blockedAdditionalHttpAttempts"]):
            raise TerminalRejected("ADAPTER_STREAM_OUTCOME_UNKNOWN")
    except asyncio.CancelledError as exc:
        capture["cancelled"] = True
        cancelled, error_code = exc, "ADAPTER_CANCELLED_UNKNOWN"
    except Exception as exc:
        error_code = (terminal.receipt["errorCode"] or
                      (str(exc) if isinstance(exc, TerminalRejected) else "ADAPTER_UPSTREAM_OUTCOME_UNKNOWN"))
    finally:
        await client.close()

    # Even if an upstream library emitted a terminal before failing, none is
    # delivered by this buffered adapter. Preserve the private parsed events.
    response_bytes = b"" if error_code else b"".join(
        ("event: " + event["type"] + "\ndata: " + json.dumps(event, separators=(",", ":")) + "\n\n").encode()
        for event in events)
    finish = terminal.receipt["rawFinishReason"]
    terminal_events = [event for event in events if event.get("type") in
                       {"response.completed", "response.incomplete", "response.failed"}]
    complete = (not error_code and finish in {"stop", "tool_calls"} and len(terminal_events) == 1 and
                terminal_events[0] is events[-1] and terminal_events[0]["type"] == "response.completed" and
                terminal_events[0].get("response", {}).get("status") == "completed")
    receipt = {"complete": bool(complete), "upstreamProtocol": PROTOCOL,
        "nativeAdmission": native_admission,
        "upstreamHttpStatus": capture["upstreamHttpStatus"], "terminal": terminal.receipt,
        "transportCleanEnd": capture["transportCleanEnd"],
        "internalHttpAttemptCount": capture["internalHttpAttemptCount"],
        "blockedAdditionalHttpAttempts": capture["blockedAdditionalHttpAttempts"],
        "cancelled": capture["cancelled"], "errorCode": error_code,
        "upstreamFinishReason": finish, "reportedModel": None,
        "litellmVersion": version("litellm"), "openaiSdkVersion": version("openai"),
        "maxOutputTokens": max_output_tokens, "executionModel": execution_model,
        "clientRequestSha256": digest(client_request_bytes), "effectiveRequestSha256": effective_sha,
        "upstreamRequestSha256": digest(capture["request"]),
        "upstreamResponseSha256": digest(bytes(capture["response"])),
        "responseSha256": digest(response_bytes),
        "upstreamBodyCapture": "HTTP_ENTITY_BYTES_NOT_TCP_OR_TLS_FRAMES"}
    durable(directory / "upstream-response.body", bytes(capture["response"]))
    durable_json(directory / "parsed-response-events.json", events)
    durable(directory / "response.sse", response_bytes)
    durable_json(directory / "receipt.json", receipt)
    if cancelled:
        raise cancelled
    return {"responseBytes": response_bytes, "upstreamRequestBytes": capture["request"],
            "upstreamResponseBytes": bytes(capture["response"]), "receipt": receipt}
