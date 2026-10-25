#!/usr/bin/env python3
"""Small stdio MCP facade for the parent-owned, already-bound assessment hooks.

Only a fresh loopback capability is inherited. Platform credentials, Host leases,
and source configuration never enter this process or the model's tool schema.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


def call_parent(method, params):
    address = os.environ["WISELINK_ASSESSMENT_URL"]
    target = urllib.parse.urlsplit(address)
    if target.scheme != "http" or target.hostname != "127.0.0.1" or target.path != "/mcp":
        raise ValueError("invalid_local_broker")
    request = urllib.request.Request(address, json.dumps({"method": method, "params": params}).encode(), {
        "Authorization": "Bearer " + os.environ["WISELINK_ASSESSMENT_TOKEN"],
        "Content-Type": "application/json",
    })
    # Do not send the ephemeral loopback capability through a system proxy.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=120) as response:
        raw = response.read(2_000_001)
    if len(raw) > 2_000_000:
        raise ValueError("broker_result_too_large")
    return json.loads(raw)


def main():
    for raw in sys.stdin.buffer:
        request_id = None
        try:
            if len(raw) > 2_000_000:
                raise ValueError("request_too_large")
            message = json.loads(raw)
            if "id" not in message:  # initialized/cancelled notifications have no reply
                continue
            request_id = message["id"]
            method, params = message.get("method"), message.get("params", {})
            if method == "initialize":
                version = params.get("protocolVersion", "2024-11-05")
                result = {"protocolVersion": version, "capabilities": {"tools": {}},
                          "serverInfo": {"name": "wiselink-codex-assessment", "version": "0.1.0"}}
            elif method == "ping":
                result = {}
            elif method in ("tools/list", "tools/call"):
                result = call_parent(method, params)
            else:
                print(json.dumps({"jsonrpc": "2.0", "id": request_id,
                                  "error": {"code": -32601, "message": "Method not found"}}), flush=True)
                continue
            print(json.dumps({"jsonrpc": "2.0", "id": request_id, "result": result}, ensure_ascii=False), flush=True)
        except Exception:
            # Never echo request contents, control capabilities, or exception bodies.
            print(json.dumps({"jsonrpc": "2.0", "id": request_id,
                              "error": {"code": -32603, "message": "Assessment broker unavailable"}}), flush=True)


if __name__ == "__main__":
    main()
