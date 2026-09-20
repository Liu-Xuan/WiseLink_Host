# 妙搭托管 OpenClaw 配置回弹——浏览器实测取证报告（2026-09-13）

> 范围：妙搭官方托管实例 `app_17c3zn24kv2`「WiseLink 工程资料助手」，逻辑 profile `wiselink-engineering`，OpenClaw V2026.6.6。
> 方式：在妙搭内置 Web IDE / 设置界面**只读**查看，未修改、未保存、未新增模型、未重启任何服务。
> 边界：配置读回只证明"磁盘/界面当前值"，不等于上游模型真实生效容量；真实硬顶仍以独立会话阶梯实测为准。
> 敏感信息：主配置内联的 DLI apiKey、gateway token、MCP Bearer 已在本地快照中脱敏，本报告不复述。

---

## 1. 结论（先看）

1. **"改过又恢复"不是环境重置，而是常驻网关进程的"托管目录合并回写"。**
   内置模型 `miaoda/minimax-m3` 的容量字段由妙搭平台托管模型目录约束，标准值为
   `contextWindow=256000 / maxTokens=16000 / reasoning=false`。手动改成百万后，常驻
   `openclaw gateway run --port 18789`（ppid=1，容器主服务）会在运行期把"与托管目录合并后"的配置
   **原子 rename 写回** `openclaw.json`，内置模型条目被标准值覆盖。
2. **已定位到两次回弹的精确进程与时间**：2026-09-11 01:29、2026-09-13 15:01，均为 `gateway run`
   进程写入（非 `config set`、非 doctor、非 Skill 安装），写入后内容同为 **14427 字节**并被提升为
   last-known-good。最近一次：09-13 13:13 手动改成 1000000/1000000/true，**1 小时 48 分后**被回写为
   256000/16000/false。
3. **DLI 自定义模型"还在"的原因**：`dli/gpt-5.6-sol` 是用户自定义 provider，不在平台托管目录内，
   合并时原样保留；内置 `miaoda/*` 条目受管、被回写。这解释了"部分变化、部分保留"。
4. **agent 目录 `models.json` 是主配置 `models` 段的派生投影**：
   `agents/wiselink-engineering/agent/models.json` 当前与主配置模型段逐字段一致（M3 同为 256000/16000/false，
   密钥处显示 `secretref-managed`）。改派生文件同样会被重新生成覆盖，不是独立持久层。
5. **UI 不提供内置模型容量编辑入口**：设置→可用模型中，内置 MiniMax-M3 的"⋯"菜单只有"应用至全部智能体"；
   "+ 自定义模型"只能新增第三方 provider。租户无法在界面改内置 M3 的 contextWindow/maxTokens/reasoning。
6. **【09-13 晚更新，详见第 9 节】方案 A 已受控执行并回答两个关键问题**：新增独立 provider `m3probe`
   （声明 contextWindow=1e6 / maxTokens=131072）**可持久**、运行中网关无需重启即可动态识别；但 16001→32k→64k
   输出阶梯实测证明 **16000 是上游内网 sgw 通道的单次输出硬顶，本地放大 maxTokens 无法突破**，需转方案 B 向平台申请上调。

---

## 2. 当前真实配置（只读，2026-09-13 读取）

主配置 `/home/gem/workspace/agent/openclaw.json`（623 行；本地脱敏快照见
`HOSTED_openclaw_json_snapshot_20260913.json`）：

- `models.providers.miaoda`：baseUrl `https://innerapi.aiforce.cloud/innerapi/api/v1/sgw/model/proxy`，
  `api=openai-completions`，`timeoutSeconds=600`，密钥为 file secretref（未内联）。
- 内置模型 4 个：

  | id | contextWindow | maxTokens | reasoning | input |
  |---|---|---|---|---|
  | miaoda-model-auto | 200000 | 8192 | false | text |
  | miaoda-auto-multimodal | 200000 | 8192 | false | text,image |
  | miaoda-model-flash | 200000 | 8192 | false | text |
  | **minimax-m3** | **256000** | **16000** | **false** | text,image |

