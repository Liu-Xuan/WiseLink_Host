# 妙搭官方托管 OpenClaw：模型容量与配置持久化定位（M3 / wiselink-engineering）

- 日期：2026-09-13
- 目标实例：妙搭官方托管 OpenClaw `app_17c3zn24kv2`（`https://miaoda.feishu.cn/app/app_17c3zn24kv2?from=aily`），唯一逻辑 profile `wiselink-engineering`，物理 Skill `wiselink-research-and-synthesize@r09.c96`，主用模型 `miaoda/minimax-m3`。
- 业务真源 Host 是另一应用 `app_17bzc551rsg`。
- 范围声明：本篇只针对**妙搭官方托管**实例。本机自托管 0.10 docker（`external/openclaw/.runtime`、`scripts/openclaw/write-openclaw-config.mjs`、本地 LiteLLM）的根因与数值**不适用**于本篇，见同目录 `M_CONFIG_LAYER_FORENSICS_20260913.md`（其"分层 merge / 改持久层 / 快照对链"方法论可迁移，但本机启动脚本结论不可套用）。
- 证据等级：标注【已证·代码/文档】【已证·容量实测】【待托管 UI/平台确认】，不把推断写成事实。

---

## 0. 结论速览

1. **容量参数（contextWindow / maxTokens / reasoning）不由 Host 掌握。** Host 的模型目录只是"路由标识白名单"，只持久化"选哪个模型"（modelRef + revision），没有任何容量字段【已证·代码】。想在 Host 后端调容量，此路不通，也不该在这改。
2. **16000 不是一个点，是两层独立来源叠加，两层都要放开才能突破：**
   - 我们自己的 Skill 中，**JobAid（动态问题评估）生成策略把请求额度写死为 16000**（`run-jobaid-problem-assessment.mjs` 的 `requestMaxCompletionTokens:16000`）；而 Review / Initial 路径已经申请 524288【已证·代码】。
   - 托管 Gateway 再把请求额度**夹限（clamp）到 wiselink-engineering 这个 agent 的模型条目 `maxTokens`（当前 16000）**【已证·代码注释/官方文档；实际生效值已证·容量实测】。
   - 现在两层都是 16000，所以任何请求都停在 16000；只放开其中一层会被另一层夹住。
3. **"改了全局/网关目录却回弹"是作用域用错，不是环境重置。** OpenClaw 的全局（`-g`）按设计**不覆盖** agent 自己的显式条目（`-a`）；之前改的"官方主配置/网关目录"属于 global / 易失层，真正跑工程请求的是 `wiselink-engineering` 的 **agent 作用域**持久条目，因此仍是旧值。DLI 自定义模型因为写在能被持久 merge 下发的位置而保留——这解释了"改过又恢复，但 dli 还在"【已证·官方文档 + 三层读回一致性】。
4. **百万要区分"协议接收"与"可靠利用"。** 近百万输入可被接收和计量（输入路径未被旧 256000 钳），但实测 38.2 万 6/6 全对、89.3 万仅 2/6 且中段丢失【已证·容量实测】。配置全部对齐到 1000000 也只能保证"不提前拒"，不能承诺"单次百万可靠"；业务单次可靠工作点应设在已验证区间并留余量。

---

## 1. 三层控制权：谁管什么（决定"能改哪"）

| 层 | 载体 | 持久化什么 | 谁能改 | 是否含容量参数 |
| --- | --- | --- | --- | --- |
| 业务 Host | `app_17bzc551rsg`，`server/modules/model-settings/*` | 只存 modelRef（+ expectedRevision CAS、租户）到非秘密设置表 | 模型管理角色经页面（`WL_CANONICAL_MODEL_MANAGER_ROLE_ID`），禁止 CLI 绕过角色 | **否** |
| 工程 Skill | `wiselink-research-and-synthesize@r09.c96`（跑在托管 OpenClaw 内） | 每请求的 `max_completion_tokens` 申请值、输出窗口/工作预算 | 我们改源码 → Publish Lite 打包 → 用户批准后 Skill-only 覆盖安装 | **是（请求侧额度，非模型条目）** |
| 托管 OpenClaw | `app_17c3zn24kv2` / profile `wiselink-engineering` | 模型条目 contextWindow/maxTokens/reasoning，按 session/agent/global 三作用域持久 | 妙搭托管配置面（owner/admin）；容器内 `/home/gem/...` 文件租户无 shell 直接改 | **是（真正的 clamp 上限）** |

### 1.1 Host 层证据【已证·代码】

