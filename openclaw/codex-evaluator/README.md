# Codex executor for the existing WiseLink assessment contract

## 2026-10-25 consumer migration

The current graph contract is v1.7. Its first production path remains
`PROGRAM_CONTROLLED_V1`: the program prepares material, makes one model request,
preserves the complete response, saves, independently reads back, and projects
Overall deterministically. The autonomous assessment experiment documented below
is a separate mode and is not the default program assessment.

`createCodexGateway` in `codex-generation.mjs` supplies bounded structured
generation to the existing initial/applicability, JobAid/Matter, translation,
reading, activity, ordinary Review and Wiki consumers. Use explicit
`modelExecutor: 'CODEX'` plus `codexOptions: {codexBinary, configPath, runRoot}`;
the existing CLI exposes the matching `--model-executor`, `--codex-binary`,
`--codex-config` and `--codex-run-root` options. Omitted selection preserves
Hosted behavior. The Host must present an independent Codex MCP identity before
these CLIs can claim any business work; the current legacy identity is rejected.

Each bounded generation makes exactly one Miaoda `glm-5.3` request. Codex returns
a JSON candidate; a local adapter validates it and converts it to the existing
function response envelope. No business function is executed by that conversion.
The original domain validators, checkpoints and Host save/read rules remain in
control. Wiki has its own actual Codex process receipt, not a simulated Native
OpenClaw receipt. Existing unresolved checkpoints remain pinned to their executor.

The real-model, synthetic-data smoke commands are:

```sh
node openclaw/codex-evaluator/run-consumer-fixture.mjs \
  --codex /absolute/path/to/codex --config /absolute/path/to/openclaw.json \
  --run-root /absolute/private/runs
node openclaw/codex-evaluator/run-wiki-fixture.mjs \
  --codex /absolute/path/to/codex --config /absolute/path/to/openclaw.json \
  --run-root /absolute/private/wiki-runs
```

Both commands use synthetic Host data. They do not claim a real business save.
`--dry-run` validates their inputs without calling a model. The bounded adapter
rejects oversized input before dispatch (approximately 1 MiB) and supports up to
32,768 output tokens, with a default of 16,384 and lower caller limits honored.

Both commands have now completed against the real `codex-cli 0.164.0` and the
test application's configured Miaoda `glm-5.3` route. The consumer fixture exited
0 in 48.474 seconds with four upstream requests: program assessment, translation
GENERATE, translation CHECK, and document reading. Its synthetic Host recorded a
work SAVE followed by an independent exact-request READ; the resulting saved
revision was the input to the deterministic Overall projection. The Wiki fixture
exited 0 in 18.204 seconds with two upstream requests and produced a candidate
from two selected synthetic children and their shared root source. The Wiki
candidate was not saved to Host. All six process receipts closed normally and
reported the source model configuration unchanged. The complete sanitized
[consumer validation evidence](consumer-validation-evidence.json) records these
results; `realHostCalled` is false throughout.

See the [consumer inventory and Host binding record](../../docs/coordination/WISELINK_CODEX_MIGRATION_20261025.md)
for actual scope, the retained Hosted-only legacy worker and isolated Native
Review mode, MCP framework choices, and the remaining identity/credential/routing
work. A metadata-only existing-Host probe is available in `probe-host-mcp.mjs`;
its successful result explicitly does not claim an independent runtime binding.

## Earlier autonomous assessment fixture

This is an opt-in implementation for a Miaoda test instance. Codex CLI owns model
continuation and registered MCP calls. Model inference uses the instance's existing
`miaoda/glm-5.3` provider. No OpenAI account, OpenAI API key, or global configuration
change is required by this runner.

The 2026-10-25 end-to-end fixture passed with 9 actual Miaoda requests across
initial evaluation and Overall, 2 independently verified work saves, and exact
saved-revision reuse at the synthetic Overall commit. See [validation report](VALIDATION.md)
and [machine-readable evidence](validation-evidence.json). This proves the bounded
executor path, not authorization or persistence on the canonical Host.

