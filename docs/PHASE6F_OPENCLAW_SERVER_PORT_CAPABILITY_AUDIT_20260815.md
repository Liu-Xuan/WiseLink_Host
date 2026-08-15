# Phase 6F — OpenClaw server port capability audit

Date: 2026-08-15 (Asia/Shanghai)

Canonical host baseline: `5e628a66b94681e11cf2b858d0fd88c634832cd2`

Hosted OpenClaw app: `app_17c3zn24kv2` (`WiseLink 工程资料助手`)

Mode: `NO_MUTATION / RUNTIME_NO_CODE_CHANGE`

## Decision

Do not bind `OpenClawOemDiscoveryPort` yet.

The current hosted OpenClaw object has no verifiable, published server-only invocation
surface that the canonical host can consume through ordinary runtime configuration. The
existing real `ZERO_RESULTS_FOR_TARGET_IDENTIFIER` result remains a discovery-only replay
input; it is not evidence of a callable Skill, OpenAPI operation, internal action, connector,
or stable request/response contract.

`ExternalDiscoveryModule.forRoot()` therefore remains unconfigured in production assembly.
No HTTP gateway, MCP bridge, browser service, credential, Skill, automation, release, schema,
or online record was created.

## Exact read-only platform evidence

All commands used `/opt/homebrew/bin/lark-cli` version `1.0.85` with the already authenticated
user identity. No command below sent a chat message or changed application state.

| Read | Exact result |
| --- | --- |
| `apps +list --keyword OpenClaw` | one visible object: `app_17c3zn24kv2`, updated `2026-08-14T15:22:13Z` |
| `apps +get --app-id app_17c3zn24kv2` | rejected with API code `40002`: this object is not one of `html/modern_html/fullstack/js_page`, and ordinary app detail OpenAPI is not allowed; log `202608150509487D48D010FAD0274FE718` |
| `apps +release-list` | `releases=[]` |
| `apps +openapi-key-list` | `infos=[]` |
| `apps +automation-list` | `items=[]` |
| `apps +access-scope-get` | rejected with `3340002`: application is not published for normal access-scope operations; log `20260815050950334AD4DE79C1845D879C` |
| `apps +session-list/get` | one application-development conversation exists, with no runtime turn or queued work |

The CLI's `apps +chat` is explicitly a write operation for the cloud application-development
session (official examples ask it to create a page or change a title). It is not a business
Skill invocation API and must not be adapted as `OpenClawOemDiscoveryPort`.

The absence of a normal Miaoda release does not claim that the hosted OpenClaw assistant is
offline. It means that a versioned normal-app release identity cannot be read and pinned using
the ordinary Miaoda release API.

## Source and owner evidence

The existing owner candidates remain entry instructions, not deployed runtime contracts:

- `openclaw-oem-monitor.ui-candidate.json` is
  `READY_TO_ENTER_NOT_CREATED / OWNER_ONLY_UNPUBLISHED`.
- The proposed `oem-public-discovery` Skill and three cron tasks are not created or enabled.
- `personal-openclaw-assessment.ui-candidate.json` records the native Aily third-party-agent
  source `妙搭云电脑-WiseLink 工程资料助手`, but its current authorization state is
  `授权已过期`; the next action is a human `重新授权`.
- The Aily candidate describes user-authorized third-party-agent orchestration. It does not
  define a tenant-token or server-to-server authentication contract for the Nest host.
- The historical self-hosted extension, `host.docker.internal`, and local bridge are explicitly
  `NOT_CONSUMED_NOT_INSTALLED_BY_WISELINK_3_1`.

Feishu's published OpenClaw guidance describes a hosted personal assistant operated through
Feishu conversation, extensible Skills, and scheduled work. It does not document a stable
server invocation endpoint for an arbitrary Miaoda Nest module:

- https://www.feishu.cn/content/article/7615218249831058381
- https://www.feishu.cn/content/article/7631864469689240764

This is an evidence-bounded conclusion about the current object and published surfaces, not a
claim that Feishu can never add such an API.