- 自定义 provider `DLI`（baseUrl `https://api.dli.li/v1`）下 `gpt-5.6-sol`：**未声明** contextWindow/maxTokens。
- **无 `models.mode` 字段 → 默认 merge**（与托管目录合并，而非只用本地配置）。
- `agents`：**只有 `agents.defaults`，没有 `agents.entries`（无 wiselink-engineering 专属覆盖）**；
  `defaults.model.primary=miaoda/minimax-m3`；`compaction.mode=safeguard`、`reserveTokensFloor=50000`；
  `maxConcurrent=4`、`subagents.maxConcurrent=8`。
- gateway：`mode=local / bind=loopback / port=18789`，`http.endpoints.chatCompletions.enabled=true`。
- meta：`lastTouchedAt=2026-09-13T15:01:40.980Z`（= 回弹发生时刻）。

派生文件 `agents/wiselink-engineering/agent/models.json`（97 行）：模型条目与主配置一致，miaoda 密钥显示
`secretref-managed`。同目录另有 `sessions/`。

---

## 3. 备份时间线（minimax-m3 条目逐版本比对）

| 备份文件 | meta.lastTouchedAt (UTC) | M3 contextWindow | M3 maxTokens | reasoning | 说明 |
|---|---|---|---|---|---|
| `.clobbered.2026-08-27T09-56-45-968Z` | 2026-08-17 11:53 | 200000 | 16000 | false | 旧结构（含 glm-5.1/qwen-3.7）；08-27 被外部整体覆盖时 OpenClaw 改名留证 |
| `.bak-maxtokens16000` | 2026-09-06 08:59 | 200000 | 16000 | false | 新结构基线，其余模型 200000/8192 |
| `.bak.4` | 2026-09-08 07:54 | 1000000 | 524288 | true | 首次改百万（batch-file），其余模型 524288 |
| `.bak.3` | 2026-09-08 09:11 | 1000000 | 524288 | true | c38：另设 `compat.maxTokensField=max_tokens` |
| `.bak-timeout600-20260910-173835` | 2026-09-08 09:11 | 1000000 | 524288 | true | 内容同 .bak.3，09-10 改 timeout 时另存 |
| `.bak.2` | 2026-09-10 09:39 | 1000000 | 524288 | true | 维持百万 |
| **`.bak.1`** | **2026-09-11 01:29** | **256000** | **16000** | **false** | **回弹①：百万→平台标准值**，其余模型回到 200000/8192 |
| `.bak`（通用最新备份） | 2026-09-13 13:13 | 1000000 | 1000000 | true | 手动再改百万（仅 M3，其余仍 200000/8192） |
| **当前 `openclaw.json` / `.last-good`** | **2026-09-13 15:01:40** | **256000** | **16000** | **false** | **回弹②：1h48m 后又回到平台标准值** |

要点：回弹后的目标值每次都精确等于 `256000/16000/false`（不是简单恢复某个旧备份——09-06 基线是
200000/16000，而回弹是 256000/16000），说明回写源是**平台托管目录当前登记值**，而非本地历史文件。

---

## 4. config-audit.jsonl：谁在写、用什么动作写（根因铁证）

`logs/config-audit.jsonl` 共 31 条 `config-io` 记录，每条含 ts / pid / ppid / cwd / **完整 argv** /
前后 hash / bytes / result。关键记录：

| 行 | 时间 (UTC) | 触发动作（argv 摘要） | pid/ppid · cwd | bytes 前→后 | 性质 |
|---|---|---|---|---|---|
| 26 | 09-08 07:54 | `config set --batch-file tmp/m3-undo-restore.batch.json` | ppid≠1 · `…/agent` | 14397→14403 | 手动 |
| 27 | 09-08 09:11 | `config set models.providers.miaoda.models.3.compat.maxTokensField max_tokens` | ppid≠1 · agent | 14403→14487 | 手动 |
| 28 | 09-10 09:39 | `config set models.providers.miaoda.timeoutSeconds 600` | ppid≠1 · agent | — | 手动 |
| **29** | **09-11 01:29:34** | **`gateway run --port 18789`** | 1675565 / **ppid 1** · **`/`** | **14518→14427** | **网关回写＝回弹①** |
| 30 | 09-13 13:13:22 | `gateway run --port 18789` | 1901457 / ppid 1 · `/` | 14427→14429 | 网关落盘（UI 改百万的写入） |
| **31** | **09-13 15:01:41** | **`gateway run --port 18789`** | **1901457（同一进程）** / ppid 1 · `/` | **14429→14427** | **网关回写＝回弹②** |

