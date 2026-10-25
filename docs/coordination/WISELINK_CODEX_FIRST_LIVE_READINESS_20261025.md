# CODEX 首次真实运行准备

2026-10-25 的正式只读核对已经取得 Host 发布、配置名称、路径权限和完整数据库差异。当前仍是**本地候选已实现、现场配置未完成、新业务尚未运行**。本文件记录首测的下一步，不改 R10 主计划，不授予发布、配置、安装或业务执行权限。

## 准备状态

| 对象 | 本次证据与结论 | 下一项决定性证据 / 负责方 |
| --- | --- | --- |
| Host 现有发布 | 正式 release 为 finished，准确源码仍为 `a65a80925073e4b88aba6d84413a77aa3c814ff6` | 主控固定新组合及准确 Host 后继，独审后由 17b 唯一获准操作员执行；本轮尚未确定实际操作会话 |
| 首测本地组合 | 已完成 `f57d8863` 首测核心；已按准确 `925deb2 → 19d58915` 选择必要客户端增量并通过独审与受影响定向验证 | 准确文件清单、定向结果、独审和最终组合构建，均记于新交付回执；不把上游离线报告当本地实测 |
| Host 配置 | dev/online 各 38 个已登记变量名，所需 10 个 Codex 名称均未登记；未读值 | 主控确定新 runtime、独立 principal、一个新 WorkItem/intake；配置 owner 按批准范围设置并读回。缺配置不等于代码缺陷 |
| 路径权限与身份 | 现有 7 条 Key 元数据中，5 条专用 POST 路径的有效授权均为 0；未读或保存凭据值 | 现有凭据 owner 配置独立秘密引用与准确路径权限；随后只读核对 MCP 身份。服务名或工具目录本身不授予业务权限 |
| API 入口 | 正式 launch URL 是用户页面；所查平台 metadata 未暴露 API origin | Host 操作员从官方 runtime metadata 或获准的现有连接引用核出非秘密 origin；不能拼接 launch URL 冒充 API |
| 数据库发布差异 | 官方完整 dev→online preview 返回 `changes: []` | 当前无迁移动作；该事实不证明新业务事务已运行 |
| 新应用现场 | `app_17gr74pbere` 正式会话列表只有一个 inactive 会话，平台 cron 列表为空；Chrome 已登录，页面仍显示唤醒中、预览为空 | 新执行端 owner 提供实际宿主、Codex 安装与入口、监督/唤起定义和私有目录元数据。无平台 cron 不等于无原生调度；空预览不证明安装失败 |
| 持久目录 | 历史合成 Host 的随机 run 目录不证明本应用的 checkpointRoot/runRoot | 新执行端 owner 核实际绝对路径、权限、卷和保留责任；实际重启读回仍另列未验，不用 fsync 或旧 fixture 代替 |

Host 配置名称核对时间为 2026-10-25 11:25 UTC，汇总时间 11:31 UTC；新应用页面观察为 11:30 UTC。它们是该时点的证据，不能替代执行前读回。官方 CLI 首次读取因本机认证存储权限失败，使用现有桌面授权重新读取成功；没有新登录、重置凭据或修改应用。

## 首测执行形状

采用既有 `consume-hosted-work-item.mjs --auto-queue`，准确新 WorkItem 与 intake 由 Host 配置和正常授权绑定，`--queue-max-items 1`。运行模型仍为妙搭现有 `miaoda/glm-5.3`；Codex 是执行程序，不把开发代理的模型偏好变成产品模型。实际命令须先填入唯一安装根、Node/Python/Codex 路径、现有私有连接配置和两个持久 root，未填参数的模板不执行。

一次新业务按以下顺序取证：

1. 正常新 intake/WorkItem，准确 DocumentVersion、parse/source artifact、原文字节及授权；不得换 requestId 复用旧工程执行历史来冒充新事项。
2. Host 封存 `PROGRAM_CONTROLLED_V1`、GLM-5.3 与实际 `EVALUATE_JOBAID` 动作；保留 intake、stage/action、SAVE 三种独立请求身份和两层租约。
3. 同一消费者把实际输入、prompt、上游请求及 child run 关联持久保存，再生成一次完整响应；没有完整回执则查询原请求，不另派模型。
4. 正常 SAVE，按原 SAVE key 独立 READ，核准确 work revision；确定性 Overall 实际消费同一修订并提交。
5. 核 attempt 终态、原 claim ACK、原用户页面与图的同版阅读。保存、综合、结束分别记录；模型完成或进程退出不替代这些事实。

首次可用现成受控单次唤起，不要求先造常驻调度或多 worker 框架。监督/重启方式及目录持久性仍须明确；2/4 workers、翻译 P1、Review/Wiki 扩展独立推进。

## 切换、恢复和旧内容

旧入口停止新增领取、在途状态核对、Host 拒绝旧身份/旧 fence 是三项不同责任。切换 `WL_MODEL_EXECUTOR` 会使依赖旧 Host 路径的消费者被拒，必须在准确批次中列出影响；不因而要求停止整个旧 OpenClaw 应用。原 ATT5 UNKNOWN 和其他未决请求保留，既不重放，也不迁为新执行器的任务。

首次运行遇到未知时停止新增派发，由同一 owner 保留并查询原 checkpoint/run/receipt；不换 root、requestId 或执行器掩盖结果。COMMITTING 只恢复原准确保存结果，不能凭泛化成功状态跳过独立 READ 或吞掉坏 ACK。

旧内容不要求兼容。旧文档与接口副本可归档；旧业务成果有需要时按新版新请求重生成，删除前核当前指针、阅读、Wiki 和 Overall 依赖；UNKNOWN/COMMITTING/在途归为保留取证。清理与重生登记在[旧内容处置清单](WISELINK_CODEX_RUNTIME_ACCEPTANCE_20261025.md#旧内容处置清单)，本轮未实施清理或重生。

## 审批材料的范围

准确组合定稿后，审批草案应一次列明：Host 后继和目标环境、客户端包与安装位置、独立身份及秘密引用、五条路径权限、一个新来源/事项/intake 的创建与封存方式、旧领取影响、单次唤起及失败停止责任、完整验收路径。模型/SAVE 与技术切换分清但可在同一明确批次中批准。

当前实际宿主、安装目录、私有 root、API origin、操作 owner、准确新事项与私有 Host 后继尚未齐全，因此仅准备草案，尚未提出或执行这批切换。缺参数时继续补正式证据，不用一项泛化批准掩盖它们。
