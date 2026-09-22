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


## 2026-09-22 可见 Astra：既有评估活动纵切复核与最小计划

本节仅为源码复核与计划，没有产品实现或运行验收。基线/起止 HEAD：
`21a6716b0c5018a53c580024c9f9d2523e6cf373`，其父提交
`2650c86aa68762825fc3ce872da90414525c9c49`。工作目录为本 perf worktree；
canonical 未写入。回执新增前 worktree 干净；本轮唯一仓库差异为本节。

### 历史事实 → 当前代码证据

已实际用 read_thread 回读指定两条历史任务，未以旧回报代替现状：

- `01a0c702-1f0d-7fa2-afca-6de9d9d77459`：两页共12轮，已到末页。
  最新回报记录 A=`2650c86aa`、B=`21a6716b0`，纠正
  `setQueryData(key, undefined)` 不删除数据的旧结论，保留共享拒绝状态和
  Outlet 局部边界。当前 git 父子关系与 `useEngineeringMatter.ts` 中的
  readable/rejected 联合值、`Layout.tsx:101` 的 RouteOutletBoundary 相符。
  158 tests、构建数字及当时 GitHub 回读是历史成绩，本轮未复跑或重新核对远端。
- `01a0b6f4-0fb9-7501-af6d-df46a5ba1f89`：最新8轮及前一页6轮；更早未穷举。
  用户要求吸收旧工作台中的分析过程、复核意见、适用性和目录，避免重复页面；
  历史回报记录 `1c8e8c2a2` 的分析入口、`b02395537` 的 JobAid 正文壳和技术发布。
  当前 WorkItemProcessWorkspace、JobAidProblemWorkspace、MatterProblemAnalysisPage
  确实消费保存工作，但 WorkItemProcessWorkspace 的活动仅为四类 timeline 最近四条，
  MatterProblemAnalysisPage 没有通用活动流。技术发布记录不证明新投影已上线。
- 已读本地官方接续包先读我、00、01、02、03，以及先前活动历史审计。
  02 的 H0/T0/2B.1 是另一个已限定性能批次，不将它扩大为本子任务的 PDF、
  推送或发布指令；本子任务以本轮活动纵切委派为准。

已在当前代码核实的活动链：

| 范围 | 当前证据 | 本轮判断 |
| --- | --- | --- |
| Review | action-attempt/review-evidence-activity.ts 的 raw.every 与100条窗口 | 四类活动已可见；不能向原 union 混塞 Matter 大对象 |
| JobAid | jobaid-work.repository.ts:405，recordSourceRead 写 ASSESSMENT_SOURCES_READ | 已有持久事件，无需新事件真源 |
| JobAid 状态 | canonical-jobaid-problem.service.ts:1286，按 current.actionAttemptId 取 executionStatus | 最近保存工作不等于当前活跃 attempt，未保存新轮可能不可见 |
| JobAid 历史 | 同 service:1265 的 readBrowserRevision | 精确历史服务存在；未发现 controller 调用，不得假装前端已接通 |
| Matter | matter-action-attempt.service.ts 的读源/原件/保存/更正事件 | 原始 reading/proposal/context 不可直接返回前端 |
| Matter 授权 | readForBrowser → authorized(nativeActor) → scopedRow → working basis/reference evidence 授权 | 保留 actor/app/tenant/user、冻结来源及递归引用校验 |
| 时间与保存 | MATTER_ORIGINAL_BOUND、MATTER_JOBAID_WORK_SAVED 无 observedAt | 时间缺失为 null，不以读取时刻或 latest 修订补历史 |
| 轮询 | useJobAidWorkingRead.ts，enabled 即6秒再读，清理仅忽略迟到结果 | 终态仍轮询；effect 变更时旧请求未 abort，不能宣称全局单 inflight |

### 本轮最小计划与不变契约

第一纵切仍是既有 ActionAttempt/JobAid/Matter 记录 → 白名单投影 → 授权 GET →
现有问题与分析/工作进展消费者，不建立 AssessmentRun、数据库或事件总线。

1. 明确 current selector（active 优先、无 active 才 latest）和 exact attempt/history。
   精确 workRef 服务端绑定其原 attempt；缺失不回退 latest。查询按 tenant/actor/
   subject/actionType 收敛；游标绑定固定 attempt，翻页不得重新选择最新轮。
2. 同 attempt 原始数组下标作稳定局部序号，未知项不能重编号后项。去重使用
   attemptRef+序号；保存回执用 requestId+workRef。真实重复读取保留。
   JobAid 保存修订与活动数组分组，不合成不存在的全局精确先后顺序。
3. 输出逐项白名单构造，只含已授权身份、范围和保存引用。未知类别计省略数；
   已知结构损坏/JSON损坏明确活动错误，合法保存正文独立保留。时间缺失为 null；
   状态快照不伪造开始/结束历史；候选不等于正式采用。
4. raw offset 游标、最多100条有界窗口；区分此前省略、未知省略与尚未翻页数量。
   HTTP分页不等于数据库分页优化：持久JSON仍可能整行读取。
5. 当前可见页面和活跃 attempt 才轮询；同scope单 inflight，终态/失败停止，手动刷新可恢复。
   signal 贯通，卸载/身份变化取消并拒收迟到响应。只更新 current key，精确历史不被替换；
   复用已挂载 QueryClient 的身份与拒绝语义，不另建页面 Map。

### 依赖 / cross_module_needs

本轮明确禁止修改聚合入口，因此没有写未接通的产品代码。完整纵切需要以下其中一种 owner 接线：

- 推荐独立 assessment-activity.controller.ts，复用既有 JobAid/Matter service；
  集成 owner 在 canonical-host.module.ts 的静态 controllers（209起）及动态 controllers
  （458起）同步注册，若增加独立 provider 同步登记。其余实现可放非聚合文件。
- 或由 owner 扩展 canonical-host.controller.ts:194 邻近的 JobAid GET 路由；Matter
  可用独立 engineering-matter.controller.ts。GET 不得触发 reserve/claim/save/retry。

Matter 单独首切可在已有独立 controller 上实现，不能将上述依赖说成整个架构无法实现。
它必须复用 engineering-issue-search.service.ts:208 的浏览器授权 pattern：当前事项 fresh read、
serviceAuthorization 的 principal/app/tenant/actor 对齐、authorizeReferenceMatter callback；
缺引用授权时保持拒绝，不能为只读投影删除 scopedRow 的授权。

候选路由（尚未实现）：
`GET /api/canonical-host/work-items/:workItemId/assessment-activity` 与
`GET /api/canonical-host/engineering-matters/:matterId/assessment-activity`。
最终采用哪一条接线由主控协调；本节不修改聚合文件，也不把新接口塞入不相关 search/continue 路由。

### 验收门与实际验证

实现后的最少对应检查：投影不泄露私有字段、未知/损坏记录、跨scope cursor、稳定分页与真实重复读取；
HTTP未登录/跨tenant/actor/来源撤权/冻结输入不一致拒绝且无写调用；active新轮无保存不借用旧轮；
页面慢请求单 inflight、终态/失败停止、手动恢复、身份变化与迟到响应、历史不被 current 覆盖。
随后跑原配置关联 Jest，以及 `npm run type:check:server`、`npm run type:check:client`。
不新增全仓 gate；真实浏览器、数据库、Hosted 和发布分别验收。

本轮实际执行 git branch/status/rev-parse/log/diff 和定向 rg/sed/cat，Git 核对正常；
`ls -ld node_modules` 退出1，指定 worktree 没有依赖目录。未安装/链接依赖。
只有文档差异，未跑 Jest/类型检查，不把历史29项或158项计入本轮。
未操作妙搭、数据库、模型、正式采用、发布或推送；未形成产品实现提交。


## 2026-09-22 可见 Astra 实现：Matter JobAid 安全活动首切

后续主控已授权本轮必要聚合注册，解除上一节所记接线限制。本批明确只贯通 Matter 内的
JobAid 评估活动到现有问题分析页；WorkItem JobAid 与 WorkItemProcessWorkspace 未包含，
不能把本批称为全部评估过程已接通。父提交：`21a6716b0c5018a53c580024c9f9d2523e6cf373`。
最终代码为该基线上本节列出的提交差异；准确提交 SHA 以 Git 回执为准。

### 实际行为与必要聚合修改

- 新增受保护只读 GET：
  `/api/canonical-host/engineering-matters/:matterId/assessment-activity`。
  沿用 NeedLogin、ProductionMiaodaBrowserObjectIngressGuard、hostActor，fresh Matter/exact-work
  读取、service-scope principal/app/tenant/actor 对齐，再进入原 authorized/scopedRow 的冻结输入与
  递归引用来源授权。没有 reserve、claim、save、retry 或其他写调用。
- `canonical-host.module.ts` 只增加一个 import 和两处 controller 注册。原 Matter working GET
  是正文/版本响应，没有活动选择和分页语义；因此采用领域专用 GET，未修改聚合正文响应。
  没有新增 provider、表、AssessmentRun、事件源或生产配置。
- 默认选择活跃 attempt，无活跃才选最近一轮，createdAt + attemptId 确定排序。
  支持 exact attemptRef 和 exact workRef；历史工作绑定其 source.actionAttemptId，缺失不退回当前。
  没有关联 Matter attempt 的旧/Review 工作明确返回无关联记录，不捏造历史。
- 每页默认50、最多100条原始记录位置。cursor 绑定 tenant/actor/matter/selector/attempt 和 raw offset；
  原始序号稳定，保留重复读取，按 requestId+workRef 去重重复保存回执，包括跨页重复。
  独立显示此前原始记录数、本页未知/损坏/重复省略数；未知类型不抹掉合法记录。
- 白名单只返回活动类别、真实时间或 null、来源版本/页/片段范围、保存引用等。
  原始 activity、purpose、reading、proposal、context、checkpoint、租约和模型输入不进入响应。
  终态是当前状态快照，不伪造开始/结束历史；始终声明候选，不代表正式采用。
- MatterProblemAnalysisPage 的侧栏现在消费真实活动 GET，保持保存正文及精确 workRef。
  历史视图注明“所关联执行轮的记录，不是保存时刻的状态快照”。
  复用现有身份 Query；活动页按 app/tenant/actor/session/matter/selector/cursor/limit 分键。
  只有当前可见页、CURRENT 选择且 attempt 活跃时4秒轮询；终态、投影损坏、网络失败或拒绝停止。
  手动刷新不取消已有同key请求而是共享它；最后观察者离开时 signal 取消，迟到结果不能跨会话生效。
