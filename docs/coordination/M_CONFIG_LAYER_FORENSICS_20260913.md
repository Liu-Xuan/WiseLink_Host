# OpenClaw 分层配置取证（2026-09-13）

配合 `M_MODEL_CAPACITY_TEST_20260913.md` 阅读。本篇定位"配置改过又恢复、dli 自定义模型仍在"的机制，全部为**只读**核查：未改配置、未重启、未部署、未推送。

## 0. 范围与边界（先划清）

- 取证对象是仓库内 `external/openclaw/.runtime`，即容器 `/home/node/.openclaw` 的运行时卷。`.runtime` **不被 git 跟踪**（git 仅跟踪 `external/openclaw/extensions` 插件源码），因此其配置变化只可能来自运行进程或容器编排，不可能来自 git 检出。
- 它与 M3 容量测试里的远程妙搭工程 Agent（`/home/gem/.../wiselink-engineering`，reasoning=false / maxTokens16000 / contextWindow256000）**不是同一实例**。本篇先用本地可核验物证确定 OpenClaw 的通用写配置机制，再给出对远程的"可检验推论"；推论不等于远程已证事实。

## 1. 配置分层与单向数据流

| 层 | 本地位置 | 持久性 | 由谁写入 |
| --- | --- | --- | --- |
| 持久主配置 | `config/openclaw.json`（`models.mode=merge` + `models.providers`） | 持久，是真源 | 正常走 config-io；也可能被外部直接覆盖 |
| 派生 Agent 目录 | `config/agents/<agent>/agent/models.json` | 派生，可重建 | 启动/会话初始化时按主配置 merge 生成，并补全默认字段 |
| 易失网关目录 | 网关内存模型目录 | 易失 | 运行时由主配置加载，UI 可临时改，重启重建 |
| 每请求实际载荷 | 每次请求的 model / max_tokens / 上下文字段 | 一次性 | 受上面各层钳制后的最终生效值 |

关键方向是**单向再生成**：持久主配置 → 派生层 / 易失层。反向修改派生层或易失层，不会回写持久主配置，重启或会话重建即被主配置重新覆盖。

## 2. 正常写主配置只有两条通道（审计物证）

`config/logs/config-audit.jsonl` 记录每次主配置写入，字段含 `ts / argv / pid / ppid / previousHash / nextHash / previousBytes / nextBytes / result / suspicious`。4 条记录归为两类入口：

1. **gateway 启动**：`node /app/dist/index.js gateway --bind lan --port 18789`（pid 为容器入口 pid=1 的子进程），启动过程连续写两次（补默认、补插件）。
2. **CLI 切模型**：`openclaw models set <model>`，两次分别为 `set openai/wiselink-direct-llm-bailian`、`set openai/gpt-5.4`。

正常写入的三个伴随特征：`result=rename`（旧文件轮转为 `.bak`，再依次 `.bak.1/.bak.2/.bak.3`，保留 4 代）、更新 `meta.lastTouchedAt/Version`、追加一条 audit。

## 3. 哈希链确定性核验（最强证据）

对磁盘文件实算 SHA256，与 audit 记录的前后哈希逐环比对：

| 磁盘文件 | 字节 | 实测 SHA256 前 12 位 | 对应审计节点 |
| --- | --- | --- | --- |
| `openclaw.json.bak.3` | 62 | `f4bab5928d05` | rec1 previousHash ✓ |
| `openclaw.json.bak.2` | 495 | `9b4fcbceeb10` | rec1 next = rec2 previous ✓ |
| `openclaw.json.bak.1` | 1037 | `be32191dbfa8` | rec3 previousHash ✓ |
| `openclaw.json.bak` | 1195 | `3936b93726c1` | rec3 next = rec4 previous ✓ |
| `openclaw.json`（当前） | 2234 | `13221db80273` | **不在审计链上** |

审计链尾应是 rec4 nextHash `b3253933bd97`（1205B，对应 `models set openai/gpt-5.4`）。

- 四个备份与审计链四个节点**逐一精确吻合**，证明审计与轮转备份机制本身真实可信。
- 当前主配置 `13221d…` 既不等于链尾 `b32539…`，也不落在链上任何位置，且**没有产生第 5 个 `.bak`，`meta.lastTouchedAt` 仍停在链尾时刻 2026-06-20T08:48**。
- 结论（确定性，非推断）：当前主配置由一次**绕过 OpenClaw config-io 的外部写入**直接覆盖——无 audit、无 rename 备份、不更新 meta。

## 4. 重建时间线

1. 06-17 gateway 启动，写主配置两次（audit rec1/2）。
2. 06-20 08:46、08:48 两次 `openclaw models set`（链尾停在 gpt-5.4，1205B）。
3. **08-01 00:22 主配置被外部覆盖为 2234B**：primary 改为 `wiselink/wiselink-direct-llm`，新增 `models.mode=merge` 与完整 `models.providers.wiselink`（3 个 DLI，contextWindow200000 / maxTokens8192）。
4. 08-23 检测到新版本 2026.7.1-2，而运行版本仍为 2026.3.13（`update-check.json`）。
5. **08-24 14:00 `agents/main/agent/models.json` 被重新生成**：3 个 DLI 的 200000/8192 与主配置 providers 同源，并被 merge 补全了主配置里没有的默认字段 `reasoning:false / input:[text] / cost 全 0 / api`——这正是"主配置最小定义、生成时补默认值"的派生痕迹。

