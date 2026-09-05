# WiseLink R10 当前执行计划

更新日期：2026-09-05。依据：[云文档 revision 2110](https://hv5zjf4j8yb.feishu.cn/docx/MA3fdjEycoISjHxptAqcsyxvn9b) 与 [当前正文镜像](WISELINK_R10_CURRENT.md)。

## 已设定的 Goal

让工程师在既有真实 SB 事项页面中提问、补材料、纠正方向后，由云端自动执行并基于共同上下文返回候选；连续追问承接讨论，展示实际取证、依据、未知及判断变化。全过程不依赖 Codex 手工启动 driver 或开发者电脑常驻。

自动运行和共同上下文需要在同一用户流程中验证。保存、安装、mock、一次手工提交和测试数量都不能代替页面连续使用证据。Goal 当前为 ACTIVE，尚未完成。

## 当前进度

| 步骤 | 状态 | 交付内容 |
| --- | --- | --- |
| 1. 契约修订与目标 | 已完成 | 云文档原位修订并回读至 revision 2110，保留四张原图和历史记录；当前正文与本计划同步仓库。 |
| 2. 自动运行与共同上下文 | 进行中 | 页面选择到 Turn/Task 已接通且本地检查通过，尚未发布；Hosted 原生 command cron 能力已核实。下一步接执行意图、云端领取、共同上下文及状态回读。 |
| 3. 连续调查与页面体验 | 待接通 | 稳定授权会话、按需来源读取、连续追问、真实活动/失败展示；前端与 Host/Skill 兼容衔接。 |
| 4. 真实页面往返 | 待验证 | 页面发送、自动运行、候选回写、追问、补材料或纠正、判断变化说明。 |

这些是实施顺序，不是逐级解锁的 gate。遇到具体故障定位原因，做必要普通测试，然后返回完整流程。

## 第二步的具体接线

1. **选中评估点（代码完成，尚未发布）。** selectedEvaluationItemId?: string | null 已贯穿 DocumentParsingPage、ContinuousReviewPanel、Append 请求、既有 Turn JSON、回读及 Agent Task/Context；Host 在装配任务时核对当前事项评估点。历史纯文本和旧 JSON Turn 继续兼容，不依赖文本猜测，也不新增表。
2. **自动运行（下一项）。** 当前 append 仍仅保存/回读。用既有 Turn/ActionAttempt 表达可恢复执行意图，解决“保存后派发前进程退出”的具体缺口。通过已核实的 Hosted 原生 command cron 定期运行领取脚本，只领取明确请求自动执行的新 Turn；不重放历史 Turn 或已成功初始操作。沿用当前授权范围和既有 driver，不能让开发 CLI 成为运行时依赖。
3. **共同上下文。** 从主文件业务语义、完整来源索引、精选已读片段、实际检索背景、工程师补充和讨论摘要装配评估前上下文。JobAid、Overall、Review 复用不同任务视图；评估后再附实际结果引用，避免把结果侧 EvaluationContext 当作首次评估前置而形成循环。
4. **真实执行投影。** 复用当前对话回读接口，向已授权页面提供按 Turn 的可见运行状态和失败原因。已有候选缺失不能等同“正在运行”；不另建前端业务状态机，不伪造百分比或取证活动。
5. **按需读取。** 将当前问题和选中 Criterion 交给 Agent，保留全量索引，按相关性/分批读取；不要将全部 availableSourceRefIds 一次塞入请求，也不要仅因来源数超过 100 而整轮失败。

运行载体已部分核实：Hosted app_17c3zn24kv2 管理会话 conversation_4ky0f6r24fz90 的只读检查 Turn 7681886217462189043 已 completed。实测 OpenClaw 2026.6.6 (8c802aa)、Node 22.22.1、Gateway 可达；cron add 帮助明确包含 command/command-argv/command-cwd、every/cron、timeout-seconds 与 no-deliver；cron status 为 enabled=true，jobs=0。无需模型的定时脚本是下一步部署路径，不是已经部署的消费者。尚未创建/启用作业，尚未验证跨会话执行及重启恢复，也未修改安装/权限/凭据或提交任何业务 Turn。

普通妙搭应用详情 API 不支持 Hosted 类型，管理页本轮加载超时；已支持的开发期平台会话仍可读取云端能力。不得将该开发会话/CLI 冒充 Host 的业务运行接口。云端领取接口仍须沿用明确授权范围，不能移除现有授权或把当前样本硬编码成通用业务策略。

## 并行分工

- 主控：shared DTO、Host/Agent 接线、共同上下文、集成、兼容发布和实际验证。
- [前端任务](codex://threads/01a06014-5282-7f90-91bf-12759224d211)：对话、附件、选中评估点、来源导航和真实状态展示。Criterion 接线已交付并集成；execution/活动 DTO 收敛后继续 UI，不扩张无关状态检查。
- 方法/解析：保持主文件结构、条件和例外；JobAid 正式来源状态据真实绑定派生。现有 SOURCE_IDENTITY_MISMATCH 是固定占位，不应直接改成 MATCH。
- 数据支线：真实知识空间 RAG 薄适配、构型事件源及既有采用后重算；未接通如实显示，不阻断现有资料分析。

## 当前证据与未完成事项

本轮完成：文档提交 b80016f9b，Host 焦点接线 2f5169560，前端源提交 074467e02 已单独集成为 d8d77b1b0。联合 5 个测试文件 64 tests 通过；server/client typecheck 与 production build 均通过；现有代码 ESLint 无 error（配置忽略的测试文件不计入 lint 证明）。尚未应用发布，也没有新线上 Review Turn、候选提交或正式采用。

构建非阻断问题已定位：平台 Vite 预设使用默认 vite-tsconfig-paths()，向工作空间扫描时遇到父目录历史工作树的 tsconfig 解析错误；本仓库 tsc/build 仍成功退出。另有既有模块类型与 chunk-size 警告。本轮不静默压制这些日志，不为旁支修改构建框架或扩大测试门槛；后续单独收窄工作空间扫描范围。

本次开发起点：分支 codex/wl31-r09-master-handoff-20260903，HEAD e16c3fbaf41deefd62222f6abb06a65d5ced5e90；e16 是文档提交，业务父提交为 c79c17eae1d11bb91e9a930b82d8e6b0822975dc。

最近已核实的线上记录（非本次重新执行）：Host release 7681752312452730071 finished；主事项 WI-2c1902db-c2cd-427d-b0d4-1f8f70fe6597，SB 777-34-0425 / B-1266，revision 11，JobAid 150 项；Review ACTIVE，14 Turns，Turn 13/14 为未采用候选。Skill 最近安装记录 r09.c18，历史 Turn 保留其真实执行 build。

尚无页面自动运行、稳定持续调查会话、共同上下文进入初始 JobAid/Overall 或真实知识空间 RAG 的完整证明。构型源仍 NOT_CONNECTED；不能据此伪造空数据成功、事实不适用或已完成重算。

## 发布与采用边界

- 优先跑通实际流程；默认不新增 hash、baseline、冻结契约或 gate，保留已有认证、数据安全、SourceRef、事务、幂等、恢复和正式采用保护。
- 普通资料、讨论、工作判断和候选可持久保存，不等于正式采用。
- Host 与 Skill 可按兼容窗口分别发布；前后端仍是同一个 Host App 发布单元。技术发布按用户长期授权执行，结果据实回报。
- 不自动确认 ReviewAction，不自动采用工程结论或执行正式审批/业务发布。
- 文档提交不触发无必要的 Host 发布；功能发布后才更新线上状态与验证记录。
