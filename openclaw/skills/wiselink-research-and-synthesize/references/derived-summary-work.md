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

Model dispatch retains the bound official Hosted profile and existing transport.
A mismatching Host route is refused, never switched. The driver returns only
source-read intents or candidate content through `return_wiselink_summary_step`.

The existing Summary CLI default-imports `native-temporary-review-gateway.mjs`
and passes its `createNativeReviewGatewayPreparer` to the current
`derived-summary-native-gateway.mjs` session. An explicit
`--native-gateway-launcher` can supply that same interface. The preparer also
serves isolated Review execution; Summary is an actual consumer of the two
native helper files. Including `native-temporary-review-gateway.mjs` and
`one-shot-outbound-adapter.mjs` supplies this existing source dependency without
changing Summary model instructions, projections or saved checkpoint formats.

Preparation stays lazy until a model request needs a gateway. It binds the exact
Summary subject, Host attempt, native session and deadline; the adapter records
each actual provider dispatch, including a child-internal retry. The current
Summary receipt validator checks the bounded dispatch ledger and provider
terminal proof. Owned child shutdown, adapter closure and temporary secret scan
precede the private cleanup receipt. A saved model response can repeat its exact
source read without preparing another gateway; an unknown provider terminal
closes further dispatch and cannot rearm the same attempt.

The model SAVE step uses `{action:'SAVE_SUMMARY', content:{headline,listBrief,body,limitations}}`.
Its strict tool schema requires exactly these four content fields: headline,
listBrief and body are nonempty strings; limitations is an array of nonempty
strings and may be empty. The schema mirrors existing Host receive limits
(240/2000/1000000 characters and 4000 per limitation); these are not requested
summary lengths. The system instruction follows the task's requested length and
asks for concise decisive premises, conclusions and conditions instead of copied member
assessments. The driver validates the object, then sends the unchanged Host SAVE
transport `contentJson: JSON.stringify(candidate.content)`. A string limitation
is rejected, never converted to an array. READ intents retain their existing shape.

## S2 model-view preservation

P1 deduplicates evidence by exact `evidenceRef`: complete evidence appears once
at top level and members retain ordered `evidenceRefs`. Equal wording under
different refs never merges identities; conflicting content for the same ref
is rejected. A member with persisted `understanding` may omit the duplicate
composed `body` only when `understanding` plus its complete ordered issues
reconstructs that body exactly. No text is inferred or parsed out of legacy
bodies. Old members without that field and child summaries keep their complete
bodies. Issues, negations, measures, rationale, limitations and exact lineage
remain intact; Host task/control fields stay outside the model view.

Each new P2 read intent still executes the requested authorized READ. Its complete
validated result is stored once at `summary-round-<round>-read`, separately from the model tool
message. The message confirms `CONFIRMED_SAME_CONTENT` only after exact
selection/content binding checks and proof that the full content is already in
the saved INPUT or an earlier tool message. `contentLocation` points to that
actual message and JSON location, including split body fields and evidence
locations. Registry availability alone is not delivery. Unseen content is
`DELIVERED_FULL_CONTENT` with its complete value; later confirmations retain
fresh currentness, Overall-status and limitation notices. Partial/error envelopes,
changed refs/content, missing receipts and invalid delivery locations fail closed.
Neither confirmation nor an inherited source read establishes fresh source
verification, applicability or approval.

The supported S2 prompt versions in `invoke-hosted-derived-summary-model.mjs` are:

- P1: `wiselink.derived-summary-prompt.v2.evidence-problem-dedup.v1`.
- P2: `wiselink.derived-summary-prompt.v2.evidence-problem-dedup.read-projection.v1`.
- Current new-state ordered INPUT variant: `wiselink.derived-summary-prompt.v2.evidence-problem-dedup.read-projection.v1.cache-prefix.v1`.

The ordered variant changes only serialization order through
`derived-summary-cache-prefix.mjs`. Complete values, array order, roots and
locator paths remain; generic identity/task hashing stays canonical. Supported
older `wiselink.derived-summary-prompt.v2.evidence-dedup.v1` and
`wiselink.derived-summary-prompt.v2` checkpoints keep their own message format.
Fresh reader enrichment never rewrites a sealed old member basis.

Every run chooses timeout, completion cap and maximum actual model requests
within the Host deadline and official profile limits. These are adjustable run
budgets, not fixed model capabilities; the existing provider timeout is inherited
when omitted.

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

## Checkpoint recovery

Saved `messages`, supported `promptVersion` and completed `argsHash` remain bound
to the original request. Recovery validates the saved transcript and exact
assistant/tool call pairs; it never replaces old messages with a newer projection.
Valid legacy v2 states may omit the version discriminator; their saved INPUT and
transcript still require the same binding validation.
A receipt-only crash after a completed model response and immutable READ can
reconstruct the missing tool message without redispatch or repeating that READ.
An already advanced transcript must match the original completed response and
receipt. Missing model state with round/Gateway artifacts, missing full receipts,
unsupported versions or altered bindings stop before generation or SAVE.

Completed model responses are persisted before executing their read intent.
Unknown generation is never replayed. Known transient failures retain the shared
requester's bounded retry plus fresh lease and the adapter's real terminal proof.
The existing exclusive attempt marker forbids restarting a retired Gateway
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
not model content, creates provenanceJson (prompt, skill and tool
versions). Provider dispatch receipts and secret-cleanup proof remain private
checkpoint evidence. A cleanup or terminal-proof failure prevents saving.

## Evidence boundary

Offline preservation and exact byte/receipt checks establish the retained input
and recovery contract. They do not measure real-model token or semantic savings,
prove installed OpenClaw behavior, deployment, provider execution or a real
business summary. This reference does not activate a runtime or authorize an
installation or profile change.

The native helper tests use explicit fake resolver modules, fake child CLIs,
synthetic provider configuration and fake upstream responses over loopback.
Their cross-module Summary tests exercise the current strict receipt validator,
actual dispatch ordinals, owned cleanup, unknown-terminal fencing and saved
response replay. They do not verify the default SDK deep import, its
`resolveSecretRefValues` export, a particular installed SDK version, real
SecretRef resolution or a real model. Running the CLI with active configuration
can claim/heartbeat the Host attempt, read sources, resolve credentials and
dispatch the provider; package inclusion and these synthetic tests do not grant
that execution authorization.
