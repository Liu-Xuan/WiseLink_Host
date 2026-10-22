# 分层 Wiki 消费与恢复

本协议随组合版集成，版本以官方建包与实际安装回执为准。Host、SQL、MCP、Native Skill 配套安装后开启入口。

Host 为本人已确认归类的文档与事项注册稳定 ATA4、ATA2、机型 Wiki。ATA4 汇总本章文档解读和相关事项已保存的完整成果；ATA2 只综合所属 ATA4 已保存的 Wiki 正文；机型只综合所属 ATA2 已保存的 Wiki 正文。每层保留精确子层、叶子和根引用，保存到既有 DerivedSummary。仅有机型或两位 ATA 归类的原资料与确认分类保留在原资料列表，不伪造 ATA4，也不作为父层直接综合成员。机型提及仅是归类建议。

自动任务由 Host 在输入哈希中封存 `wikiLevel`。父层新消费者使用 `HIERARCHICAL_WIKI_PARENT_V2`：首轮交付全部精确子层正文与去重的根证据目录；模型文本中的已登记继承来源引文归属到该准确子 Wiki，原保存正文和来源谱系不改写，完整根正文仍由 Host 授权注册表保留，只在模型明确 `READ_SOURCES` 时交付。目录、Host 预读和子层引用都不等于本轮原件正文已读；新根引用须有对应正文交付。普通人工综合和旧任务保留原输入与恢复协议。此新增输入须配套新消费者；旧版拒绝未知字段，不能只发布 Host 后把旧消费者当作已支持。

事项 SOURCE_CHANGE/续评还须本人通过目录的“委托事项自动续评”单独授权。归类、阅读权限、Wiki 启用都不能代替分析委托。运行仍使用事项既有任务模型与 Host 当前来源授权。

## 入口

在已存在的 Native 自动队列 cron 内启用 `consume-hosted-work-item.mjs --auto-queue --wiki-idle`，并提供 `--openclaw-config`、`--wiki-timeout-ms`、`--wiki-max-completion-tokens`、`--wiki-max-model-requests`。推理选项为 `--wiki-reasoning-effort low|high|max`，默认 low；可另指定 `--wiki-provider-timeout-seconds`。预算由集成 owner 在既有总限额内选择；不得复制新 cron 或扩额度。

没有既存 Wiki 指针时，用户任务优先，用户队列 IDLE 才调用 `next_hierarchical_wiki`。Host 平台兜底触发器只预约同一队列，不能调用模型。空节拍、重复版本和未核实归类返回 IDLE，零模型。

`SUMMARY_PENDING` 使用原 `consume-hosted-derived-summary.mjs`；`MATTER_PENDING` 使用原 Matter 消费器及 `hierarchical_wiki_` 工具别名。始终核对确切 summary/matter、attempt、输入和执行模型，沿用官方 Hosted GLM5.3 Gateway。不能用假 WorkItem 取得权限。

## 在途指针

在准备 Gateway 前持久写 `active-wiki`。已存在指针优先于新用户工作和新 Wiki；只恢复其原对象、原 attempt、原 checkpoint。沿用 endpoint 的 Native `flock`，一次只能有一个消费者。

`NO_GATEWAY` 表示本指针尚未进入准备阶段；`PREPARING` 在调用一次性 preparer 前写入。不确定的准备、缺失终态回执、EOF/UNKNOWN、绑定错误均保留指针。Host SAVED/FAILED/CANCELLED 或 deadline 到期不能替代 Provider 已结束的可靠证明，不删除 started marker、重置 receipt 或重新 arm。

只有原绑定的 Provider 安全终止证明及准确 Host 保存/finish，或者可靠的 Host 终态清理回执，才解除指针。来源撤权后 `hierarchical_wiki_cleanup` 仅返回确切自动 attempt 的状态/取消回执，不返回 task、正文或来源。

清理遵守原生提交截止点：只允许取消 QUEUED/RUNNING/RETRY_SCHEDULED；COMMITTING 或已有 commitStartedAt 返回 TOO_LATE，保留提交结果与租约，显示 `WIKI_HOST_COMMIT_PENDING` 并恢复原提交。Provider UNKNOWN 显示 `WIKI_PROVIDER_TERMINAL_UNKNOWN`；不能借清理绕过提交边界。

## 观察

普通 ATA4/ATA2/机型合并窗口为 15/30/60 分钟，重要变化为 2/5/10 分钟；首次为 5/10/15 分钟。2/4/8 小时等待阈值允许有依据的部分覆盖；仍需加真实发现节拍、队列等待与执行时间。叶子真正 SAVED 后才向上增加确切输入，依赖完成释放原到期时间。

待覆盖变化在目录显示；当前正文保留确切范围与限制。来源、解析或子层更新及 dirty/waiting 只影响新修订生成，不因这些变化清空或拦截仍获授权的已保存正文。移除分类导致旧正文包含已撤销材料时，当前视图隐藏，已授权历史版本可按确切 ref 读取。“尽快更新”单独记录重算需求，不清空已保存正文的成员快照。

## 安装顺序

先确认已接受的 DerivedSummary/source SQL 与身份、原文及 Native 最终校验基础。按正式迁移途径应用 `0076_derived_summary_document_reading.sql`；用官方 dev/online schema snapshot 经 `scripts/prepare-hierarchical-wiki-ddl.mjs` 生成 `0077`，再应用生成 SQL。原始 0077 模板会明确拒绝执行。新增表的 RLS/ACL 由同一 SDK 实际 SQL role 校验，不能以 PUBLIC serializer 代替。

这两项迁移须在新版 Host 处理保存请求前完成，因为文档、事项、WorkItem 的真实保存会在同事务追加 Wiki journal。随后串行安装 Host/MCP/Skill 并分配新版本，核对原 Native owner 与在途状态，再调整既有 cron 参数；平台触发器名为 `hierarchical_wiki_due`，建议 30 分钟绑定。另行记录一次获准机型的自然调度保存链，才可宣布生产自动链通过。

本文不声称已执行迁移、安装、C136 参数更新或平台触发器绑定。