- 同一 selector 的明确401/403/404拒绝会取消其他分页旧请求，并把已缓存分页都改为共享 rejected 值。
  返回前页不会复活拒绝前数据；普通网络错误不能解除拒绝，成功重新授权读取才恢复该页。
  不使用组件私有拒绝 Set 或第二个 Map。

### 准确文件范围

新增：
- `shared/matter-assessment-activity.interface.ts`
- `server/modules/canonical-host/matter-assessment-activity.ts`
- `server/modules/canonical-host/matter-assessment-activity.controller.ts`
- `client/src/features/matter/useMatterAssessmentActivity.ts`
- `client/src/features/matter/MatterAssessmentActivity.tsx`
- `test/unit/matter-assessment-activity.spec.ts`
- `test/unit/matter-assessment-activity.service.spec.ts`
- `test/unit/matter-assessment-activity-ui.spec.ts`

修改：
- `server/modules/canonical-host/matter-action-attempt.service.ts`：只读选择与投影方法。
- `server/modules/canonical-host/canonical-host.module.ts`：两处注册。
- `client/src/api/engineering-matter.ts`：GET、signal 和 selector 响应绑定。
- `client/src/features/matter/useEngineeringMatter.ts`：仅导出既有身份 hook，未改缓存策略。
- `client/src/features/matter/MatterProblemAnalysisPage.tsx`：挂载真实活动消费者。
- `test/unit/engineering-matter-client.spec.ts`：GET/取消/身份绑定。
- `test/unit/matter-problem-analysis-page.spec.ts`：活动消费者与历史工作接线断言。
- 本目录 `REPORT.md` 与 `CURRENT_TASK.md`：历史复核、实现与接续记录。

### 实际验证

工作目录为指定 perf worktree；借用 canonical 的现有 node_modules 只读链接，未安装/升级依赖。
产品源码与测试均解析本 perf 工作树，不在 canonical 跑测试冒充本分支成绩。

```sh
./node_modules/.bin/jest \
  test/unit/matter-assessment-activity.spec.ts \
  test/unit/matter-assessment-activity.service.spec.ts \
  test/unit/matter-assessment-activity-ui.spec.ts \
  test/unit/matter-problem-analysis-page.spec.ts \
  test/unit/engineering-matter-client.spec.ts \
  test/unit/engineering-matter-query-cache.spec.ts \
  test/unit/matter-attempt-mcp-tools.spec.ts \
  test/unit/review-evidence-activity.spec.ts --runInBand
npm run type:check
npm run build:client
```

- 最终联合 Jest：8 suites / 76 tests passed，exit0，原配置、无forceExit、正常退出。
  覆盖分页序号/去重/未知与损坏、私有字段拒出、跨scope与历史ref、原来源授权拒绝、GET保护声明、
  慢请求共享、终态/错误停止、隐藏/卸载取消、分页拒绝不复活、手动恢复。保留既有 React Router future warning。
- 标准前后端类型检查：最终均 exit0。中间一次未申请 perf 写范围的执行，server通过、client因
  TS5033/EPERM 无法更新 tsconfig.app.tsbuildinfo 退出2；之后按已授权目录运行同一命令通过。
  未关闭增量、诊断或更换配置来绕过失败。
- 本批15个源码/测试文件的 `eslint --quiet`：通过；新增文件 Prettier 格式化后检查；diff检查通过。
- `npm run build:client`：exit0，32条路由，入口1,678.72kB raw /538.16kB gzip，15.62s。
  这是父提交加本批代码差异的本地编译，构建指纹仍引用当时HEAD；不是新提交已部署证明。
  Vite 报告邻近旧工作树 tsconfig 解析告警及大chunk提示，未关闭告警或修改外部工作树。
- controller为定向处理器/装饰器测试；数据库选择与授权仓储为受控fixture。
  未运行真实HTTP网关身份、真实Postgres、Hosted业务或浏览器视觉测试，不以单测耗时当p95。

### 后续验收与明确剩余

托管妙搭 Host/OpenClaw 可用；开发智能体token耗尽不代表托管运行不可用。
本批提供给主控串行审查与技术发布准备；未推送、未发布、未调用妙搭开发智能体或真实模型。
部署必须使用本批精确代码提交重新构建，不使用上述带父提交指纹的本地产物。

发布后的最小只读验收：正常身份打开已有 Matter 问题页，核对 current 与 exact workRef、翻页、
来源撤权及隐藏/终态停止；读取既有运行数据不新建评估。随后对明确授权样本进行 Hosted 活跃轮测试，
核对真实读源/保存事件、HTTP次数和候选正文仍独立；正式采用继续走原业务边界。

剩余：WorkItem JobAid 的活动与enabled永久轮询、WorkProgress消费者未改；本首切不新增工具开始/结束事件。
活动JSON仍可能整行读入，授权fresh-read仍会读取工作状态，未宣称数据库分页或读取性能已经优化。
新保存活动不会自动替换旁边已读正文；正文沿原有“重新读取”入口更新，精确历史不自动变化。
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

## B 3A.2 — idle source projection preparation (2026-09-23)

Parent e7b6b6c040585f17fd4bb949a90b47fa0bd47647; independent tree `/private/tmp/wiselink-perf-b-source-idle-20260923`. Actual document_work INDEX caller still executes parsing.status and actor scope before this service. Source projection now selects pending first. Only the no-pending case reads two readiness columns through DocumentSemanticService/RevisionRepository. Query joins exact tenant/document/parse/revision and VERIFIED PUBLISHED original manifest SHA; it neither selects map_json nor loads object-store bytes. If registration is absent, normal Reader and ensure still create first semantics. Pending work retains original integrity/semantic validation and unchanged transactional offset/manifest/RLS write guards.

This is a registered readiness result, not a claim of current object-store integrity. No new authorization cache, schema, SourceRef or model action. Direct tests prove ready+idle original/ensure counts=0; missing initial semantics and pending still read; readiness errors propagate. SQL generation verifies parameters and exact binding predicates. Original production projection failed the new idle test with STORAGE_UNAVAILABLE, exit1; new path passes. Updated the existing PostgreSQL fixture's semantic dependency to implement readReady; did not run that database suite or claim live SQL/RLS proof.

Validation: 4 suites/25 tests (document-source-idle, document-semantic-map, document-translation-structure, document-translation-runtime), standard Jest normal exit; server typecheck, changed-file ESLint and server build pass. Same non-target OCR limitation as 3A.1. Logs `/private/tmp/wiselink-source-idle-{before,test,regression,types,lint,build}.log`.

Also removes two trailing-space lines copied into OFFICIAL_CODEX_ROADMAP in e7. Those were newly introduced documentation whitespace, not an old repository baseline; full cumulative diff-check must include the tracked new file. 3A.1 product code remains unchanged for Luna. Full roadmap still active; real SQL, independent acceptance, 3A.3 and other open stages remain.

## B 3A.3 — current semantics before new translation (2026-09-23)

Parent 81ea079eacf8b41c35bd82ad4493cef61705a86a; independent tree `/private/tmp/wiselink-perf-b-semantic-order-20260923`. Main confirmed B as sole writer of consumeHostedDocument and its tests; A's WorkItem resume/lease region is untouched. Main must selectively combine and test A/B; non-overlapping hunks alone are not combined validation.

Previously INDEX and translation START raced via allSettled; the direct deferred-INDEX regression proves old code sent START before INDEX resolved (exit1). Now STATUS and existing-work recovery remain concurrent with search indexing; only a new IDLE START depends on current semantics. Successful current INDEX PROGRESS/RETRY/NO_PENDING already follows ensure and permits START without waiting for all indexing. A historical pending index cannot certify the current parse: a new current translation prepares that exact run separately when required.

Host IDLE translation STATUS adds exact parseRunId + semanticReady from the existing narrow registry read, without original/map hydration. An already registered current semantic revision permits START immediately while search indexing continues. If INDEX fails after persisting semantics, the consumer re-reads exact Host readiness; true allows START while sourceProjection retains its failure. False/absent readiness prevents START and returns REQUIRES_ATTENTION; mismatched readiness identity fails closed. Existing RUNNING/SUCCEEDED/CANCELLED/status handling and admission-denied checkpoint are retained; no unknown model call is replayed.

Compatibility: deploy compatible Host (3A.2 readReady + this STATUS field) before installing this Skill change. Old callers tolerate additive fields. Against old Host, successful exact INDEX can still establish readiness; after INDEX failure missing field cannot be guessed true. No actual install/release performed; only main may perform those actions.

Validation: Node document/work-item/reading/activity consumer tests 98/98; Jest translation-runtime/source-idle/task-envelope 3 suites16/16. Server typecheck, four-file ESLint, server build pass (non-target OCR static only). Logs `/private/tmp/wiselink-semantic-order-{before,test,consumers,runtime,regression,types,lint,build}.log`. The only new timing claim is proven ordering/counts in controlled promises, not real plugin/Hosted speed. Luna acceptance pending. 3A.2 real PostgreSQL/RLS remains open despite local independent acceptance; V/R, 2B.2/2C/2D/3B/stage4 also remain open in whole Goal.

## B 2C.2 — separate card content from geometry (2026-09-23)

Parent c65d0aa101363dec19869403c5dde71c17a8ad1c; tree `/private/tmp/wiselink-perf-b-graph-cards-20260923`. Only SuiteGraphCanvas and its direct test plus this report/current task. Existing SuiteMatterGraphView memoizes presentation by graph/layout/filter inputs, so selection/side-panel alone is not asserted to rebuild topology without a counterexample.

OverlayCard is memoized by id, detached data snapshot, selection and stable event handlers, excluding rendered position. Outer position/scale remains rendered every changed visual frame. Selection/group/overflow handlers read current callback refs; drag keeps the existing ref-based lifecycle. Body changes, selection and halo dimensions still invalidate cards. No theme, graph layout, source or relationship semantics change.

Actual old-source component regression: zoom updated geometry but also called the unchanged item body/icon selector (expected0, actual1, exit1). Candidate gives0 on zoom and callback-only parent render,1 on title change and selection; clicking uses the replacement callback, not the old callback. Existing real Cytoscape/drag/cancel/halo/reset/narrow-screen tests retained.

5 suites53 tests pass, client typecheck/exact ESLint pass, production client build14.18s pass with existing chunk warnings. Logs `/private/tmp/wiselink-graph-cards-{before,test,regression,types,lint,build}.log`. This is controlled body work reduction, not browser frame-time/p95 proof. Incremental topology and full layout/viewport return remain open. No publish/model/data action. 3A.3 independent local acceptance arrived during this batch; 3A.2 real PostgreSQL/RLS fixture c65d0aa10 is now under Luna's separately authorized temporary-instance validation.


## 2026-09-23 B：2C.3 稳定 ID 增量拓扑

