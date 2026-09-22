# 评估智能体 A：执行能力接续

## 范围与基线

A负责文档/事项解析后的关联上下文、JobAid动态问题分析、已准入来源按需取数、候选工作增量保存与真实过程可见。系统通用提速由另一管线负责。主控统一集成、同步、发布；可见Luna负责独立测试验收。

本批父提交为 `0ee978c45346a3ecacbf425cc183657562dfef9c`，在既有独立 perf 工作树继续开发。只修改下述OpenClaw执行文件及本记录，不重做活动首切；不包含B的 `aac9bd64ee80fb9a967d64c05aed120b42c12350` UI修复。本批逻辑不依赖该UI修复；整体发布需主控按接受范围组合。未改canonical目录或B工作树。

## 已有执行能力与后续核查

- 已有共同上下文、原文来源目录、JobAid方法、前次完整工作；模型通过 READ_SOURCES / QUERY_KNOWLEDGE / SAVE_WORK / FINISH 选择动态问题组，不新增固定问卷。
- 已有Aily知识查询请求身份、读回和未核原件边界；不能把知识查询记为受控事实，也不能虚构其他数据源已准入。
- 已有同一会话多次保存、Host来源验证与CAS、精确工作回执；Matter逐轮checkpoint和保存响应丢失恢复已存在。
- 活动首切已交付，但不代表完整智能体目标完成。WorkItem运行恢复与当前attempt可见性仍需后续按真实反例推进。
- WorkItem外层model checkpoint尚未接入逐轮assessment checkpoint，且consumer对Host BUSY返回、工具调用回执缓存、失败取消是相关控制路径。不能仅传入一个checkpoint参数就宣称安全恢复；下一批须核对同一请求重新进入、fresh lease/source授权及未知模型结果不重放，再决定实现范围。

## 本批修复：重新评估必须有本轮保存

`run-jobaid-problem-assessment.mjs` 原来对非Matter任务无条件把previousWork作为saved。具有前次已完成工作的EVALUATE_JOBAID若首先FINISH，驱动会返回旧workRef；Host的canonical-jobaid-problem.service既有提交校验要求当前attempt保存，只有Overall一致性允许前次工作，因而真实提交将拒绝。

现在普通重新评估的saved从空开始，前次正文仍完整留在模型上下文；模型直接FINISH会收到现有JOBAID_COMPLETED_WORK_REQUIRED反馈，可继续SAVE_WORK后完成。Overall明确匹配SYNTHESIZE_OVERALL与OVERALL_CONSISTENCY时仍可核对后复用旧工作；Matter已授权resumeSavedWork沿用。没有自动生成工程结论，没有自动复制/保存旧正文，没有修改Host正式采用、来源和版本边界。

## 直接验证

新增反例修改前失败：模型仅调用1次并返回旧引用；预期完成纠正、保存、结束共3次。修改后得到新引用JAWR-4、expectedWorkRevision=3，前次JAWR-3保持不变。

- node --test openclaw/skills/wiselink-research-and-synthesize/tests/jobaid-problem-runtime.test.mjs openclaw/skills/wiselink-research-and-synthesize/tests/consume-hosted-work-item.test.mjs：68/68通过。
- node --test openclaw/skills/wiselink-research-and-synthesize/tests/consume-hosted-matter.test.mjs openclaw/skills/wiselink-research-and-synthesize/tests/consume-hosted-matter-correction.test.mjs：22/22通过。
- git diff --check：通过。

这些是本地受控模型/工具驱动证据，不是实际Hosted模型验收。真实验收应使用明确获准的重新评估任务，确认原工作保留、本轮新保存、准确FINISH与Overall引用关系；不要为测试重放未知在途请求。需要主控部署相应Skill脚本，单独Host发布不会安装此改动。
