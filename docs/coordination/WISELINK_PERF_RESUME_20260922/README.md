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

Do not treat chat summaries, old release references, or the unavailable
`5b8e2a3a...` cloud commit as a substitute for this branch.

## Included Work

- 1A default graph entry and timeline discovery handoff.
- Engineering Matter directory batch narrow reading.
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
- Focused Jest: 11 suites passed, 103/103 tests passed.
- Postgres metadata suite: 4 skipped because no test database was configured.
- ESLint, Prettier and `git diff --check`: pass.

The focused Jest command is recorded in `REPORT.md`.

## Boundaries

- No production model, permission, database or schema change.
- No production analysis or release was triggered.
- No browser, real-database latency, preview or online p95 measurement was
  performed.