- `server/modules/model-settings/canonical-model-catalog.ts`：`CANONICAL_REGISTERED_MODELS` 每项只有 `modelRef/displayName/providerKind/providerLabel/available`，文件注释原文："This is an allowlist of routing identifiers, not a live inference health check. Provider credentials and URLs remain in that instance's official settings."
- `canonical-model-settings.service.ts` 的 `update()` 白名单仅允许 `['modelRef','expectedRevision']`（其他键直接拒绝）。
- 结论：Host 决定"路由到 M3 还是 DLI"，并把该选择作为 `executionModel` 非秘密元数据随任务下发；**不设置、也无法设置窗口/输出/reasoning**。

### 1.2 Skill 层证据【已证·代码】

请求字段为 OpenAI 风格 `max_completion_tokens`，仅当模型为 `miaoda/minimax-m3` 时附加：

| 路径 | 脚本 | M3 申请额度 |
| --- | --- | --- |
| Review 回合 | `scripts/run-hosted-review-turn.mjs` | `M3_MAX_COMPLETION_TOKENS = 524_288`（注释：MiniMax Chat Completions 文档 524288，2026-09-08；"output allowance, not actual usage"） |
| Initial 模型调用 | `scripts/invoke-hosted-initial-model.mjs` | 由入参 `maxCompletionTokens` 透传（初始分析/Review 对齐 524288） |
| 翻译块 | `scripts/invoke-hosted-translation-block.mjs` | 由入参透传（历史 c31 曾 32000） |
| **JobAid 动态问题评估** | `scripts/run-jobaid-problem-assessment.mjs` | **`JOBAID_GENERATION_POLICY.requestMaxCompletionTokens = 16000`（写死）**，`maxScopeAdjustments:0`，basis 原文："16000 is an observation on one Hosted M3 request, not a universal model limit." |

- 单测 `tests/jobaid-problem-runtime.test.mjs` 断言该路径每次请求 `max_completion_tokens === 16000`，并在 `finish_reason=length / completion_tokens=16000` 时以 `JOBAID_MODEL_OUTPUT_LENGTH` 终止、不重放。
- 含义：**"c96 工程请求主动申请 16000"最可能就是 JobAid/连续问题批处理路径**——请求侧自己只要了 16000。这层我们完全可控（Skill-only 修订，无需 Host 发布）。

### 1.3 托管 OpenClaw 层

- Skill 多处明确："Gateway 会将请求额度夹到模型条目的 `maxTokens`，运行前须核实该配置已允许请求值；参数本身不修改配置"（`SKILL.md`、`references/input-output.md`）。`requestedMaxCompletionTokens` 只记录申请值，不是生效证据。
- 历史 c38 教训【已证·runbook】：当时"全局配置=524288、wiselink-engineering 本地目录=32000，实际三次原生生成都停在 output=16000"，证明**真正 clamp 的模型条目既不是全局那份、也不是本地目录文件那份**，而是承载该 profile 运行的 agent 作用域条目。本轮三层读回（global/网关=1000000、true；agent=256000/16000/false）是同一问题的再现。

---

## 2. 输出上限的完整 clamp 链（突破 16000 的依据）

单次实际输出上限 = min( ① Skill 请求额度, ② agent 模型条目 maxTokens, ③ 平台/上游 M3 真实单次输出硬顶 )

```text
① Skill max_completion_tokens
   Review/Initial = 524288（已足够，不是瓶颈）
   JobAid         = 16000（写死，瓶颈之一）
        │
        ▼  被下一层夹限
② wiselink-engineering agent 模型条目 maxTokens = 16000（当前，瓶颈之二）
        │
        ▼  再被下一层夹限
③ 妙搭平台对 miaoda/minimax-m3 的真实单次输出硬顶（未知）
   对照口径（均非本平台承诺，需实测）：OpenClaw 官方示例 M3 maxTokens=131072；
   MiniMax 官方文档称 completion 最大 524288（Skill c38 采用）。
```

- 当前 ①JobAid=16000 与 ②=16000 同时命中 → 必停 16000，且长输出时 reasoning/thinking token 也计入 completion，会进一步挤占可用正文/工具调用额度（这与"三次都只产出 thinking、无完整函数载荷、HTTP400"一致）。
- **要突破，①②必须同时 >16000**，然后用真实新会话阶梯实测去探 ③ 的边界；只改任一层无效。

---

## 3. 上下文：协议窗口 ≠ 可靠利用