## Current scope

The implementation has two independent integration surfaces:

1. `createCodexAssessmentCallbacks` supplies `evaluateDynamicRules` and
   `synthesizeOverall` callbacks with the existing `{output, provenance}` return
   contract. The existing Host orchestrator remains responsible for begin, lease,
   identity, result sealing, commit, adoption rules, and reader consistency.
2. `run-fixture.mjs` runs these callbacks with the real Codex/Miaoda model and an
   explicitly synthetic in-memory Host. Its results are software execution evidence,
   not real Host persistence, engineering acceptance, or product-reader validation.

The target test instance had no configured Host MCP server when inspected. Old
application credentials and runtime identities were not copied. The separate
program-controlled production path remains unchanged.

The shared design conversation could not be read because of a browser origin
restriction. Implementation is grounded in the independently available assessment
handoff and actual repository contracts. It must not be described as an exact
reproduction of inaccessible conversation text.

## Reused components

Source reference: `94c24efa746984a7edbf8b76719e1ffcfa549bed` on
`codex/native-assessment-delivery-20261024` in `Liu-Xuan/WiseLink_Host`.

- Existing JobAid guidance, semantic guidance, work shape, and exact saved-work
  projection are imported from `../skills/wiselink-research-and-synthesize/scripts`.
- The guidance and work-shape file hashes were compared with the old app's c239
  installation and match. This source branch declares package c235; that package
  declaration is reported honestly, without claiming the whole c239 installation
  was migrated or that a new runtime is registered with Host.
- The old handmade `invokeHostedJobAidProblemModel` model loop is not invoked.
- Existing Feishu channel, memory, browser, and platform plugins are not
  automatically exposed to Codex. This executor registers only the assessment MCP
  intent tool. Other capabilities need their own compatible adapter and authorization.

## Flow

`Codex -> registered assessment_step -> bound Host hooks`

`Codex Responses -> loopback bridge -> configured Miaoda Chat Completions`

The one MCP tool retains the existing intents:

| Intent | Effect |
| --- | --- |
| `READ_SOURCES` | Read exact refs from the supplied Host catalog. |
| `QUERY_KNOWLEDGE` | Query supplementary knowledge when the task declares it available. |
| `READ_WORK` | Read and verify a pinned work revision; expose the requested complete baseline. |
| `SAVE_WORK` | Submit `workJson` with caller-generated request key and CAS revision, then independently read it back. |
| `FINISH` | Finish only against verified completed work; Overall also requires CURRENT overview and consistency check. |

Models never author attempt/lease controls. Unknown SAVE outcomes retain their
original request key and are read back before proceeding. A definitive Host
validation rejection can be corrected only when the authorized transport wrapper
provides a trustworthy rejection classification (`knownValidation: true` plus a
safe code), or a structured rejection response. An arbitrary transport exception
is not enough to claim the write failed.

Overall may retain an already completed/current work revision if its actual
consistency review finds no change. The subsequent Host Overall commit is separate
from creating another issue-work revision. A stale overview requires a meaningful
update before completion.

## Requirements and execution

- Node.js 22 and Python 3 with their standard libraries.
- Official `@openai/codex@0.164.0`, installed separately. The runner fails for an
  unvalidated version; it does not install or update software itself.
- Existing Miaoda provider configuration with file SecretRefs. The bridge resolves
  credentials only inside the instance and sends them only to the fixed configured
  Miaoda upstream. Codex receives temporary loopback capabilities.
- The isolated Codex configuration explicitly permits only its registered
  `assessment.assessment_step` tool for the requested automation. It keeps global
  approval policy at `never` and a read-only shell sandbox; the bridge filters all
  other tool schemas and rejects unlisted calls. This local policy does not grant
  Host access or authorize formal business decisions.

From the repository root, set actual local paths in the command:

