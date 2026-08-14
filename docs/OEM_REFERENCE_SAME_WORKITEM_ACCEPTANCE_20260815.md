# OEM_REFERENCE same-WorkItem acceptance — 2026-08-15

> Superseded for current identity and package claims by
> `OEM_REFERENCE_VERSION_CHAIN_ACCEPTANCE_20260815.md`. This file remains historical evidence for
> the first single-version slice; its old `AIRBUS-FAST-61` family identity and package IDs must not
> be used by current consumers.

## Outcome

The canonical host now runs a controlled Airbus OEM reference through the existing ordinary
business path:

`controlled DocumentVersion → existing PDF producer → frozen.2 package → immutable FileService
readback → full U0 Validator → Unified Reader → same WorkItem page and server-derived deep link`

No second producer, Reader, table, queue, worker or currentness source was created. The current
implementation uses one OEM_REFERENCE profile with exact per-DocumentVersion bindings; the
established hosted FTD profile remains unchanged.

## Exact sources

- DM owner: `fcab253b17dd1d118232fdbb72f4e0fe2d295f0e`
- Parser owner: `454957b9f1559ea9bde72c32524f14507794cfdc`
- Unified independent acceptance: `bbc2824bdf4cb9ce9c82f1be53fd24dd768966b5`
- formal request lock/entry: `bb836ed6e97383f651a57657d7361fa64d898126`
- U0 Validator: `fa69ada08265934951df53c7a61a3ccdb8cb2900`
- source PDF: `/private/tmp/airbus-fast61-april2018.pdf`
- source bytes / SHA-256: `10,036,964` /
  `05cf88265253e63a16bb3d850c2bff5a6b620088a245b316fcdbddcc6a8c0dd8`
- DocumentVersion: `document_version_ad56cbdaec487e554130afe4`

The formal `runtime.parse_pdf_request` was run twice with the same generated-at value. Both
outputs were byte-identical. This closes the previous `DM_REQUEST_OWNER_COMMIT_MISMATCH`; the host
fixture is the exact formal output, not a hand-authored parsed package.

## Observed local vertical

- status: `ORDINARY_OEM_REFERENCE_LOOP_PASS`
- WorkItem: `WI-LOCAL-OEM-REFERENCE-FAST61`
- first action: create; repeated action: reuse same WorkItem
- producer executions: `1`
- WorkItem phase: `CANDIDATE_READBACK_VERIFIED`
- package ID/content hash:
  `urn:techpub:package:v1:sha256:88824f5f49f28b1f80ad2fc3df7e12b87bee7510f134c06323a5d8ced1b48797`
- package artifact: `493,117` bytes /
  `a079ebf1333ec09eb9d74d3024e6e3d1d7a0f02d243188be824f8b0fb37735ab`
- 84 content units / 80 source refs / 40 source segments
- Reader query `FAST`: 50 returned units, all source-bound
- result: `partial`; page quality: `NEEDS_REVIEW`
- applicability source expressions / candidates / assignments: `0 / 0 / 0`
- deep link:
  `https://hv5zjf4j8yb.feishuapp.com/app/app_17bzc551rsg/work-items/WI-LOCAL-OEM-REFERENCE-FAST61/documents`
- Assessment auto-adoption: false
- AEO auto-adoption: false

The page uses the same WorkItem fresh-read and explicitly renders `REFERENCE ONLY`,
`NEEDS_REVIEW`, the three zero applicability counts, and the prohibition on Assessment/AEO
automatic adoption.

The earlier 493,107-byte `e7744caf...` candidate used the wrong formal-route mapping-profile
identity and a different lineage timestamp representation. It was rejected rather than accepted
as serialization noise. The corrected formal entry now emits the exact Unified `bbc2824...`
package byte-for-byte; its ArtifactRecord binds the same package/content identity, raw SHA-256,
byte length and media type. The formal output's local `artifactRef` filename remains a locator,
not package identity.

## Commands and tests

```bash
WL_LOCAL_U0_PYTHON=/private/tmp/wiselink-u0-local-venv/bin/python \
  npm run test:ordinary:oem-reference-loop
WL_LOCAL_U0_PYTHON=/private/tmp/wiselink-u0-local-venv/bin/python \
  npm run test:ordinary:first-ftd-loop
npm test -- --runInBand
npm run lint
npm run build:prod
```

Observed: OEM reference loop PASS; established FTD loop PASS; DM two-PDF loop PASS; Unified and
DM composition PASS; Jest `19/19` suites and `87/87` tests PASS; lint, server/client typecheck and
production build PASS. The formal Unified service separately passed `20/20` tests and two
byte-identical actual PDF projections.

## Claims and non-claims

Claims:

- the formal owner-locked request, actual bytes, frozen.2 package, U0, Reader, WorkItem, page model
  and deep link execute locally as one loop;
- FTD does not regress;
- repeat trigger reuses one WorkItem and does not rerun the producer;
- the immutable package actual bytes are the source of the reference-only usage projection.

Non-claims:

- no push, DEV release, online FileService/DB write or current switch;
- no Assessment, AEO, applicability decision or engineering conclusion;
- no generic OEM crawler-to-Catalog automation; only the already confirmed FAST #61 identity is
  routable.

## Goal alignment

- A. Yes: an engineer can inspect the OEM reference package and source-bound Reader output in the
  same WorkItem page.
- B. Complexity is limited to an exact OEM binding in the existing producer and a thin usage
  projection derived from immutable package bytes; it directly prevents reference material from
  being treated as applicable engineering authority.
- C. No new gate, hash scheme, frozen contract, baseline, table or receipt was introduced.
- D. The next shortest path is one authorized hosted OEM_REFERENCE validation, not another proof
  framework.