## 5. 已排除的写入来源

- 自家 wiselink 插件源码（`extensions/wiselink`，git 跟踪）不写 `openclaw.json` / `models.json`（关键词检索 0 命中）。
- canonical host 业务仓库中不存在铺 OpenClaw 主配置或 agent `models.json` 的 provisioning 脚本（命中文件均为业务 worker / skill / migration / test）。
- `.runtime` 不在 git 内，排除 git 检出覆盖。

因此 08-01 那次外部写入者落在本仓库之外，首要候选为：**容器编排 / 卷铺放 / 妙搭 runtime provisioning / 版本升级迁移**。仅凭本仓库无法确定具体是哪一个，需要远程或平台侧审计；当前也无法假设它不会再次发生。

## 6. 解释"改过又恢复，但 dli 还在"

- 你改的 `reasoning / maxTokens / contextWindow` 若落在**派生层**（agent models.json）或**易失层**（网关内存目录），重启或会话重建时会被持久主配置 merge 覆盖回旧值——表现为"之前改过、后来恢复"。
- DLI 抹不掉，是因为它被写进了**持久主配置 `models.providers`**（在 08-01 那次外部覆盖时固化），每次 merge 都重新下发到派生层。
- 所以这**不是"整个环境被定期重置"**，而是两件事叠加：① 持久层对派生/易失层存在单向再生成（改错层就会被弹回）；② 持久主配置本身历史上被外部覆盖过一次，且来源未锁定。是否复发取决于编排/升级，需用前后快照比对验证。

## 7. 对远程工程（256000/16000）的可检验推论（推论，非已证）

- **P1 层不同步**：工程 agent `models.json` 是该容器内持久主配置 merge 的派生物；UI/网关改成 reasoning=true / 1000000 没有进入工程容器那份持久主配置，于是派生层仍是 false / 16000 / 256000。
- **P2 output 被钳、input 未被同一份钳制（解释 16000 停止）**：三次原生生成各停在 output 16000，且 c96 工程请求主动申请 16000，与派生层 `maxTokens=16000` 精确吻合，说明**输出上限被模型目录 maxTokens 钳制**，调大请求预算（65536）无效与此一致。而 38.2 万输入成功突破旧 256000，说明**输入路径并未被同一份 contextWindow 钳**（走网关/上游真实窗口）。即旧目录文件"并非全字段生效"：**maxTokens（输出）生效，contextWindow（输入）未生效**，两条参数路径在不同层取值、彼此不同步。
- **P3 近百万输入的错误形态**：89.3 万测试中尾部 R14988/R15000 正确、中前部 R00017/R03751/R07501/R11251 错误，呈"首尾在、中段丢"的 needle-in-haystack 衰减特征，更像有效可靠利用区小于标称窗口，而非随机失败。标称窗口被协议接受/计量 ≠ 内容被可靠利用；已验证的可靠上限只到 38.2 万（6/6 全对）。单次测试不能定通用准确率。

## 8. 远程最小定位步骤（只读、不主动重置）

1. 在工程容器内取 `config/logs/config-audit.jsonl` 与 `openclaw.json*`（含全部 `.bak*`），用本篇第 3 节同样方法实算 SHA256 对哈希链，确认 256000/16000 是哪一次、被什么 `argv` 写入，以及是否同样存在"无审计外部覆盖"。
2. 给四层各存一份**脱敏**快照（持久主配置 / 网关目录 / agent models.json / 一次真实请求 payload 的 model+max_tokens+context 字段），在下一次正常保存或环境启动前后对比，确定派生再生成发生在"启动时"还是"每会话/每请求"。
3. 关键判别实验：只改**持久主配置**里目标模型的 maxTokens（不改 agent models.json、不只点 UI），重启后看派生层是否同步、工程请求是否仍钳在 16000。若同步且 16000 解除，根因坐实为"改的层不对 + 派生再生成"；若连持久主配置都被改回，则直接抓外部覆盖者（编排/升级）。

## 9. 对业务主线（首份 FTD 真实保存）的含义

- 在改对持久层之前，输出被钳 16000 无法靠加大请求预算解除；应让**单批生成输出显著低于 16000**（建议每批 ≤ 8–10k 输出留裕度）并**分批 SAVE**，从架构上绕开，与已保留的连续会话 / 动态问题组 / 分批保存方案一致。
- 单批喂入原文控制在已验证可靠区（38.2 万全对以下并留裕度，建议 ≤ 约 30 万 token 量级），不要一次近百万。
- 验收仍以新 workRef + 内容/来源/权限真实读回为准，不以模型目录数字或"输入被接受"作为通过标准。

## 附：本地证据清单

- `external/openclaw/.runtime/config/openclaw.json` 及 `.bak / .bak.1 / .bak.2 / .bak.3`
- `external/openclaw/.runtime/config/logs/config-audit.jsonl`
- `external/openclaw/.runtime/config/agents/main/agent/models.json`
- `external/openclaw/.runtime/config/update-check.json`
- 配套机制图：`M_CONFIG_LAYER_FORENSICS_20260913.html`（示意，数值以本文与容量报告为准）
