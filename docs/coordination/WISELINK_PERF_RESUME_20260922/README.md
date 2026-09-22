# WiseLink Read-Performance Resume Handoff

This directory is the GitHub-readable handoff for the current WiseLink
read-performance resume branch.

## Source Of Truth

- Repository: https://github.com/Liu-Xuan/WiseLink_Host
- Branch: `codex/perf-resume-20260922`
- Base: `b02395537a948fbe427f232f5a52ab59ba43efe0`
- Branch tip: authoritative source for the latest local integration state.

External reviewers should fetch this branch from `github`, inspect the code in
the worktree, then read:

1. `CURRENT_TASK.md` for the short resume point.
2. `REPORT.md` for implementation, verification and limitations.
3. `SQL_EVIDENCE.md` for the latest isolated PostgreSQL query and plan evidence.

Do not treat chat summaries, old release references, or the unavailable
`5b8e2a3a...` cloud commit as a substitute for this branch.

## Included Work

- 1A default graph entry and timeline discovery handoff.
- Engineering Matter directory batch narrow reading.
- Engineering Matter QueryClient sharing for Wiki and exact workRef views.
- Denied-resource cache continuity: a 403/404 keeps the resource hidden even
  when the next refresh fails with an ordinary network error.
- Route-level lazy loading for heavy pages; the library shell stays eager.
- The available earlier two-file 1B control-read candidate.
- The recovered metadata boundary changes plus local reimplementations of the
  three missing new files.

The directory narrow reading is a local implementation, not a recovered cloud
patch. The 1B candidate does not include the final unavailable cloud worktree
differences. The metadata decoder and its two new tests are also local
reimplementations because the cloud message retained only file names, not the
new-file bytes.

## Current Verification

- `npm run type:check:server`: pass.
- `npm run type:check:client`: pass.
- Focused Jest: 20 suites passed, 151/151 tests passed with the repository
  standard configuration and no `--forceExit`; Jest exits normally. After the
  denial/recovery and route-boundary work the focused set is 21 suites,
  158/158 tests passed; the original 20-suite set is 156/156.
- Client production build (`vite build`, no plugin install, no environment
  copy): entry chunk 3,742.29 kB -> 1,678.64 kB raw, 1,183.84 kB -> 538.05 kB
  gzip; entry-reachable JS 3.57 MB -> 1.60 MB; entry CSS 637.9 kB -> 325.0 kB.
  `cytoscape`, `mermaid`, `pdf`/worker, `shiki` and `AtlasWorkspace` are no
  longer statically reachable from the first-screen entry.
- Isolated PostgreSQL directory test: pass; 6 production-generated queries on
  representative small and 80-matter datasets.
- Postgres metadata suite: 4 skipped because no test database was configured.
- ESLint, Prettier and `git diff --check`: pass.

The focused Jest command is recorded in `REPORT.md`.

## Boundaries

- No production model, permission, database or schema change.
- No production analysis or release was triggered.
- No browser, preview, HAR or online p95 measurement was performed. Wiki to
  graph to Wiki request counts are deterministic mock/API-call counts only.
- Query cache policy remains `staleTime` 30 s, `gcTime` 5 min, `retry` false.
  Session or identity change clears the engineering-matter query root; it does
  not clear unrelated resources.
- A denied workspace or exact-work resource stays hidden until a fetch succeeds
  again; an ordinary network failure after a denial does not restore the
  rejected content. The denial lives in the shared query value, not in a
  component-local flag.
- Lazy route chunks wait and fail inside the `Layout` content area; the shell,
  identity providers and QueryClient stay mounted. The failure panel uses an
  explicit manual whole-page reload.
- The local build is not a Miaoda release validation. No browser HAR, preview
  deploy or online p95 was measured.
