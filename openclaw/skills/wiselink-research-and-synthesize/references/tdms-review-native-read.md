# Review TDMS 来源：保存依据与有界新读取

这是 Native 源码的配套协议，须与支持新工具的 Host 和正常安装的新包一起使用。源码测试不表示已部署、已安装或已执行生产读取；已安装 c234 的原包与记录保持独立。普通 Review、旧 saved-only 任务和 COMMITTING 恢复继续各自原路径。

Host 在 c5 `UPDATE_ASSESSMENT` / JobAid `PROBLEM_REVIEW` 的 `tdmsReviewContext` 槽中只选择一种严格结构。wrapper、modelInput 和返回的 `context.problemAssessment` 必须完全相等，不能混入普通 `tdmsContext`。

- `wiselink.tdms-review-saved-context.v1 / SAVED_EVIDENCE_ONLY` 保持原九键与非空 `evidenceRefs`。它只交付指定 previousWork 中已有的原始 native carrier，不授予新 READ。
- `wiselink.tdms-review-runtime-context.v1 / BOUNDED_NATIVE_READ` 恰有十键：`schemaVersion, mode, reviewConversationRef, reviewTurnRef, requestId, inputRevision, workRevisionRef, workRevision, savedEvidenceRefs, runtimeContext`。`savedEvidenceRefs` 可空，只能是准确 previousWork 中已经初始交付的 native refs；`runtimeContext` 是原完整 `wiselink.tdms-runtime-context.v1` 的 `binding/selections/projection`。其 taskContextRef 必须等于本次真实 begin envelope 的 operationRef，不能从旧 READ、requestId 或模型内容猜测。

新目录只含元数据，`readPerformed=false`。source/set/cohort/member、SourceVersion、Estimated、own approval 与覆盖缺口保留。目录 ref 不自动进入 sourceCatalog、deliveredEvidence、previousWork 或已读集合；只有原已保存 carrier 才能按其历史身份初始交付。Estimated 表示源评估自身的批准状态，不证明执行或正式采用，也不把父单、稳定版本或同 ATA 的其他记录当作该评估的批准。

模型继续只调用 `read_wiselink_review_sources({sourceRefIds})`。确定性 driver 先验证整个非空、唯一、至多 100 refs 的请求，再分流：

- 普通 frozen resource/dialogue refs 沿 `read_source_refs`。
- native refs 沿 `read_review_native_sources`。native 子集最多 96，超过时在任何 Host READ 前拒绝整个请求，不截断或拆批绕限。控制面参数由 begin closure 提供：准确 `attemptRef/workItemId/leaseToken/leaseGeneration`、`sourceRefs`、非空至多 2000 字符 purpose，以及必填 `context:'EXACT'`。不提供 PAGE，不向模型提供权限工具。

新工具是严格可识别的可选 capability。旧 Host/旧 task 不增加必需工具；只有新的 runtime addon RUNNING 任务在模型前要求它。COMMITTING 在 context、模型和 capability 新要求之前恢复封存结果，不 READ 新源。当前 isolated candidate 仍只预读普通 document，不因新目录扩大读取或保存。

Host 的 `wiselink.jobaid-source-read.v2/v3` 回包必须 AVAILABLE、EXACT、completeRequestedScope=true，具有准确请求 refs、完整 native carriers 和与 carrier 全等的原 `nativeReadReceipts`。每条 fresh receipt 的 taskContextRef 等于本次 operationRef；source revision、字段 selector、selected set/generation/cohort/member、Estimated 和 own approval 都必须与冻结目录吻合。Host 独立保有真实 READ receipt 与受租约/来源授权保护的 `ASSESSMENT_SOURCES_READ` journal；目录、dispatch activity 或 Native 观察不能代替它。

driver 私有 observations 和 checkpoint 保存原始 packet/receipt。只有模型展示副本省略这两处控制字段：

```text
sourceRefs[i].nativeReadReceipt.taskContextRef
sourceRefs[i].nativeScope.processingSetBinding.scope.tenantId
```

模型只收到按原请求顺序排列的来源展示数组，不接收 packet envelope、重复 receipts 数组或 runtime binding。模型 receipt 是 `Omit<NativeReadReceipt,'taskContextRef'>`，不能交给原 receipt parser、SAVE 或授权函数。receiptRef、readAt、permissionRevision、fieldPaths、sourceVersion、正文与 approval 全部保留。旧保存 carrier 的历史 receipt 不改写。

初始模型 addon 另投影为仅 `{schemaVersion,mode,projection}`，只在已验证的 `opinions[].scope` 与 `cohorts[].scope` 删除 tenantId；旧已交付 carrier 继续第一段已审投影。所有实际 READ 到模型的路径，包括自动补读、缓存、纠正反馈与 checkpoint replay，都经过原 sanitizer 和按精确当前控制值拒绝的 guard。来源 title、excerpt、receiptRef 或 permissionRevision 含当前控制身份时直接失败，不能全局替换正文、递归删字段或放宽禁词。isolated 完整 generationInput 也在 Gateway 前检查。

候选解析、artifact sealing 与 commit readback 共用已完整复验原 task 和原始 observations 形成的 decision catalog。新 carrier 仅扩本次 delta 可用证据，不修改 sealed task。相同 ref/正文保留首次 carrier，独立新 receipt 仍在 Host journal/原始观察中；正文/source/set/approval 改变则拒绝。新的 native ref 仅放在合法 JobAid delta 及内联引用中，顶层 sourceRefs 和 candidateEvidenceRefs 继续原 artifact/attachment 语义。UNCHANGED 仍须读取准确当前 dialogue contribution，不强制读取未使用的 TDMS 目录。

原模型请求数、30 分钟总预算、heartbeat、纠正次数和无进展限制不扩大。Native 结构验证不是当前授权证明；source audience、actor/tenant、租约、取消、保存事务、CAS、当前版本和正式采用继续由 Host 决定。
