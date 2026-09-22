# Current Task

## Branch Identity

- Base: `b02395537a948fbe427f232f5a52ab59ba43efe0`
- Branch: `codex/perf-resume-20260922`
- Last pushed HEAD: `c330b8bd87428235ed95db1dec9d07d54c212977`
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
- 1C test lifecycle: the previous `--forceExit` need came from six QueryClient
  `gcTime` timers left by the session-change test, not from business requests.
  The test now owns a fake clock and destroys its root, QueryClient, JSDOM
  window and cache; production cleanup only removes inactive engineering-matter
  queries and leaves active observers intact.
- 1B: available two-file candidate imported and tested against the current
  directory-runtime spec. The final unavailable cloud worktree difference is
  not covered.
- Metadata: three recovered modified-file diffs plus local reimplementation of
  the decoder and two tests. Legal missing/null metadata remains null; the full
  API still rejects corrupt structures.

## Verification

- Server typecheck: pass.
- Client typecheck: pass.
- Focused Jest: 20 suites, 151/151 tests passed with the repository standard
  configuration, `--runInBand` only, and no `--forceExit`; the process exits
  normally.
- Isolated PostgreSQL: pass on 127.0.0.1:55441 with a NOBYPASSRLS test role;
  six production-generated queries for both representative and 80-matter
  datasets. See `SQL_EVIDENCE.md`.
- No production database, browser, preview or production run. The local
  temporary database and role were removed after the test.

## Next Action

The directory closeout checkpoint is `c330b8bd...`. This round commits and
pushes the verified 1C lifecycle closeout to the same GitHub branch. Browser
request timing and online p95 remain unmeasured. Stop after this closeout; do
not start PDF, graph lifecycle, shared query cache or other runtime batches.