- **hash 链连续无缺**：`7c5f3ca →(行29) a41fd09[14427] →(行30) 9aecfc8[14429] →(行31) 8287ed7b[14427]`。
  两次回弹后都落到**同一字节数 14427** 的同一版本。
- 所有**手动**修改都是 `openclaw config set …`（ppid≠1、cwd 在 agent 目录、带明确键路径）；
  两次**回弹**都是常驻 `gateway run`（ppid=1、cwd=`/`、无 config set 参数）以 `result:"rename"` 原子覆盖。
- `logs/config-health.json`：`lastKnownGood = lastPromotedGood = 8287ed7b`（=行31回弹结果，14427 字节），
  15:01:51 promote、15:36:20 观测仍为 good —— 系统把回弹版本当作"已知良好配置"持续维护。

**机制判定**：gateway 运行期（不仅是重启）在与平台托管模型目录合并后，会把合并结果持久化回主配置；
内置 provider 模型元数据被托管目录值覆盖，自定义 provider 不被托管目录管理因而保留。

---

## 5. 界面能力边界（设置 / 智能体面板）

- 顶部主视图：智能体 / 控制台 / 文件夹 / 终端 / 设置（Radix 标签，需真实指针点击，合成 `.click()` 不切换）。
- 设置→**可用模型**：智能选择（妙搭）、MiniMax-M3（妙搭）、gpt-5.6-sol（DLI）；每卡"⋯"菜单
  **MiniMax-M3 仅"应用至全部智能体"一项，无容量编辑**；右上"+ 自定义模型"为新增第三方 provider 表单
  （厂商名 / BaseURL / API Key / 模型名）。说明文案：自定义模型不消耗飞书 AI 额度，配置后在智能体面板选用即生效。
- 智能体面板"模型：MiniMax-M3"下拉：智能选择 / MiniMax-M3 / gpt-5.6-sol / 配置自定义模型；同样**无内置容量字段**。

---

## 6. 对三个目标的判定

### ① 稳定提供 1,000,000 上下文
- 改内置 `miaoda/minimax-m3` 的 contextWindow **在租户侧不可持久**（被 gateway 回写到 256000）。
- 且容量实测（见 `M_MODEL_CAPACITY_TEST_20260913.md`）：38.2 万输入全对、89.3 万输入 2/6 取值正确——
  **协议可接收近百万 ≠ 可靠利用**，平台目录登记仅 256000，业务工作点建议留余量 ≤约 30 万。
- 真正稳定接近百万只有两条路：**(A) 平台侧上调托管目录中内置 M3 的登记 contextWindow**（租户不可控，需妙搭平台/管理员）；
  **(B) 用自定义模型条目承载更大 contextWindow**（不被回写），但上游真实可用窗口仍须实测。

### ② 突破单次 16000 maxTokens
- 16000 有**两层独立来源**，只改一层无效：
  1. Skill 侧 `run-jobaid-problem-assessment.mjs` 把 JobAid 动态问题路径 `requestMaxCompletionTokens` 写死 16000
     （Review/Initial 路径已申请 524288）；改它属 Skill-only，需 package + 用户批准后覆盖安装。
  2. 内置 M3 在网关按条目 maxTokens 夹限：实测申请 65536 仍三次各停在 output=16000。
- 内置条目 maxTokens 改不大也存不住；**只有让请求走"自定义模型条目 → 真正支持更大输出的上游"才可能突破**，
  并以 16001→32k→64k→131k 阶梯实测确定真实硬顶（配置数字不算证据）。

### ③ 配置持久化
- **内置模型字段无法在租户侧对抗 gateway 回写**；主配置、agent 派生 models.json 都会被统一。
- **可持久的是自定义 provider/model 条目**（DLI gpt-5.6-sol 已长期存活为证）。
- `models.mode:"replace"`（只用本地、不与托管目录 merge）是一个**待隔离验证**的开关：可能阻止回写，
  但也可能丢失平台注入的 baseUrl/鉴权元数据导致内置模型不可用，必须在可回滚快照下试验。

---

## 7. 建议的下一步（均为写操作，**未经你确认不执行**）

- **方案 A（租户可控、可回滚，优先验证）**：经设置"+ 自定义模型"新增一个自定义条目，复用内网网关指向 M3，
  用独立 id（非 `miaoda/*`、非 `dli/*`），声明目标 contextWindow/maxTokens，在智能体面板选用它；
  随后按"改后读回 → 新会话再读回"验证**持久性**，用独立诊断会话做输出阶梯实测验证**真实硬顶**。
  - 若自定义条目指向内网 M3 仍被夹到 16000，则证明硬顶在平台/上游，租户配置无法突破，转方案 B。
