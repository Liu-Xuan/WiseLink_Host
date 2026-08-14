# WiseLink 3.1｜工程资料与综合评估

This repository is the source of the single WiseLink 3.1 full-stack Miaoda host candidate:

- Miaoda app: `app_17bzc551rsg`
- App name: `WiseLink 3.1｜工程资料与综合评估`
- Branch: `codex/v3-1-canonical-host-candidate`
- Product shape: one Miaoda host + one later Aily entry + internal modules

Parser Lab, DM labs, Assessment workbenches and historical Hub apps are module sources or internal
labs, not additional user products.

## Current runnable vertical

The host now contains the ordinary first business path:

`authenticated Miaoda action → exact DM DocumentVersion → create-or-reuse WorkItem → FTD PDF
producer adapter → techpub.parsed-package.v1/frozen.2 → immutable FileService readback → full U0
Validator → Unified Reader query → same WorkItem page/deep-link`

The path uses:

- DM owner source `3ebc61c0532c5ee04122a251464fc644d1238439` without taking over DM
  currentness;
- Unified owner source `b3e7a20245af19349a8bfa9c0da995d5eeac6acf` and U0 commit
  `fa69ada08265934951df53c7a61a3ccdb8cb2900`;
- the existing frozen.2 FailureReport adapter and strict failure validator;
- a normal Miaoda database `WorkItem` plus one `ActionAttempt`, not Base, a queue, worker or lease
  platform;
- the platform `@NeedLogin` user context, server-side action authorization, business unique key and
  compare-and-set revision.

The hidden `/runtime-probe` page provides read-only hosted dependency checks plus one manually
triggered, fixed real-FTD validation action. It uses imported `axiosForBackend`, accepts no client
WorkItem ID/path/authority, and cannot create Assessment/AEO conclusions.

## Verified hosted DEV result

The real FTD PDF (122,102 bytes) resolves to
`document_version_fd88dcb9cf64cf3ba21033ef`. One authenticated hosted business request created
WorkItem `WI-c2943f5a-d023-46ac-9cf5-9480de0aabaf` and one successful ActionAttempt, persisted and
read back a 662,441-byte frozen.2 package, passed the full U0 Validator, and returned 38
source-bound `software` Reader results. The same WorkItem deep link renders
`CANDIDATE_READBACK_VERIFIED`, 311 content units and 239 source references.

Detailed evidence: `docs/FIRST_REAL_FTD_WORKITEM_VERTICAL_ACCEPTANCE_20260814.md`.

## Hosted DEV acceptance state

DEV contains the seven DM tables plus `work_item` and `action_attempt`; after the accepted run, all
nine contain exactly one related record. FileService contains the pre-existing objects plus one
content-addressed package object. Closure release `7673837917727050950` is deployed from exact
commit `65467a48b5010a98fe41921bdb0f9279deb8362c`; validation is disabled and its run ID is absent.
No production/current switch or engineering conclusion was made.

One later page read initially failed before a FileService HTTP response and then succeeded on a
single read-only retry. It is classified `TRANSIENT_READ_RECOVERED_BY_SINGLE_READ_ONLY_RETRY`; no
business POST retry was added or performed.

## Aily native read-only adapter

The local host now exposes three GET-only `/openapi` wrappers for Aily: WorkItem status plus
parsed-package summary, source-bound query, and server-derived Miaoda deep link. They reuse the same
WorkItem repository, Unified Reader and canonical app binding. The routes contain no `@NeedLogin`
because Miaoda's OpenAPI gateway authenticates them with a scoped application API Key; no
`start_parse` write tool is exposed.

Local implementation and the exact pending platform actions are recorded in
`docs/AILY_MINIMAL_ENTRY_HANDOFF_20260814.md`. No OpenAPI Key, Aily Skill, release or online write
was created in this local-only slice.

## Goal alignment

- This slice directly produces a source-bounded parsed result an engineer can inspect.
- New code is limited to the missing ordinary WorkItem store, producer/storage adapters and error
  persistence needed for that path.
- No new package contract, hash scheme, baseline or general gate was introduced.
- The hosted real document loop is complete; the Aily read-only adapter now exists locally and the
  next action is a scoped DEV OpenAPI Key plus three Aily read-only Skill mappings, not another
  proof framework.