## Authentication and context matrix

| Candidate surface | Authentication/context | Callable now | Reason |
| --- | --- | --- | --- |
| normal Miaoda OpenAPI | would require a published operation and OpenAPI Key | no | key list is empty; no operation or release is exposed |
| canonical host internal action | would require an exported provider/action contract | no | special OpenClaw object exposes no such metadata through the supported CLI/OpenAPI |
| Aily third-party agent | human user authorization | no | authorization is expired; reauthorization is an explicit human action |
| named OpenClaw Skill | Skill-specific runtime input/output | no | `oem-public-discovery` is only an uncreated UI candidate |
| OpenClaw cron result | OpenClaw-owned scheduled execution/history | no current task | automation/task candidates are uncreated and disabled |
| application-development `session/chat` | authenticated user, mutating cloud development conversation | not eligible | not a runtime business invocation contract |

There is therefore no verified tenant/user context, request schema, response schema, error
taxonomy, idempotency behavior, or Skill version that the canonical host can pin today. Guessing
these values would create a second, unaudited interface.

## WorkItem isolation evidence

The saved real result fixture
`test/fixtures/openclaw-first-oem-discovery-only.json` contains only the hosted app ID, public
OEM query, result status, coverage flags, two tangential public Boeing candidates, and excluded
non-OEM domains. It contains no `workItemId`, API key, actor, authority, DocumentVersion, or
artifact reference.

The proposed Skill input also explicitly forbids:

- `workItemId`
- `apiKey`
- `documentVersionId`
- `artifactRef`
- `actor`
- `authority`
- profile credentials

This proves the retained fixture and intended boundary do not carry a WorkItem Key. It does not
claim a not-yet-created runtime Skill has been security-tested.

## Real result retained for local replay

Query: `777 FTD 31-21002 software`

- `resultStatus=ZERO_RESULTS_FOR_TARGET_IDENTIFIER`
- `accessRestricted=false`
- `truncated=false`
- `partialOnly=true`
- direct target matches: `0`
- two Boeing results are `TANGENTIAL_NO_DIRECT_MATCH`
- non-OEM Federal Register and China Southern sources were excluded

Phase 6E already proved this exact fixture records one search run, zero candidates, and zero DM
I/O through the existing two-table loop. Phase 6F does not re-label that replay as a live server
call.

## Platform-native shortest path

The next eligible path is platform-native and requires an action-time human confirmation:

1. In the hosted OpenClaw UI, review and create the parameterized
   `oem-public-discovery` Skill with the already documented public-OEM-only input and output.
2. Publish/enable only after reviewing the Skill source, permissions, allowed domains, and result
   storage. Do not forward WorkItem identity or credentials.
3. Restore the Aily third-party-agent authorization through the explicit user reauthorization
   screen if Aily is the consumer.
4. If the platform then exposes an official server invocation operation, read its generated
   operation metadata, authentication mode, exact request/response, error behavior, and version
   before implementing the thin adapter.
5. If only Aily or cron consumption is available, keep it as a native Aily/OpenClaw path and let
   the canonical host consume only a reviewed platform result through a supported native
   binding. Do not invent a private HTTP gateway.

Confirmation is required at steps 1–3 because they create/publish a Skill or automation,
grant/renew access under a user identity, or establish a long-lived credential/binding. None of
those actions was authorized for this no-mutation audit.

## Claims and non-claims

Claims:

- Exact app metadata and normal Miaoda capability metadata were read without mutation.
- No currently verifiable stable server-only invocation seam exists for this app.
- The production discovery port correctly remains unconfigured.
- The real ZERO result remains valid for deterministic local candidate-store replay.

Non-claims:

- No live OpenClaw query or Skill was invoked in Phase 6F.
- No Skill, cron, Aily binding, connector, API key, release, schema, or online record was created
  or changed.
- No claim is made that the hosted assistant is offline, or that Feishu will never expose a
  server API.
- No WorkItem, Document Management, Assessment, AEO, or engineering conclusion was created.