- **方案 B（根治内置 M3，需平台）**：向妙搭平台确认并申请上调托管目录中内置 `minimax-m3` 的
  contextWindow/maxTokens 登记值，以及该网关到上游 M3 的真实输出/上下文配额。
- **方案 C（仅隔离实验）**：在备份可回滚前提下测试 `models.mode:"replace"` 能否阻止回写及其副作用。
- **Skill 侧并行**：JobAid 写死 16000 单点按 Skill-only 流程处理（package + 批准覆盖安装 c96→新版）。

---

## 8. 证据索引

- 本地脱敏快照：`docs/coordination/HOSTED_openclaw_json_snapshot_20260913.json`（主配置 623 行，密钥已打码）。
- 机制与三层控制权：`M_HOSTED_MODEL_SCOPE_20260913.md` / `.html`。
- 容量实测原始数据：`M_MODEL_CAPACITY_TEST_20260913.md`。
- 容器内路径：主配置 `/home/gem/workspace/agent/openclaw.json`；
  审计 `logs/config-audit.jsonl`、健康 `logs/config-health.json`；
  派生 `agents/wiselink-engineering/agent/models.json`；备份 `openclaw.json.bak*` / `.last-good` / `.clobbered.*`。
- 本轮浏览器内**零写入**：未保存配置、未新增模型、未改开关、未重启；自定义模型表单已取消。

---

## 9. 方案 A 执行结果（2026-09-13 晚，经用户"确认写入并连续实测"）

> 唯一真实写作为新增独立 provider `m3probe`（可回滚）；未改内置 / DLI / MCP / channel / cron，未重启 gateway，
> 未调用 Host 保存、未碰业务原件。全程独立诊断会话、构造数据，token 仅在 shell 变量内使用、不落盘、不回显。

### 9.1 写入与即时读回

- 备份：`openclaw.json.before-probeA`（=8287ed7b / 14427B）。
- `openclaw config patch --file tmp_probe_patch.json`（正式写**不可**加 `--json`，仅 `--dry-run` 可）：Applied 7 updates；
  审计 16:38:13，pid1979524/ppid1979517（CLI，非 ppid=1），hash **8287ed7b → 208aab86**，14427→15480B，result rename。
- 新增 `models.providers.m3probe`：baseUrl 复用内网 sgw，`api=openai-completions`，apiKey / headers.x-api-key
  **原样复用现有两个 file SecretRef（未接触明文、未新增密钥）**，timeoutSeconds=600；唯一模型
  `{id:"minimax-m3", name:"M3 Probe Large", reasoning:true, input:[text,image], contextWindow:1000000, maxTokens:131072, cost 全0}`；
  `agents.defaults.models` 增加别名 `m3probe/minimax-m3`。
- 读回：内置 `miaoda/minimax-m3` 原封不动仍 256000/16000/false；`openclaw models list` 识别
  `m3probe/minimax-m3  text+image 977k  Auth yes  configured,alias:M3 Probe Large`。
- 运行中的旧 gateway（13:13 启动）**无需重启即动态识别并成功调用**该模型（HTTP 200）；`gateway call`
  仅 health/status/system-presence/cron.*，无配置 reload 方法。本地 HTTP 调用：端点
  `http://127.0.0.1:18789/v1/chat/completions`，`Authorization: Bearer <配置内联 gateway.auth.token>`、
  `x-openclaw-model: <provider>/<model>`，body.model 固定 `"openclaw"`。

### 9.2 持久化观察（问题③）

- 写入后历经多次模型调用、约 30 分钟，主配置 hash 恒定 **208aab86 / 15480B**；`config-audit.jsonl` 在 16:38 之后
  **没有任何 ppid=1 的 gateway run 写入**，m3probe 始终保持 1000000/131072/true。
- 同构铁证：非托管自定义 provider `DLI/gpt-5.6-sol` 已穿越 09-11、09-13 两次真实 ppid=1 合并落盘仍存活。
- **判定**：独立 provider id 的自定义条目可持久、不被托管目录合并回写；"改过又恢复"只发生在**就地修改内置
  `miaoda/*`**（它在托管目录内、被平台标准值覆盖）。**正确持久化形态 = 用独立 provider 新增，不就地改内置。**
