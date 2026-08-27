# d3ce25f → R09 c4 迁移与 owner 集成矩阵

本版本从历史 `d3ce25f43a926a9bfa0d7d5d982f18f71e679f9f` 的同名 Skill 原位升级到 Host C4+C5
`df4bd1a5c0698c5fd56912fba1329a9283d990c6`，不创建第二 Skill。

| 历史资产/语义                         | R09 c4 处理                                                                                          | 当前 owner                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `SKILL.md` 单一 Skill 主控            | 升级为 INITIAL_ANALYSIS + INTERACTIVE_REVIEW 双 mode                                                 | Skill 编排；Host 授权/业务真源                       |
| `agents/openai.yaml`                  | 原位升级默认提示，不新增 Agent/Profile                                                               | 妙搭唯一 profile `wiselink-engineering`              |
| dynamic N/N                           | 保留动态 N、criterion 全量唯一同序、SourceRef criterion allowlist                                    | Host CriterionSet/EvaluationContext；Skill validator |
| FALSE/UNKNOWN/TRUE predicate          | 完整保留；UNKNOWN 只能来自 Host missingPredicateKeys                                                 | Host predicate；Skill 不改写                         |
| Reader `resultCount/results[]`        | 保留；明确不是 applicability assignment                                                              | Host Reader/source currentness                       |
| actual-byte/fresh-current             | begin 前后 status；Task artifact ref/SHA；commit 交 Host ResultGate/persist/readback/CAS             | Host                                                 |
| candidate-only                        | 全部结果保留候选；review commit 五个 authority flag 必须为 false                                     | Host current/ReviewAction owner                      |
| gap-driven discovery                  | 保留选择性 provider、状态保真、未采纳非证据                                                          | Host SearchRun/DM adoption                           |
| unknown commit                        | 升级为一次 exact readback、no blind retry；translation 缺精确读回则 unknown                          | Host status/recovery                                 |
| 旧 9-tool `{attemptRef,output}`       | 删除；改为 exact20、lease token/generation、完整 ResultEnvelope                                      | Host MCP 1.2.0                                       |
| 旧 Host SHA `9fbafb55…`               | 删除；当前基线 exact `df4bd1a5…`                                                                     | Host C4+C5 accepted successor                        |
| `scripts/orchestrate-host-mcp.mjs`    | 增加 applicability，统一五类 attempt COMMITTING/commit-loss 只读恢复                                 | Skill control flow                                   |
| `scripts/validate-payload.mjs`        | 保留 dynamic/discovery/overall validators；新增 Task/Result/translation/review/provenance validators | Skill preflight + Host final gate                    |
| fixtures/tests                        | 保留历史 hosted 737/dynamic fixture；新增 C2 review task/candidate fixture 与双 mode tests           | 本地合同证据                                         |
| ZIP installer                         | 不迁移；不能作为官方托管 runtime                                                                     | 官方托管 Skill UI/合同待 UAT                         |
| `archive/internal-lab/phase13-ab.mjs` | 排除                                                                                                 | 历史实验，不属 R09 runtime                           |

## Assessment 与 review owner 边界

- Dynamic 只消费 Host 当前 authority-free seam；历史 Base AI、Workbench/Registrar、Base record identity 不进入
  Skill。Host projection 的 `baseRules` 仅为兼容名。
- EvaluationContext、CriterionSet、rule artifact actual bytes、engineer-review ledger、revision/current/STALE 和 CAS
  仍由 Host 拥有。
- 同 criterion 的工程师 review history 必须连续保存；effective 取最后一条。Skill 只读脱敏语义，不创建或
  重写 ledger。
- ReviewActionDraft 是候选。ReviewAction、affected-only reevaluation、overall r2、旧结果 STALE 和新 current
  仍是 Host/用户确认后的后续链，C2 review tools 不执行它们。
- base revision/source identity 漂移、未知/重复 SourceRef、旧 lease 或旧 expected revision 必须由 Host fail closed；
  Skill validator 是前置防错，不替代 Host transaction/unique constraint/type/test。

## 当前缺口

1. Review attachment/search/compare/reevaluate/resynthesize 没有 C2 工具，保持 fail closed。
2. 本地测试没有调用官方托管 app/profile/model，不能证明 Skill 已安装、Host MCP 已在 UI 可见、业务 Session
   create/resume 可用或逐 turn no-fallback provenance。
