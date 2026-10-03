# Selected-scope derived summaries

`consume-hosted-derived-summary.mjs` consumes one already-admitted Host attempt:
`OPENCLAW_DERIVED_SUMMARY`, subject `{kind:'DERIVED_SUMMARY', summaryId}`. It
never discovers members, begins a new business request, or fabricates a WorkItem,
Matter or Review actor-context identity. The shared contract is
`shared/derived-summary.interface.ts`; the plain task carries Host control fields
`actionAttemptId`, `operationRef`, `deadlineAt`, `executionModel`, and
`taskInputHash`. Those fields stay outside model messages.

The consumer uses STATUS, CLAIM, a real READ_MEMBER_WORK for **every** selected
exact member, the official Hosted model, SAVE_SUMMARY, READ_SAVED_SUMMARY and
FINISH. Optional model reads use only registered member/evidence refs and carry
an explicit purpose. The body must cite at least one registered member or source.
Direct member use is recorded only for explicit member citations in the body. Host
reauthorizes reads and saves, merges scope/member limitations, validates source
identity, materializes coverage, owns CAS/idempotency and keeps every revision
candidate-only. Full selected issues, conditions, measures, risk rationale,
unknowns, stale Overall, corrections, historical exact work and child summary
lineage are delivered. A child summary is derived work; its roots do not become
new independent sources, verified applicability or installed-fleet facts.

The CLI uses the **installed A12b native temporary Gateway and original one-shot
outbound adapter**. Its small new binding branch accepts the real summary
subject and session `agent:wiselink-engineering:summary:<summaryId>:<attemptRef>`.
The official source profile, endpoint, secret resolver, TLS, plugins-disabled
Gateway and provider-terminal ledger remain the existing implementations. The
captured route must be the registered official `miaoda/glm-5.3`; a mismatching
Host route is refused, never switched. The driver returns only source-read
intents or candidate content through `return_wiselink_summary_step`.

The model SAVE step uses `{action:'SAVE_SUMMARY', content:{headline,listBrief,body,limitations}}`.
Its strict tool schema requires exactly these four content fields: headline,
listBrief and body are nonempty strings; limitations is an array of nonempty
strings and may be empty. The schema mirrors existing Host receive limits
(240/2000/1000000 characters and 4000 per limitation); these are not requested
summary lengths. Prompt v2 follows the task's requested length and asks for
concise decisive premises, conclusions and conditions instead of copied member
assessments. The driver validates the object, then sends the unchanged Host SAVE
transport `contentJson: JSON.stringify(candidate.content)`. A string limitation
is rejected, never converted to an array. READ intents retain their existing shape.

Every run explicitly chooses timeout, completion cap and maximum actual model
requests. These are adjustable run budgets within the Host deadline and current
profile limits, not fixed model capabilities. The existing provider timeout is
inherited when omitted; the observed 600 seconds and 64000 completion cap are
current installation choices. Reasoning defaults to low and may be set to the
profile's supported low/high/max. No 480-second or 8192-token default is imposed.

```text
node scripts/consume-hosted-derived-summary.mjs \
  --summary-id <exact DS- ID> --attempt-ref <exact AQ- ID> \
  --openclaw-config /home/gem/workspace/agent/openclaw.json \
  --timeout-ms <positive run budget within Host deadline> \
  --max-completion-tokens <positive cap within official profile> \
  --max-model-requests <positive actual dispatch budget> \
  --reasoning-effort low \
  --provider-timeout-seconds <optional positive override> \
  --checkpoint-root <private persistent directory>
```

Completed model responses are persisted before executing their read intent.
Unknown generation is never replayed. Known transient failures retain the shared
requester's bounded retry plus fresh lease and the adapter's real terminal proof.
The existing A12b exclusive attempt marker forbids restarting a retired Gateway
under the same Host attempt. A completed read intent can repeat its exact Host
read; if more generation is necessary after that Gateway has retired, a normal
new Host request is required. This does not reset the old attempt, erase its
checkpoint, alter the original deadline or change the provider.

A lost save response checks the **same** requestId. Only bounded
`DERIVED_SUMMARY_SAVE_NOT_FOUND` means no save; other failures remain failures.
The exact persisted content, candidate status, scope, request and revision are
read back before FINISH. Saved content survives a FINISH error; a later run can
finish or read its terminal result without another generation or save. Real
pre-save execution failures use fenced FAIL with a fixed code; they never invent
successful output or use CANCEL as a failed model receipt. A rejected failure
report remains in the private checkpoint and is exposed as a bounded diagnostic.

Actual reported model identity is stored separately from configuredModelRef.
If the platform exposes no downstream model, actualModel is null. The driver,
not model content, creates provenanceJson (prompt, installed skill and tool
versions). Provider dispatch receipts and secret-cleanup proof remain private
checkpoint evidence. A cleanup or terminal-proof failure prevents saving.

## Installation delta

This Git implementation starts from Host commit
`7e7be7fdbba40fc94c461defc962bf1caae9475e`. Its runtime files are older than the
installed A12b 71-file source. Do not install those whole existing files from Git.
Apply the separately reviewed A12b delta, which preserves all installed files and
changes only the new summary consumer files, strict metadata registration/tests,
this documentation, and the summary-only native launcher binding branch.

Add exactly `derived_summary_attempt` to
`mcp.servers.wiselink_host_controller.toolFilter.include`, preserving every prior
entry and every other config key. Host must publish the corresponding tool
before the strict runtime metadata validator is installed. Do not start a summary
job or change cron, identity, models, endpoints, secrets or profile during install.

Local tests and the exact-file installation rehearsal prove the implementation
and fake transport behavior. They do not prove installed OpenClaw behavior,
provider execution, a published Host route, or a real business summary. Those
receipts remain separate acceptance steps.