基线 `bcccd815602537575371e769c1ddb47390c6a032`，独立树 `/private/tmp/wiselink-perf-b-graph-topology-20260923`。Canvas 接入增量 reconcile：保留同 ID 节点对象与当前拖动坐标，只删缺失/改变端点的元素，先节点后边补入；补丁更新声明数据、类与交互属性，保留运行期 halo/交互状态。仅拓扑、声明坐标或尺寸变化触发 preset layout；标题等正文刷新不 layout/resize/fit。显式声明新布局仍采用新坐标，既有 reset 行为保留。

真实 headless Cytoscape 消费者反例在旧 Canvas（bcccd815）失败：标题刷新会替换节点对象；新实现保留对象/拖动位置/镜头，更新可见标题且 layout/fit 为零。增量辅助测试涵盖节点/边增删、端点替换、声明属性清除、交互类和 halo 保留、明确布局/尺寸变化。6 suites/57 tests 通过，client 类型检查通过；生产文件 ESLint 无错误；test 目录被现有 ESLint 配置排除，未声称对其 lint 通过，Jest/TypeScript 已实际编译执行。client build 成功（13.44s，仅既有 chunk/module 警告）。这不是浏览器 p95 或完整返回布局验收。

前批独立证据：Luna 已通过 bcccd815 的 5 套 53 项、client types/lint/build/precommit；c65d0aa 的真实 PG14.17 实例 1/1，实际迁移和 readReady JOIN/RLS、错误身份/版本/manifest、非owner非超级用户角色及约束通过，临时 127.0.0.1:55441 实例和唯一创建目录已停止清理。主控确认本轮统一集成/发布/Skill install 和授权预览样本核验仍待执行，不因等待而重复本地验收。


## 2026-09-23 B：2C.4a 导航前保存最后相机

基线 `b2247dee71a415636232d85f31c846948d296353`，独立树 `/private/tmp/wiselink-perf-b-graph-return-20260923`。Canvas 提供脱离内部可变 pan 对象的当前相机读取；View 在打开 Wiki、原文/目标、过程、证据或时间线前同步采集相机并交给上层，切换视角前也保存离开的镜头。平时仍按帧发布，未改为每个 pan/zoom 都触发 React 更新。Page 收到导航边界通知时直接 replace 当前历史项，避免延迟320ms的保存被卸载取消；目标页的精确返回链接与浏览器后退都可恢复最后相机。

两个实际消费者反例在基线失败：View 未收到 RAF 回调就打开 Wiki 使用旧镜头；Page 导航前只有相机变化时，精确返回链接虽然新鲜，浏览器后退仍得到旧镜头。新测试分别覆盖两处，并验证读取相机为独立副本、视角切换保存。此批不宣称跨页恢复拖动节点布局、所有外部退出或真实浏览器p95已完成；后续继续这些要求，不关闭完整Goal。

验证：8 suites/71 tests、client typecheck、三个生产文件 ESLint、client build（13.46s，既有 module/chunk 警告）通过。现有 ESLint 配置不覆盖 test 目录，不将其记为 lint 通过。提交使用正常 precommit。


## 2026-09-23 B：2C.4b 会话内几何恢复

基线 `8de759fb9a3b2b3630370fa537e3fbe3e9dcdbfd`，独立树 `/private/tmp/wiselink-perf-b-graph-layout-20260923`。导航/视角切换前保存节点ID、当前坐标/宽高及声明的基准几何；URL只带随机引用，业务正文与权限结果不在缓存。范围绑定当前sessionGeneration、matterId、实际matterWorkRevisionId、视角、布局、密度、分页、有效隐藏组及关系模式。返回仍先获取当前授权图谱，只恢复现存且基准坐标/尺寸兼容的新节点，异步后到的节点也可按同样规则恢复；显式reset保留默认布局行为，不反复覆盖用户后续拖动。

缓存限8条、每条512节点及256KiB序列化几何、总1MiB序列化几何（不是整个JS堆的精确大小），30分钟有效期；读取命中调整淘汰顺序，不延长有效期。过期条目在读取/保存时清理；会话变更或未认证时重新进入图谱清空。浏览器刷新/淘汰/过期/范围不匹配采用正常布局，镜头等原URL状态继续独立处理。不支持跨浏览器持久布局。变化生成新UUID引用，不覆盖旧历史快照；相同范围/几何允许保留同一引用。有限快照不替代授权或业务SourceRef。

直接反例：旧View打开Wiki未保存任何layoutSnapshot，新View导航→返回挂载能取回几何；切换实际工作scope拒绝旧快照。真实Cytoscape remount恢复拖动坐标，reset回到默认；测试还涵盖脱离副本、迟到节点/已存节点不覆盖、基准不兼容、会话/拒绝清空、30分钟过期、条数/字节限制、不可变历史、返回引用过滤。6套54项、client typecheck、5生产文件ESLint、client build14.15s通过；test目录不在现有ESLint覆盖内，未将其记为lint通过。仍需真实用户链路与p95，不将此批等同于全部2C完成。

前批验收回读：Luna已独立通过b2247dee7（6套57项、真实Cytoscape边界探针）与8de759fb9（8套71项、类型/lint/build/precommit）。A当前准确HEAD为0c350f04c2da8f6e2257689092bf8b312497d342，本地验收通过；A未新增source plan/原件缓存或全局公平调度，后续B 3B不得缓存权限判定或弱化其恢复fresh授权/未知模型结果拒绝重放边界。仍待主控统一集成与真实Hosted流程验证。


## 2026-09-23 B：2B.2 原件会话复用

基线 `d0829db9c1b81560622210f3e37c1a988227dd78`，独立树 `/private/tmp/wiselink-perf-b-original-reuse-20260923`。主控确认B拥有原件API/Host原件service-controller/URL utility区域；canonical-host.ts含A的assessment-work修改，主控组合时只合并本批原件函数，不整文件覆盖。

测量先行：实际React原件预览链、合成8MiB Blob、相同DV三次打开/卸载。基线 `/private/tmp/wiselink-original-reuse-before.log` 验证3次完整下载、24MiB、创建/撤销URL各3；新实现相同流程1次完整下载8MiB、2次新identity请求，URL仍各3。不把synthetic PDF或mock网络当真实业务/浏览器p95；真实收益还要计算每次新授权网络请求耗时和首次暖命中的SHA-256计算/临时ArrayBuffer成本。

Host新增GET original-identity（private,no-store），原登录/平台入口guard保持；前后两次DOCUMENT_READ授权，tenant限定读取精确DV登记并核对version/source sha与length一致，仅返回DV/sha/length。它证明本次授权和登记身份，不读取对象存储，不能证明当前对象仍可下载。首次/缓存不匹配的完整GET仍走原有实际字节sha/length/provider身份校验。浏览器按sessionGeneration+DV留存Blob；每次暖读取都重新请求identity，首次暖命中对实际Blob算SHA-256（同Blob并发只共享hash，不共享权限结果），sha/length均匹配才使用。拒绝、请求故障或会话失效不返回旧字节；摘要/长度改变淘汰并重新完整读取。

边界：缓存最多4份、单份16MiB、总Blob字节32MiB、5分钟固定TTL，计时器主动删除并在空缓存注销session监听；身份变更立即清空。最多两次读取/校验/哈希在途，排队可被取消，旧generation出队拒绝。超限文件保留原本直接读取能力但不驻留缓存。32MiB是本模块持有Blob字节上限，不代表浏览器总堆/PDF.js解码/活跃组件URL/临时hash buffer；对象URL始终由组件创建并在卸载/换版/身份失效时撤销，缓存淘汰不提前撤销活跃组件URL。

验证：4套117项（original-memory、original-canvas-preparation、metadata-enrichment、canonical-host-client）通过；另补并发hash共享但授权独立测试。覆盖撤权/503拒绝旧bytes、digest/length变化、DV/session隔离、计时器过期、数量/总字节/单文件限制、最多2次在途与排队取消、迟到结果拒绝、真实组件三次开关URL平衡、Host二次授权与不读存储。双端typecheck、5生产文件ESLint、build:prod通过（client13.11s，既有module/chunk警告；构建不是实际OCR/Hosted运行）。test目录不纳入现有ESLint配置。必须组合部署新Host identity端点与对应前端；未实现旧Host端点缺失时绕过授权的缓存回退。

前批d0829db9c独立验收已通过。计数澄清：B的6/54集合含matter-graph-page/graph-route，Luna的6/63集合用appearance/presentation替换这两套，属于并列补充证据而非计数过时；Luna已明确更正，不重复门禁。


## 2026-09-23 主控：A/B 固定集成与独立组合验收

独立分支 `codex/integration-ab-20260923`，A 父 `0c350f04c2da8f6e2257689092bf8b312497d342`，B 合并父 `ff46e1d98a96664b522277134c52bc1da2d21bb7`。另纳入 `aac9bd64ee80fb9a967d64c05aed120b42c12350` 的产品及测试修复；两处文档冲突保留双方历史并在 CURRENT_TASK 标明当前集成状态。产品共享 API/consumer 自动合并，随后执行组合验证。最终提交 SHA 以本分支 Git 为准。

A 专属 Luna：组合 consumer Node 84/84；staged 快照 Jest 5 suites/135 tests；server/client typecheck 通过。覆盖 WorkItem 恢复与 Document 当前语义依赖、原件身份/授权 API 和 A AbortSignal、JobAid 一致性快照与轮询。
B 专属 Luna：合并树 Jest 16 suites/203 tests，server/client typecheck、生产 TS/TSX ESLint、build:prod、precommit 通过；client build 13.81s，仅既有 warnings。两组测试有交集，不相加为去重总数。
42 个 staged 路径，cached/working diff-check 通过，无未暂存源码变化。node_modules 为 B 验收复用已有依赖的未跟踪链接，不纳入提交。文档补记后执行正常提交钩子，未改变已测试产品源码。
尚未 push、Host release 或 Skill install；未验证真实 PostgreSQL 并发、Hosted UI、模型流程、浏览器 heap 或线上 p95。部署顺序：兼容 Host 先行，再安装该精确组合版本的 Skill，并核对实际文件哈希。B 后续 d051d278 及 2D.1 不在此固定截点。
## 2026-09-23 B：3A.4 活动控制与来源权限

基线 `ff46e1d98a96664b522277134c52bc1da2d21bb7`，独立树 `/private/tmp/wiselink-perf-b-activity-control-20260923`。实际发现Activity所有动作在分派前load原文/semantic，导致状态、心跳、取消也受文件服务失败影响。控制操作改为服务范围+actor/RLS读取run后fresh parsing.status复核普通来源ACL/catalog，再执行生命周期动作；不加载原文字节、semantic map或plan。BEGIN及READ/SAVE继续精确原文和manifest/parseRevision完整性路径。成功控制只证明任务控制权限，不证明历史原文当前可下载或字节完整。

