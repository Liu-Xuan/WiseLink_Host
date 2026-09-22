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
