# Phase 13C production-path cleanup and integration

Date: 2026-08-16  
Baseline: `c63406f079d5ee4f86e313106c53f51b35f95fc9`  
Scope: local Canonical Host changes only. No push, release, environment change, database write, or FileService write.

Consumed Unified owner input: exact clean commit
`45f7f80a0e393be844bf7ba756efa9a7c38678a1`. The Host reuses the already present
`wiselink.v3_1.sb_job_aid_assessment_input.v4` adapter; it does not copy the Unified
implementation or add another projection. Owner evidence for the real 737 input is 73,786 bytes,
75/75 units, 22/22 page SourceRefs, and seven field SourceBindings. Those facts describe the
upstream assessment input only; they do not claim that Base has completed its dynamic-N result.

Consumed Document Management discovery persistence input: exact clean commit
`ddb77bbf5bc8bb898f93a9e72f171dfee86230e9`. The Host keeps exactly the existing two discovery
tables and one `MiaodaExternalDiscoveryCandidateStore`; the owner `failure_code` field, provider
result mapping, official-domain rule, and discovery/acquisition separation are applied to that
provider. The already accepted Host list and terminal reject operations remain methods of the same
provider, not a second store.

## Goal alignment

The production path remains one Miaoda application, one database/FileService truth, and one
`WorkItem`. DM, Unified, Assessment, AEO, Base rule processing, and hosted OpenClaw are internal
capabilities. The page, fixed read-only OpenAPI, and MCP facade all read the same server-fresh
`WorkItem` projection.

This slice does not invent Base results, a 150/150 completion claim, or an OpenClaw answer. It adds
only the host seam and waiting state needed to consume the real upstream artifacts later.

## Production-path inventory before the patch

| Item | Before | Phase 13C disposition |
| --- | --- | --- |
| Ordinary PDF/DM/Unified/Reader path | Default `AppModule` path | Keep |
| Ordinary Assessment evaluate/resynthesis | Authenticated, WorkItem CAS, actual-byte artifact | Keep |
| Read-only runtime/U0 readiness | `GET /api/runtime-probe` | Keep |
| Read-only WorkItem OpenAPI and MCP | Fixed GET routes plus one read-only MCP facade | Keep |
| External discovery candidate store | Same Miaoda DB, human review boundary | Keep |
| Host-owned OpenClaw automation | Default `@Automation`/`@BindTrigger` registration | Remove; hosted OpenClaw supplies results to the host seam |
| Phase 2D DM validation module | Default `AppModule` import and POST route | Remove from default production composition |
| Phase 2E/2F FileService probe | `POST /api/runtime-probe/file-service-upload` | Remove route/provider from production composition |
| Runtime-probe First FTD trigger | Client-side fixed selection and business POST | Remove; runtime probe becomes read-only |
| Phase 9 one-shot trigger | Already closed before this baseline | Verify absent; no new work |
| Phase 10 AEO one-shot trigger | Controller route, UI button, env branch, runtime seed asset | Remove from production route/UI/build composition |
| Legacy Host-copied AEO/Hub module | Entire `server/modules/aeo-authoring` compiled by the Host plus Phase 6D script/test entry | Remove from Host production compile/current scripts; retain authoritative implementation in AEO owner Git |
| Legacy assessment Registrar activation | Already absent from `AppModule`; host consumer is controller-free | Keep absent; do not restore |
| Example/sample page | Unrouted generated page | Remove from source tree |
| Personal Aily/old Hub as controller | Not imported in production composition | Keep absent |
| Historical acceptance documents and reusable internal tests | Trace evidence | Preserve documents/tests; remove obsolete one-shot production scripts and asset wiring |

Unified's production cleanup at the consumed owner commit leaves readiness as its production HTTP
surface and removes its historical POST/SSE/runtime-probe actions. Canonical Host continues to use
the existing in-process Validator/Reader/FailureReport providers and does not reintroduce those
routes.

## Dependency graph after cleanup

```text
Canonical Aily Skill
  -> fixed read-only OpenAPI or read-only MCP facade
      -> CanonicalHostVerticalService
          -> WorkItem fresh read
          -> Unified Reader (source-bound query)

Miaoda authenticated page/action
  -> CanonicalHostController
      -> ordinary authorization + permission fresh read
      -> OrdinaryWorkItemService / CanonicalHostAssessmentService
      -> WorkItem CAS + ActionAttempt
      -> one FileService actual-byte store

Phase 13C internal coordinator (no public write route in this slice)
  -> real Base rule result provider [default unconfigured]
      -> actual bytes persist/readback
      -> WorkItem.integratedAssessment.baseRules thin projection
  -> real hosted OpenClaw synthesis provider [default unconfigured]
      -> actual bytes persist/readback
      -> WorkItem.integratedAssessment.overallSynthesis thin projection
  -> page / fixed OpenAPI / MCP read the same projection
```

No Phase 2/9/10 validation action, old Registrar activation route, second WorkItem store, queue,
worker, host-owned OpenClaw scheduler, or alternate Reader appears in this graph.

## Real-upstream boundary