同时核对ConfiguredDevelopmentCanonicalServiceScopeAuthorization：authorizeDocumentWork仅配置允许列表与actor绑定，文档明确每次仍需普通来源权限。既有Reading除STATUS外的CANCEL/CLAIM/HEARTBEAT/FAIL未复核这一权限；本批补齐轻量parsing.status，来源撤权后不能修改任务，lease/fence/事务不变。

Activity STATUS在来源授权后调用已有expire（仅QUEUED/RUNNING且deadline已过），再读取最新持久状态；已保存/取消的并发结果不会被该SQL覆盖。防止只轮询未知结果的消费者一直看到过期RUNNING，没有触发新的模型请求或重放未知结果。

反例：新控制/撤权/截止时间测试在基线15失败18通过；修复后2套33项全通过，覆盖五类Activity控制零original/semantic读、fresh ACL、拒绝后零控制写、READ/SAVE原文失败、fresh状态回读及Reading普通来源权限。server types/两个生产文件ESLint/server build通过。额外实际Host Runtime+MCP+本地构造模型服务互通2项通过；该夹具原先漏注入已存在documentReading服务，在到达业务动作前工具目录校验失败，已补齐测试依赖并给未来deadline fixture补expire。未改生产MCP工具清单或模型契约，未调用真实模型/生产平台。构建仅静态运行资产检查，不是Hosted运行验收。

前批ff46e1d98原件复用已获Luna独立4套118项（含新增并发hash项）、controller4项、双端types、生产lint/build/precommit通过；真实授权网络延迟、浏览器heap/p95仍未取得。主控当前已回读为idle且尚未提供新集成/发布证据，已请求安排统一集成及授权预览样本，B继续独立2D/3B工作。


## 2026-09-23 B：2D.1 已保存活动/解读窄读

基线 `d051d2781010ec0d5ef2cc8bf3acc7ab13864903`，独立树 `/private/tmp/wiselink-perf-b-saved-reading-20260923`。实际热点是Activity/Reading readForBrowser即使只展示已保存结果也loadPublished下载整个original，再读semantic map。此批仅改变这两个浏览器结果路径：先fresh普通源ACL与tenant目录读取，按准确parseRunId读取PUBLISHED/VERIFIED MANIFEST登记，并核对DV/tenant/document/family/sourceArtifact/sha/byteLength绑定，再读完整saved JSON并严格比对其original binding/指定candidate或reading revision。语义查询用readReady的可选精确revision，JOIN已发布parse/manifest/parseRevision，不把历史请求替换为最新语义版本。最后保持普通来源权限复核，完整保存正文不裁剪、不改写、不代替新生成结果。

边界：inspectPublishedIdentity及semantic readReady证明当前授权、持久登记关系；不下载对象、不证明当前对象存储可用或重新验证原文字节/semantic map内容。已有写入/保存验证与数据库版本约束保持。BEGIN/实际READ/SAVE/原文交付仍走原有实际bytes、semantic与manifest完整性校验。空候选也返回准确原件binding；不同工作/parse/source/semantic版本不回落当前版本。

反例及验证：两个实际runtime browser反例在旧实现因STORAGE_UNAVAILABLE失败；新实现完整返回构造的长正文且original/semantic hydration计数均0，来源撤权、不同parse binding、缺失精确semantic仍拒绝。新增published identity服务测试覆盖双ACL、精确历史parse、tenant/状态/manifest/source摘要/字节/artifact/family不一致。最终5套59项（activity-runtime、reading-runtime、published-identity、source-idle、translation-runtime）通过，server types/5生产文件ESLint（两条既有unused-disable warning，无error）/server build通过。

实际PG证据：新建仅本轮独立实例 `/private/tmp/wiselink-saved-reading-pg.0a77go3j`，loopback63135、专用wiselink_document_attempt_test；运行扩展的document-translation-attempt-postgres.test.mjs 1/1通过，历史semanticRevision=1与latest=2明确区分，缺失revision返回null、0拒绝，同时保留真实JOIN/RLS/非owner NOSUPERUSER NOBYPASSRLS角色和CHECK/immutable策略检查。日志 `/private/tmp/wiselink-saved-reading-pg.log`。实例已fast stop并仅删除创建目录，没有访问共享/生产库。该结果不是线上浏览器p95。

协作更新：Luna已独立通过3A.4 d051d2781。主控已创建AB集成树，Luna对HEAD0c350f04/MERGE_HEADff46e1d9的41个staged路径组合16套203项、双端types/lint/build/precommit通过；仍未回报实际发布SHA/授权预览样本。本2D.1不修改或阻塞该固定截点。

后续只读回读：集成树HEAD已为e812421cb050aed0954ca3f6945159100155a301，tracked clean仅node_modules链接；这是集成提交证据，尚不代表Host发布或授权样本验收。


## 2026-09-23 B：3B.1 单执行解析复用与有限连续推进

基线 `396ad7e8184718753166502dc06ffad9fcc2a023`，独立树 `/private/tmp/wiselink-perf-b-parse-execution-20260923`。改变范围是解析executeStep与PDF页提取，不触及A/WorkItem或共享consumer。25页构造执行样本，基线4次原件readSelection、4次独立PDF页提取生命周期、插件1次；新实现2次原件readSelection、2次PDF session打开/销毁、4个8页以内页组、插件仍1次。丢失第一次page upload进度回执时，原件读取5→3；已保存页组恢复，不重复提取0页组。该计数来自实际service加隔离存储/插件/PDF mock，真实PDF.js的生命周期与文本/图像/跨页内容另由Node测试核验；不是生产I/O时间或p95。

同一executeStep只取得并核验一次原件字节/sha/length/provider绑定，惰性打开一次PDF，最多两个8页组；每组先fresh普通来源ACL与lease检查，页内保留检查，保存时原有事务/CAS不变。第二组只有从executeStep入口算起未超过10秒且源字节≤16MiB才继续。每组立即持久保存，最终组装前释放PDF；所有异常/返回均释放，下一请求重新取得、验证原件并检查新lease，不保留跨请求原件/PDF/权限缓存。恢复到已存在页组不打开PDF，复用旧parse revision的原始页面不新增解析插件调用。

限制：10秒是页组间继续预算，不是抢占正在运行的插件/文件服务/PDF单页的硬截止；现有租约仍决定有效性。16MiB限制仅决定是否多处理一组，不是Node/PDF解码总堆上限，大原件保留既有每次一组能力。额外只多驻留一个有限页组，不新建并发执行器。跨任务调度/浏览器真实竞争、公平性和来源plan复用仍待后续完成，不把本批称作全部3B闭合。

验证：两条新“第二轮应发布”反例在旧实现均失败；额外旧实现读数断言证实无丢失回执4读、丢失回执5读。新5套38项（execute、store、compose、layout、official-plugin）通过：最多两组、预算耗尽/大原件让出、组间撤权/租约失效、提取失败后只恢复未保存范围、provider漂移拒绝、parse revision复用/旧manifest不改。真实PDF.js Node5项通过：Hosted裁剪依赖加载、图像操作标记、跨页表格、同一session连续读取、关闭后拒绝、再次读取fresh授权和调用者bytes不被转移。server typecheck、2生产文件ESLint、server build通过；构建标记STATIC_VALIDATION_ONLY_NON_TARGET_BUILD/onlineMutationPerformed:false。测试目录不在ESLint覆盖内。

发现并修正同一个Node测试里的旧夹具：它用两行普通PDF文字宣称有列结构，与当前compose“必须有实际物理列对齐证据”不符；在基线同样2≠1失败。改为jsPDF逐格绘制有对齐坐标的真实两页表格，仍要求全部四行/每个单元格/两个来源页，定位精度验证改为实际TEXT_ITEM及非空box。生产compose未修改，未削弱表格证据规则。

协作：Luna已独立验收396ad7e81（5套59项、types/lint/build/precommit）；其PG说明明确只读实现者日志、不算第二次实际PG运行。主控固定e812集成发布切点不受本批影响；尚未收到新的实际Host/Hosted Skill版本及正常身份业务样本证据。Goal保持active。


## 2026-09-23 B：3B.2 JobAid单执行来源plan复用

基线 `70ad48ea9f1ba0fb73d0ddd1c428ebbbfc631489`，独立树 `/private/tmp/wiselink-perf-b-source-plan-20260923`。A明确确认工程原文helper及JobAid buildInput分页循环无在途修改，允许B单写者推进；B只改service该循环和import，不覆盖A b10e6e570知识观察或租约/活动/恢复区域。

反例来自实际JobAid begin和真实plan构建，文件/工作/权限服务使用隔离fixture：61个源单元按20分页，原先准备阶段重建plan4次；begin返回前assertSourcesAuthorized另一次fresh原件读取/plan验证，总5次。新实现执行内prepareDocumentOriginalEngineeringReader一次构建plan和coverage，组织unit/ref/finding/locator索引；原文quote按选中SourceRef惰性拼接一次，保留该ref跨页所有anchor，不截短table/例外。JobAid四页共用该局部reader；begin返回前的fresh原件/来源复核仍另做一次，总plan5→2、原件读取保持2次。既有单页调用保留包装入口，每次独立准备，不引入跨请求缓存或缓存授权结果。

reader只属于已完整验证的不可变原件这一次准备，普通源/semantic/manifest绑定及actor边界由原有真实读取链继续执行。不同请求、parse/source/semanticRevision分别准备；不把同parseId当跨请求复用许可。预计算的coverage对每个返回值复制，evidence每次新建，调用者修改返回对象不污染后续页；完整SourceRef引用和原有源顺序保持。未修改模型调用、checkpoint/lease、未知结果重放或正式采用。该批未优化独立assertSourcesAuthorized内部多ref扫描，也未声称所有来源消费者/公平调度完成。

验证：旧实现新入口反例实际5次plan（期望优化后2），修复后完整任务sourceCatalog仍是61个单元的完整合并原文，不少末尾条件。3套41项（engineering-reading 7、JobAid continuation 30、source-idle 4）通过，包括单reader plan/coverage各1、长文/表格/跨页同ref、selected findings、可变返回副本、不同原文内容/semanticRevision隔离、错binding拒绝、实际begin二次fresh读取、续接原件变更与撤权拒绝。server typecheck、2生产文件ESLint、server build通过；构建仍是静态资产校验，未触发线上模型/业务。没有线上p95或堆采样结论。

