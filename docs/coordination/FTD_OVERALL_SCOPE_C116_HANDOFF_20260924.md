# FTD Overall 精确作用域候选（2026-09-24）

本地候选以 c115 修订提交 `22383092d2198234fdb19e956b30d4931badb9cf` 为父提交。
它准备 FTD JobAid **成功保存后**的 `SYNTHESIZE_OVERALL` 单阶段；不改变翻译、
适用性、Review、事项、文档或正式采用的授权。主控曾报告 c115 Host 技术发布
SHA 为 `43c4e33a3a97a38c36c18681cc1013ba81a006f0`；本轮对同一 release
`7688907528675527897` 的最终只读 `release-get` 回执显示 `finished`、
`commit_id=def68384f5deef7f0976e31138b10a3464b63ee8`、`error_logs=[]`。
两 SHA 不一致，且二者当前均不在本机 Git；主控须先核对实际发布源码、准确差异
与父提交，再选择性集成本候选，不能仅凭本地测试视为部署。

## 当前只读证据与前提

- 线上 `WI-990d6e76-78d4-440a-a419-1b2e37b94ac9` 仍是 revision 3、
  `CANDIDATE_READBACK_VERIFIED`，documentVersionId 为
  `document_version_b83523c2b5ba26a2b1753641`；当前 integratedAssessment 的
  baseRules、Overall 与 applicability 均为空。ActionAttempt 只有一条已成功的
  `PARSE_PDF`；没有 JobAid 或 Overall attempt。读回日期为 2026-09-24。
- Host `deriveProgression` 将适用性 `WAITING_INPUT` 视为非阻断；JobAid `SUCCEEDED`
  后，Overall `PENDING` 才可能成为 `nextOperation`。实际运行必须再次读取 Host
  状态，并使用 `--max-initial-stages 1 --expected-initial-operation SYNTHESIZE_OVERALL`。
  预期操作不匹配时在 begin/model 前停止。当前线上仍未满足 Overall 前提。
- 本批没有核验或扩张模型预算、来源准入或线上服务配置；c115 Skill 仍未安装，
  额外 WorkItem 环境变量仍缺席。没有运行 Hosted 模型或业务写入。

## 接线与隔离

- 额外 WorkItem 的 `BEGIN_OVERALL`、`RESUME_OVERALL`、`COMMIT_OVERALL` 与既有
  JobAid attempt 来源/工作、状态、心跳、取消工具都携带显式 WorkItem ID。
  省略 selector 的旧调用仍落到原单值任务；原授权指纹保持不变。
- Host 对 `tenantId + workItemId + attemptRef` 做持久查询。Overall resume/commit
  要求 `OPENCLAW_OVERALL_SYNTHESIS`；显式 selector 的通用 attempt 工具只接受
  Dynamic 或 Overall 类型，拒绝翻译、适用性与 Review。Overall 的 TaskEnvelope
  与行、来源、lease、当前 DocumentVersion/revision 和 CAS 仍经既有服务验证。
  `CanonicalJobAidProblemService` 的工作接口同时服务 JobAid 与 Overall v2，按
  当前 attempt 的任务输入和 Host 授权来源表读取，不把相关材料自动提升为权威依据。
- c116 只增加 Overall 单阶段预期操作锁和远程 selector；checkpoint 仍按原参数
  计算哈希，外围 binding 冻结任务、文档版本与阶段，旧阶段进度可读回。

## 集成和真实验证边界

先独立审查本分支相对 c115 的差异，确认与主控已发布的 Host SHA 一致，再决定
选择性合并与技术发布。Skill 如需安装，必须用与接受提交匹配的实际包哈希，并
读回安装版本。任何真实运行前，主控核对 FTD 当前版本、JobAid 已保存工作、
Overall `PENDING`、来源权限、冻结预算、运行队列与恢复记录；单阶段消费之后
读回 exact WorkItem revision、Overall attempt、工作引用和来源覆盖。失败或
未知提交先查原 attempt，不重启模型或改造 Host 的 current/CAS。技术发布、安装、
本地测试均不算业务验收。
