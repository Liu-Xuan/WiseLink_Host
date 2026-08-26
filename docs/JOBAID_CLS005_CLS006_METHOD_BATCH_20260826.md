# Job-Aid CLS-005 / CLS-006 真实评估方法窄批次

## 选择

本批次只迁入 `CLS-005` 和 `CLS-006`。两者可直接消费 737-34-3830 actual frozen.2 的 preserved page SourceRefs，不需要建立新解析器、LLM、外部事实源或第二套规则：

- `CLS-005` 分别检查 Alert Service Bulletin、AOT/All Operators Telex、SPECIAL ATTENTION；
- `CLS-006` 提取厂家 Compliance/Recommendation 原话和规范化观察。

继续使用 Job-Aid v0.2、150 条和既有 CriterionSet；输出均为 `candidate_only`。

## 关键边界

- `CLS-005` 只有 `accountingComplete=true`、`contentPreserved=true` 且存在全页 SourceRefs 时才可输出 `NOT_OBSERVED_WITH_COMPLETE_PRESERVED_TEXT`；负观察不伪造命中 SourceRef，也不等于“不存在”或 PASS。
- `CLS-006` 的 `No compliance time is given` 与 `Boeing recommends this service bulletin` 只属于厂家来源观察；`companyExecutionDecision` 固定为 `null`，由工程师结合其他受控证据决定。
- coverage 或原话来源未连接时为 `DATA_SOURCE_NOT_CONNECTED`；方法完成后仍需工程师解释时为 `ENGINEER_DECISION_REQUIRED`；predicate false 仍为 `NOT_APPLICABLE`，绝不显示 PASS。

## 六段工程师呈现

两条的 `method_execution.engineerPresentation` 均包含：`evaluationProblem`、`lifecycle`、`requiredEvidence`、`sourceFacts`、`specializedMethod`、`authorityBoundary`。

## Non-claims

- 未创建工程师决定、EvidenceRef、公司执行决定或 current projection；
- 未运行 Hosted ActionAttempt/OpenClaw；
- 未声明三标志不存在，也未声明厂家推荐等于公司执行；
- 未实现其余 Job-Aid 条目或宣称 150 条已完成评价。