协作：前批70ad48ea9已获Luna独立5套38项/实际PDF.js5项及types/lint/build/precommit验收，可供主控选择性集成。完整Goal继续active，仍需跨任务竞争、其余阅读热点、通用图谱退出及真实资料库→Wiki→图谱→原文→返回→历史/最终部署证据。


## 2026-09-23 B：首次正常身份V/R与真实PDF目标页修复

主控回读Host app_17bzc551rsg release7688408024273652704 status=finished、commit_id=e812421cb050aed0954ca3f6945159100155a301、error_logs=[]。主控授权正常身份只读现有已保存样本，Hosted Skill新包尚未安装。B自建IAB tab现场已有正常登录、资料库11文档，打开既有5页FTD解析版本2：完整结构化原文、表格和作者目录可读；中文已有部分结果21%并明确DEADLINE_EXPIRED，未重生成或制造样本，未发起模型/正式采用。样本ID和安全过滤后的数字在本机/private/tmp/wiselink-vr-readonly-evidence-20260923.json；公共文档不复制业务原文/认证头。

单次实际网络观测：translation-reading 200，headers1481.28ms，总网络1580.362ms、encoded21206bytes；original 200，headers1680.954ms，总网络2079.863ms、encoded122810bytes。它们是正文/原件读取单样本，不是暖轻量API或热正文p95；自动化工具曾超时但现场页面已完成，工具墙钟时间不算页面延迟。全链/Wiki/图谱及采样分布尚未完成。

真实缺陷：第5页来源选择后外层显示5，但原件工具栏4/5且实际显示上一页。DOM证据：容器高760px，已渲染页514px；第一次目标页距顶部500px，手动再输入5仍因最大scrollTop1854而停在目标页上方240px，阅读线落在第4页。根因是一次性定位发生在canvas异步尺寸稳定前，且短末页没有足够末端滚动空间。

独立修复基线6f77d9456，树/private/tmp/wiselink-perf-b-pdf-target-20260923：PdfDocumentViewer为明确导航请求接入局部followPdfPageTarget；观察容器/页frame尺寸并按RAF合并重定位，已可滚动容器按末页实际高度补足尾部空间。用户wheel/touch/pointer/翻页键即接管滚动并断开目标跟随；新明确来源请求才重新跟随，隐藏/卸载断开observer/listener/RAF。没有重新请求原件、换SourceRef或缓存权限。只在可滚动容器加尾空间，避免auto-height容器反馈增长。

实际React组件回归先在旧实现2失败1通过；修复后新增中间页异步尺寸项，4项通过。输入模块仅为测试编译Vite worker URL/import.meta，PDF获取隔离，运行真实React viewer与控制的DOM几何；现有结构化workspace测试中两项源码字面scroll实现断言迁到此行为测试，不降低页面定位要求。相关5套共25项通过（首轮4套通过/一个旧字面断言失败，移除失效实现拼写断言后该套3项复跑通过），client types、2生产文件ESLint、client build14.99s通过。

真实浏览器对照：本轮自建loopback63217静态夹具，五页合成PDF、真实pdf.js/worker、实际Viewer与CSS，仅未走的Host API及本地CSRF依赖stub。旧模块目标5却工具栏4、targetTop500.875px、scrollTop1570；恢复修复模块后工具栏5、targetTop-0.25px、scrollTop2044、尾空间251px（容器760/末页515），截图确认实页5。局部静态服务已通过其运行句柄正常中断退出，本地tab已关闭；不是在生产页注入修复。线上e812仍需主控集成发布后复验。

协作：6f77d9456的3套41项/types/lint/build/precommit已获Luna独立验收。消费者公平性本轮只读定位，尚未改consumer；V/R给出新实际失败后优先修复该失败。完整Goal保持active。


## 2026-09-23 B：正常身份知识→图谱→来源→保存工作回查

在主控报告已发布的 e812 上只读核验：知识页准确 ENGINEERING_MATTER/subjectId/workRef 已显示保存工作，但侧栏关系图谱 href 是裸 /graph；点击后默认解析为另一事项。顶部“打开图谱与自动演示”另属 Atlas，不具备精确保存工作入口，事项视图未接线提示不等于正式 Suite 图谱失败。A已按e812确认正式入口是 /graph?matterId=M&workRef=W，且其准确工作读取/校验已接入；主控和A确认B本批Sidebar范围无并发修改。

独立树从e5dd起点最小修改Sidebar：/knowledge已有完整知识身份时复用knowledgeReadingIdentity，事项工作映射到matterId+workRef；不带知识选择的默认入口保持。重复/空/未知/缺失身份及混入其他对象pin显式阻断，不调用默认事项目录修复。WORK_ITEM保存版本保留workItemId+workRef，由现有dispatcher显式拒绝不支持的精确历史入口；本批未猜测JAWR到事项MWREV映射，也不声称该产品入口已可用。没有额外事项读取、后端权限变更或内容缓存。

实际Sidebar组件反例：修复前9失败/13通过，修复后相关3套35项全部通过（sidebar-global-nav、shell-url-identity、app-shell-navigation）。测试仅隔离无关品牌SVG组件的Vite import.meta，Sidebar与路由/链接真实渲染。初始测试编译曾暴露此既有mock缺口及本批union narrowing问题，已分别修正后重新获得有效红绿结果。client types、生产Sidebar ESLint、client build13.65s通过。不是把静态字符串或自动化工具耗时当线上性能。

实际业务只读补证：使用页面已显示的同一M/W及已核实正式路由进入，Suite图谱加载对应保存工作；确切原文入口打开该事项登记主文件，该文件当前无已发布解析，未重解析。返回关系图谱保留相同M/W、layoutSnapshot、viewport zoom/pan参数并重新显示图谱；未做像素/返回p95计量。图谱时间节点“保存工作修订16”打开同一保存Wiki，再通过其原有“工作修订14”链接打开历史版本，页面明确显示正在阅读指定修订14且不替换最新工作。此处主文件缺少解析，不能计为该样本的目标页阅读已通过；前批5页PDF证据属另一既有样本。

网络只记匿名计量：此前工程知识catalogue单次响应头5270.617ms、catalogue/work1508.353ms。此次保存工作回查窗口中事项metadata 200 headers1328.567ms/total1330.135ms/2687B；working 200 headers1915.401ms/total1992.366ms/29807B；精确working/W 200 headers1473.856ms/total1542.370ms/30955B。中间浏览器事件缓冲曾过期，未恢复的数据不补造；新窗口明确未截断。排除外部telemetry，不计为暖后端p95。具体样本ID仅留本机/tmp证据JSON，不提交来源正文或认证信息。

Luna已独立接受e5dd PDF修复5套25项、types/lint/build/precommit。本批仍待独立验收和主控集成发布；必须在最终部署后重新点击知识侧栏确认，不能用手动准确路由替代已修复上线证据。完整Goal继续active。


## 2026-09-23 B：2D 保存工作历史成员授权有界并发

真实热点继续存在：同一正常登录会话显式重载工程知识，catalogue 200 headers5405.168ms/total5405.496ms/3261B，catalogue/work 200 headers5108.373ms/total5225.923ms/27513B；该缓冲窗口标记截断，但两条请求均有response+finish，只报告这两条完整样本、不推断其他请求。再次重载完整未截断窗口：catalogue 200 headers3943.824ms/total3944.157ms/3236B，catalogue/work 200 headers3295.797ms/total3361.144ms/27575B。无效空采样未计入。页面重载样本不等于热React正文返回，也没有得到服务端trace或资源规格，因此不能把总网络耗时归因于某个SQL或宣称p95。

主控和A明确无engineering-matter-working.service.ts在途写入。B从287ddd668建独立树，定位readWorkingRevision中current成员检查之后历史成员逐一串行requireInput。只将已去重的历史member列表按4个一组Promise.allSettled读取；每组完成后按原顺序传播首个错误，拒绝后不启动下一组。不跳过与current重合成员，不缓存权限，不更改authorizedMatter的snapshot重核/原件绑定、仓库readByRef完整来源/血缘核验、tenant/actor或exact workRef语义。这是每次精确读取的局部并发上限，不是全系统调度或全局数据库并发上限。

实际服务反例使用真实requireInput依赖路径和可控授权延迟：2个current+9个saved唯一member，每个freshRead20ms；原实现200ms，修复80ms（1组current+3组历史），历史最大并发4，fresh调用仍11次；第二次请求重新检查全部11次。另一反例历史被移除成员拒绝时等待该组其余读结束，active=0才返回，下一组不启动。current拒绝时不读取保存body，确切历史缺失不回退current。旧版2失败/5通过，修复相关3套53项通过（engineering-matter-working.service、engineering-issue-search、engineering-matter-working-state），server types、生产service ESLint、server build通过。

本批不能单独解释或解决线上4–5秒：仓库完整授权/血缘和数据库路径仍需继续证据定位；没有生产trace不能宣称某个查询是主要瓶颈。Luna已接受上一批287ddd668的3套35项/types/lint/build/precommit。本批待独立验收、主控集成及实际重复采样；Goal保持active。

## 2026-09-23 主控第二批组合验收

固定e812基线 + B c58eb5c08164da72cdbb33ffde49fd059317174f + A b10e6e570744169c5c057a806ccad2637414eab1精确增量，产品自动合并无冲突。A专属Luna在staged快照跑6套75项通过；B专属Luna在组合树跑13套151项、Node runtime/PDF 6项通过（独立PG测试未配置URL而skip，不计实际PG验收），双端typecheck、生产源码ESLint、client/server build、precommit通过。两个集合有交集，不相加为去重数量。

接受时35个staged路径，随后主控新增M_INTEGRATION当前状态与本段记录，最终36路径。额外变化仅文档，无产品修改；正常提交钩子继续执行。后续77ae及新consumer不加入。未将本地测试当作部署后点击或线上p95验收。Git/发布结果以本次实际回执为准。

## 2026-09-23 B：2D 总体更正提示元数据批量读取

在已观测秒级保存工作读取路径继续定向定位，engineering-matter-working.repository authorizedReadModel对每一overviewCorrection单独查询该actionAttempt的最新保存workRef/revision。已有真实历史页出现多条更正，现有隔离PG来源血缘fixture可直接复现N+1；没有把这个局部往返数声称为线上主要耗时或p95。

主控确认该repository无在途修改。独立树从c58eb5c08起点，只将此元数据查询改为按actionAttemptId DISTINCT ON一次读取、workingRevision降序取最新；tenantId/matterId/createdByUserId和attempt集合过滤原样保留。matterId+workingRevision已有唯一约束，排序不存在同事项同revision平局。notice仍按原overviewCorrections顺序填充；无对应保存保持null，FINISH状态不冒充保存，无notice不发查询。没有读取全部正文、截短内容、改变来源血缘/actor RLS或添加跨请求缓存。

