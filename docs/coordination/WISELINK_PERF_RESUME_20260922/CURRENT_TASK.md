# Current Task

## 本批身份

B当前树：`/private/tmp/wiselink-perf-b-graph-library-return-20260923`。主控已协调本批三份导航源码归B负责；全局资料库返回精确图谱已实现，真实组件点击+默认选择回归与父提交反例齐备，4套72项/client types/lint/build通过，待Luna审查及发布。此前本批在fresh授权后重叠租户投影与精确来源identity读取，保留一致性检查/错误优先级/两次版本核对；3套61项、types/lint/build通过，父提交反例160ms、新实现100ms（受控时序，非线上）。84acf1611已获Luna独立接受（另选3套70项/types/lint/diff），待主控集成发布及线上收益验证。此前41e9已独立接受并进入81abd9，release7688473071305133285已finished、实际资产SHA吻合。三次冷目录3.324–4.167秒/正文2.654–3.473秒，过期返回目录4.070秒/正文3.419秒，全部200、修订16完整。不是p95/A-B，目标未闭合。见AB81_READ_RUNTIME_EVIDENCE_20260923.json；Hosted安装与后台竞争仍待主控，Goal active。

本轮 Trace 详情已定位：目录 60 条 SQL 标注合计 1095.79ms / 服务端 3633.95ms；正文两样本均 26 条，SQL 328.69/267.48ms / 服务端 2817.51/2082.99ms。调用间等待显著，尚不能归因于网络或 CPU。下一步减少依赖读取往返，保留鲜活授权与版本核对。见 AB81_DATABASE_TRACE_EVIDENCE_20260923.json。

新发现：AB81图谱→资料库→浏览器后退通过，17 overlay/viewport/精确work一致且退出canvas=0；但资料库“返回原阅读位置”仍回资料库，Sidebar未携带return上下文且TopBar默认/library。此全局退出路径尚未闭合，下一步修复精确图谱返回上下文，保留现有版本校验。见GRAPH_GLOBAL_EXIT_EVIDENCE_20260923.json。

## 完整路线状态（2026-09-23）

| 范围 | 当前证据与未完成项 |
| --- | --- |
| 目录/1A/1B/元数据/1C/2A | 既有21a6716b及REPORT/SQL_EVIDENCE保留。1B是可取得候选，不覆盖不可取得云端差异。 |
| H0/T0 | d58615c5含已验证测试导航时序修复，原配置正反执行顺序正常退出；不再追查未证明的全局串扰。 |
| 2B.1 | d58615c5含PDF模块与原件并行准备，Luna已做本地独立验收；真实目标页问题（请求5、实际4）由e5dd修复并已进入ef258；独立线上只读第5页/实际第5页及手动滚动接管通过。普通段落退出第1页缺口已由a88固定登记parse/sourceRef/page，并获ab3独立线上第5页往返通过；自由像素与纯PDF滚动未声明完成。 |
| 2B.2 | 当前本地受控8MiB样本3次打开：基线3次下载24MiB，新实现1次下载8MiB+2次fresh授权/登记核对。最多4条/单条16MiB/总32MiB/5分钟主动过期，同步工作最多2次；SHA/length匹配才复用，不缓存权限，URL仍组件拥有。ff46e1d98已获Luna独立4套118项及controller4项验收；ef258真实三次打开1次原件+2次identity核对，完整网络及非强制GC heap观测见REPORT；identity约1.0–1.3s，未达暖读取目标，不声称无泄漏。 |
| 2C | 3e0cc6074按帧合并/状态去重/销毁清理，Luna5套52项及构建通过。2C.2 bcccd815正文memo/稳定回调已获Luna 5套53项验收。2C.3 b2247dee7增量拓扑、标题刷新不重排/不丢拖动位置，6套57项已获Luna独立验收；2C.4a 8de759fb9导航/切视角捕获最新相机、立即保存导航历史已获Luna8套71项独立验收。2C.4b d0829db9c有限会话几何返回恢复已获Luna独立验收；B 6套54项与Luna不同集合6套63项并列，精确身份/工作/显示参数绑定。ab3同版本Wiki返回20次DOM p95 24.5ms、2RAF38.8ms，布局/镜头一致；通用外部退出、冷图与其他交互仍需继续。 |
| 2D | 当前2D.1：已保存活动/解读结果完整返回，fresh普通来源授权+精确published parse/source登记+指定semanticRevision窄查；396ad7e81已获Luna独立5套59项/types/lint/build/precommit验收；PG真实SQL/RLS1项是B实现者证据，Luna只读日志、未重复连接。目录/来源章节其余热点及真实耗时仍需核对。 |
| 3A.1 | e7b6b6c04控制分派移出原文路径，5套43项与server构建通过，Luna本地验收通过；真实执行的重复内容校验尚保留；当前3A.4活动STATUS/CANCEL/CLAIM/HEARTBEAT/FAIL移到fresh普通来源授权后、不加载原文/semantic；Reading相同控制补齐普通来源授权，d051d2781的2套33项及MCP真实服务互通2项已获Luna独立验收。 |
| 3A.2/3 | 81ea079ea已改pending优先、空闲窄查精确语义登记，Luna本地4套25项验收通过，真实SQL/RLS已通过。3A.3已按主控授权单写者修订consumer：新START需当前语义就绪，历史pending不替代；已就绪不等待索引，索引失败鲜活回读就绪，旧任务状态/恢复不阻断。b020437e1的98项Node及3套16项Jest已获Luna本地验收；c65d0aa10由Luna在主控授权的独立PG14.17实例实际执行1/1通过，JOIN/RLS/非owner角色/约束均验证；唯一临时实例已停止删除。 |
| 3B | 当前3B.1单执行最多两个8页组、组间10秒预算/16MiB原件上限；组间fresh ACL/lease，每组checkpoint，PDF在返回/异常/最终组装前释放。25页构造样本原件读取/PDF打开4→2，插件仍1次。70ad48ea9的5套38项+真实PDF.js Node5项/types/lint/build/precommit已获Luna独立验收。当前3B.2执行内来源plan准备61单元分页4次→1次；独立授权复核仍另算1次，实际begin总5→2次；6f77d9456的3套41项/types/lint/build/precommit已获Luna独立验收。跨任务公平与真实竞争计量仍未完成。 |
| 4 | A负责JobAid/OpenClaw/Overall/Wiki连续工作。A回报当前0c350f04c（含0ee/35a/47adb/301/60ec/786/0c350），Luna已本地验收；0c350f04已进入固定e812并发布，b10e6e570已进入ef258；Hosted安装/全链验收仍需主控闭合；应取A的确切交付，不在B重写。 |
| V/R | 主控回读Host app_17bzc551rsg release7688432648880098235 finished / ef258aa7；B正常已有登录只读资料库、既有5页FTD解析2/部分中文/PDF，未生成。已发现并本地修复真实目标页错位。79bd已有知识同版本新鲜窗口24次DOM p95 21.6ms证据；已有图谱返回20次DOM p95 24.5ms；暖轻量读取p95与后台竞争仍未完成，完整路径由Luna继续独立功能复验。 |

