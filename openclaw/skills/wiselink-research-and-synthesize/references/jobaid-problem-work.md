# JobAid 问题工作协议

本协议适用于 `wiselink.jobaid-problem-task.v2` 与 Review c5。先发布双读 Host/Skill，再由 Host 的 `WL_JOBAID_PROBLEM_V2_ENABLED=1` 为新任务选择本协议。既有 TaskEnvelope 的版本与身份保持不变。

## 完整认识与来源

模型首先收到文件概要、实际可读来源目录、JA 方法条款、受控适用性摘要和前次完整工作。目录只说明资料可用；通过 Host 阅读精确来源或展开同页，才能把正文用于新结论。工程师陈述、受控事实、原文、方法和历史候选保持各自身份。方法条款不是证明当前对象技术后果的事实。

围绕真实问题保存完整判断、支持/限制/冲突前提、风险情景、措施价值、其他分类、未决问题与相关原文义务。没有固定问题数、准则行数、每行字节预算；短摘要和详细正文来自同一工作版本，不能靠裁剪删掉条件、否定、紧迫性或重要未决项。

模型给出稳定 `issueKey` 与 `claimKey`；Host 保存完整身份。每个前次问题必须恰好出现在 changed issues、`unchangedIssueKeys` 或带理由的 `retiredIssues` 中，不能静默遗漏。普通新证据只修订受影响的问题。

## 风险与方法版本

JA-AC 的严重性是 3/5/7/10，可能性是 10/7/5/3；Host 计算其乘积及五级分界。未知保留 null，不填零。六类重要事件须有实际情景依据，并保留严重性/提级管控要求；严重性 7 不是自动四级风险。SAE Category、源文件级别和 EO 属性不换算为 JA 风险。

四/五级等适用义务保持原有强度与条件；工作是候选，不表示要求可忽略，也不自动发出限制、放行或正式指令。没有可靠性查询、装机事实或历史资料时明确写出缺失范围及对判断的影响。

首版方法包 `JA-PROBLEM-METHOD-20260909@1.0` 取自用户提供的完整设计资料；来源版本状态均为 `VERSION_UNCONFIRMED`。附件 5 的内容为设计附录转述，本轮没有取得可读独立 Excel，R00 与 R01 配套关系仍未确认。本包不激活或修改旧准则集。

## 保存和最终提交

- `read_assessment_sources`：携带已有 attempt lease、注册引用、读取目的和 EXACT/PAGE，Host fresh-authorize 后返回实际正文并持久记录已读范围。
- `save_assessment_work`：驱动提供 requestId、expectedWorkRevision 与完整 workJson；Host 验证来源、前次问题分区、actor/tenant、当前版本、lease/cancel 和 CAS，在既有 ActionAttempt 下追加不可变工作版本。
- `read_assessment_work`：读当前保存正文，或按原 requestId 恢复一次响应丢失。不得把没有保存的模型文字当作已完成工作。

`IN_PROGRESS` 是分析中的实质工作；`COMPLETE_WITH_OPEN_QUESTIONS` 表示本轮完成且保留业务未知；`COMPLETE` 不允许仍有必须保留的待确认或未处理事项。模型超时、取消和提交失败是技术状态，不自动改变工作完成含义。

初始/Overall ResultEnvelope 只提交 `workRevisionRef`，Overall 另带具体 `consistencyCheck`。Host 要求最新、同文档、完成的精确版本，并验证 `promptVersion=wiselink-jobaid-problem@v2` 和 `toolVersions['jobaid-problem-protocol']='2'`。旧模型不能靠填空通过此合同。

## 连续 Review 与消费者

Review c5 沿用已有五个 Review 工具。文档和附件只经注册 SourceRef 阅读；方法条款单独提供，不能伪造为 Artifact/SourceRef。模型以 `jobAidWorkingDelta` 给出完整局部修订，普通回答可用 null。Host 在同一 actor 事务里追加工作并持久化回答，失败时一并回滚。它不执行 ReviewAction、正式采用、签署或发布。

页面、列表和 quicklook 读取最新保存工作；旧 Overall 明确标为基于更早版本。已封存的旧 Dynamic/Overall 页面继续读取原 artifact。AEO 的旧准则行投影在首版明确不支持新问题结果，返回 `JOBAID_PROBLEM_AEO_PROJECTION_UNSUPPORTED`，不能生成假 N/N 表格。

## 本地验证与运行边界

确定性验证覆盖 16 格风险矩阵、未知值、长条件、两轮局部纠正、来源注册与实际交付。原生驱动测试覆盖来源读取、实质保存、408 后保留工作、取消后停止以及响应丢失时读回原请求。独立 PostgreSQL 测试使用实际 RLS、SDK actor 事务和 Review 持久化函数，验证并发 CAS、取消迟到写入、两轮 Review 原子保存与重放。

这些是本地证据。真实模型评估、Host/Skill 发布和 M3/DLI 业务闭环由集成任务执行，不能从本地测试推断已完成线上运行。