真实PostgreSQL14.17独立实例127.0.0.1:55439、唯一测试库wiselink_engineering_matter_test：既有cross Matter references fixture加入Drizzle匿名计数（只计元数据查询数，不记录SQL参数）。原实现3次≠期望1产生有效红例，修复后1次通过。扩展同一更正attempt保存两版后FAILED，验证最新第三修订仍可见；旧工作只纳入不晚于该版本的更正目标，未保存/失败仍null；零notice查询0次；保留原fixture对来源事项/原始文档撤权、跨事项血缘完整性的拒绝验证。原fixture首轮因历史缺失headline/listBrief而无法通过当前业务schema，补入明确合成摘要后才获得有效红绿证据，未降低生产校验。

最终实际PG测试1/1通过、0跳过；相关Jest3套35项（engineering-matter-correction-save-projection、matter-work-reference、engineering-issue-search）通过，server types、生产repository ESLint、server build通过。日志/private/tmp/wiselink-correction-read-{red,pg,tests,types,lint,build}.log。initdb首次因沙箱共享内存限制失败，获准在沙箱外初始化同一空隔离目录后完成；测试后pg_ctl确认stopped，测试目录已删除，无生产数据库连接或修改。

Luna已独立接受c58eb5c08的3套53项/types/lint/build/precommit。本批待独立验收与主控集成发布。仍缺最终线上复验、服务端trace/资源数据、热正文/图谱返回/暖API分布及后台竞争证据，完整Goal保持active。


## 2026-09-23 B：3B 文档明确发布后的有界接续

实际消费者反例：consumeHostedDocument收到唯一parse STEP的明确PUBLISHED后直接返回，INDEX/独立中文需要额外一次native调度唤醒。不是Host能力不足，也不必新增队列或调度器。主控及A确认B下半document消费者单写者，上半A WorkItem/JobAid恢复逻辑未修改。

本批从77ae建独立树，把既有published分支原样抽成advancePublishedDocument供两条路径使用。一个tick仍最多一个parse STEP，只有明确PUBLISHED且elapsed<10s才fresh STATUS；同一documentVersionId/parseRun仍PUBLISHED、没有新activity/reading待办并再次检查elapsed<10s，才接续原INDEX/translation分支一次。状态/parse改变、无run或预算耗尽保留已发布回执并交还下一tick；wrong document/非法run身份抛错，未知STEP/recheck失败不重试。已有语义ready门槛、独立索引失败报告、翻译START/STEP恢复与admission checkpoint保持。没有增加模型/新BEGIN，未安装或运行真实任务。

直接反例原实现3失败/15通过；修复document/activity/reading三个Node文件86项通过，上半WorkItem单独17项通过，共103项；覆盖同tick接续、新parse/状态/新待办让出、STEP或recheck跨过10s边界、未知STEP/recheck、错误scope，原published语义与恢复集合通过。node --check、消费者ESLint通过；纯消费者JS变动未重复构建未改的Host。10秒是接续启动预算，不是硬中断或已开始操作的总时长上限；局部消除一轮固定等待不等于证明跨任务公平性、native cron并发配置或真实竞争性能。

主控已实际建立/private/tmp/wiselink-integration-ab2-20260923、固定e812+MERGE_HEAD c58eb5c08+A b10，共35staged文件，组合独立验收进行中，尚无新release事实；77ae及本批明确留下一批。旧e812配套Hosted Skill安装仍未闭合，不能把consumer测试当线上持续工作完成。完整Goal保持active。


## 2026-09-23 B：2D 知识目录及精确保存正文共享阅读资源

真实e812同一SPA会话knowledge→library→knowledge（无reload）仍重新请求catalogue 200 headers2845.869ms/total2846.250ms/3254B，再请求work 200 headers1413.028ms/total1796.929ms/27689B；网络窗口未截断。DOM读取前后heap used14,998,392→15,747,564B、nodes4092→4095、listeners783→782、documents均5；仅单次浏览器观测，未归一GC，不认定泄漏/峰值或p95。本机匿名记录仍在/private/tmp/wiselink-vr-readonly-evidence-20260923.json。

KnowledgeLookupPage原useEffect每次remount清空并请求，未使用既有共享Query资源。主控和A确认该页无在途；A纠正其历史hook曾改过，B只以当前树为准。新增useKnowledgeResources，复用现有QueryClient、ENGINEERING_MATTER_QUERY_ROOT及Layout session清除；useEngineeringMatter仅把现有identity hook/readMatterResource导出，行为不变。key含app/tenant/actor/session、目录query/scope/cursor或正文subjectKind/subjectId/workRef，沿用30s stale/5min GC。新鲜同身份返回复用完整正文/目录；过期或失效后的重新读取隐藏旧正文，拒绝结果替代旧数据并在新鲜窗口跨remount保留，显式重试可恢复；迟到响应、账户变化、精确历史不退current。source资料分支仍保留原读取流程，未扩大该分支改造。

这是已授权数据的有限阅读窗口，不授权新scope或Host操作；窗口内若没有session失效或新的读取，不保证立刻察觉远端撤权，与现有Matter阅读窗口一致。每次实际API读取仍由Host fresh授权，进入新identity key重新读取；没有另造QueryClient、持久化正文缓存或缓存权限授予决定。新鲜窗口过后返回会重新读取，session清除移除inactive知识资源。

实际页面反例旧1失败/12通过，修复4套48项通过（knowledge-catalogue-interactions、knowledge-reading-ui、matter-resource-reuse、reading-return-context）。两次新鲜路由访问的catalogue/work调用各2→1；覆盖stale刷新隐藏、403替换/返回不自动重试、显式恢复、历史ref区别、actor/tenant隔离、session清除、31秒过期重读、非法pin清除后默认选择，以及既有迟到/来源/滚动行为。测试为组件补实际QueryClientProvider，并在SSR/卸载后clear自有client；初轮SSR未clear导致等待GC的测试进程已正常中断，修订后最终测试正常退出，不用forceExit或改变生产gcTime。client types、3个生产文件ESLint、client build13.22s通过。

主控回报ab2 commit ef258aa7faba42277d38dec7584e41bb4be2ee55、origin/github同名分支准确SHA一致；release7688432648880098235 finished/同commit/error_logs=[]。该部署包括c58前序与A b10，不含77ae/fadf/本批。两Luna线上验收进行中，已证实侧栏图谱保留M/W，但主控转报“返回原阅读位置”按钮可能到裸/library；B已要求区分真实按钮与browser back，并将其作为独立下一修复。不能把进入成功或浏览器后退当完整往返完成。77ae/fadf已获独立验收，本批待审查/发布/实际热路径采样，Goal保持active。


## B 知识页经图谱的实际返回按钮（2026-09-23）

- 实际生产 ef258aa7 / release 7688432648880098235 的两位独立只读验收：知识 exact M/W → sidebar graph 保留修订16；实际“返回原阅读位置”按钮落到资料库（有时携带已有family），丢失知识阅读上下文。browser back成功不能代替按钮通过。样本私有身份只保留临时证据，不写入公开仓库。
- 同轮独立线上PDF证据：既有5页样本点击真实目标段落再读原件，工具栏5/5、实际第5页；手动向上滚动工具栏变3，用户可以接管。保存工作UI读取n=3为6395/4773/5655ms，仅单会话观测，不是服务端p95。
- 根因：Sidebar只传M/W；graph镜头persist重建query；通用TopBar只从matter路径而非graph query取得事项。修复以现有returnKnowledgeQuery传白名单知识参数，返回时强制nested ENGINEERING_MATTER + M/W与当前graph query一致；source reader原有document绑定不变。图谱persist、打开原文/时间轴/Wiki及返回保留该上下文，保留viewport/layoutSnapshot等原有镜头协议；不接受任意返回URL。
- malformed/duplicate/超长返回意图保留为明确拒绝，不因显示状态改写而降级猜测；知识参数next等未知字段不带回。返回上下文useMemo仅随返回意图改变，不因每次camera URL改变反复重建回调。
- 有效旧反例：Sidebar实际组件生成的graph链接缺少articleY等返回状态，1 failed/21 passed。修复后测试真正点击侧栏链接及TopBar返回按钮，恢复knowledge同M/W/articleY；另验camera persist→source→graph→knowledge、跨事项/跨修订、duplicate及混合绑定。5 suites/68 tests通过；client typecheck、5个production文件ESLint通过。早期交互fixture缺graph路由后的getMatter Promise，已补测试fixture，未改产品容错。
- 构建与提交检查见 `/private/tmp/wiselink-graph-return-build.log`、`/private/tmp/wiselink-graph-return-precommit.log`。本地验证不代表线上返回按钮已修复；待独立审查、Main集成发布及只读复验。完整Goal、真实p95、后台竞争及Hosted阶段4仍未闭合。


## B 原件复用真实只读证据与独立审查收敛（2026-09-23）

- 原件样本在ef258之后加载，采样跨越后续dc491任务目录修复发布：正常现有登录、同一已保存5页PDF，首次完整导航后测试（未直接捕获资源SHA，见下方准确边界）。切换“仅原文”仅隐藏保留PDF面板，不算unmount；本轮两次真正离开阅读器到library，再history back与显式打开原件。
- 三个完整CDP事件窗口均truncated=false/hasMore=false：首次original 200，响应头3006.571ms、完成14001.699ms、网络encodedDataLength122853；第二次只发original-identity 200，1333.164/1337.594ms、1651字节；第三次只发identity 200，约1045ms、1658字节。第三次response/finish原始时间戳相差-0.832ms，保留原数据但不作亚毫秒推论。网络字节含传输编码，不冒充原始PDF字节数。
- 结论限定：真实会话内两次复用均避免再次下载PDF，仍每次fresh identity授权核对；两次暖核对约1.0–1.3s，尚未满足500ms暖读取目标。n=3不是p95，未以工具壁钟充当渲染时间。
- Performance.getMetrics非强制GC：打开前used/total=14991852/16613376；首次隐藏保留17928552/19398656；第二次打开18281948/19988480；第三次20614960/26017792。Documents均5；Nodes1117→1186→1180→1193；listeners879→926→695→718。不同瞬间且自然GC不受控，仅作观测，不能证明泄漏或无泄漏。原始匿名摘要在`/private/tmp/wiselink-vr-readonly-evidence-20260923.json`，不提交正文、认证头或私有样本主键。
- 新缺口：未带sourceRef的普通段落第5页点击只更新workspace component state；实际离开与返回时回第1页。源码locateUnit只有setPage/setActiveUnitId，与此一致。需下一批将当前精确段落位置纳入受限阅读返回状态，保留来源/版本绑定，不能以已通过的“显式目标5正确渲染”掩盖普通退出位置丢失。
- Luna本地独立接受：e10fc616（24知识测试、client types、ESLint、diffcheck）与a7e41a5（36导航/返回测试、client types、ESLint、diffcheck）。实现者原4套48/5套68与独立子集分别保留，不伪称同集合复测。已请求Main按父子顺序集成并回传release；尚未线上验收新缓存或返回按钮。

