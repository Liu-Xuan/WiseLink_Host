# Current Task

## Branch Identity

- Base: `b02395537a948fbe427f232f5a52ab59ba43efe0`
- Branch: `codex/perf-resume-20260922`
- Integration worktree:
  `/Volumes/SSD/LLM/WiseLink/private/runtime/miaoda-app-repos/wiselink-v3-1-perf-resume-20260922`

## Work State

- 1A: default graph entry and timeline discovery handoff imported and tested.
- Directory: `EngineeringMatterDirectoryService.list` now uses fixed batch
  reads. It no longer calls `matters.read/readWorking` per directory row and
  does not load complete working state JSON.
- 1B: available two-file candidate imported and tested against the current
  directory-runtime spec. The final unavailable cloud worktree difference is
  not covered.
- Metadata: three recovered modified-file diffs plus local reimplementation of
  the decoder and two tests. Legal missing/null metadata remains null; the full
  API still rejects corrupt structures.

## Verification

- Server typecheck: pass.
- Client typecheck: pass.
- Focused Jest: 11 suites, 103/103 tests passed.
- No real database, browser, preview or production run.

## Next Action

Stop and review this branch. Do not start shared query caching, PDF loading,
graph lifecycle or other performance batches without a new task.
