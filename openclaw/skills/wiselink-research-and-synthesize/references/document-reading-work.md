# 独立文档解读（c112 引入，c113 引用修订）

本能力提供文件自身的简明主题、解读正文、关键条件及来源限制，不是工程事项综合、适用性决定、正式采用或活动时间线。前端读取同一已保存产物，GET 不调用模型。必须先具备本次 Host 接口及数据库迁移，再安装包含本能力的后继 Skill；c111 已安装版本不具备本能力。

## 创建与消费

使用独立 `document_reading` MCP 工具。只有明确授权的任务才调用 `READING_BEGIN`，携带确切 documentVersionId、parseRunId、semanticRevision、稳定 requestId 和 expectedRevision。Host 校验原文来源及 CAS 并返回 runRef；消费者不自行 BEGIN、不制造 WorkItem、不重跑解析或中文。原文有效性和覆盖范围不能因已有中文成果而推定。

现有 `consume-hosted-work-item.mjs --document-version-id DV --reading-run-ref RUN --lease-owner OWNER` 可精确消费/恢复已有任务；省略 reading-run-ref 时，document_work STATUS 提供已准入的 nextReadingRunRef。既有活动任务仍先消费；显式 reading 和 activity ref 不得同时传入。

消费顺序为 STATUS、CLAIM、带租约的 READ 分页、官方 Hosted 模型、SAVE。READ 按原文单元读取，包括尚未分章节的单元；实际交付不足只标 PARTIAL_DELIVERY，不冒充全篇理解。模型输出仅包含 schemaVersion、headline、brief、explanation、criticalConditions、limitations；所有解释性 statement 的引文必须逐字匹配实际交付 anchor。Host 决定来源绑定、覆盖范围、保存版本和候选身份。引用校验不是语义正确性或工程接受的证明。

## c113 模型引用与保存合同

新模型工具的每个 quote 只输出已交付的 `anchorId`；候选适配器复制该锚点完整 `sourceText`，确定性生成 `start=0`、`end=sourceText.length`（UTF-16）及原文 `text`，再交 Host 既有 v1 保存合同校验。模型不能提供或修补数字偏移，也不按相似文本或重复文本猜换锚点。未知锚点、重复输入身份、空来源及夹带字段明确失败。模型仍负责选择真正支持解释的依据；合法身份不证明语义支持。

此变化只用于新模型调用，provenance记录prompt v2；既有model.result/save.started不转换、不重写、不以本地修订内容冒充原模型结果。输入在派发前被拒绝时持久化明确失败，重启不进入等待模型确认；真实传输未知仍保留原有不重复规则。

## 恢复与错误

### 长任务启动与观察

消费者包含真实模型请求，不能用短命令等待窗口作为进程生命周期。使用平台支持的持续进程会话或后台任务，记录原进程标识、准确 runRef、checkpoint 路径及私有输出路径；后续读取该进程和检查点，不重复启动。工具返回等待超时只结束本次观察，不应杀死消费者。不得套用 `timeout 165` 等短于正常模型预算的外层强制终止；实际终止仍由消费者已有 deadline、租约和 AbortSignal 控制，不增加模型预算或调整 cron。

同一线上 run 的手动观察和调度消费必须使用同一个持久检查点根目录；不能为人工验证另设目录，再仅凭该目录为空判断尚未调用模型。默认根目录为 `~/.openclaw/wiselink-work-item-runs`。接手已有 run 前核对实际启动参数、默认及此前指定目录，发现任一 `model.started` 而无结果时按未知处理；Host 租约过期不证明此前没有模型调用。已存在的检查点不搬移、覆盖或删除，隔离测试目录只用于明确隔离的测试任务。

若已被外层命令中断，先核对原进程、原请求回执及同一检查点。没有 `model.result` 只表示结果未知，不代表网关未执行；不可删掉 `model.started`、重发模型或创建新 run 绕过。原请求结果无法取回时明确报告该限制，再处理有依据的后续方案。

检查点按 Host endpoint（不含凭据）、文档版本和 runRef 隔离，并校验 parseRun/semanticRevision/expectedRevision。先持久化 model.started，再调用模型；持久化 model.result 后才准备保存。保存前持久化 save.started。模型结果未知不重调；保存结果未知只查准确原 run 的 STATUS。SAVED 回执始终比对已有提交内容、来源及真实 producer；CLAIM 并发完成需重读检查点。

明确的应用校验失败返回 REQUIRES_ATTENTION 和安全错误代码，保留诊断，不自动重试模型/SAVE。不确定的传输结果保留 PENDING_MODEL_CONFIRMATION 或 PENDING_SAVE_CONFIRMATION；不能把它改写成成功或直接创建后继。取消通过明确 READING_CANCEL；模型不能自动正式接受任何工程结论。

## 读取

浏览器沿既有身份/来源授权读取 `GET /api/document-management/document-versions/:documentVersionId/document-reading`，必须明确 parseRunId、semanticRevision，可明确 readingRevision。目录 documentReading 是该版本同一保存结果的轻量投影，携带 AVAILABLE / RETRACTED / SOURCE_CHANGED / NOT_GENERATED 状态；更换原文或语义版本不能将旧解读当当前。关键否定、条件和源限制不得机械截断或被目录主题替代。

独立复核发现已保存候选有实质错误时，可由已授权的 document work 身份明确调用 `READING_RETRACT`，携带准确 documentVersionId、runRef、expectedReadingRevision、稳定 requestId、reasonCode 和 reviewReference。Host 在原文授权、来源版本及当前阅读修订 CAS 下追加唯一撤回记录；原 SAVED 行、result、saveCommand 和 readingRevision 保持不可变。重放同一请求返回同一撤回记录，不同请求或落后修订失败。STATUS 显示有效状态 RETRACTED、撤回记录和空 result；浏览器完整读取、目录及批量预览均不再提供撤回候选，显示待重新核验。新候选仍需独立准入和模型调用，expectedRevision 取已保存的最高修订（包括撤回者），不得回退到旧修订或静默覆写。