| 概念 | 当前状态 | 决定者 |
| --- | --- | --- |
| 标称/协议 contextWindow | 主配置、网关目录=1,000,000；agent 条目=256,000（旧） | agent 模型条目 + 网关/上游 |
| 输入是否被 256000 拒 | **没有**：38.2 万输入成功，说明输入路径走网关/上游真实窗口，未被这份旧 contextWindow 钳【已证·实测】 | 网关/上游真实窗口 |
| 可靠利用（needle 全对） | 382,372 输入：随机取值 6/6、条件判断 6/6；893,180 输入：取值 2/6、判断 4/6，错误集中中前部、尾部正确，呈 needle-in-haystack 衰减【已证·实测】 | 模型本身的长程有效注意力，非配置可改 |

- 把 agent 条目 contextWindow 对齐到 1,000,000 的价值：消除"计费/截断判断与真实窗口不一致"的隐患，让工程请求不被任何旧值提前拒；**它不能提升可靠回忆能力**。
- 恒等式：contextWindow = 输入 + 输出 + thinking。若 maxTokens 提到 131072/524288，可用输入相应扣减；声明百万窗口时要给输出与思考留额，避免临界截断。
- 工程建议：单次可靠工作点暂按已验证区间并留余量（约 ≤30 万量级），更大原文沿用"连续会话 + 动态问题组 + 分批 SAVE"，不要依赖单次近百万的完美回忆；要抬高可靠上限只能靠多点位、多次重复的分布实测画曲线，而不是改一个数字。

---

## 4. 配置作用域：持久化为什么之前失败（官方语义）

OpenClaw 模型选择/写入有三个作用域（官方 `concepts/models`，2026-09-13 复核）：

| 作用域 | 命令/入口 | 写入位置 | 是否覆盖该 agent 旧值 | 持久性 |
| --- | --- | --- | --- | --- |
| session `-s/--session`（默认） | `/model <m> -s` | 仅当前会话 pin | 否 | 新会话/重置即失 |
| **agent `-a/--agent`** | `/model <m> -a`（owner/admin） | `agents.entries.<agent>.model` 及该 agent 目录 `agents/<id>/agent/models.json` | **是，且"never falls through to global"** | **持久，工程请求真正读它** |
| global `-g/--global` | `/model <m> -g`（owner/admin） | 共享 `agents.defaults.model` | **否，原文："does not overwrite other agents' explicit primaries"** | 持久但不覆盖已有显式 agent |

- 自定义 provider 模型写入 `~/.openclaw/agents/<agentId>/agent/models.json`，默认与 config **merge**；merge 时 agent models.json 的非空 authored 字段优先，缺省字段才从 config/catalog refresh；`models.mode:"replace"` 则只用配置项。hosted catalog 后台最多每 6h 检查、**下次 Gateway 重启才生效**，且只能补已装插件 provider 的元数据，不提供 baseUrl/请求头。
- **因此在托管环境要让 wiselink-engineering 持久生效，必须写到 agent 作用域**（对应 `/model … -a wiselink-engineering`、`openclaw models set --agent wiselink-engineering …`，或 UI 中先选中该 agent/profile 再保存其模型条目），把该条目的 `contextWindow / maxTokens / reasoning` 一次配套改对；只改 global、只在当前会话改、或只改网关内存目录，都会被 agent 的持久条目按设计弹回——这就是"改过又恢复"的机制，不是整环境重置。
- 改后必须读回**该 agent** 的条目（`/model status`、`openclaw models status -a wiselink-engineering` 或该 agent 的 models.json 脱敏快照），并在"重启 profile / 新开会话"后再次读回确认不回弹，才叫持久化。

---

## 5. 三目标的可执行路径

### 目标 A：突破 16000 maxTokens（输出）

1. **Skill 层（我们可控，Skill-only）**：把 `run-jobaid-problem-assessment.mjs` 的 `JOBAID_GENERATION_POLICY.requestMaxCompletionTokens` 从 16000 调到与 Review 一致的目标申请值（先 524288 或一个中间档），同步更新对应单测断言；走 `npm run package:openclaw:skill`，用户批准后 `openclaw skills install … --force` 同名覆盖，读回版本与 installed tests。
2. **托管 agent 条目层（需托管配置面 owner/admin）**：在 **agent 作用域**把 `miaoda/minimax-m3` 条目的 `maxTokens` 从 16000 调到目标值并持久、重启后读回。
3. **阶梯实测探平台硬顶 ③**：用独立诊断会话、指定函数返回，依次申请 16001 / 32000 / 65536 / 131072，观察 `finish_reason` 是否仍为 length、`completion_tokens` 是否真的超过 16000、是否产出完整函数载荷。停在哪一档，哪一档就是 ③ 的实际上限；配置读回和 clamp 计算都不算证据。
4. 同时在 agent 条目把 `reasoning` 设成与预期一致（true/false 二选一并持久），避免 thinking 悄悄吃掉输出额度导致"有思考无载荷"。

