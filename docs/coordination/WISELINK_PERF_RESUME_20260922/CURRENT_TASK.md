# Current Task

## Branch Identity

- Base: `b02395537a948fbe427f232f5a52ab59ba43efe0`
- Branch: `codex/perf-resume-20260922`
- Verified H0/T0 starting checkpoint:
  `21a6716b0c5018a53c580024c9f9d2523e6cf373`
- Integration worktree:
  `/Volumes/SSD/LLM/WiseLink/private/runtime/miaoda-app-repos/wiselink-v3-1-perf-resume-20260922`

## Work State

- 1A: default graph entry and timeline discovery handoff imported and tested.
- Directory: `EngineeringMatterDirectoryService.list` uses batch composition
  and working-summary reads, plus a final batch stability confirmation. It
  does not call `matters.read/readWorking` per row and does not load complete
  working state JSON. Work based on an older Matter revision is a legal
  pending-update state, not a directory error.
- Directory authorization: linked WorkItems are batch-checked for owner,
  document version and family binding. Material JSON is parsed at the existing
  `parseMatterMaterial` boundary in batch.
- 1C: Wiki and Matter graph now share the mounted QueryClient for workspace and
  exact `workRef` resources. Cache identity includes app, tenant, actor and
  session generation. View state does not enter content keys.
- 1C cache policy: staleTime 30 s, gcTime 5 min, retry disabled. The freshness
  window is reuse-only; it does not poll. Exact refresh refetches only the
  relevant resource. A current W5 to W6 refresh never rebinds an exact
  historical W5. Session or identity change cancels and removes the
  engineering-matter query root.
- 1C error scope: a 403/404 on one matter clears only that matter and does not
  affect another cached matter or retry automatically. Network errors keep the
  same-identity readable content. Two consumers share one request and one
  unmount does not cancel the other.
- 1C denial durability: a denied workspace or exact-work resource stays hidden
  when a later refresh fails with an ordinary network error. Only a successful
  fetch clears the denial. A normal network failure without a prior denial
  still keeps the last readable content. Denying the current matter also
  suppresses its exact historical work in the wiki and graph consumers.
- 1C denial ownership: the read outcome is a shared
  `readable`/`rejected` query value, so remounts and sibling consumers see the
  same conclusion. There is no component-local denial Set and no claim that
  `setQueryData(key, undefined)` deletes data; direct verification showed it
  leaves the previous data in place.
- 1C test lifecycle: the previous `--forceExit` need came from six QueryClient
  `gcTime` timers left by the session-change test, not from business requests.
  The test now owns a fake clock and destroys its root, QueryClient, JSDOM
  window and cache; production cleanup only removes inactive engineering-matter
  queries and leaves active observers intact.
- 2A: heavy routes are lazy-loaded while `Layout` and the library entry stay
  eager. The chunk boundary moved to `RouteOutletBoundary` around the `Layout`
  outlet, so the shell, identity providers and QueryClient stay mounted while a
  page waits or fails; non-`Layout` preview and OAuth routes keep their own
  boundary. Route generation still reports 32 routes.
- 1B: available two-file candidate imported and tested against the current
  directory-runtime spec. The final unavailable cloud worktree difference is
  not covered.
- Metadata: three recovered modified-file diffs plus local reimplementation of
  the decoder and two tests. Legal missing/null metadata remains null; the full
  API still rejects corrupt structures.

## Prior Verification (before H0/T0)

- Server typecheck: pass.
- Client typecheck: pass.
- Focused Jest: 21 suites, 158/158 tests passed with the repository standard
  configuration, `--runInBand` only, and no `--forceExit`; the original
  20-suite set passes 156/156.
- Client production build: entry chunk 3,742.29 -> 1,678.38 kB raw and
  1,183.84 -> 538.06 kB gzip (code version `1d9434e64` plus this round).
  `routes.json` still lists 32 routes and keeps
  `/library`, `matters/:matterId`, `graph`, `reader`, `version-comparison` and
  the dev-preview paths.
- Isolated PostgreSQL: pass on 127.0.0.1:55441 with a NOBYPASSRLS test role;
  six production-generated queries for both representative and 80-matter
  datasets. See `SQL_EVIDENCE.md`.
- No production database, browser, preview or production run. The local
  temporary database and role were removed after the test.

## H0/T0 — 2026-09-22

The integration worktree was clean at the checkpoint above. The protected
canonical `codex/0-11` worktree remains at `b02395537` with its four untracked
debug files untouched. This test-only batch was implemented separately in
`/private/tmp/wiselink-h0-t0-pdf-20260922`.

The intermittent timeline failure was reproduced (5/6 tests). Its test helper
scheduled navigation with `setTimeout(0)` but released the old response before
confirming navigation. `act` does not guarantee that host timer has fired.
The test now explicitly commits DV2 navigation and asserts DV2 is visible
before releasing DV1. No production behavior, globals or Query policy changed.
Both suites pass individually (2 and 4 tests) and together in both actual
execution orders (6 tests), exiting normally without forceExit. See REPORT.

## Next Action

Continue the separately assigned 2B.1 PDF module/original parallel preparation
on its own worktree, then integrate the tested subset. PDF implementation is
not part of this T0 commit. No 2B.2 cache, graph lifecycle or backend batch is
started. Browser timing, authorized preview and online p95 remain unmeasured;
no origin sync, release, database or production-model operation occurred.