- 最后真正卸载reader后停在资料库：heap used/total=19181488/26247168，Documents5/Nodes2295/listeners1201。资料库DOM与PDF页不同，不能将节点/监听器数直接相减认定泄漏；未强制GC。


## B 普通原文定位的路由返回修复（2026-09-23）

- 基线0d66，独立树`/private/tmp/wiselink-perf-b-reader-location-20260923`。实际来源为上一批正常身份第5页段落→资料库→history back回第1页；与PDF异步高度目标5错位到4是两个问题。
- workspace把用户真实选页/单元传给page；page仅从当前已授权读取结果的unit/sourceRef/location登记中选出该页的ref，将sourceRef与实际保存parseRunId写入当前URL（replace，保留所有已有返回上下文）。未知单元/未登记页不写入；多页单元不取第一ref猜测。已固定run的页内选段不重读body；无固定run首次选段显式固定保存run，会重新授权读取该run，不能继续把旧来源绑定到latest。
- 反例基线2 failed/15 passed；修复测试包含真实router离开/返回、最新published变更仍回旧run、保留returnLibraryQuery、页内不重读、无pin固定run、未知unit/未登记页不导航、多页unit明确选页、实际workspace回调。最终相关3套44项通过；client typecheck、2个production文件ESLint、client build（12.54s）、precommit与diffcheck通过。日志`/private/tmp/wiselink-reader-location-{red,tests,types,lint,build,precommit}.log`；只有既有React Router future-flag warnings，不代替线上验收。
- 范围：本批恢复明确点击的普通原文物理页/SourceRef；未声称任意自由滚动像素、TOC或纯PDF手动滚动位置已全部持久化，完整阅读性能目标仍未完成。

### 原件样本准确发布边界补记

Main回执：ef258 release7688432648880098235 finished updated_at=1790103060000；仅任务目录500兼容修复dc4915437dba7157406e6b18b1f51ed2ad7a83ea，release7688437914978126804 finished updated_at=1790104842000、error_logs=[]、双远端同名一致；不含77ae/fadf/e10/a7/0d66。PDF代码两版本一致。

既有CDP事件原始wallTime：首次original=1790104648.659391；第二identity=1790104858.009625；第三identity=1790104938.913739。首读早于dc491 finished，后两次晚于；三次间仅SPA导航没有刷新，因此前端资源不因后端发布自动换版。未直接捕获asset SHA或实际响应pod的二进制身份，不补造。三次同会话原件复用事实成立；不能把它标成单一ef258前后端环境的严格延迟对照。

## 2026-09-23 主控第三批组合接受

固定dc491基线合并B a88链，23个staged路径；产品自动合并，REPORT历史合并。A专属Luna：共享consumer132项、任务读取2套16项通过，jobaid-work.repository与已线上修复dc491逐字相同。组合扩展检查：前端6套82项、durable consumer19项、双端typecheck、改动生产lint/Node syntax、client build12.88s/server build通过。测试集合交叠不累计；工程元数据PG8项因无URL跳过，只保留此前实现者真实PG证据，不冒充本轮独立DB通过。

主控仅补写发布组合记录，不改通过验证的产品。新的626dcf6身份窄读不在此范围。Skill包含已接受fadf变化，技术Host发布不等于安装或真实消费者生效；安装仍需精确包/目录核对。线上图谱实际返回、知识warm复用、普通段落精确parse位置恢复需要部署后真实点击复验。

## B 原件身份端点只读投影收窄（2026-09-23）

- 基线a88，独立树`/private/tmp/wiselink-perf-b-original-identity-20260923`。真实warm identity两次约1.0–1.3s促成本次定位，但TTFB不能直接归因SQL。本批消除可证明不被消费的读取工作，不预报线上节省毫秒数。
- 旧调用链：fresh authorizer→readMetadataSource（version/family/source/metadata全列、metadata leftJoin与max revision子查询）→一致性核对→fresh authorizer。新增readOriginalRegistryIdentity只投影5列：version id/digest/length，source digest/length；仍通过原family canonicalIdentity tenant前缀与精确version过滤，并innerJoin原source。service仅此identity端点调用新方法，原件下载与metadata业务调用不变。
- 保留两次fresh actor/tenant authorization、未知来源404、version/source digest及length不一致409、读取中撤权拒绝；不缓存授权、不跳过source登记、不读取存储PDF、不触发parse/write，不改表/索引/RLS。
- 旧服务反例2 failed/31 passed；新服务+session byte reuse两套39项通过。新真实PostgreSQL隔离fixture 1/1通过，无skip：fixture故意没有metadata表，证明该endpoint不依赖metadata修订；实际一条SELECT返回5字段、tenant-1不读取tenant-10、反向隔离、missing version/source无结果、空tenant拒绝。该fixture证明SQL执行及tenant条件，不冒充生产RLS或生产延迟测量。
- PostgreSQL本地127.0.0.1:55439新建实例`/private/tmp/wiselink-original-identity-pg-20260923`已停止删除；只删除本批可丢弃数据目录，initdb/pg/test日志保留。未连接生产数据库。
- server typecheck与两production文件ESLint通过；build/precommit日志`/private/tmp/wiselink-original-identity-{build,precommit}.log`，测试日志`/private/tmp/wiselink-original-identity-{red,tests,pg-test}.log`。提交后交Luna独立审查，Main串行集成发布；线上500ms目标仍未证明。
- a88普通段落返回候选已获Luna独立22项与client types/lint/diffcheck接受；实现者3套44项/build/precommit证据另列，不混同独立覆盖。


## B 发布后知识热正文实际计量（2026-09-23，79bd）

- Main ab3 release7688444473504353246 finished / commit79bd2380615ff18582269cc3cd5d95f805261b87、两远端同SHA；含a88，不含626。B此后完整导航加载应用，观察到新sidebar带returnKnowledgeQuery；未直接捕获asset SHA，不作额外编造。
- 使用现有正常登录与同一保存修订16。真实点击sidebar资料库→工程知识，CDP isolated world中的临时click listener记录performance.now；MutationObserver仅在exact M/W URL、修订16标记、完整knowledge-prose且无preview status/alert时记DOM-ready，再记录两次RAF后的值。没有改产品代码、正文或业务数据；结束已disconnect/remove listener/delete测量对象，读回undefined。2RAF只代表帧机会，不等于物理GPU显示时刻。
- 全部49次尝试含探索数据保留在`KNOWLEDGE_HOT_READ_EVIDENCE_20260923.json`。最初探索两次的full navigation之后Network未重新enable，故不宣称零请求，也不纳入请求分类统计。
- 精确连续25次窗口输入epoch1790106647392.4至1790106665092.3ms；事件buffer无truncation/hasMore=false，全部ready、0timeout/0failure。第1次：catalogue200 3391ms/3164网络字节 + work200 2212ms/27807字节；DOM5633.9ms，2RAF5647.9ms，保留为过期重读。其余24次无knowledge catalogue/work请求，按实际请求时间归类而非剔除慢值。
- 24次新鲜窗口同保存版本：DOM p95（nearest rank）21.6ms、max31.2ms；2RAF p95 36.5ms、max36.6ms。这是单会话、小样本、具体热知识路径达到100ms目标的证据；不推广为全站或非缓存读取达标。过期重读5.65s及探索7–10.7s仍是待解决慢路径，未从原始样本删除。
- Main专属Luna负责本release的导航/普通段落功能复验，B本轮补计量，不以自身计量替代独立功能结果。A明确没有已核实获准在执行的job/subject窗口，旧cron/attempt不能当当前在途；Skill未安装，后台竞争与阶段4真实执行仍未闭合。2026-09-11原生并发8/4/8文档仅为历史快照，需Main回读当前配置与具体运行授权后验证公平性。

主控最小集成接受：79bd基线合并626及59791匿名记录，两个生产文件与已独立接受626完全一致。Luna在固定staged树复跑identity/sessionreuse两套39项通过，diff-check通过；PG本轮无环境变量跳过，不计为新PG证据。未重复未变产品的全仓gate。发布结果以随后精确release回执为准，未预报性能。

## B 图谱返回实际计量与 ab3 独立验收（2026-09-23）

- 部署沿用 Main ab3 79bd2380615ff18582269cc3cd5d95f805261b87 / release7688444473504353246；已有正常登录，同保存修订16，实际 graph→Wiki→TopBar「返回关系图谱」。未新建解析、翻译、评估或模型任务。
- 匿名26次完整DOM结果见 GRAPH_RETURN_EVIDENCE_20260923.json。上轮工具8次批处理超过30秒后内核重置，恢复6次已完成结果；本轮另20次，未删除慢值或失败。20次DOM-ready p95 24.5ms/max25.1ms；两RAF p95 38.8ms/max39.3ms，nearest-rank。每次exact M/W、layoutSnapshot、修订16、17 overlays、3个非空canvas、82%镜头且无graph alert；overlay位置字符串全部相同。
- 该指标证明具体已保存图谱恢复满足200ms目标；两RAF不是GPU像素完成，也不表示后台刷新/授权已完成。保留旧数据的后台刷新发生在其后，不能将本结果用作500ms暖后端目标或新授权读取达标证据。未覆盖冷启动、大图、所有退出路径、用户连续拖动及真实模型竞争。
- 网络事件buffer窗口开头被淘汰（truncated=true、cursor1054、最早保留sequence55），不宣称整窗零请求或完整请求总数。留存业务请求全部200：19个parsing状态读601.8–1894.1ms；5个matter读1191.5–1990.7ms；5个working读2060.1–3071.7ms。实际后台重复状态读取仍是候选热点，不能因前景快速恢复而隐去。
- 临时isolated-world observer、capture click listener已移除，测量对象读回undefined；没有持久产品埋点或业务状态修改。
- Luna独立ab3线上功能回执：知识→侧栏图谱保留同M/W与修订16；实际TopBar「返回工程知识」恢复精确知识上下文；普通已登记段落u112的实际第5页→资料库→browser back保留同parse/sourceRef/page5。显式reload 3次6582/6185/7709ms，median6582ms，仅功能/耗时观察，不冒充p95或请求计数。a7/a88已部署功能缺口由此闭合；自由像素/TOC/纯PDF滚动仍不在其声明范围。
- 626dcf6原件identity窄投影已获Luna独立服务33项/types/lint/build接受；真实PG1/1仍是B证据，Luna未复跑。Main本轮确认正在集成626与59791；在确切发布回执前不声称生效。Main/A正在核实现行Hosted官方操作入口与历史已授权范围；没有已核实可供B观察的当前job，状态未知不撤销历史授权、不等同必需新授权。


