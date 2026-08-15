# Phase 7 — real 737 cumulative Assessment local acceptance

## Outcome

The canonical host now completes the local, same-WorkItem product path:

`737 SB actual bytes → exact DM DocumentVersion → frozen.2 package actual-byte readback → full U0 Validator → Reader → Job Aid N=150 → candidate_only overall → engineer edit 1 → stale/resynthesis → engineer edit 2 → stale/resynthesis → page and fixed status OpenAPI fresh-read`

The second resynthesis retains both engineer changes. It no longer rebuilds from the stale
pre-change snapshot and therefore cannot silently discard the first explicit review.

## Exact owner inputs

- Document Management Boeing SB handoff:
  `2666e1a50efac7cc2a6dc2e2359882540cc7491b`
- Assessment host consumer and public seam:
  `1c24231137873752f71bde05de93b0d7d57669ba`
- Assessment cumulative resynthesis correction:
  `bf4521ac47dd1354d63c709a67ced28ce5598612`
- Document Management OEM monitoring status semantics:
  `1031cb030eb0c05299c3b932a98806658a15cdaa`
- Unified frozen.2 Reader/Validator remains the existing public composition; owner acceptance:
  `bbc2824bdf4cb9ce9c82f1be53fd24dd768966b5`

The OEM monitoring refresh is a regression input, not part of the 737 parsing authority. ZERO,
ACCESS_DENIED, PARTIAL_RESULTS, TRUNCATED and any flagged legacy CANDIDATES_FOUND result remain
discovery-only. Only a complete direct official source match may proceed to human selection; no DM
ingest is performed without an actual FileService selection.

## Exact real-loop identities

- source file: `737-34-3830 Original.pdf`
- source bytes: `1,060,204`
- source SHA-256:
  `add32c7d4192d35c59162f15eb57f08247427135d5912438501ec9267fa4d41a`
- DocumentVersion: `document_version_f4813607b91ee1a20e754e2d`
- WorkItem: `WI-LOCAL-737-34-3830-ASSESSMENT`
- package ID:
  `urn:techpub:package:v1:sha256:60c1b8548bf24a19d7d9f9cd3bc9fdafe252b034384aabcbba6d79517dc2972d`
- package bytes / raw SHA-256: `273,349` /
  `84d37eda63352934a69f7b1b37c0e174b74c7274e47d9041513e990c5091e1ac`
- full U0 result: `FULL_STRICT_VALIDATOR_PASSED`
- Reader applicability query rows: `38`
- CriterionSet: `JACS-72D0484B6F1C17A38F671F46`
- criteria/evaluation items: `150 / 150`
- final status: `BLOCKED_MISSING_INPUT / 待核实 / candidate_only`
- final cumulative assessment artifact bytes / SHA-256: `2,707,663` /
  `2113ab042ede84105f5dd976aef5ec54cb9bf794edfec79ac75844f676fa1da0`

## Defects closed by ordinary implementation

- existing-result returns now authorize and fresh-read permission before returning, including the
  post-collision fresh result;
- authorization requires both `allowed === true` and the exact requested action;
- resynthesis requires the current expected WorkItem revision and uses that revision as the
  existing ActionAttempt number, so separate explicit edits occupy attempts 4 and 5;
- invalid decision/status combinations, unknown criteria and client-reported engineer identity are
  rejected as HTTP 400 before ActionAttempt reservation or assessment mutation;
- the controller continues to derive actor from `@NeedLogin` `userContext` and derives review status
  from the selected decision;
- the page exposes evaluate plus one explicit engineer-change/resynthesis action while preserving
  the existing 原件 → 分类 → 解析 → 统一包 → Reader rail;
- the three Bearer OpenAPI routes remain GET-only; no Assessment mutation route was added there;
- the final assessment actual-byte readback contains both engineer comments in the evaluation
  snapshot and overall transport.

## Commands and observed results

The first unscoped local run correctly failed with
`FULL_U0_VALIDATOR_UNAVAILABLE:PROCESS_FAILURE` because the default Python lacked the frozen.2 U0
requirements. The business path was then rerun with the repository's already proven Python runtime;
the failure was not hidden and no validator was replaced:

```bash
WL_LOCAL_U0_PYTHON=/Users/liuxuan/miniconda3/bin/python3 \
  npm run test:ordinary:737-assessment-loop
npm test -- --runInBand
npm run test:canonical:activation
npm run type:check
npm run lint
npm run build:prod
```

Observed:

- real 737 cumulative loop: PASS;
- Jest: 27 suites / 127 tests PASS;
- targeted authorization/controller/client/OEM regression: 29/29 PASS;
- activation/page/OpenAPI composition: PASS;
- server/client typecheck, ESLint, Stylelint and production build: PASS.

The production client build emits existing workspace tsconfig-path discovery and large-chunk
warnings; it completes successfully and does not change this slice's claims.

## Claims and non-claims

Claims:

- one ordinary WorkItem retains the exact parser package while carrying a thin, fresh Assessment
  projection;
- two explicit engineer changes are cumulative, revision-scoped and source-bounded;
- page and fixed read-only OpenAPI read the same WorkItem projection;
- incomplete external discovery states cannot authorize Document Management ingestion.

Non-claims:

- no push, DEV release, environment change, online schema change or business write was performed;
- no Aily UI or OpenAPI mutation skill was added;
- no engineering conclusion, fleet applicability decision, Assessment confirmation or AEO
  authority was created;
- no table, queue, worker, second store, Reader, contract, hash rule, baseline or gate was added;
- hosted evaluate/resynthesis actions remain the next separately authorized validation action.

## Goal alignment

- The slice moves a real 737 from exact document identity through source-bounded parsing into a
  reviewable 150-item Assessment and proves repeated human iteration on the same WorkItem.
- Every implementation change prevents a concrete wrong result: authorization bypass, stale CAS,
  invalid review state, HTTP 500 misclassification or loss of a prior engineer edit.
- No new proof framework or special-case parsing rule was introduced.
- The shortest next step remains one controlled hosted evaluate/resynthesis validation; it does not
  require another architecture layer.
