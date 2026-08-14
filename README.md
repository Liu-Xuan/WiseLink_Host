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

`authenticated Miaoda action → exact DM DocumentVersion → create-or-reuse WorkItem → controlled PDF
producer profile → techpub.parsed-package.v1/frozen.2 → immutable FileService readback → full U0
Validator → Unified Reader query → same WorkItem page/deep-link`

The same route now accepts both the established FTD profile and one controlled, catalog-only
`OEM_REFERENCE` profile. The latter is reference-only and cannot create applicability, Assessment
or AEO authority.

The path uses:

- DM owner source `fcab253b17dd1d118232fdbb72f4e0fe2d295f0e` without taking over DM
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

## Local controlled OEM reference result

Airbus FAST #61 (10,036,964 bytes) is admitted only through the server-confirmed
`OEM_REFERENCE` classification and exact DocumentVersion
`document_version_ad56cbdaec487e554130afe4`. The formal DM request at Unified commit
`bb836ed6e97383f651a57657d7361fa64d898126` produces the exact accepted byte-stable frozen.2 partial package.
The same ordinary WorkItem path persists/readbacks it, passes U0, returns source-bound Reader
results, and projects the canonical page/deep-link with `REFERENCE ONLY`, `NEEDS_REVIEW` and
applicability `0/0/0`.

Detailed evidence: `docs/OEM_REFERENCE_SAME_WORKITEM_ACCEPTANCE_20260815.md`.

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

Local implementation and the exact platform handoff are recorded in
`docs/AILY_MINIMAL_ENTRY_HANDOFF_20260814.md`. Hosted testing proved that Miaoda OpenAPI Key scopes
match paths literally, so the current local revision uses three fixed GET paths with a required
`workItemId` query parameter. This revision has not been pushed, released or applied to the Key.

## Goal alignment

- This slice directly produces a source-bounded FTD or controlled OEM reference result an engineer
  can inspect in the same page.
- New code is limited to the missing ordinary WorkItem store, producer/storage adapters and error
  persistence needed for that path.
- No new package contract, hash scheme, baseline or general gate was introduced.
- The hosted FTD loop remains complete; OEM_REFERENCE is local-only and has not been published.
  The next product action is a single authorized hosted OEM reference validation when requested,
  then the existing Aily read-only mappings—without adding another parser or state store.
