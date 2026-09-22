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

## Round 4: Shared Rejection State And Local Route Boundary

### A. Denial State Belongs To The Shared Resource

The earlier round stored the denial in a per-hook `useState` Set and asserted
that `setQueryData(queryKey, undefined)` cleared the cached body. Direct
verification against the installed `@tanstack/query-core` showed the opposite:
`setQueryData(key, undefined)` leaves the previous data in `state.data`, and a
component-local Set is forgotten on remount. The report above that used that
claim was wrong and is corrected here.

`client/src/features/matter/useEngineeringMatter.ts` now normalises the read
outcome inside the shared query value:

- the workspace and exact-work query functions resolve to
  `{ kind: 'readable', data }` on success and `{ kind: 'rejected', error }` for
  401/403/404; other errors keep the normal throwing behaviour;
- `revoked` is `result.kind === 'rejected'` (or a denied identity error), so it
  is read from the same cached value by every consumer and survives unmount and
  remount without a component-level flag or a second cache;
- a denial is never overwritten by a later ordinary network error, because that
  network error throws and leaves the previously cached `rejected` value in
  place;
- a successful re-authorization resolves to a new `readable` value and every
  consumer of that key recovers together;
- a normal network failure with no prior denial still keeps the last readable
  result, and a denial of the current matter still suppresses its exact
  historical work.

Read semantics are kept distinct: the page hides denied content, the shared
resource records the denial, and no business data is deleted from the server.
The previous "delete the body" wording is not used.

Tests in `test/unit/engineering-matter-query-cache.spec.ts` now cover:

- `workspace revoke is not undone by a later network failure`;
- `exact historical work revoke is not undone by a later network failure`;
- `a current matter denial also hides its exact historical work`;
- `a denied resource stays denied after the reader unmounts and remounts`;
- `two consumers recover together after a shared resource is reauthorized`.

The remount and two-consumer cases use separate mounts/clicks rather than one
consumer clicking repeatedly. The denial and recovery assertions pass.

### B. The Route Chunk Boundary Sits At The Outlet

The module-level `lazy(() => import(...))` declarations stay in
`client/src/app.tsx`; all 32 generated routes are unchanged. The Suspense and
error boundary moved out of `app.tsx` into
`client/src/components/RouteOutletBoundary.tsx`, which wraps the `Outlet` in
`client/src/components/Layout.tsx`. As a result the sidebar, top bar, identity
providers and `QueryClient` remain mounted while a page chunk loads, and a
single page chunk failure no longer removes the app shell. Routes that do not
render through `Layout` (the dev-preview entries and the OAuth callback) are
wrapped individually so they keep their existing purpose. The error panel
offers an explicit manual whole-page reload; it does not auto-refresh, and it
does not promise that unsaved in-page state survives the reload.

A controlled async integration test in `test/unit/route-outlet-boundary.spec.ts`
uses the real `Routes`, `Layout` and boundary: a pending chunk keeps the shell
and shell navigation mounted; a rejected chunk keeps the shell and shows the
recoverable panel; navigating back to the library restores the shell and the
route content without rebuilding the sidebar.

Lazy route set: dialogue, work-item overview, matter wiki, matter analysis,
situation, timeline, document parsing and readers, document revision/activity,
runtime probe, external discovery, OAuth callback, model settings, relation
graph, knowledge lookup, all `dev-preview/*` pages, the reader/version
compatibility adapters and the React Flow validation playground.

Measured with `NODE_ENV=production vite build --config vite.config.ts` on the
same Node 24.14.1 and the same installed dependency tree:

| Metric                |      Before |       After |
| --------------------- | ----------: | ----------: |
| Entry chunk raw       | 3,742.29 kB | 1,678.38 kB |
| Entry chunk gzip      | 1,183.84 kB |   538.06 kB |
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
- Jest: 21 suites passed, 158/158 tests passed with the repository standard
  configuration, `--runInBand` only and no `--forceExit`; Jest exited normally.
  The original 20-suite set passes 156/156 in its recorded order.
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
- `test/unit/matter-resource-reuse.spec.ts` and
  `test/unit/timeline-activity-discovery-handoff.spec.ts` interfere when run in
  the same Jest process: each passes alone, and the recorded ordered 20-suite
  command passes, but running the resource-reuse suite immediately before the
  timeline suite fails one timeline assertion. This ordering interaction is
  pre-existing and outside this round's scope.

## H0/T0 — Deterministic Timeline Handoff (2026-09-22)

Base: `21a6716b0c5018a53c580024c9f9d2523e6cf373`, clean integration branch
`codex/perf-resume-20260922`. Implemented in isolated detached worktree
`/private/tmp/wiselink-h0-t0-pdf-20260922`; the canonical worktree and its four
untracked debug files were not modified. Existing 1A/directory/1B/metadata/1C/2A
remain the starting implementation, not work repeated in this batch. The two
referenced task histories agree with this checkpoint; the older Suite review
layout remains separate future work.

### Reproduction and cause

The first normal pair run selected timeline then matter and passed 6/6.
A diagnostic sequencer selected matter then timeline: one run passed 6/6,
a second failed 5/6 at the final timeline test with DV1/RUN-STALE instead of
DV2/RUN9. Reverse ordering also passed. Thus CLI argument order is not execution
order, and choosing one passing order is not a fix.