### 目标 B：稳定 1,000,000 上下文（输入）

1. 在 **agent 作用域**把 M3 条目 `contextWindow` 对齐 1,000,000（与 maxTokens/reasoning 一次配套），重启读回，消除旧 256000 的不一致。
2. 业务侧把"协议可接收"与"可靠利用"分开承诺：标称放开到百万；单次可靠工作点维持在已验证区间（约 ≤30 万留余量），更大输入走分批/检索/连续会话。
3. 若要抬高可靠上限，做多点位（头/中/尾多针）、多次重复的分布测试，记录正确率-输入长度曲线，再决定是否上调业务工作点。不继续无限扩大压力测试。

### 目标 C：配置持久化（不再回弹）

1. 唯一正确落点：**wiselink-engineering 的 agent 作用域持久模型条目**；不要改 global 后期待它覆盖 agent，不要改 session/网关内存当持久。
2. 留存四层脱敏快照 + 哈希（global 主配置、网关目录读回、agent models.json、一次真实请求的 `model.output-shape`），在"正常配置保存前后""profile/网关重启前后"各比一次，定位是否还有外部改写；不主动重置环境。
3. 可复用本机取证篇的对链方法，但托管容器无 shell 时，以托管 UI/CLI 读回值 + 真实请求 usage 为准。

---

## 6. 待妙搭托管 UI / 平台确认（阻塞，代码库无法自证）

1. 【最关键】托管配置面是否向租户开放 **agent（wiselink-engineering）作用域**模型条目编辑（contextWindow/maxTokens/reasoning）并持久？还是只暴露 global、内置 `miaoda/*` 模型元数据只读？这决定能否租户自助修复，还是必须提平台工单。
2. 平台对 `miaoda/minimax-m3` 实际下发的**单次输出硬顶**与**真实上下文窗口**是多少（可能既不同于 MiniMax 官方文档 524288，也不同于 OpenClaw 示例 131072/1000000）。
3. 之前"界面配置及网关目录已更新为 reasoning=true/1000000"具体在哪个界面、选了哪个作用域（global 还是 agent）？若确为 global，则直接验证"改错落"假设。
4. 托管是否允许 owner/admin 执行 `-a` 写入或等价 UI；网关重启策略（catalog 需重启生效）由谁触发。

> 上述需在 `app_17c3zn24kv2` 配置界面实际查看/截图，或经用户明确授权后用浏览器自动化协同查看；任何"保存/修改"都是外部写入，须先经用户确认，不自行提交。

---

## 7. 验证与红线

- 验证顺序：本地 Skill 自测/打包 → 托管安装读回（版本、installed tests、byte 摘要）→ agent 作用域条目读回 → 独立诊断会话阶梯实测 → 真实新 Turn/requestId 的业务 UAT。安装/配置读回不等于真实跑通。
- 不把多次各 16000 的用量相加成"一份 48000 结果"；不把配置数字或"输入被接收"当业务通过；业务验收仍以"首份实质 FTD 工作真实保存并读回"为准。
- 不主动重置环境、不盲目重放已完成业务动作；模型/RAG/worker/前端投影不自行创建正式采用或各类 signoff，工程输出保持候选。
- Skill-only 改动走 Publish Lite 唯一路径；区分 Git 同步与 Host/Skill 发布；未经授权不向额外账号/空间写入。

## 8. 证据索引

- Host：`server/modules/model-settings/canonical-model-catalog.ts`、`canonical-model-settings.service.ts`
- Skill：`openclaw/skills/wiselink-research-and-synthesize/scripts/run-jobaid-problem-assessment.mjs`（16000 策略）、`run-hosted-review-turn.mjs`（524288）、`invoke-hosted-initial-model.mjs`、`invoke-hosted-translation-block.mjs`；`SKILL.md`、`references/input-output.md`、`references/hosted-uat-runbook.md`
- 容量实测：`docs/coordination/M_MODEL_CAPACITY_TEST_20260913.md`
- 通用机制（本机物证，方法可迁移、根因不迁移）：`docs/coordination/M_CONFIG_LAYER_FORENSICS_20260913.md`
- 官方作用域/merge：`https://docs.openclaw.ai/concepts/models`；M3 输出额度对照：`https://platform.minimax.io/docs/api-reference/text-chat-openai`
