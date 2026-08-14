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

## Verified local result

The real newer FTD PDF (122,102 bytes) resolves to
`document_version_fd88dcb9cf64cf3ba21033ef`. The first run reaches
`CANDIDATE_READBACK_VERIFIED`; the repeat returns the same WorkItem. The persisted package has 311
content units, 239 source references and 38 source-bounded `software` query results. An explicit
unsupported-producer run creates, persists, reads back and strictly validates a frozen.2
FailureReport instead of returning `artifact:null`.

Detailed evidence: `docs/FIRST_REAL_FTD_WORKITEM_VERTICAL_ACCEPTANCE_20260814.md`.

## Online state before hosted business validation

DEV schema contains the seven existing DM tables plus `work_item` and `action_attempt`; both new
tables have zero records before the first hosted call. The schema was applied once and read back.
Existing authorized FTD files are retained. This source slice has not yet pushed a new commit,
created a new release, called the hosted business POST or changed production/current.

## Next step

Commit the clean local implementation, push only this app's `sprint/default`, create one controlled
DEV validation release, fresh-read the current DB/FileService state, then use the logged-in hidden
page to perform exactly one POST. Success requires the same WorkItem page/readback and no automatic
retry. Assessment, AEO, Aily mutation, OpenClaw and production release remain out of scope.

## Goal alignment

- This slice directly produces a source-bounded parsed result an engineer can inspect.
- New code is limited to the missing ordinary WorkItem store, producer/storage adapters and error
  persistence needed for that path.
- No new package contract, hash scheme, baseline or general gate was introduced.
- The next action remains the shortest path to a hosted real document loop, not another proof
  framework.
