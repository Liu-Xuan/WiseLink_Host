# Phase 5 — real 737 Job Aid Assessment local acceptance

## Outcome

The one canonical host now runs the local product path:

`737 SB actual bytes → exact DocumentVersion → existing PDF frozen.2 producer → full U0 Validator → Reader → Job Aid N=150 → candidate-only overall assessment → engineer change → explicit resynthesis → same WorkItem page/OpenAPI/deep link`

It also exercises reviewed OEM context with the current FAST version chain. FAST #61 is adopted in
the initial candidate; changing the reviewed manifest to #62 produces
`EXTERNAL_CONTEXT_STALE`, and the rebuilt transport contains #62 only. OpenClaw
`ZERO_RESULTS_FOR_TARGET_IDENTIFIER` remains discovery-only and never becomes evidence.

## Exact owner inputs

- Document Management SB handoff: `2666e1a50efac7cc2a6dc2e2359882540cc7491b`
- Assessment ordinary host consumer: `56d35d2b0ebf83e235b1583303bb996e5a93081f`
- Assessment public API snapshot: `765062c255c4c9a402db2fffe53be22d8f70ae0a`
- Assessment reviewed OEM seam: `1c24231137873752f71bde05de93b0d7d57669ba`
- Unified/U0/Reader: existing canonical-host frozen.2 composition, unchanged

## Exact 737 binding

- source bytes: `1,060,204`
- source SHA-256: `add32c7d4192d35c59162f15eb57f08247427135d5912438501ec9267fa4d41a`
- DocumentVersion: `document_version_f4813607b91ee1a20e754e2d`
- package ID: `urn:techpub:package:v1:sha256:60c1b8548bf24a19d7d9f9cd3bc9fdafe252b034384aabcbba6d79517dc2972d`
- package bytes: `273,349`
- package raw SHA-256: `84d37eda63352934a69f7b1b37c0e174b74c7274e47d9041513e990c5091e1ac`
- CriterionSet: `JACS-72D0484B6F1C17A38F671F46`
- criteria: `150 / 150`

## Observed behavior

- full U0 validation passed before Assessment;
- Reader returned 38 source-bounded applicability rows without deciding fleet applicability;
- the assessment remains `BLOCKED_MISSING_INPUT / 待核实 / candidate_only`;
- the initial assessment artifact was persisted and read back as exact bytes;
- changing reviewed FAST #61 to #62 yielded `EXTERNAL_CONTEXT_STALE` and removed the old #61
  DocumentVersion from the rebuilt transport;
- an explicit engineer review change yielded `ENGINEER_ITEM_SET_CHANGED` and a second immutable
  assessment artifact;
- exactly one `EVALUATE_JOB_AID` ActionAttempt and one `RESYNTHESIZE_ASSESSMENT` ActionAttempt
  succeeded;
- the parser package identity remained unchanged; Assessment refs/hashes are stored only in the
  nullable WorkItem assessment projection, never in parser package fields on ActionAttempt;
- the same WorkItem page, fixed read-only OpenAPI status and server-derived deep link fresh-read the
  candidate projection.

## Commands

```bash
WL_LOCAL_U0_PYTHON=/private/tmp/wiselink-u0-local-venv/bin/python \
npm run test:ordinary:737-assessment-loop

npm test
npm run lint
npm run build:prod
```

Observed acceptance:

- real 737 Assessment loop: PASS;
- Jest: 19 suites / 87 tests PASS;
- server/client typecheck, ESLint, Stylelint, production build and OpenAPI self-check: PASS.

## Claims and non-claims

Claims:

- the existing single WorkItem and existing FileService/Reader path can host the real 737
  candidate assessment without a second store, queue, worker or Registrar;
- reviewed OEM revision changes and engineer review changes both make the candidate stale and
  require explicit resynthesis;
- page and read-only OpenAPI consume the same thin WorkItem projection.

Non-claims:

- no push, release, environment change or online write was performed;
- no Assessment or AEO engineering conclusion was confirmed;
- OpenClaw output was not adopted as evidence;
- no new table, endpoint, package contract, hash rule, baseline, gate, queue, worker or second
  persistence truth was added;
- hosted Assessment and Aily skill execution remain unverified.

## Goal alignment

- This slice moves an exact SB from parsing into a source-bounded, reviewable Job Aid candidate.
- Added complexity is limited to ordinary Assessment composition, two ActionAttempts and one thin
  WorkItem projection; it directly prevents parser/assessment artifact identity confusion.
- The implementation advances the real loop instead of adding gates or special-case rule lists.
- The shortest next step is one separately authorized hosted Assessment validation, followed by
  mapping the existing fixed read-only OpenAPI into Aily skills.
