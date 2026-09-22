# Current Task

## 本批身份

B系统性能工作树：`/private/tmp/wiselink-perf-b-knowledge-reuse-20260923`，分支`codex/perf-b-knowledge-reuse-20260923`；起点`fadf512b932eec820cecd1fe42e97e4e47d9c047`。本批知识目录/精确保存正文接入既有Query身份、session清除及30秒新鲜窗口；4套48项/客户端标准检查通过，待独立验收。主控ab2已发布ef258aa7/release7688432648880098235；新缓存/77ae/fadf均不在该部署。线上图谱返回按钮新缺口单独优先处理，不以browser back算按钮通过。

## 完整路线状态（2026-09-23）

| 范围 | 当前证据与未完成项 |
| --- | --- |
| 目录/1A/1B/元数据/1C/2A | 既有21a6716b及REPORT/SQL_EVIDENCE保留。1B是可取得候选，不覆盖不可取得云端差异。 |
| H0/T0 | d58615c5含已验证测试导航时序修复，原配置正反执行顺序正常退出；不再追查未证明的全局串扰。 |
| 2B.1 | d58615c5含PDF模块与原件并行准备，Luna已做本地独立验收；真实正常身份样本已读到目标页问题（请求5、实际4）；当前本地修复通过真实PDF.js浏览器正反对照，待独立验收/再发布。线上高亮/返回链仍需继续。 |
| 2B.2 | 当前本地受控8MiB样本3次打开：基线3次下载24MiB，新实现1次下载8MiB+2次fresh授权/登记核对。最多4条/单条16MiB/总32MiB/5分钟主动过期，同步工作最多2次；SHA/length匹配才复用，不缓存权限，URL仍组件拥有。ff46e1d98已获Luna独立4套118项及controller4项验收；仍待真实浏览器耗时/内存证据。 |
| 2C | 3e0cc6074按帧合并/状态去重/销毁清理，Luna5套52项及构建通过。2C.2 bcccd815正文memo/稳定回调已获Luna 5套53项验收。2C.3 b2247dee7增量拓扑、标题刷新不重排/不丢拖动位置，6套57项已获Luna独立验收；2C.4a 8de759fb9导航/切视角捕获最新相机、立即保存导航历史已获Luna8套71项独立验收。2C.4b d0829db9c有限会话几何返回恢复已获Luna独立验收；B 6套54项与Luna不同集合6套63项并列，精确身份/工作/显示参数绑定。通用外部退出、真实交互计量仍需继续。 |
| 2D | 当前2D.1：已保存活动/解读结果完整返回，fresh普通来源授权+精确published parse/source登记+指定semanticRevision窄查；396ad7e81已获Luna独立5套59项/types/lint/build/precommit验收；PG真实SQL/RLS1项是B实现者证据，Luna只读日志、未重复连接。目录/来源章节其余热点及真实耗时仍需核对。 |
| 3A.1 | e7b6b6c04控制分派移出原文路径，5套43项与server构建通过，Luna本地验收通过；真实执行的重复内容校验尚保留；当前3A.4活动STATUS/CANCEL/CLAIM/HEARTBEAT/FAIL移到fresh普通来源授权后、不加载原文/semantic；Reading相同控制补齐普通来源授权，d051d2781的2套33项及MCP真实服务互通2项已获Luna独立验收。 |
| 3A.2/3 | 81ea079ea已改pending优先、空闲窄查精确语义登记，Luna本地4套25项验收通过，真实SQL/RLS已通过。3A.3已按主控授权单写者修订consumer：新START需当前语义就绪，历史pending不替代；已就绪不等待索引，索引失败鲜活回读就绪，旧任务状态/恢复不阻断。b020437e1的98项Node及3套16项Jest已获Luna本地验收；c65d0aa10由Luna在主控授权的独立PG14.17实例实际执行1/1通过，JOIN/RLS/非owner角色/约束均验证；唯一临时实例已停止删除。 |
| 3B | 当前3B.1单执行最多两个8页组、组间10秒预算/16MiB原件上限；组间fresh ACL/lease，每组checkpoint，PDF在返回/异常/最终组装前释放。25页构造样本原件读取/PDF打开4→2，插件仍1次。70ad48ea9的5套38项+真实PDF.js Node5项/types/lint/build/precommit已获Luna独立验收。当前3B.2执行内来源plan准备61单元分页4次→1次；独立授权复核仍另算1次，实际begin总5→2次；6f77d9456的3套41项/types/lint/build/precommit已获Luna独立验收。跨任务公平与真实竞争计量仍未完成。 |
| 4 | A负责JobAid/OpenClaw/Overall/Wiki连续工作。A回报当前0c350f04c（含0ee/35a/47adb/301/60ec/786/0c350），Luna已本地验收；0c350f04已进入固定e812并发布，b10e6e570后续增量及Hosted全链验收仍需主控闭合；应取A的确切交付，不在B重写。 |
| V/R | 主控回读Host app_17bzc551rsg release7688408024273652704 finished / e812421c；B正常已有登录只读资料库、既有5页FTD解析2/部分中文/PDF，未生成。已发现并本地修复真实目标页错位。尚无热正文/图谱返回/暖轻量读取p95，完整Wiki→图谱→原件→返回→历史链待继续。 |

## 集成及边界

主控最新回报：已建/private/tmp/wiselink-integration-ab-20260923，A0c350f04+merge Bff46e1d9并补aac9产品/测试，41个staged路径、文档冲突已处理，已于本轮只读回读集成HEAD为e812421cb050aed0954ca3f6945159100155a301（tracked clean），推送另待两端精确SHA；主控随后回读Host release7688408024273652704 finished、commit_id=e812421cb050aed0954ca3f6945159100155a301、error_logs=[]。Luna已对准确HEAD0c350f04/MERGE_HEADff46e1d9组合16套203项、双端types/lint/build/precommit验证通过；前述门禁本身不是线上发布，发布另以本轮主控readback为据。旧release7687614542885374932/b023只属历史。B旧修复aac9bd64与审查28d87908仍保留，需主控接受。B不得自行完成发布来填验证空缺。

主控已授权正常身份只读现有保存样本；B IAB自建tab1现场已登录、可见11文档，已核对既有5页样本/解析2及21%过期部分中文，未重解析/重生成。样本对应关系及匿名数值在/private/tmp/wiselink-vr-readonly-evidence-20260923.json，公共报告不提交原文/认证头。Hosted新Skill尚未安装；真实新解析/翻译/评估仍需样本、预算和环境授权，不触发正式采用或AssessmentRun。

## 当前与随后

3A.2真实SQL/RLS、3A.3和2C.2独立验收已完成；2C.3/2C.4a已获独立验收，2C.4b已独立验收，2B.2已独立验收；3A.4、2D.1已独立验收；3B.1/3B.2均已独立验收，PDF目标定位修复已独立验收，知识→正式图谱身份修复已独立验收，保存工作历史成员有界并发已独立验收，当前总体更正提示元数据批量读取待独立验收。继续其他来源plan消费者热点、跨任务公平持续推进及2C通用退出，不重复已通过检查，不忽略2B.2/2C/2D/3B。完整计划见OFFICIAL_CODEX_ROADMAP。Goal仅在全部要求证据齐备时关闭，不在子批交付时关闭。


共享文件协调：A已明确允许B单写者修改JobAid buildInput分页循环/相关import及document-original-engineering-reading.ts。A另有b10e6e570知识观察增量（JobAidKnowledgeObservationStatus import/queryKnowledge约791–842行），B未触及；主控选择性合并本批小差异，保留A其余变更，不整文件覆盖。