The Base result provider must supply the real dynamic-N result bytes and its source summary. The
OpenClaw provider must supply the real candidate-only synthesis bytes and the Base revision it used.
Both remain unconfigured until owner output is available. An unavailable provider is an explicit
waiting condition and must perform zero WorkItem, ActionAttempt, database, or FileService mutation.

AEO owner Phase 13E exact commit
`eba49c7c0cb86ded7e3485c8d32bcbaf228557c3` is recorded only as a later consumer seam. Its
controller-free `AeoSameWorkItemAuthoringModule` and four ordinary host ports are not assembled or
executed in this slice. They become eligible only after the same WorkItem has a real Base N/N
candidate, a real OpenClaw overall candidate, and the required human confirmation.

The superseded Host copy under `server/modules/aeo-authoring`, its Phase 6D package command/test,
and its R09 seed fixture are removed from the current Host compile/test surface. The safe AEO
implementation and its history remain in the AEO owner repository at the exact commit above; no
controller or authoring route is copied back during this slice.

Current real-entry semantics are retained without reinterpretation: the Boeing query is
`ACCESS_DENIED / UPSTREAM_CONNECT_TIMEOUT`, not zero results; Airbus FAST #62 may be a complete
direct official-source collection; COMAC may use its official technical list/RSS, while Baidu search
is not an official source. The WorkItem stores only the candidate artifact descriptor, summary,
candidate-ref count, and gap. Raw output bytes stay in FileService and unadopted discovery is never
Evidence.

The existing database change is additive only:
`migrations/0002_external_search_run_failure_code.sql` adds nullable `failure_code` to
`external_search_run`. It does not create a table, trigger, scheduler, route, or worker and is not
applied online in this slice. URL/snippet stay in the candidate table. A later adopted acquisition
descriptor may contain only SearchRun/Candidate references, publisher, observed time, and the
server-owned review receipt; it must not copy discovery URL/snippet.

The OpenClaw A/B comparison binds the same Phase 9 WorkItem, DocumentVersion, parsed package, and
Base full-N artifact/revision. A is `NO_DISCOVERY` (not `ZERO_RESULTS`) with zero candidate refs. B
keeps provider-level details only in immutable artifact bytes: Airbus `COMPLETE` plus direct official
FAST #62, Boeing `ACCESS_DENIED` with `UPSTREAM_CONNECT_TIMEOUT` and zero candidates, and COMAC an
official-list/RSS partial or truncated gap. All remain `adopted=false` and
`usableAsEvidence=false`. A→B increments only overall revision and preserves A history; only a Base
revision change makes the current overall projection `STALE / BASE_RULE_RESULT_CHANGED`.

The later acceptance loop is:

```text
existing WorkItem + frozen.2 Reader receipt
  -> real Base candidate artifact
  -> FileService persist/readback + WorkItem CAS
  -> real OpenClaw candidate artifact bound to the Base revision
  -> FileService persist/readback + WorkItem CAS
  -> page + fixed OpenAPI + MCP fresh read
```

Changing the Base layer revision makes an older overall synthesis stale; it does not rewrite or
delete either immutable artifact.

## Non-claims

- No real Base dynamic-N output has been received in this slice.
- No OpenClaw overall candidate has been received in this slice.
- No 150/150 rule completion or engineering conclusion is claimed.
- No hosted action, Aily publication, application release, or online mutation is performed.
- `canonical-host.controller.ts` still derives the historical string
  `ENGINEER-REVIEW:<workItemId>:<criterionId>` in a field named `baseRecordId`. This is recorded as a
  later ordinary rename; it does not define a Base dependency and does not block this main loop.

## Local verification

- targeted Phase 13C and DM Phase 13D suites passed, including OpenClaw Boeing/Airbus/COMAC
  mapping, single-store transaction/review behavior, A/B overall history, and cleanup assertions;
- final full Jest regression: 23 suites / 103 tests passed;
- server/client typecheck, ESLint, Stylelint, production server/client build, and precommit passed;
- read-only MCP verification passed with exactly `get_parse_status`, `query_parsed_package`, and
  `get_deep_link`; mutation tool count remained zero;
- the MCP verifier's first restricted-sandbox run failed at `listen(127.0.0.1)` with `EPERM`;
  the unchanged test passed when rerun with local-loopback permission. No product implementation or
  security boundary was changed to hide that environment failure;
- online writes, releases, environment changes, and pushes: zero.

The existing local 737 ordinary vertical was also rerun as a regression, not as a substitute for
the missing real Base result. Its first run with the ambient `python3` failed explicitly at the U0
Validator with `FULL_U0_VALIDATOR_UNAVAILABLE:PROCESS_FAILURE`. The unchanged path was rerun with
the repository's previously verified `/Users/liuxuan/miniconda3/bin/python3` (`jsonschema 4.25.1`)
and passed: source 1,060,204 bytes / `add32c7d…d41a`, exact DocumentVersion
`document_version_f4813607b91ee1a20e754e2d`, frozen.2 artifact 273,349 bytes /
`84d37eda…e1ac`, strict U0/Reader, 150 candidate-only criteria, and cumulative resynthesis. Its
Boeing discovery input now reflects the observed `ACCESS_DENIED / UPSTREAM_CONNECT_TIMEOUT` rather
than the superseded ZERO result. This regression performed zero online writes and created no
release.
