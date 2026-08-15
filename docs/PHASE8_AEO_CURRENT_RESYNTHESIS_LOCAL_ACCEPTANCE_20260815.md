# Phase 8 — current cumulative Assessment to AEO local acceptance

## Outcome

The canonical host mechanically consumes AEO owner commit
`cf9a377497d2bfa0c514de4c0c4ff60a3bfc3278` and completes this local-only,
same-WorkItem path:

`real 737 SB → exact DocumentVersion → frozen.2/U0/Reader → Job Aid N=150 → two cumulative engineer resyntheses → current Assessment fresh-read → explicit AEO dispositions → working copy → Draft → Word`

The production `AppModule` still does not configure `AeoAuthoringModule`. The owner adapter is
provided only by the local acceptance composition; this slice adds no route or hosted authority.

## Exact current input

- WorkItem: `WI-LOCAL-737-34-3830-ASSESSMENT`, revision `6`
- DocumentVersion: `document_version_f4813607b91ee1a20e754e2d`
- Assessment resynthesis attempt: `ATT-LOCAL-RESYNTHESIZE_ASSESSMENT-5`
- Assessment bytes / SHA-256: `2,707,663` /
  `2113ab042ede84105f5dd976aef5ec54cb9bf794edfec79ac75844f676fa1da0`
- Assessment authority: `candidate_only`; criteria/evaluation items: `150 / 150`
- reviewed OEM reference: FAST #62 `document_version_c71fbc457cdc5e7a05725a4d`
- AEO R09 seed bytes / SHA-256: `78,811` /
  `f781b660dbc8457c800dae5e5d0d4cbef877f6d591985f4fe5f8f118dbbfa80d`

## Stale-input rejection before AEO artifact I/O

Two negative inputs are evaluated before any AEO artifact persistence or read:

- initial `CANDIDATE_ONLY` Assessment → `ASSESSMENT_EXPLICIT_RESYNTHESIS_REQUIRED`;
- the preceding resynthesis bytes presented against the current revision-6 projection →
  `ASSESSMENT_ACTUAL_BYTES_MISMATCH`.

Observed AEO artifact I/O at both rejection points is exactly `persist=0 / read=0`. The accepted
input additionally rebinds WorkItem, DocumentVersion, parsed package, authority, stale state,
context hash and transport hash to the actual current Assessment bytes.

## AEO output

The same local WorkItem executes four explicit candidate dispositions in order:
`ADOPT`, `ADAPT`, `REFERENCE_ONLY`, `IGNORE`. Each produces an immutable working-copy revision and
an exact decision readback. The final working copy is then frozen to a Draft and exported to Word.

- WorkItem state transition: `6 → 13`
- artifact kinds: bootstrap, four working copies, Draft package, Word export
- Word bytes / SHA-256: `30,207` /
  `584dd5d15359aa11adb56aa055dd95143a89178ca1794ed5f959088f074bbdc3`
- Word actual-byte signature: `PK`
- automatic adoption: false
- engineering approval: false
- online writes / releases: `0 / 0`

## Commands and results

```bash
WL_LOCAL_U0_PYTHON=/Users/liuxuan/miniconda3/bin/python3 \
  npm run test:phase6d:aeo-same-workitem
npx jest test/unit/phase6d-aeo-host-consumption.spec.ts --runInBand
npm test -- --runInBand
npm run type:check
npm run lint
npm run build:prod
npm run precommit
git diff --check
```

Observed results:

- real 737 → Assessment → AEO → Word loop: PASS;
- targeted AEO host-consumption tests: `4 / 4` PASS;
- full Jest: `27 suites / 128 tests` PASS;
- typecheck, lint, production server/client build, precommit and diff check: PASS.

The first unscoped real-loop run failed explicitly before AEO with
`FULL_U0_VALIDATOR_UNAVAILABLE:PROCESS_FAILURE` because the default local Python lacked the frozen.2
dependency closure. The accepted rerun used the repository's already-proven
`/Users/liuxuan/miniconda3/bin/python3` with `jsonschema 4.25.1`; no Validator or business rule was
changed or skipped. Existing Vite workspace-tsconfig and large-chunk warnings remain warnings and
the production build completed.

## Claims, non-claims and hosted prerequisite

Claims:

- only the current explicit cumulative Assessment resynthesis can enter the AEO adapter;
- all four candidate disposition paths, Draft and Word execute on the same WorkItem;
- the Word candidate is actual-byte readable and remains non-authoritative.

Non-claims:

- no push, release, online schema/data/FileService write or current switch was performed;
- no AEO endpoint, table, queue, worker, second store, contract, hash rule, baseline or gate was
  added;
- no engineering conclusion, applicability decision, formal AEO or AAmis update exists.

Hosted prerequisite: a separately authorized hosted slice must explicitly configure the existing
AEO owner provider with the ordinary authenticated WorkItem/FileService ports and a server-confirmed
AEO target. Production remains fail-closed and unconfigured until that action; the adapter cannot
accept client-supplied Assessment or target authority.

## Goal alignment / deviation

- This slice advances the shortest real product path from the current reviewed Assessment to a
  reviewable Word candidate.
- The only production logic change is the owner-provided stale/currentness correction; the rest is
  local composition and evidence.
- No new gate or infrastructure loop was introduced, and no per-document parser exception was
  added.
- The next step is hosted composition of this same path, not another contract or storage layer.
