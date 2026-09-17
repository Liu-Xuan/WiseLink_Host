# 独立文档解读（c112）

本能力提供文件自身的简明主题、解读正文、关键条件及来源限制，不是工程事项综合、适用性决定、正式采用或活动时间线。前端读取同一已保存产物，GET 不调用模型。必须先具备本次 Host 接口及数据库迁移，再安装包含本能力的后继 Skill；c111 已安装版本不具备本能力。

## 创建与消费

使用独立 `document_reading` MCP 工具。只有明确授权的任务才调用 `READING_BEGIN`，携带确切 documentVersionId、parseRunId、semanticRevision、稳定 requestId 和 expectedRevision。Host 校验原文来源及 CAS 并返回 runRef；消费者不自行 BEGIN、不制造 WorkItem、不重跑解析或中文。原文有效性和覆盖范围不能因已有中文成果而推定。

现有 `consume-hosted-work-item.mjs --document-version-id DV --reading-run-ref RUN --lease-owner OWNER` 可精确消费/恢复已有任务；省略 reading-run-ref 时，document_work STATUS 提供已准入的 nextReadingRunRef。既有活动任务仍先消费；显式 reading 和 activity ref 不得同时传入。

消费顺序为 STATUS、CLAIM、带租约的 READ 分页、官方 Hosted 模型、SAVE。READ 按原文单元读取，包括尚未分章节的单元；实际交付不足只标 PARTIAL_DELIVERY，不冒充全篇理解。模型输出仅包含 schemaVersion、headline、brief、explanation、criticalConditions、limitations；所有解释性 statement 的引文必须逐字匹配实际交付 anchor。Host 决定来源绑定、覆盖范围、保存版本和候选身份。引用校验不是语义正确性或工程接受的证明。

## 恢复与错误

检查点按 Host endpoint（不含凭据）、文档版本和 runRef 隔离，并校验 parseRun/semanticRevision/expectedRevision。先持久化 model.started，再调用模型；持久化 model.result 后才准备保存。保存前持久化 save.started。模型结果未知不重调；保存结果未知只查准确原 run 的 STATUS。SAVED 回执始终比对已有提交内容、来源及真实 producer；CLAIM 并发完成需重读检查点。

明确的应用校验失败返回 REQUIRES_ATTENTION 和安全错误代码，保留诊断，不自动重试模型/SAVE。不确定的传输结果保留 PENDING_MODEL_CONFIRMATION 或 PENDING_SAVE_CONFIRMATION；不能把它改写成成功或直接创建后继。取消通过明确 READING_CANCEL；模型不能自动正式接受任何工程结论。

## 读取

浏览器沿既有身份/来源授权读取 `GET /api/document-management/document-versions/:documentVersionId/document-reading`，必须明确 parseRunId、semanticRevision，可明确 readingRevision。目录 documentReading 是该版本同一保存结果的轻量投影，携带 AVAILABLE / SOURCE_CHANGED / NOT_GENERATED 状态；更换原文或语义版本不能将旧解读当当前。关键否定、条件和源限制不得机械截断或被目录主题替代。