```sh
node openclaw/codex-evaluator/preflight.mjs \
  --config /absolute/path/openclaw.json \
  --codex /absolute/path/node_modules/.bin/codex

node openclaw/codex-evaluator/run-fixture.mjs \
  --config /absolute/path/openclaw.json \
  --codex /absolute/path/node_modules/.bin/codex \
  --run-root /absolute/private/path/fixture-runs
```

The preflight is an inventory, not proof of authentication. The fixture prints
`REAL_MIAODA_MODEL_SYNTHETIC_HOST` and `realHostCalled: false` deliberately.
Run directories contain private model/tool transcripts, transport metadata,
assessment status, and the synthetic fixture result. Do not put real-business run
directories in public Git.

## Existing-orchestrator integration

After the current runtime has a legitimate Host binding, the existing authorized
consumer can inject these callbacks. The following shows the integration seam;
`callTool` must be the existing trusted Host client, not model-generated code.

```js
import { createCodexAssessmentCallbacks } from './codex-assessment.mjs';
import { runDynamicEvaluation, runOverallSynthesis }
  from '../skills/wiselink-research-and-synthesize/scripts/orchestrate-host-mcp.mjs';

const callbacks = createCodexAssessmentCallbacks({
  codexBinary: '/absolute/path/to/codex',
  configPath: '/absolute/path/openclaw.json',
  runRoot: '/absolute/private/path/assessment-runs',
});

const initial = await runDynamicEvaluation({
  workItemId, callTool, evaluateDynamicRules: callbacks.evaluateDynamicRules,
});
const overall = await runOverallSynthesis({
  workItemId, callTool, providers: [], synthesizeOverall: callbacks.synthesizeOverall,
});
```

Do not run this example on the old runtime identity merely to make the new test
app appear authorized. The canonical Host must recognize the real executing app,
profile, skill/provenance policy, current task, and permitted tools. Exact saved
work and final readers must be checked on a genuine authorized business run.

## Limits that remain explicit

- This bridge supports text plus registered function tools. It does not implement
  images, audio, custom tools, JSON-schema response formats, remote compaction, or
  encrypted reasoning state. Optional cache/client metadata hints are not forwarded.
- Default ceilings are 24 model requests, 48 business tool calls, 8,192 output tokens
  per request, and 600 seconds per callback. These are operational limits, not a
  required number of evaluation rounds or a quality score.
- The synthetic fixture explicitly requests `reasoning_effort: low` and a 16,384
  output-token ceiling after an observed 8,192-token truncated response. GLM-5.3
  always reasons and supports `low/high/max`; it cannot disable thinking
  ([vendor documentation](https://docs.z.ai/guides/capabilities/thinking)).
  The bridge records the requested setting; proxy acceptance does not independently
  prove how the provider internally applies that setting. Production quality and
  reasoning budgets require separate evaluation with real authorized tasks.
- Codex keeps continuity inside each callback. Initial evaluation and Overall use
  separate lifecycle callbacks over exact saved work, as the existing Host contract
  does. There is no separate session for every issue or SAVE.
- Uncertain-save state is retained within the running callback. Automatic recovery
  after process/container restart is not implemented here. Before production,
  connect the existing durable checkpoint/reconciliation mechanism; never silently
  start a replacement attempt after an unknown write.
- Real Host validation-error classification, runtime provisioning, final Overall
  acceptance, and same-version reading through library/Wiki/knowledge entry points
  have not been established by the synthetic fixture.
- A successful configured-model run is not a complete network-egress audit.

## Focused checks

```sh
node openclaw/codex-evaluator/assessment-session.test.mjs
python3 -m unittest discover -s openclaw/codex-evaluator -p 'test_*.py' -v
```

Checks cover exact readback, CAS binding, uncertain writes, premature completion,
CURRENT overview, source selection, tool allowlists, namespace conversion, SSE
function-call integrity, and duplicate JSON argument keys. They do not replace
real Host authorization or production acceptance tests.