## B 图谱来源读取的会话内复用（2026-09-23）

- 基线509098d23，独立树`/private/tmp/wiselink-perf-b-graph-source-reuse-20260923`。上一批线上graph→Wiki→graph各次返回自动读取首个来源parsing状态，留存19次需601.8–1894.1ms。根因是useSuiteGraphSources的局部records每次remount归零；这不是解析执行，不应误称模型重复运行。
- 实现接入现有QueryClient与ENGINEERING_MATTER_QUERY_ROOT、既有identity hook。资源key含app/tenant/actor/session/documentVersion及完整exact事件pins；当前published与指定保存候选互不替代。新鲜30秒、GC5分钟，读取中重挂载共享in-flight；组件取消自己的订阅结果，不中断其他订阅者的共享读取。现有session-root取消/清理适用于本资源，session变化后不启动迟到状态的依赖活动读取。
- 过期重挂载清空本地候选后fresh读取，显式「重新读取」绕过新鲜窗口；拒绝/失败以无候选结果替代旧内容，不通过自动remount循环重试，用户可显式恢复。身份、catalog、enabled/denied或pins改变时屏蔽旧records。exact响应另核对documentVersion/parseRun/candidateRevision及既有family/run/statement绑定。
- 复用的是已授权读取结果，不是授权授予决定；每次实际API仍由Host授权。与其他30秒阅读窗口相同，未收到session失效且没有新读取时不保证立即发现远端撤权。不持久化正文，不缓存任意跨身份结果，不触发BEGIN或候选生成。
- 有效旧反例1 failed/2 passed：实际卸载再挂载同来源状态调用2次而期待1次；修复后相关3套25项通过。覆盖fresh复用、in-flight复用、31秒过期隐藏旧候选、显式刷新、403替换/remount不自动重试/显式恢复、app/tenant/actor隔离、session迟到不继续依赖读取、根资源清理、exact候选版本区别及错配拒绝。测试拥有QueryClient并clear，正常退出，无forceExit。
- client types/lint/build/precommit实际结果以本批日志`/private/tmp/wiselink-graph-source-{red,tests,types,lint,build}.log`及提交回执为据。待Luna独立审查、Main集成与线上请求计量；不把调用次数反例当线上500ms目标或总体完成。主控仍唯一发布者。

- 本批实际client typecheck、生产hook ESLint通过（日志为空），client build13.71s通过；正常提交检查随后执行。主控新回执：626+59791已集成为8d139e310fdc7dbe33e26e7e0bf6834762168c42，release7688452846325648565 finished/error_logs=[]/updated_at1790107974000、双远端同名一致。该发布不含本批及509文档；暖identity待新部署实际复测，Hosted包仍source79bd且尚未安装。


## B 窄身份读取发布后的实际耗时分层（2026-09-23）

- Main准确发布8d139e310fdc7dbe33e26e7e0bf6834762168c42 / release7688452846325648565 finished、updated_at1790107974000、error_logs=[]、双远端同名SHA一致；含626，未含dd1。本轮发布后完整导航到原已保存五页PDF/同parseRun与登记sourceRef；正常现有登录，只读资料库→browser back反复卸载/恢复，未触发生成。
- 完整匿名数据见ORIGINAL_IDENTITY_RUNTIME_EVIDENCE_20260923.json。每次及时读取CDP事件，全部窗口truncated=false/hasMore=false。首读original200：headers2532.673ms、完成5570.678ms、122800网络字节；随后20次仅original-identity200，无重复original下载、无loadingFailed。所有样本保留。
- 20次浏览器实际暖请求：总耗时median787.913ms、p95（nearest rank）1696.780ms、min676.413ms、max1952.004ms；500ms端到端目标未达到。此为单会话小样本，不推广为总体生产p95，不把新旧不同时间采样当严格因果A/B。
- 新定位证据来自实际响应Server-Timing：20次origin 263–369ms、p95 359ms；inner221–351ms、p95 350ms。全部cdn-cache MISS、h2已复用连接，DNS/connect/SSL timing=-1。平台自报origin段低于500ms，不能冒充独立测量的Host/SQL耗时，也不能代替浏览器端到端验收。两层明显差距提示继续定位网关/网络/响应交付等待，不能把约1.7s全部归因数据库、删除fresh授权来追数字。
- 少量loadingFinished时间戳比responseReceived早约1–3ms，原值保留，不作亚毫秒推断。两个观察工具问题（早期事件轮数上限、一次canvas locator deadline）均回读同一次导航/请求至完成，没有重新导航替换失败样本。最终及后续17轮PDF实际第5页恢复；UI功能另有Luna独立验收，不以网络数据替代功能结论。
- Luna新部署独立只读功能验收：同DV/parseRun，真实u112点击写sourceRef并显示实际第5页；资料库→browser back保持；两次warm UI工具墙钟2159/1544ms，不是服务p95。Luna未获取网络字节，B本节另给CDP证据；线上未构造跨租户/digest错误，不冒充本地拒绝边界线上覆盖。
- 下一步：B继续dd1独立审查及发布后实际请求复测；Main/A核实现行Hosted入口、已有授权运行窗口。需要用现有平台可读指标细分额外等待；不新增生产观测平台，不减少Host身份/来源核对，不关闭整体Goal。


## B 保存正文读取移除未消费的当前原文准备（2026-09-23）

- 基线4bac6d6fb，独立树`/private/tmp/wiselink-perf-b-saved-original-hydration-20260923`。新8d139正常身份完整导航、指定同保存修订16；准确CDP区间从identity request前sequence开始，truncated=false/hasMore=false。identity 200：start1790108840830.171ms，total1089.617ms、1335bytes，Server-Timing inner236/origin899ms；catalogue 200：start1790108841927.617、total4363.828ms、3193bytes、inner3567/origin4173ms；work 200：start1790108841928.061、total3985.654ms、27775bytes、inner3018/origin3599ms。请求CDP monotonic起点差0.485ms，已并行，不改前端并发。epoch/monotonic细小差异保留，不作亚毫秒推断。此为单次定位，不是p95。
- 具体无用工作：readWorkingRevision先await authorizedMatter却完全不消费其currentInputs；authorizedMatter最后bindOriginalInputs额外查询当前全部published parse及最新semantic，用于当前工作输入计算。指定保存读取后续只用readByRef返回的持久原始绑定；上述当前绑定准备不会参与其返回或授权判定。
- 增加私有includeOriginalBindings参数，默认true保持当前basis/apply流程；只有指定保存revision入口传false，事项版本变动的单次重试也传递该选择。仍完整检查当前成员freshRead、tenant projection、document resolver一致性、事项版本前后复核及历史移除成员逐组fresh读取；不复用权限、不减少fresh检查次数、不改变repository保存正文及RLS、不将保存绑定改成latest。
- 有效旧反例1 failed/8 passed，精确保存读取仍调用了1次不被消费的当前绑定准备。修复后working service10项 + engineering issue search23项，合计2套33项通过；覆盖保存绑定保持、当前basis仍绑定、事项变动重试、当前撤权拒绝、移除成员拒绝、精确ref不存在不fallback等。去掉1次批量当前解析查询，不预报线上节省毫秒或声称解决全部3秒延迟。
- server typecheck（tsconfig.node.json）通过，生产service ESLint无error，保留既有unused disable warning；server build通过。首次误用根tsconfig.json出现TS6305未构建shared声明文件，已改用正确服务端配置，未修改产品来绕过。日志`/private/tmp/wiselink-saved-original-hydration-{red,tests,search-tests,types,types-node,lint,build}.log`。正常precommit随后执行，待Luna独立接受/Main发布与真实计量。
- dd1df7d662cf83cdf8947120fcb1f6dfd3643a78图谱来源复用已获Luna独立13项/client types/lint/diffcheck接受；没有重复build或线上生成。已回传Main允许按父子关系集成；本批与其后续验收不混同。


## B Matter 成员来源身份窄投影（2026-09-23）

- 基线f7d6e82e9，独立树`/private/tmp/wiselink-perf-b-source-identity-projection-20260923`。沿上一批实际知识冷读inner约3秒链定位：requireInput每次fresh成员核对调用完整source resolver，六表全列含preflight/采集/现行性等数据，但该消费者只使用documentId/documentVersionId。没有把这些列的数据量推测成已实测毫秒。
- 新resolveIdentity显式窄读8列：version的两个ID/lifecycle/digest/length，artifact的verified/digest/length。保留family/sourceArtifact/acquisition/COMMITTED preflight四个innerJoin、精确documentVersion过滤与原普通RLS；默认来源校验抽到同一私有函数，完整resolve的creator/current-head策略仍原样执行。身份窄读没有声称current-head或creator检查；调用点原先也使用不带这些选项的resolve。
- 只有EngineeringMatterWorkingService.requireInput接入。此前fresh objectAccess/tenant projection以及后续documentId/version一致性检查不变；没有减少任何授权次数、缓存权限、变更scope或凭据。当前head的leftJoin是可选信息，既不限制原默认resolve的行可见性也不参与该消费者验证，因此窄读不再加载其字段。其他依赖完整来源信息的消费者继续用原resolve。
- 有效旧反例1 failed/10 passed：成员核对仍进入不被消费的完整source读取。新三套44项通过；随后追加真实Drizzle SQL编译核对并仅复跑resolver 11项（新增1项，45个不同测试，不称为统一45项复跑）。验证四必需join和preflight acquisition/version精确条件、COMMITTED/id/limit绑定参数、无descriptor/currentness投影、四类源身份错误及缺登记拒绝，原creator/currentness测试保留。SQL为真实builder生成，但没有连接PG，不冒充实际数据库/RLS或生产延迟验证。
- server typecheck通过；两生产文件ESLint无error，working service既有unused-disable warning保留；server build和precommit按本批实际日志/提交回执记录。日志`/private/tmp/wiselink-source-identity-{red,tests,sql-tests,types,lint,build}.log`。本批不改模式/索引/存量数据，下一步Luna独立审查，Main统一集成发布，再测同保存正文冷路径。
- 前批f7d6e82e9458f55a7663cac9041a8de90186a6c9已获Luna独立33项、官方server typecheck、服务/测试lint与diffcheck接受并回传Main。dd1亦已独立接受；未取得本批发布回执前不标为线上生效。