The failing helper used a zero-delay host timer to navigate to DV2. The test
awaited React `act`, then resolved DV1 without ever asserting that the timer had
navigated. `act` drains React work but does not promise execution of this host
timer. Failure output still names DV1/PR-DV1: the old response was released
before the intended switch. Suite timing exposed the race; no cross-suite
window/document descriptor, QueryClient or mock leak was established. Both
suites restore their DOM descriptors and unmount roots; matter clears its
QueryClient. Production cancellation did not need alteration.

Only the final timeline test changed: reuse the existing NavProbe, await its
DV2 navigation, assert the DV2 URL and rendered candidate, then release the
pending DV1 response and retain the original stale-result and request-count
assertions. The test no longer owns a navigation timer. No sleep, timeout
increase, fake-timer workaround, module reset or Jest config change was added.

### Validation

Commands ran in the isolated worktree with installed Node 24.14.1/Jest 29.7.0,
repository ts-jest diagnostics/config and `--runInBand`, no `--forceExit`:

- `jest --runInBand test/unit/matter-resource-reuse.spec.ts`: 2/2, exit 0.
- `jest --runInBand test/unit/timeline-activity-discovery-handoff.spec.ts`:
  4/4, exit 0.
- Both paths with `--testSequencer=/private/tmp/wiselink-order.cjs`: actual
  matter → timeline, 6/6, exit 0.
- Same command with `WL_REVERSE=1`: actual timeline → matter, 6/6, exit 0.
- ESLint for the modified test and `git diff --check`: exit 0.

The temporary sequencer only sorts selected absolute test paths by
`localeCompare` (multiplied by -1 when WL_REVERSE is set); it is diagnostic,
not installed or committed as a success-order requirement. Reproduction logs:
`/private/tmp/wiselink-t0-repeat.log` (failed), `wiselink-t0-before.log` and
`wiselink-t0-reverse.log` (passed); after-fix logs are
`wiselink-t0-{matter-alone,timeline-alone,forward,reverse}-after.log` under the
same directory. These are local test evidence, not browser timing or p95.

The `wl-light--cold` assertion targets obsolete Layout source decoration:
current Layout delegates the Suite shell to Sidebar/TopBar and does not render
those old light-layer class strings. No inert class was added and this unrelated
text assertion was not expanded into a visual migration. Authorized browser,
PDF target rendering and production behavior are not claimed by this test-only
commit. 2B.1 is separately assigned; no publishing or runtime work occurred.

## B 3A.1 — translation control dispatch (2026-09-23)

Parent: `3e0cc6074bb19b88d6ab33c324323ea45e407d53`; tree `/private/tmp/wiselink-perf-b-translation-20260923`, branch `codex/perf-b-translation-control-20260923`. Runtime adds the existing exported DocumentParsingHostedService dependency (already consumed by document reading). `status` follows fresh DOCUMENT_READ ACL, narrow metadata source and parse-row registry, not original-store loading or semantic-map construction. No public tool/request shape changed.

Control commands and no-work exits no longer call readDocumentOriginal before dispatch: STATUS, CANCEL, repeated START receipt, IDLE, terminal STEP, wrong attempt/run and BUSY. Existing actor/tenant repository scope, expire/claim/renew/release and exact producerRunId matching remain. New START still loads and verifies bytes, semantic readiness and manifest before preparing/reserving. Claimed live STEP loads the exact original inside the failure/release boundary; plugin/save authorization callbacks retain fresh original reads. This batch does not optimize those repeated content callbacks or claim all 3A is done.

The old-source regression was actually run with the new test (only constructor wiring adapted to the old arity): storage unavailable makes STATUS reject, exit 1. New code permits status, repeat-START and cancel with zero original reads and zero semantic reads in the same fixture while still making four fresh ACL/status calls including initial START. Revocation, wrong authorized document, integrity failure, wrong/terminal/unclaimed steps and post-plugin revocation have direct tests. Original corruption on claimed STEP fails the attempt and releases the acquired lease without executing the plugin.

Validation:
- Standard Jest, runInBand only: document-translation-runtime, document-translation-task-envelope, document-translation-reading, document-reading-runtime, canonical-host-openclaw-translation.service: 5 suites / 43 tests pass, normal exit.
- Server typecheck, exact two-file ESLint, server build: pass.
- Build's OCR check is STATIC_VALIDATION_ONLY_NON_TARGET_BUILD on this host, not Linux OCR/Hosted execution.
- Logs `/private/tmp/wiselink-translation-control-{before,test,regression,types,lint,build}.log`. No local devserver started in this tree; relevant compiler/test logs inspected.

Entire adopted roadmap is now preserved in OFFICIAL_CODEX_ROADMAP; CURRENT_TASK distinguishes every remaining stage and incorporates main's current no-integration/no-release/no-authorized-preview-sample report. No source/permission/schema/production-profile change, no Hosted model/plugin invocation, no push/release/install. Luna independent acceptance and main's selected integration follow this commit. Full roadmap Goal remains active.
