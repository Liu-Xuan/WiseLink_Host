# 独立来源声明候选

本批把活动声明的生产与评估工作分开。已授权使用者显式选择准确文档、解析、已保存语义修订和章节，Hosted 生产者读取实际原文后生成候选；Host 校验并保存独立候选修订。它不要求先制造评估问题，不写 `DocumentSemanticMap`，也不把模型输出变成正式活动身份、已实施事实或工程采用。

## 接口与身份

沿用 `document_work` 工具名，增加下列动作。身份仍由 Host 的现有文档授权提供。动作的完整运行时 schema 位于 `document-activity-runtime.service.ts`；声明 schema 位于 `shared/document-activity.interface.ts`。

| 动作 | 除 action 外的参数 | 返回 |
| --- | --- | --- |
| ACTIVITY_BEGIN | documentVersionId、parseRunId、semanticRevision、requestId、expectedRevision、sectionIds | 明确受理的 run 摘要；同 request 与相同参数读回原 run |
| ACTIVITY_STATUS | documentVersionId、runRef | 原 run 状态；SAVED 时含原 result |
| ACTIVITY_CLAIM | documentVersionId、runRef、leaseOwner | 摘要及 fence；未取得租约时 fence 为 null |
| ACTIVITY_READ | documentVersionId、完整 fence、sectionId、offset、limit（1–50） | 实际完整 units、anchors、原文绑定、章节及祖先条件、range.nextOffset 和覆盖限制 |
| ACTIVITY_HEARTBEAT | documentVersionId、完整 fence | 续租结果；失效租约拒绝 |
| ACTIVITY_SAVE | documentVersionId、完整 fence、candidate、producer | 不可变候选修订；原命令重放返回相同结果 |
| ACTIVITY_FAIL | documentVersionId、完整 fence、errorCode | 本 run 失败状态 |
| ACTIVITY_CANCEL | documentVersionId、runRef | 本 run 取消状态 |

fence 包含 runRef、leaseOwner、leaseToken、leaseGeneration。租约为两分钟且不超过受理时固定的一小时期限；续租不改变绝对期限。普通 `document_work STATUS` 只发现已显式受理的 `nextActivityRunRef`，不自行 BEGIN。解析 STEP、INDEX 与中文阅读保持原路径。

Hosted 生产者必须沿用已配置的官方模型执行器及真实版本信息；不为该流程更换 profile、扩额或创建 cron。SAVE 回执未知时读取原 run 的 STATUS/result，不能换请求号重生成。失败、取消和过期不覆盖已有 SAVED 候选。

## 来源和候选边界

模型只提供请求内 statementKey、标签、精确 quote、时间候选解释、来源状态原话及限制。quote 的 anchorId 和 UTF-16 起止位置必须属于本 run 已登记的 READ 回执，文字必须与完整原文 anchor 的对应范围逐字一致。表格单元格使用已有 source plan 的 payloadPath 和真实 SourceRef，不转换成日期正则。

时间分别表达含义、精度、CALENDAR/TBD/RELATIVE/UNKNOWN 和来源原话。季度目标不是每季度重复；来源发布、生效、预计与发生分开，系统取得时间不交给模型填写。未提、未读、未定及明确取消不能互代。

Host 分配 statementId、runRef 和候选 revision，保存完整已交付 anchors、原文 binding、准确 semanticRevision 及范围回执。覆盖仅为 `DELIVERED_RANGES_ONLY`，不是全文完整，也不是工程评估覆盖。首批没有跨版同活动自动关联；后续工作引用准确已保存声明身份，不改写源声明。

## 存储和读取

`dm_document_activity_run` 保存请求、执行控制和终态候选修订。请求在 tenant/actor/requestId 内唯一；候选 revision 在 tenant/DV/parseRun 内用现有文档行锁串行 CAS。SAVE 短事务重新核验来源/语义绑定、权限、lease 和 expectedRevision，成功后清除租约字段。终态与原受理参数由数据库触发器保护。

原生浏览器仅能读取获授权的 SAVED 记录，不能读取活动租约或写入执行状态。`GET /api/document-management/document-versions/:documentVersionId/activity-reading?parseRunId=...&candidateRevision=...` 返回准确原文绑定、familyId 和候选；未保存返回 null，不解释为没有活动。GET 不发起生产，显式候选修订不切换到最新。客户端保留会话代次与 abort 检查。

## 验证与剩余范围

隔离原文测试验证精确引用、表格、TBD、覆盖及浏览器身份；隔离 PostgreSQL 使用现有来源授权函数验证请求重放、并发租约和 CAS、跨租户及撤权拒绝、不可变结果、取消/过期与 SAVE 恢复。实际本地 MCP HTTP 传输经过已安装 Skill 的工具清单校验，新动作正常分发，旧 INDEX 不变。

这些本地证据不代替 Hosted 真实模型生成及线上业务读回。后端 Skill 消费者、首个获准来源候选的真实保存、T1/T2 生产视图、跨版活动关联及完整改版评估仍需按接受范围继续。