- 为避免扰动共享实例，本轮**未主动**执行 `openclaw gateway restart --safe`（systemd user 未安装、gateway 为 ppid=1
  前台进程）；如需 100% 重启铁证，可在维护窗口执行，预期 m3probe 存活、内置仍为标准值。

### 9.3 输出阶梯实测（问题②，核心）

同一本地 HTTP 端点、非流式，构造"从 1 连续输出整数、每行 10 个、禁止省略 / 总结 / Done"的强制长输出任务：

| 序 | 模型条目（条目 maxTokens） | 申请 max_completion_tokens | HTTP | completion_tokens | 可见字符 | 实际连续数到 | finish | 判定 |
|---|---|---|---|---|---|---|---|---|
| s16001 | m3probe（131072） | 16001 | 200 | 17087（可见≈16000 + reasoning≈1087） | 26275 | ~5490 | stop | 序列中途硬截 |
| builtin16001 | miaoda（16000） | 16001 | 200 | 1190 | 129 | 仅谎称"已打印完" | stop | 模型走捷径，无效 |
| p32768 | m3probe（131072） | 32768 | 200 | **16000** | 26897 | **5601 / 目标 12000** | stop | 序列中途硬截 |
| p65536 | m3probe（131072） | 65536 | 200 | **16000** | 26837 | **5589 / 目标 24000** | stop | 序列中途硬截 |

- 首轮 s32768/s65536 因目标过大（45000/90000）模型在内部思考后口头宣布 "Done"、未逐字输出（completion 1479/2061），
  判为无效压测；改用"目标略超预算、看起来可完成"的任务后得上表有效样本。
- **判定（修正过程中的乐观读数）**：本地条目已放大到 131072、请求确实携带 32768/65536 到达上游（无本地预夹报错），
  但凡模型真实逐字输出，completion **恒定在 16000**（约 5600 个整数 / 26.8k 字符处、序列中途被截，finish 被归一化为
  stop），与申请值无关。s16001 的 17087 = 16000 可见输出 + 约 1087 未单列的 reasoning，**可见输出从未真正超过 16000**。
- **结论：16000 是妙搭托管上游通道（内网 sgw 网关 `innerapi.aiforce.cloud` → MiniMax 对该通道 / 授权）的单次输出
  硬顶，不在 OpenClaw 本地模型条目层；本地改 maxTokens 只能让大申请值不被本地预夹，改不动上游硬顶。** 与既有容量报告
  （申请 65536、内部三次各停 16000）互证。MiniMax 官方虽标称 completion 上限 524288，但这条托管代理通道实际只给到 16000。
- 突破 16000 的唯一路径是**方案 B：向妙搭平台 / 网关管理员申请上调该模型在 sgw 的单次 max_output 配额**，或换用上游配额
  更高的模型 / 通道。Skill 侧 JobAid 写死 16000 是另一独立层，改它不能绕过上游硬顶。

### 9.4 上下文（问题①，补充观察）

- m3probe 声明 contextWindow=1000000、list 显示 977k；本轮多个请求 prompt 达 428k/586k/681k（含 543k cached）均
  HTTP 200 正常处理——本地百万声明使 OpenClaw 不在 256k 处提前拒绝。
- 但"被接收"不等于"可靠"：既有受控测试 382k 全对、893k 仅 2/6，可靠工作区仍建议 ≤约 30 万；真实可用上下文同样受
  上游通道约束，本轮未重测超大上下文准确率。

### 9.5 m3probe 去留与回滚

- 当前**保留 m3probe、但未设为默认**（primary 仍为 miaoda/minimax-m3），对现有业务零影响；需要大窗口时可在智能体面板
  手动选 "M3 Probe Large"。
- 回滚：`openclaw config unset models.providers.m3probe` 与 `agents.defaults.models` 下该别名；或
  `cp openclaw.json.before-probeA openclaw.json` 后读回核对。
- 容器内证据：tmp_probe_patch.json / tmp_apply.txt / tmp_readback1.txt / tmp_a1.txt / tmp_ladder*.sh /
  tmp_meta_* / tmp_resp_* / tmp_inspect* 等；已扫描确认请求 / 结果文件无 gateway token 明文（命中 40+hex 的均为配置
  sha256 指纹），曾含内联 token 的临时文件已删。
