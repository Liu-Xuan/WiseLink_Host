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
- Two final lightweight batch confirmations verify that current Matter
  revisions and latest working revisions did not change during the read.
- Working state JSON is not loaded. SQL projects only resultRef,
  resultRevision, headline, listBrief, decisive claim IDs/text, result scope
  and overviewStatus.
- Tenant/actor identity, search, cursor, workItemId filtering, primary/material
  handling, result binding and source bindings are retained.
- Work based on an older Matter revision is allowed. It is not treated as a
  corrupt or unauthorized state.

The controlled query-count test reports six DB executions for both limit 1 and
limit 3 when the page is non-empty. The last two are stability confirmations.
This is a mock call count, not SQL duration, bytes or production latency.

## Round 2: Semantic Closeout And SQL Evidence

The local PostgreSQL fixture uses a NOBYPASSRLS role with actor and tenant
session settings. It executes the production service against representative
small data and an 80-matter scale set with one to four saved working revisions
and larger working state JSON.

- actor/tenant visibility, material-only matters, mixed WorkItem/material
  composition, search, WorkItem filtering and cursor pagination were asserted.
- decisive claim order, latest working revision, result scope and legal old
  working basis were asserted.
- a controlled matter revision change during a delayed working read produced
  `ENGINEERING_MATTER_DIRECTORY_CHANGED`, not a mixed result.
- both datasets executed six queries; exact SQL and EXPLAIN metrics are in
  `SQL_EVIDENCE.md`.

## 1C: Matter Workspace And Exact WorkRef Reuse

The app already mounts the platform QueryClient through `AppContainer`.
`useEngineeringMatter` now uses that client instead of component-local state.
The same module exposes a shared exact-workRef resource.

Changed files:

- `client/src/features/matter/useEngineeringMatter.ts`
- `client/src/features/matter/EngineeringMatterPage.tsx`
- `client/src/pages/RelationGraphPage/useSuiteMatterGraph.ts`
- `client/src/pages/RelationGraphPage/SuiteMatterGraphPage.tsx`
- `client/src/components/Layout.tsx`
- direct tests under `test/unit/`

Cache keys:

- workspace: appId, tenantId, actorId, sessionGeneration, matterId
- exact work: appId, tenantId, actorId, sessionGeneration, matterId, workRef
- view tab, graph selection, camera and anchors are excluded

Policy:

- staleTime: 30 s
- gcTime: 5 min
- retry: false
- manual refresh refetches the exact active resource and retains prior content
  while the refresh is in flight
- session change cancels and removes the matter query root
- network error keeps same-identity cached content and exposes the error
- 401/403/404 clears the displayed content instead of using stale data

Request and reuse evidence from route-level tests:

- current workspace: one logical workspace acquisition across Wiki -> graph ->
  Wiki, with two cache hits. `getEngineeringMatterWorkspace` still performs two
  HTTP requests per acquisition, so two resource requests are implied for the
  cold path.
- exact historical work: one workspace acquisition and one exact-revision
  acquisition across Wiki -> graph -> Wiki, with both later views served from
  cache. This implies three resource HTTP requests on a cold path; the shared
  identity-context read adds one request unless already cached.
- two simultaneous consumers start one logical workspace request; unmounting
  one does not cancel the remaining consumer.
- completed A -> B -> A reuses A. An unfinished A request is canceled when its
  last consumer leaves; returning to A starts a new request.
- a late A response cannot overwrite B.

These are deterministic mock/API-call counts. No browser request trace or
real-network timing was measured.

## 1C Lifecycle Closeout

This round did not change the cache policy or add another cache. It closed the
remaining lifecycle and evidence gaps:

- Within the 30 s freshness window a revisited matter is served without a new
  acquisition. Crossing the window alone does not fetch; a later consumer
  trigger does. `staleTime` is not polling.
- After the current work moved from W5 to W6, the current workspace refreshed to
  W6 while an exact historical W5 read stayed W5 and was not re-fetched. The
  directory list brief is never substituted for full workspace or exact-work
  content.
- A 403 on one matter cleared only that matter; a second cached matter and its
  exact work resource were unaffected, and no automatic 403 loop occurred.
  Network failure kept the same-identity readable content and surfaced the
  error; authorization failure did not keep showing the rejected object.
- Session change canceled and removed engineering-matter queries without
  destroying a query still observed by the new generation. Ordinary route
  transitions and last-consumer unmount did not clear the shared cache.

The earlier `--forceExit` gap was diagnosed, not suppressed. Only the
`session change clears old data and isolates the new generation` case retained
handles: six QueryClient `gcTime` timers created while the old cache root was
being removed. The two remaining stdio sockets were the Jest worker channel,
not application requests. The test suite now uses a test-owned fake clock,
unmounts the React root, clears and unmounts its QueryClient, closes JSDOM and
destroys remaining cache entries. Production cleanup calls `cancelQueries`
first and deletes only inactive engineering-matter queries; it never clears
the whole client and never disposes a query another consumer still observes.

## Round 3: Denied-Resource Durability And Route Lazy Loading

### A. 403 Followed By A Network Failure

The reported counterexample reproduced against the real hooks: after a
successful read, a refresh returning 403 hid the body, but the next refresh
failing with an ordinary network error restored the pre-denial body, because
`revoked` was derived only from the latest query error.

Minimal fix in `client/src/features/matter/useEngineeringMatter.ts`:

- each hook tracks the denied resource by its own query key in component state;
- the exact-work hook also receives the workspace denial as an authorization
  gate, so its query is disabled while the current matter is denied and the
  wiki and graph cannot surface a stale historical view from a different key;
- `setQueryData(queryKey, undefined)` runs while the resource is denied, so the
  shared cache no longer holds the rejected body;
- a later `revoke` only clears once a genuinely successful fetch is recorded,
  so an ordinary network failure after a denial cannot re-expose it;
- a normal network failure without a prior denial still keeps the last readable
  content, and a successful reauthorized fetch restores consumption;
- the tracking is per query key and per hook, so denying matter A does not
  affect matter B, and the exact-work key is independent of the current
  workspace key.

Tests added in `test/unit/engineering-matter-query-cache.spec.ts`:

- `workspace revoke is not undone by a later network failure`;
- `exact historical work revoke is not undone by a later network failure`;
- `a current matter denial also hides its exact historical work`.

Both assert denial -> network failure -> hidden, then a successful
re-authorization restores content. The pre-fix run failed both cases with the
old body visible; the post-fix focused run passes 16/16 in the four related
suites.

### B. 2A First-Screen Route Lazy Loading

`client/src/app.tsx` now declares every heavy route component with a top-level
`lazy(() => import(...))`. `Layout` and `WorkspaceHomePage` stay eager so the
library shell and its redirect are available without waiting for a chunk.
`AppContainer`, `BrowserRouter`, the theme provider and the QueryClient remain
outside the `Suspense` boundary, so loading a route chunk does not rebuild the
providers or the shared matter cache. A `RouteChunkBoundary` renders a visible
"page failed to load" panel with a manual reload button; it resets when the
route changes and never auto-refreshes.

Lazy route set: dialogue, work-item overview, matter wiki, matter analysis,
situation, timeline, document parsing and readers, document revision/activity,
runtime probe, external discovery, OAuth callback, model settings, relation
graph, knowledge lookup, all `dev-preview/*` pages, the reader/version
compatibility adapters and the React Flow validation playground.

Measured with `NODE_ENV=production vite build --config vite.config.ts` on the
same Node 24.14.1 and the same installed dependency tree:

| Metric                |      Before |       After |
| --------------------- | ----------: | ----------: |
| Entry chunk raw       | 3,742.29 kB | 1,678.64 kB |
| Entry chunk gzip      | 1,183.84 kB |   538.05 kB |
| Entry-reachable JS    |     3.57 MB |     1.60 MB |
| Entry CSS             |    637.9 kB |    325.0 kB |
| `routes.json` entries |          32 |          32 |

The entry now references `cytoscape`, `mermaid`, `pdf`, `shiki` and
`AtlasWorkspace` only through dynamic-import maps; those libraries are in
separate async chunks. `routes.json` was regenerated twice during the build
and still contains `/library`, `matters/:matterId`, `graph`, `timeline`,
`reader/:documentId`, `version-comparison/:documentId` and the dev-preview
paths. These numbers are build-artifact bytes, not first-paint time, server
transfer bytes or online p95.

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
  test/unit/engineering-matter-query-cache.spec.ts \
  test/unit/matter-resource-reuse.spec.ts \
  test/unit/suite-matter-graph-read.spec.ts \
  test/unit/matter-historical-read-stability.spec.ts \
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
  test/unit/engineering-matter-client.spec.ts \
  test/unit/matter-problem-analysis-page.spec.ts \
  test/unit/matter-wiki-layout.spec.ts \
  test/unit/matter-posture.spec.ts \
  test/unit/library-atlas-reading.spec.ts \
  --runInBand

ENGINEERING_MATTER_DIRECTORY_TEST_DATABASE_URL=postgres://liuxuan@127.0.0.1:55441/wiselink_directory_test \
  node --test test/node/engineering-matter-directory-postgres.test.mjs

NODE_ENV=production vite build --config vite.config.ts
```

Results:

- Server typecheck: pass.
- Client typecheck: pass.
- Jest: 20 suites passed, 154/154 tests passed with the repository standard
  configuration, `--runInBand` only and no `--forceExit`; Jest exited normally.
- Client production build: pass. Entry chunk 1,678.64 kB raw / 538.05 kB gzip,
  down from 3,742.29 kB / 1,183.84 kB. `dist/client/routes.json` has 32 routes.
- Isolated PostgreSQL directory test: 1 passed; six queries and EXPLAIN plans
  captured.
- ESLint, Prettier and `git diff --check`: pass.
- Postgres metadata tests: 4 skipped without a dedicated test database.

## Current Boundaries

- The front-end graph and timeline implementations remain as already accepted.
- No schema, database, permission, model or production routing changes.
- No production PostgreSQL latency, browser request trace, preview release or
  production p95 measurement. The isolated database metrics are local
  synthetic evidence only.
- The previous committed checkpoint `c330b8bd...` records the directory
  semantic closeout and SQL evidence. This commit records the 1C resource
  lifecycle closeout on the same GitHub branch. `origin`, production and
  preview are not synchronized.
- Wiki to graph to Wiki HTTP counts are deterministic mocked resource/API call
  counts, not browser HAR requests. Browser request timing, content appearance
  timing and online p95 remain unmeasured.
- `test/unit/single-app-workspace.spec.ts` has one pre-existing source-text
  assertion failure on `wl-light--cold`; the Layout source never contained that
  token at `c85a0b616` either, and this round did not change Layout. It is
  outside the focused regression set and is recorded rather than worked around.
