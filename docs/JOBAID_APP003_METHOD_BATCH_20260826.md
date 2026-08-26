# Job-Aid APP-003 真实评估方法窄批次

## 选择结论

本批次只实现 `APP-003`（机体/机载系统适用性分支选择）。它是 14 条“已有 PDF 证据但缺少方法”中最适合 737-34-3830 actual SB 的最小高价值桥梁：同一 frozen.2 包内既有飞机 `Effectivity`，也有 Flight Management Computer 拆换工作及 SourceRefs，足以识别“部件适用性 owner 必须参与”，但不足以由 Job-Aid 自行计算航空公司单机适用结论。

规则、CriterionSet 与 owner 均不复制：继续使用 Job-Aid v0.2、150 条及 `JACS-72D0484B6F1C17A38F671F46`；部件分支只依赖既有 `APP-001`、`APP-002` 和 FleetMasterData applicability owner。

## 六段工程师呈现

`evaluationItems[APP-003].method_execution.engineerPresentation` 固定包含：

1. `evaluationProblem`：该工作只依赖机体构型，还是还依赖装机部件；
2. `lifecycle`：当前为 `APPLICABILITY_DISCOVERY`，并显示精确 availability reason；
3. `requiredEvidence`：Effectivity、affected parts/work instructions 以及既有 owner 结果；
4. `sourceFacts`：来源字段摘要与真实 frozen.2 `sourceRefIds`；
5. `specializedMethod`：工作对象发现、分层、owner 路由；
6. `authorityBoundary`：机器只分类和路由，工程师基于受控 owner 结果复核，所有输出 `candidate_only`。

## 状态语义

- 来源路由或既有 owner 结果未连接：`DATA_SOURCE_NOT_CONNECTED`；
- 方法尚未实现：`METHOD_NOT_IMPLEMENTED`；
- 来源负观察仍需工程师确认：`ENGINEER_DECISION_REQUIRED`；
- 尚未进入对应生命周期：`LIFECYCLE_NOT_REACHED`；
- CriterionSet 谓词为 false：`NOT_APPLICABLE`，绝不显示为 PASS。

这组状态是解释型呈现元数据，不改 CriterionSet predicate、Job-Aid 决策或 currentness。

## 最窄后续接线

Host private assessment composition 在同一 WorkItem/current revision 下向 APP-003 绑定既有 APP-001/APP-002 与 FleetMasterData owner 候选结果；若 owner 未连接，保持 `DATA_SOURCE_NOT_CONNECTED`。无需改 shared DTO、公共 router、DB schema、ActionAttempt 队列或 UI 真源。

## Non-claims

- 未执行 Hosted ActionAttempt 或 OpenClaw；
- 未证明真实 FleetMasterData owner 已绑定；
- 未生成工程师结论、EvidenceRef、current projection 或发布决定；
- 未把 737-34-3830 的厂家 Effectivity 提升为航空公司单机适用性；
- 未宣称其余 13 条方法已实现或 150 条已可运行。
