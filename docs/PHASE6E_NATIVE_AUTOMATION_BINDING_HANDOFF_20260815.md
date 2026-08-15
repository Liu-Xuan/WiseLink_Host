# Phase 6E — Native automation binding handoff

## Outcome

The Phase 6C candidate store can be invoked by a Miaoda-native cron automation without an HTTP
or Webhook bridge. The application template exposes `@Automation()` and `@BindTrigger(name)`;
the decorated class is a normal Nest provider and can inject `ExternalDiscoveryService` directly.

The local host now contains exactly one binding:

- trigger name: `wiselink-oem-discovery-monitor`
- code: `server/modules/external-discovery/external-discovery.automation.ts`
- input port: `OPENCLAW_OEM_DISCOVERY_PORT`
- host seam: `ExternalDiscoveryModule.forRoot({ discoveryPortProvider })`
- current host default: `ExternalDiscoveryModule.forRoot()` with no provider; it fails before
  candidate-store or DM I/O
- configured path: one `discoverOnce()` call, then one
  `ExternalDiscoveryService.recordSearchRun()` call into the existing two tables

No cron implementation, queue, worker, webhook, public write route, OpenAPI mutation, or second
candidate store was added. The automation runtime has no interactive user context; the future
server-only OpenClaw provider must supply the automation actor and tenant context together with the
normalized SearchRun. Human select/reject remains exclusively on the existing `@NeedLogin` page.

## Read-only platform audit

The exact command was run with the current user identity:

```bash
lark-cli apps +automation-list \
  --app-id app_17bzc551rsg --as user --all --format json
```

Observed on 2026-08-15:

- `ok=true`
- `has_more=false`
- `items=[]`

This is a verified empty automation list, not an assumption and not `UNVERIFIED`.

The application trigger guide and compiled production output both confirm the internal binding
shape. The built JavaScript contains `BindTrigger('wiselink-oem-discovery-monitor')`, the
`@Automation()` class is registered in `ExternalDiscoveryModule`, and that module is imported by
the host `AppModule`.

No automation was created or enabled. A future separately authorized platform configuration is:

```bash
lark-cli apps +automation-create --as user \
  --app-id app_17bzc551rsg \
  --name wiselink-oem-discovery-monitor \
  --trigger-type cron \
  --cron '<five-field schedule>' \
  --timezone Asia/Shanghai \
  --status disabled
```

The trigger must remain disabled until a real server-only `OPENCLAW_OEM_DISCOVERY_PORT` provider is
configured, the application is released, and enabling/testing is separately authorized.

## Local business-loop evidence

The targeted loop used the existing Phase 6C service and store boundary:

1. The saved real OpenClaw result for `777 FTD 31-21002 software` was normalized as
   `ZERO_RESULTS_FOR_TARGET_IDENTIFIER`.
2. Its two tangential URLs are not target candidates, so the recorded SearchRun has zero candidate
   rows and performs zero DM I/O.
3. A fixture explicitly labelled `LOCAL_ONLY_COMPLETE_DIRECT_MATCH` records one complete Airbus
   direct-match candidate.
4. That candidate remains `PENDING` for the existing logged-in review page; there is no automatic
   selection and DM I/O remains zero.
5. An unconfigured discovery port fails with `OPENCLAW_OEM_DISCOVERY_PORT_UNCONFIGURED` before any
   candidate-store I/O.

Observed targeted result:

- 3 suites / 9 tests PASS
- real ZERO: one run / zero candidates / zero DM I/O
- local complete match: one run / one PENDING candidate / zero DM I/O
- unconfigured port: zero runs / zero candidates / zero DM I/O

Regression evidence after the binding was added:

- full Jest: 25 suites / 103 tests PASS
- lint and server/client typecheck: PASS
- production server/client build: PASS
- Unified composition: PASS
- real FTD vertical using `/Users/liuxuan/miniconda3/bin/python3`: PASS; identical repeat reused
  the WorkItem, U0 package and FailureReport strict validation passed, online writes remained zero

## Isolated PostgreSQL DDL audit

The exact `server/database/external-discovery.ddl.sql` was executed in a fresh local PostgreSQL 14
cluster under `/private/tmp`, not against Miaoda DEV or online. PostgreSQL accepted `BEGIN` and then
stopped at the first platform-specific column:

```text
ERROR: type "user_profile" does not exist
```

The file is transactional, so no table was committed. Generic PostgreSQL cannot independently
reproduce Miaoda's built-in `user_profile` type, `authenticated` / `service_role` roles, or their
RLS execution context without constructing a compatibility imitation. This slice deliberately did
not fabricate those platform objects. Consequently:

- ordinary PostgreSQL execution boundary: verified and explicitly blocked at `user_profile`
- Miaoda RLS semantics: `UNVERIFIED`
- second schema plan operation count: `UNVERIFIED`, not claimed as zero

The only valid way to close that remaining schema evidence is a separately authorized Miaoda DEV
schema apply, platform readback, and second plan. Phase 6E does not perform it.

## Claims and non-claims

Claims:

- Miaoda supports a direct internal Nest provider handler for cron automation.
- The canonical host has a local-only direct binding to the existing candidate store.
- The real zero-result and local direct-match paths preserve candidate-only and DM-zero behavior.

Non-claims:

- automation create/update/enable: 0
- hosted schema changes: 0
- DEV/online records or FileService writes: 0
- push/release/environment changes: 0
- OpenClaw hosted call in this slice: 0
- human selection, DM ingestion, DocumentVersion, WorkItem, package, Assessment, AEO, currentness,
  applicability, or engineering conclusion: 0
