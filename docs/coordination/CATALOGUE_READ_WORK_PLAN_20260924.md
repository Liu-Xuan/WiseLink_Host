# 工程知识目录读取优化职责与验收

## 当前证据

代码基线 d1858281bd5af864192facdeb352090fe1d971a3，父 c5445dfec677b911957f2753bf8103566dcea519。d185 的上线状态尚未取得权威回执；主控读取工具本轮返回空 items，不能据此判定已发布。

c544 ALL 的单次样本：20条返回、21条可见含lookahead，candidate_query 123ms，matter_exact_read 21次累计52121ms，read_group_wait 6次累计14742ms，app_server 14873.07ms、275 SQL spans。并行和递归阶段嵌套，不能相加，单次样本不代表p95。旧 def68384 样本保留历史用途。

## 函数职责表

| 实际路径 | 责任与保留边界 | 优化机会 |
| --- | --- | --- |
| EngineeringIssueSearchService.catalogue | actor校验，关键词/当前性筛选，40/5/4限制，拒绝继续扫描，错误传播，20+1游标 | 现有尾组裁剪保留；仅从授权结果生成entry |
| CanonicalJobAidProblemService.readBrowserRevision | 对象入口授权、确切修订加载、assertEvidenceOwned | 暂保留全部；不跨请求复用授权 |
| EngineeringMatterWorkingService.readWorkingRevision | 当前成员授权、确切保存读取、历史保留成员freshRead | current稳定性确认和历史成员复核不可命中旧缓存 |
| authorizedMatter | loadCurrent、freshRead、再次loadCurrent确认版本 | 可研究同窗口批量事实，但两次版本读取不可合成同一旧结果 |
| repository.readByRef / readModel | tenant/matter/workRef定位，命令/状态解析及一致性校验 | 完整状态仍是核验事实来源；不只抽标题绕过损坏 |
| authorizedReadModel / assertOwnedSources | 保存来源及原始文档所有权 | 保留；有证据后考虑同窗口逐根独立结果的批量化 |
| authorizedReadModel 的 overview_origin | 概述确切来源和receipt绑定，发现损坏 | 不因列表不展示来源就跳过 |
| authorizedReadModel 的 PRIOR_RESULT递归 | 当前/历史links授权、确切修订、循环及每条边内容绑定 | 可共享确切节点取数，但不能共享引用边结论或跳过递归上下文 |
| noticeAttempts / noticeSaves | 更正匹配、receipt保存绑定和通知数据合法性 | 已合并通知类型和保存查询；不能重复声称解决原有逐条查询 |
| knowledgeFromWork / jobAidReadingResult | entry外的阅读对象、问题正文映射、证据克隆 | 本批将entry独立投影，目录不再构造WorkItem详情对象 |

## 本批实际减少的工作及限制

目录改调用 knowledgeEntryFromWork；详情继续调用 knowledgeFromWork，并共享entry投影。WorkItem目录不再遍历issues生成issueArticles，也不再structuredClone evidence。全套reader与授权仍执行，Matter不再构造顶层详情包装，但其数据库工作未减少。因此本批只是A的可核验第一步，不能宣称解决21次Matter exact的主要瓶颈，也不能将完整读取改名算作完成A。

验证使用固定entry预期，检查目录不克隆详情证据而详情仍独立克隆；保留现有分页、拒绝、数据错误、并发上限和确切历史读取测试。测试对象由现有隔离fixture提供，不改线上业务。

## 下一项决策与完成标准

先取得d185细分日志，选择占比高且语义明确的事实读取做B。只补改变决策的缺口；不要求先部署本批投影再开始设计B。数据库或权限的动态事实不做跨请求缓存。最终新鲜复核与每条引用边验证保持独立。持续核对相同用户、scope、search、cursor和数据集；对照前根据重复基线样本约定延迟收益门槛。报告样本数、实际调用/解析减少及并发资源影响，不用SQL spans冒充往返数。

验收仍需完成主要Matter读取工作量下降、固定预期的授权/来源/错误/分页回归，以及真实平台重复对照收益。仅此代码拆分、单测通过或新增观测均不足以关闭Goal。C仅在A+B后大型静态状态解析仍占主要成本时评估。
