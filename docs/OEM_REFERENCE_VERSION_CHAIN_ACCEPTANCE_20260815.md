# OEM_REFERENCE FAST #61 → #62 version-chain acceptance — 2026-08-15

## Outcome

The canonical host consumes the exact Document Management and Unified owner outputs as one local
version chain:

`AIRBUS-FAST ISSUE 61 → exact WorkItem #61 → frozen.2/U0/Reader/page`

`AIRBUS-FAST ISSUE 62 → exact WorkItem #62 → frozen.2/U0/Reader/page`

ISSUE 62 advances the owner-proven Catalog current generation from 1 to 2. It does not mutate or
rebind the ISSUE 61 WorkItem; the historical page remains independently readable.

## Selected implementations

- DM owner: `7eec76ae972312ecb81bbce569140df6c782fbba`
- Parser owner: `454957b9f1559ea9bde72c32524f14507794cfdc`
- Unified actual-byte acceptance:
  `916e647a0edd7d02c77433e4765ce42237a369c9`
- U0: `fa69ada08265934951df53c7a61a3ccdb8cb2900`
- one mapping profile: `frozen.2-controlled-oem-reference.1`
- one Parser Profile: `parser-profile:generic.document@1.0.0`

## Exact version identities

| Field | ISSUE 61 | ISSUE 62 |
|---|---|---|
| DocumentVersion | `document_version_7d5aca8851db8ea41b89003d` | `document_version_c71fbc457cdc5e7a05725a4d` |
| Source bytes | 10,036,964 | 7,179,982 |
| Source SHA-256 | `05cf8826…c0dd8` | `7b793ed0…4f380` |
| Package ID | `c2e4716f…897aa3` | `bd7d7f70…b354a2` |
| Package bytes | 493,111 | 508,172 |
| Artifact SHA-256 | `abd9b428…9f48` | `305aff01…b2ec` |
| Semantic hash | `439154c4…c86db` | `b1ff0474…f9de6` |
| Provenance hash | `226eefc3…671be` | `cafcfb9e…298f8` |
| Coverage hash | `efa78d0e…516db` | `6e3bf643…4bd87` |

Both contain 84 content units, 80 SourceRefs and 40 SourceSegments; all 84 units are source-bound.
Both remain `partial / NEEDS_REVIEW / REFERENCE_ONLY` with applicability `0/0/0`. Zero means no
applicability expression was extracted, not a conclusion of non-applicability.

## Host behavior

- one shared OEM_REFERENCE profile is reused for both versions;
- exact source/package bindings remain per immutable DocumentVersion;
- repeat invocation of either version reuses its own WorkItem and does not rerun the producer;
- the two versions have different WorkItem, package and actual-byte identities;
- after ISSUE 62, ISSUE 61 remains readable through its original server-derived deep link;
- the page displays `AIRBUS-FAST` plus `ISSUE 61` or `ISSUE 62` from the exact package binding;
- neither WorkItem contains Assessment or AEO state and neither permits automatic adoption.

## Commands

```bash
WISELINK_FAST61_PDF=/private/tmp/airbus-fast61-april2018.pdf \
WISELINK_FAST62_PDF=/private/tmp/airbus-fast62-october2018.pdf \
node --test tests/hosted-document-management.test.mjs

WL_LOCAL_U0_PYTHON=/private/tmp/wiselink-u0-local-venv/bin/python \
npm run test:ordinary:oem-reference-loop
```

The first command is run from a detached worktree at the exact DM owner commit. The second runs
the canonical host production server build and the two real package paths.

Observed results:

- exact DM owner loop: 12/12 PASS;
- canonical host FAST #61/#62 loop: PASS, including one producer run per exact DocumentVersion and
  repeat-trigger WorkItem reuse;
- existing FTD ordinary loop: PASS;
- Jest: 19 suites / 87 tests PASS;
- server/client typecheck, lint, production server/client build and `git diff --check`: PASS;
- production-client browser readback: both WorkItem pages display `AIRBUS-FAST`, their respective
  `ISSUE 61` / `ISSUE 62`, `REFERENCE ONLY`, `NEEDS_REVIEW`, applicability `0/0/0`, and disabled
  Assessment/AEO automatic adoption.

## Claims and non-claims

Claims:

- the exact local DM chain reaches generation 2 with one family/document and two versions;
- both versions pass the same producer, full U0 Validator and Reader;
- both separate WorkItem pages are readable and the older WorkItem remains unchanged.

Non-claims:

- no push, release or online mutation was performed;
- no production/current selection was made by Unified or the host;
- no applicability decision, Assessment, AEO or engineering conclusion was created;
- no second profile, route, package contract, Reader, Validator, table, queue, worker, hash rule or
  gate was added.

## Goal alignment

- The slice makes the real product loop visible for a new monitored revision, not only a fixture.
- The only added complexity is a second exact version binding and a second WorkItem.
- Existing identity, U0, Reader, authentication and source-byte checks are reused unchanged.
- The next shortest path is a single authorized hosted #62 validation, not further local gates.
