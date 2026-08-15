# Phase 6D — AEO same-WorkItem local integration handoff

> Historical acceptance: the active host source seam is superseded by AEO owner commit
> `cf9a377497d2bfa0c514de4c0c4ff60a3bfc3278`; see
> `PHASE8_AEO_CURRENT_RESYNTHESIS_LOCAL_ACCEPTANCE_20260815.md`. The identities below remain the
> original Phase 6D evidence and are not the current source pin.

## Outcome

The canonical host now consumes the AEO owner public seam from exact commit
`7a8403ef93b015d35f886eece4865f66741812dd` and runs the local product path:

`real 737 SB → frozen.2/U0/Reader → Job Aid N=150 Assessment → reviewed FAST #62 candidate → exact R09 authoring seed → explicit ADOPT → working copy → Draft package → Word candidate`

All stages remain on `WI-LOCAL-737-34-3830-ASSESSMENT`. The host production `AppModule` does not
import `AeoAuthoringModule`; the same-WorkItem adapter is absent by default and is supplied only by
the local acceptance context through `provideAeoSameWorkItemAssessmentAdapter()`.

## Exact inputs and readback

- Phase 6C parent commit: `b42188168459370e2c6a83e2cb658a89ed6013fb`
- AEO owner commit: `7a8403ef93b015d35f886eece4865f66741812dd`
- 737 DocumentVersion: `document_version_f4813607b91ee1a20e754e2d`
- 737 frozen.2 package: `urn:techpub:package:v1:sha256:60c1b8548bf24a19d7d9f9cd3bc9fdafe252b034384aabcbba6d79517dc2972d`
- 737 package bytes/hash: `273,349` / `84d37eda63352934a69f7b1b37c0e174b74c7274e47d9041513e990c5091e1ac`
- CriterionSet: `JACS-72D0484B6F1C17A38F671F46`, `150 / 150`
- final Assessment bytes/hash: `2,705,961` / `0948b690b2f55bc3b3bfe0ad279e4b33976e1794cbf2d1dc938e74485edbfaed`
- reviewed OEM reference: FAST #62 DocumentVersion `document_version_c71fbc457cdc5e7a05725a4d`
- exact R09 seed package: `AEOPARSE-D39EB2E83C552549A9AA5784`
- R09 seed bytes/hash: `78,811` / `f781b660dbc8457c800dae5e5d0d4cbef877f6d591985f4fe5f8f118dbbfa80d`
- WorkItem state transition: `6 → 10`
- generated artifact kinds: `AUTHORING_BOOTSTRAP`, `WORKING_COPY`, `DRAFT_PACKAGE`, `WORD_EXPORT`
- Word candidate bytes/hash: `30,207` / `239585984cc5a15e58e3a6f4968de3ec6b67dc129137d4e668b13dd1fdcde96d`
- Word actual-byte signature: `PK`

The disposition is explicit `ADOPT`; it remains a candidate requiring review. Automatic adoption,
engineering approval, publication, AAmis replacement and online writes are all false.

## Composition boundary

The synchronized source is the 35-file transitive closure behind the owner public API and action
path. Thirty-four files are byte-identical to the owner commit. The only host adaptation registers
the already-present `AeoAuthoringService` injectable in `AeoAuthoringModule.providers`, as required
by the host's typed-Nest lint; it adds no controller, route, startup I/O or authority. The closure
includes the same-WorkItem adapter, action/session/Word core and their shared AEO types.
No AEO module is registered in the hosted `AppModule`, so this slice adds no route, page, table,
queue, worker or second state store. The local runner supplies in-memory ports solely to prove the
same WorkItem and actual artifact bytes.

## Commands and observed findings

```bash
WL_LOCAL_U0_PYTHON=/Users/liuxuan/miniconda3/bin/python3 \
npm run test:phase6d:aeo-same-workitem

npx jest test/unit/phase6d-aeo-host-consumption.spec.ts --runInBand
npm test
npm run type:check
npm run lint
npm run build:prod
npm run precommit
```

The first fixture-generation attempt used the temporary snapshot's unresolved preset path; the
second lacked `NODE_PATH`. Both failures were explicit. The exact owner source was then executed
with the canonical host TypeScript configuration and module path, producing the already recorded
78,811-byte R09 fixture and matching historic SHA-256. The first action runs also exposed invalid
local-only locator schemes and one fake-Registrar field assertion; only the local fixture/provider
was corrected. Owner validation and action code were not relaxed.

The earlier FTD regression environment finding is retained: system `python3` lacks `jsonschema`.
The accepted command explicitly uses `/Users/liuxuan/miniconda3/bin/python3`, where `jsonschema
4.25.1` is installed. FailureReport strict validation is not skipped.

## Claims and non-claims

Claims:

- the exact owner adapter is disabled by default and works when explicitly injected locally;
- one existing 737 WorkItem can carry source-bound Assessment context into AEO authoring without a
  second WorkItem;
- one explicit reviewed FAST #62 candidate can be adopted into the R09 working copy and projected
  deterministically to a byte-readable Word candidate;
- all four AEO artifacts are immutable local candidates and no validation-write receipt is used on
  the authenticated ordinary-host path.

Non-claims:

- no push, release, environment mutation, schema application or online write was performed;
- no AEO route or Aily mutation tool is active in the canonical host;
- no engineering approval, applicability conclusion, formal AEO, AAmis update or current switch
  exists;
- no new contract, hash rule, baseline, gate, endpoint, table, queue, worker or store was added.

## Goal alignment

- This slice advances the real cross-module path from an exact SB and source-bound Assessment to a
  reviewable AEO Word candidate.
- Added code is a mechanical owner source closure plus one local composition runner; it does not
  create another product surface or runtime authority.
- The work did not expand into new gates or per-document special-case parsing rules.
- The next shortest step, if separately authorized, is a hosted read/action composition using the
  same WorkItem and existing authentication—not another contract or persistence layer.
