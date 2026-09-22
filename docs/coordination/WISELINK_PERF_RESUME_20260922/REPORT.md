# WiseLink Read-Performance Resume Report

## Result

The available 1A, 1B and metadata work was integrated on an isolated branch.
The still-heavy Engineering Matter directory was then narrowed locally.

The branch is based on `b02395537a948fbe427f232f5a52ab59ba43efe0`. The
unavailable cloud head `5b8e2a3a8b4cf8de866f1649e7010294541442fa` was not
recovered and is not claimed as the tested base.

## Engineering Matter Directory

Before:

- The main page query selected matters.
- Every selected matter called `EngineeringMatterService.read` and
  `EngineeringMatterWorkingService.readWorking`.
- Those reads entered complete revisions, materials, working state JSON and
  working authorization history.

After:

- The main query selects only matterId, title, current matter revision,
  createdAt and updatedAt.
- A non-empty page uses three additional fixed batch reads:
  1. current-revision work-item links;
  2. material existence for current revisions;
  3. the latest working revision per matter.
- Working state JSON is not loaded. SQL projects only resultRef,
  resultRevision, headline, listBrief, decisive claim IDs/text, result scope
  and overviewStatus.
- Tenant/actor identity, search, cursor, workItemId filtering, primary/material
  handling, result binding and current working basis are retained.

The controlled query-count test reports four DB executions for both limit 1
and limit 3. This is a mock call count, not SQL duration, bytes or production
latency.

## Integrated Work

### 1A

The six-file default graph and timeline handoff patch was applied cleanly.

### 1B

The available gzip candidate changed:

- `server/modules/canonical-host/document-reading-runtime.service.ts`
- `test/unit/document-reading-runtime.spec.ts`

It verifies control actions do not enter the full original-bytes path while
READ/SAVE retain source and revision checks. It remains the earlier candidate,
not the unavailable final cloud worktree.

### Metadata

The recovered cloud message supplied complete diffs for three modified files.
The three new files were not present as bytes, so the decoder and two tests
were reimplemented locally:

- `server/modules/document-management/src/hosted/nest/document-metadata-decode.ts`
- `test/unit/document-metadata-decode.spec.ts`
- `test/unit/document-parsing-status-title.spec.ts`

Full metadata responses reject corrupt required fields. Status title display
validates only the title it consumes, so unrelated optional display corruption
does not block task control or deadline reconciliation.

## Verification Commands

```bash
npm run type:check:server
npm run type:check:client

./node_modules/.bin/jest \
  test/unit/matter-directory-narrow-reading.spec.ts \
  test/unit/default-graph-matter-discovery.spec.ts \
  test/unit/timeline-activity-discovery-handoff.spec.ts \
  test/unit/suite-matter-graph-page.spec.ts \
  test/unit/suite-graph-route.spec.ts \
  test/unit/use-matter-directory-refresh.spec.ts \
  test/unit/library-directory-mode-return.spec.ts \
  test/unit/document-reading-runtime.spec.ts \
  test/unit/document-metadata-decode.spec.ts \
  test/unit/document-management-metadata-enrichment.spec.ts \
  test/unit/document-parsing-status-title.spec.ts \
  --runInBand
```

Results:

- Server typecheck: pass.
- Client typecheck: pass.
- Jest: 11 suites passed, 103/103 tests passed.
- ESLint, Prettier and `git diff --check`: pass.
- Postgres metadata tests: 4 skipped without a dedicated test database.

## Current Boundaries

- The front-end graph and timeline implementations remain as already accepted.
- No schema, database, permission, model or production routing changes.
- No real PostgreSQL latency, browser request trace, preview release or
  production p95 measurement.
- The branch is committed and pushed only to the project GitHub remote for
  review; origin and production are not synchronized by this handoff.
