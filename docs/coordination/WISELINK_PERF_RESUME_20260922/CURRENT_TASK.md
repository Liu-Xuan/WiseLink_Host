# Current Task

## Branch Identity

- Base: `b02395537a948fbe427f232f5a52ab59ba43efe0`
- Branch: `codex/perf-resume-20260922`
- Last pushed HEAD: `19195541ba30c8942801def67508e5245c55a02f`
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
- 1B: available two-file candidate imported and tested against the current
  directory-runtime spec. The final unavailable cloud worktree difference is
  not covered.
- Metadata: three recovered modified-file diffs plus local reimplementation of
  the decoder and two tests. Legal missing/null metadata remains null; the full
  API still rejects corrupt structures.

## Verification

- Server typecheck: pass.
- Client typecheck: pass.
- Focused Jest: 11 suites, 106/106 tests passed.
- Isolated PostgreSQL: pass on 127.0.0.1:55441 with a NOBYPASSRLS test role;
  six production-generated queries for both representative and 80-matter
  datasets. See `SQL_EVIDENCE.md`.
- No production database, browser, preview or production run. The local
  temporary database and role were removed after the test.

## Next Action

This directory closeout is saved by the current reviewed commit and pushed to
the project GitHub branch. Continue with the separately scoped 1C work as a
local, uncommitted development step. Do not start PDF, graph lifecycle or other
runtime batches.
