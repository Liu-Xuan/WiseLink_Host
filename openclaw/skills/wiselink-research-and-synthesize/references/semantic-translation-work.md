# 语义块翻译 v2

只在 Host 返回 `wiselink.3_1.translation_task.v2` 时使用本流程。驱动为 `scripts/run-semantic-translation.mjs`，单次模型适配器为 `scripts/invoke-hosted-translation-block.mjs`。v1 的逐 unitKey 输入、窗口纠正和全文回传仅用于历史协议，不套用到 v2。

## 输入与生成

`begin_translation({workItemId,requestId})` 返回已绑定 DocumentVersion、解析产物和 TranslationWorkspace 的任务指针。驱动通过 `translation_workspace` 的 NEXT 领取完整语义块批次；分片只运输同一个批次的完整 JSON 字节，READ_BATCH 收齐并校验后才调用模型。原始片段、语义块、请求批次与阅读元素分别保留，不能反拆自然译文填回旧 unitKey。

模型仅接收本批完整块、真实来源锚点、原始结构与相关上下文引文，包括定义、条件、术语及警示作用范围。段落可引用多个来源片段；列表保留项目身份；表格单元格只能引用同一真实格内的锚点。Host 保有布局和定位，模型不能猜坐标、重建表格或修补 OCR。上下文文本不是额外待翻译范围。

每个登记的 GENERATE、CORRECT、CHECK/CHECK_BATCH 请求使用一个新的短原生会话，最多一次远程请求，默认并发为 1。生成批次优先容纳完整块，初始调度目标不是模型上下文上限；大块不裁切。一次响应至多 15 分钟，并受原 attempt 剩余 deadline 限制；每次请求前及返回后由驱动续租。M3 仍按已有授权申请官方配置允许的最大输出额度。

请求使用已支持的 `tool_choice=required`，输出只调用 `return_wiselink_translation_block`，参数为严格 JSON 字符串 `candidateJson`。GENERATE/CORRECT 返回 `{blocks:[{blockId,elements:[{kind,translatedText,anchorIds}]}]}`；可以返回完整块组成的连续前缀，不能返回截断块或拼补 JSON。CHECK 只返回目标块及定位明确的 issues，不改写译文。modelVersion 优先使用网关响应中的可读模型字段；官方网关只返回 profile 别名时，沿用绑定任务的 `configured-route:<modelRef>` 路由回执，表示平台未报告模型版本，不声称已验证下游快照。观察记录分别保存已选路由、实返模型（未提供为 null）、来源种类与网关响应 ID；Host 核对路由回执和 sealed task 一致。不得因此切换模型或丢弃已收到的完整候选。

新驱动在 NEXT 声明 `batchSemanticChecks=true`。Host 按完整块、6000 原文字符调度目标和最多 32 块登记 CHECK_BATCH，冻结每块 blockId、blockRevisionId、rowVersion；单块仍使用 CHECK。批量输出为 `{checks:[{blockId,issues:[{code,severity,message,anchorIds}]}]}`，与块顺序严格一致，不接受漏项、重排或跨块锚点。Host 在同一已授权、带租约与 CAS 校验的事务内保存全部检查，逐块决定可读性；任一版本变化使整批回滚。相同结果重交只读回原记录，不再调用模型。旧驱动未声明批量支持时继续使用单块协议。

## 保存、质量与恢复

驱动先 SAVE 实际正文，再由 Host 执行来源/结构/条件/数字关系等检查，必要时安排同一获准模型的有界语义检查或一次局部纠正。BLOCK 阻止该块成为可读候选；REVIEW 允许阅读并显示限制；NOTE 不触发重译。检查通过不等于工程批准或翻译正确性的保证。原文图内文字未提取、OCR 等问题保持 SOURCE 身份，模型不能自行清除。

保存以 workspace、generation request 和 block 绑定；相同请求内容冲突明确失败，正文与来源版本不可覆盖。保存响应未知时先 READ，再仅重交同一幂等保存，不能重新生成。HTTP 408/504 或传输中断不证明远端已停止；记录 GENERATION_UNKNOWN 并停止当前运行。原生 profile 的全部内部工具权限尚未证明为纯生成，因此不启用未知生成的自动补发。HTTP 200 无有效函数候选属于输出协议失败，不当作自动可重试网络故障。

只对 CHECK/CHECK_BATCH 的已知等级 BLOCK/REVIEW/NOTE 统一字母大小写（例如 block → BLOCK）；不修改等级含义、正文、锚点或其他字段，未知等级仍拒绝。输出先在 B/A/U 别名范围内校验，再恢复 Host ID 并复核。失败时另存 `translation-<generationRequestRef>.output-shape-2.json`，只包含首个失败字段路径、固定原因、类型与数量；不保存模型字段正文、未知键名或私有思考。检查失败不补发模型、不部分采用同批检查，也不把日志缺少细节当作已定位原因。

取消或到期后的迟到写入被 Host 拒绝。之后正常新 attempt 可接续同一 workspace，已保存、已检查版本按实际依赖复用，旧模型来源继续显示；不能复活旧终态、换 WorkItem 掩盖失败或冒充新模型重新生成了旧正文。块保存不推进全局 WorkItem revision。

页面的“继续中文翻译”或“重新翻译此完整块”通过 Host 保存明确的正常请求。消费者采用 Host 阶段返回的 requestId 领取同一请求，并使用该请求独立的本地检查点。回执未知时重读同一 requestId；终态只返回原回执，不再次领取。指定块的重译保留旧可读版本到新候选检查通过，最终组装必须确认指定块已由本次请求替换；未替换则明确失败，不能把旧完整正文当作本次重译成功。页面按 workspace 版本读回部分进展，不依赖块保存推进 WorkItem revision。

## 阅读与最终提交

Reader 从 Host 保存结果显示 PARTIAL、COMPLETE_WITH_ISSUES 或 COMPLETE，区分已保存、待检查、可读与待处理。点击自然段显示其全部实际来源；复制与导出保留完成范围及缺项。人工修订生成独立版本、明确人工来源，保留旧模型正文，仍是阅读候选。

所有可做批次结束后，ASSEMBLE 由 Host 读取当前选用版本、保存最终产物并返回 manifest。模型不重印全文；最终 ResultEnvelope 仅引用 Host 产物与精确 manifest，使用实际 Skill c47 和 `wiselink-translation-block@r09.c47`。即使全部复用旧块，最终组装也必须使用 v2 运行协议，且实际模型记录为 `host-assembly/no-model-call`。提交继续通过既有 `commit_translation_candidate` 字节分片与 FINALIZE，最终提交未知只查询原 attempt 的精确结果身份。

`WL_TRANSLATION_V2_ENABLED=1` 用于启用新请求；旧 v1 译文继续独立读取。已有 v2 workspace 可恢复。直接使用已验证英文的 Applicability/JobAid/Overall 保持各自真实来源与授权，不用虚构中文满足旧前置条件。知识产品导入仍要求对应最终提交和当前选用版本，部分可读范围不冒充完整或正式采用。

模型输入使用本次短会话的 B/A/U 别名；适配器按确定性映射恢复 Host ID 后，仍做原有范围和结构校验。原文在 anchors 保持完整，sourceStructure 的同一文字位置改为 sourceAnchorId 引用，保留列表、表格行列/跨度/脚注及完整上下文。租约、工作区控制字段和 SourceRef 定位元数据留在调用方。任何映射不一致在请求前明确报错，不删减原文或猜测修复。
