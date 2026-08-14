# Phase 6C — External discovery candidateStore handoff

## Outcome

The single canonical Miaoda host now has a local-only candidate ledger for external OEM discovery:

- `external_search_run` stores a run even when it has zero candidates.
- `external_discovery_candidate` stores zero-to-many candidates under that run.
- SearchRun plus its candidate rows are written in one ordinary database transaction.
- Candidate review is a single conditional transition from `PENDING` to either
  `HUMAN_SELECTED` or `REJECTED`; a second/competing review fails.
- Only a complete `CANDIDATES_FOUND` run with `DIRECT_OFFICIAL_SOURCE_MATCH` may be selected.
- `ZERO_RESULTS_FOR_TARGET_IDENTIFIER`, `ACCESS_DENIED`, and `PARTIAL_RESULTS` never call DM.
- Rejection is terminal and never calls DM.
- Selection alone is candidate-store state. Without actual FileService bytes there is no
  Document Management ingestion, DocumentVersion, currentness change, WorkItem, or conclusion.

The candidate page is hosted at `/external-discovery`. Its GET and human review actions are
ordinary `@NeedLogin` routes. Actor and tenant are derived only from `req.userContext`; there is no
Bearer OpenAPI write route. Scheduling is deliberately absent. A future Miaoda automation may call
the exported internal service, but no cron, queue, worker, or OpenClaw runtime was added.

## Source and local schema

- OEM monitoring owner commit: `c54538b`
- Host adaptation:
  `server/modules/external-discovery/feishu-native-oem-monitoring-ingress.ts`
- Local migration handoff: `server/database/external-discovery.ddl.sql`
- Schema is prepared only in the host worktree. It was not applied to DEV or online.

The DDL follows the platform-generated RLS pattern already used by the nine existing host tables.
The `authenticated` database role is not exposed as a client SQL or action-plugin surface in this
app; the only client mutations added here are the two `@NeedLogin` review routes, and their SQL is a
conditional `review_status = 'PENDING'` update. RLS is not treated as the business authorization
decision. Before a separately authorized schema deployment, the host owner must regenerate the
platform schema and read back its policies/constraints; this slice does not claim online RLS
activation.

## Environment count audit (read-only)

The same app identity exposed two different environment states on 2026-08-15:

- DEV: all nine existing tables returned exact count `0`.
- online: all nine existing tables returned exact count `1`.

This is recorded only as an environment-scope fact. No count drives migration, selection, identity,
or currentness. Phase 6C performed no online database or FileService mutation.

## Acceptance

Target behavior tests cover:

1. ZERO / ACCESS_DENIED / PARTIAL all keep DM I/O at zero.
2. CANDIDATES_FOUND records one run and N candidates.
3. SearchRun and candidates use one database transaction.
4. Two reviews of one candidate yield one success and one conflict.
5. Rejection is terminal; rejected candidates cannot be selected or ingested.
6. Client review calls contain no actor, authority, DocumentVersion, or currentness field.
7. Existing FTD, OEM_REFERENCE, 737 Assessment, and GET-only OpenAPI regressions remain unchanged.

Observed local results:

- Targeted Phase 6C: 3 suites / 8 tests PASS.
- Full Jest: 23 suites / 97 tests PASS.
- lint, server/client typecheck, production server/client build: PASS.
- real FTD vertical: PASS, repeat reused the same WorkItem, U0 strict package and FailureReport
  validation PASS, online writes 0.
- real FAST 61/62 OEM_REFERENCE chain: PASS, two exact WorkItems, generation 2, historical 61
  still readable, online writes 0.
- real 737 Assessment loop: PASS, CriterionSet N=150, reviewed FAST revision stale/resynthesis,
  online writes 0.
- Unified composition: PASS; no new Reader/Validator implementation.

The first FTD invocation used the system `python3`, which lacked `jsonschema`, and failed explicitly
at the existing U0 validator (`FULL_U0_VALIDATOR_UNAVAILABLE`) rather than being reported as a
candidateStore failure. Re-running the unchanged path with the repository's previously verified
`/Users/liuxuan/miniconda3/bin/python3` (`jsonschema 4.25.1`) passed. No code, gate, or validator was
added for this local environment finding.

## Non-claims

- No DEV/online table was created and no migration was applied.
- No OpenClaw call, scheduler, queue, worker, or automation was created.
- No candidate was imported into Document Management.
- No FileService byte, DocumentVersion, WorkItem, package, Assessment, AEO, applicability result,
  engineering conclusion, current switch, push, or release was created.