## 集成及边界

最新ab3：Main提交`79bd2380615ff18582269cc3cd5d95f805261b87`，release`7688444473504353246` finished updated_at1790106250000、error_logs=[]；origin/github同名`codex/integration-ab3-20260923`同SHA。含至a88并保留dc491任务目录修复，不含626dcf。Skill包source79bd、sha256 b491433f299c90b02118ea612e803c48fe0540ad6c4f2a4c636e96f6890cb4de、456451bytes/60files已由Main核验，但尚未安装，不算consumer生效。

最新ab2：Main独占集成树`/private/tmp/wiselink-integration-ab2-20260923`，准确HEAD `ef258aa7faba42277d38dec7584e41bb4be2ee55`；origin/github同名`codex/integration-ab2-20260923`均由Main核对同SHA；Host release `7688432648880098235` finished，error_logs=[]。含B至c58与A b10；不含77ae/fadf/e10/a7。后四批已独立接受，B已请求Main纳入下一次发布，未代替Main推送或发布。

历史ab集成回报：已建/private/tmp/wiselink-integration-ab-20260923，A0c350f04+merge Bff46e1d9并补aac9产品/测试，41个staged路径、文档冲突已处理，已于本轮只读回读集成HEAD为e812421cb050aed0954ca3f6945159100155a301（tracked clean），推送另待两端精确SHA；主控随后回读Host release7688408024273652704 finished、commit_id=e812421cb050aed0954ca3f6945159100155a301、error_logs=[]。Luna已对准确HEAD0c350f04/MERGE_HEADff46e1d9组合16套203项、双端types/lint/build/precommit验证通过；前述门禁本身不是线上发布，发布另以本轮主控readback为据。旧release7687614542885374932/b023只属历史。B旧修复aac9bd64与审查28d87908仍保留，需主控接受。B不得自行完成发布来填验证空缺。

主控已授权正常身份只读现有保存样本；B IAB自建tab1现场已登录、可见11文档，已核对既有5页样本/解析2及21%过期部分中文，未重解析/重生成。样本对应关系及匿名数值在/private/tmp/wiselink-vr-readonly-evidence-20260923.json，公共报告不提交原文/认证头。Hosted新Skill尚未安装；真实新解析/翻译/评估仍需样本、预算和环境授权，不触发正式采用或AssessmentRun。

## 当前与随后

3A.2真实SQL/RLS、3A.3和2C.2独立验收已完成；2C.3/2C.4a已获独立验收，2C.4b已独立验收，2B.2已独立验收；3A.4、2D.1已独立验收；3B.1/3B.2均已独立验收，PDF目标定位修复已独立验收，知识→正式图谱身份修复已独立验收，保存工作历史成员有界并发已独立验收，总体更正提示77ae及document continuation fadf已独立接受；知识复用e10、图谱返回a7、普通段落a88已进入ab3并线上验证；626窄身份投影已独立接受，Main正在集成。继续其他来源plan消费者热点、跨任务公平持续推进及2C通用退出，不重复已通过检查，不忽略2B.2/2C/2D/3B。完整计划见OFFICIAL_CODEX_ROADMAP。Goal仅在全部要求证据齐备时关闭，不在子批交付时关闭。


共享文件协调：A已明确允许B单写者修改JobAid buildInput分页循环/相关import及document-original-engineering-reading.ts。A另有b10e6e570知识观察增量（JobAidKnowledgeObservationStatus import/queryKnowledge约791–842行），B未触及；主控选择性合并本批小差异，保留A其余变更，不整文件覆盖。
