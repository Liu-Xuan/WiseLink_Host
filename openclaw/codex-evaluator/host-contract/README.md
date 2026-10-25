# Seven imported Host input schemas

The source snapshots in `source/` are exact Git blobs from Host commit
`fc1322919b1b52433c33086c8db4aeb957f0e982`. Their blob and SHA-256
hashes are recorded in `../contracts/host-source-interface.json`.
They close the imports behind these seven MCP inputs:

| Tool | Source dependency | Runtime semantics beyond standard JSON Schema |
| --- | --- | --- |
| `read_assessment_sources` | TDMS native reference schema and predicate | Canonical percent encoding, atomic lengths, safe integer index |
| `commit_translation_candidate` | Translation part byte/count constants | Uploaded bytes, receipts, and finalization are runtime operations |
| `translation_workspace` | Translation workspace and issue schemas | Nonblank translated text; actual execution and workspace checks |
| `document_work` | Activity action schemas and version constants | Activity source, authorization, and run checks |
| `document_reading` | Reading action schemas | Delivery binding, authorization, and run checks |
| `document_translation` | Translation workspace command schema | Nested workspace and translation runtime checks |
| `derived_summary_attempt` | TDMS native reference schema and predicate | Canonical native reference and summary task checks |

The Host lockfile resolves `zod` **4.6.5** with integrity
`sha512-v5l/aFXZQeai4awLbOpSoHecE9UiMrnfx75tEXLjNonXVARxQ5mOeipTjROUchszUNCqnE+hqAMujRsRHsut2Q==`.
Set `WISELINK_ZOD_MODULE` to that version's `zod/v4/index.js` before
running `../export-host-contract.mjs`. The exporter executes the pinned
Zod expressions and the TDMS predicate extracted from the pinned source,
then tests every top-level action branch and negative boundary cases.
It refuses to export these seven through the older constrained converter
when the real Zod module is unavailable. It checks the loaded Zod version
and all 15 input Git blobs, and does not use `unrepresentable: 'any'`.

`../contracts/host-zod-validation-cases.json` records synthetic offline
cases, counts, and separate SHA-256 evidence for each generated schema and
case collection. `../check-host-contract.mjs` verifies the snapshots,
case counts, and those evidence bindings. It does not rerun Zod; the exporter
above performs the actual validator execution. The artifact regression test
checks that replacing a schema with `{}`, weakening a nested bound, or editing
a negative case cannot pass with unchanged evidence. A successful offline
check does not establish Host authorization or business acceptance.

Run `../compare-host-interface-packet.mjs [packet.json] [report.json]`
to compare all 42 inventoried input shapes with a versioned local
Host `tools/list` packet. Without a packet, the comparison report is
explicitly `PENDING_LOCAL_PACKET`. The packet's exact version or commit
is required before claiming local interface alignment. The seven schemas
completed in this change have `completedInThisChange: true`.

Accepted packet layouts are `{tools:[{name,inputSchema}]}`,
`{result:{tools:[...]}}`, and `{serverSource:{tools:{name:{inputSchema}}}}`.
Include a full `hostCommit`/`commit` or an exact `hostVersion`/`version`.
`schemaVersion` describes the packet format and is not sufficient by itself.
The report records the packet SHA-256, missing tools, and per-field differences;
duplicate tool names are rejected. A supplied packet with differences or no
revision exits with code 2 after writing its report. Shapes cannot establish
runtime refinements, service identity, authorization, or business acceptance.

From a checkout of this Codex branch with the Host's locked dependencies:

```sh
WISELINK_ZOD_MODULE="$PWD/node_modules/zod/v4/index.js" node openclaw/codex-evaluator/export-host-contract.mjs \
  server/modules/canonical-host/canonical-host-openclaw-mcp.service.ts \
  server/modules/canonical-host/canonical-host-readonly-mcp-tools.ts \
  server/modules/canonical-host/canonical-host-openclaw-mcp.openapi.controller.ts \
  shared/api.interface.ts \
  server/modules/canonical-host/derived-summary-attempt-mcp-tools.ts \
  server/modules/canonical-host/matter-attempt-mcp-tools.ts \
  openclaw/codex-evaluator/contracts/host-source-interface.json
node openclaw/codex-evaluator/check-host-contract.mjs
node openclaw/codex-evaluator/host-contract-artifact.test.mjs
node openclaw/codex-evaluator/host-packet-comparison.test.mjs
node openclaw/codex-evaluator/compare-host-interface-packet.mjs /absolute/path/to/host-packet.json /absolute/path/to/report.json
```

The comparison tests use synthetic packets and do not count as alignment with
the main controller's unpublished interface packet.
