# Astra 持久指令整理（2026-09-06）

## 依据

已搜索并完整阅读 [OpenAI GPT-6 Astra 模型指南](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra)（官方 Markdown 全文）和 [Eric Provencher：Rethinking skills and prompts for GPT-6 Astra](https://x.com/pvncher/status/2095991462416490862)（X 原始文章全文；网页抓取失败后从浏览器读取）。没有用搜索摘要或第三方转载替代原文。

本次采用两篇材料中与本地指令直接相关的建议：明确任务完成范围，按上下文延续已获授权的工作，缩短技能描述，按需读取细则，按改动风险验证。API 参数和产品模型迁移不属于本次修改。

## 实际加载与来源

| 来源 | 本次判断与处理 |
| --- | --- |
| `/Volumes/SSD/CodexHome/AGENTS.md` | 全局常驻；补充自主完成、按需读取、适当验证、授权延续和简洁表达。`~/.codex` 指向同一位置，没有改第二份副本 |
| 本仓库 `AGENTS.md` | 当前独立 Git 根的项目常驻；保留 Git 授权原文，补充 Host 实际边界和按任务读取 R10 资料 |
| `/Volumes/SSD/LLM/WiseLink/AGENTS.md` | 不在本仓库自动加载链内，但会影响从父工作区开始的任务；旧 R09 原文完整移存到 `Docs/agent-instructions/legacy-r09-handoff-20260906.md`，入口改为当前仓库和专项路由 |
| `.agents/skills/` | 当前发现的 8 个项目技能；正文在使用时加载。全部缩短描述，修正过度约束，并将大段资料按用途拆分 |
| `/Volumes/SSD/CodexHome/skills/` | 4 个个人技能；TDMS 两项是链接，修改其真实源文件。hatch-pet 按生产阶段拆分，保留现有验收要求 |
| `/Users/liuxuan/.agents/skills/` | 27 个飞书技能；审阅发现描述并缩短，进一步修正 lark-apps/lark-markdown/lark-shared 及相关本地开发参考的具体问题 |
| Codex 记忆摘要 | 标注旧 V9/0.10/0.11 经验的历史范围，指向当前 Host；原始历史条目保留 |
| 全局/父目录 config、应用设置、命令规则 | 核对指令入口及模型设置；已为 gpt-6-astra/max。本次不更改模型、MCP、沙箱、审批策略、命令 allow 规则或插件启用配置 |

发现规则依据 [官方 AGENTS.md 加载说明](https://developers.openai.com/codex/guides/agents-md)：全局指令加从项目根到当前目录的指令链。未发现覆盖当前入口的 AGENTS.override.md 或自定义 instruction-file 配置。技能目录出现在发现列表不等于正文已常驻加载。

系统/应用注入的高优先级指令不属于可编辑本地文件。已安装的 OpenAI 插件缓存没有改写。`openclaw/skills/wiselink-research-and-synthesize` 属于独立的妙搭产品运行时，保持平台模型配置；本次不向其部署 Codex 的 Astra 偏好。

## 主要修订

- coding-guide 从 40,253 字节降至约 2.7 KB，改为后端、前端和本地调试入口。取消每次读代码先通读、重复 schema 读取、固定行数拆分、预填悬空 import、无条件全套测试等要求。
- 根据当前 Repository 的实际用法修正“禁止事务/手写 SQL”；保留平台注入连接、参数化查询、短事务、RLS 与 actor 授权。
- 修复不存在的 think、组件、认证和通讯录技能引用，改为已有技能、实际 SDK 类型和组件源码。
- OpenAPI 保留网关 API Key 认证与 Host service-scope/对象授权；不再把“系统身份”解释成无需业务授权。
- 插件输出校验失败不再填默认业务值；错误堆栈不再返回浏览器。插件 prompt 只描述实际目标、输入和输出，不强加角色与固定格式。
- lark-markdown 明确只处理 Drive 资源，避免本地 Markdown 编辑误触发上传；lark-apps 沿用既有开发上下文，取消无条件重问开发方式和目录。
- trigger-guide 只处理妙搭 handler，不把 JSON 输出和旧频率说明套用到所有开发、Hosted cron 或 Codex 提醒。
- hatch-pet 从 85,522 字节的入口拆为约 3.4 KB 路由及分阶段参考；方向、透明度、独立盲审和最终验收要求保留。
- GitHub 同名 codex/* 非强制推送授权与历史更正原文保留；TDMS 评估单正文完整保留，参与者技能仅将重复读配置改为任务开始及配置变化时读取。

## 验证与使用

对 39 个修改的技能检查 YAML、名称、描述、引用和平台元数据；描述合计由 9,563 降至 2,127 字符。官方 skill-creator 最小校验器原生接受 8 个，其余 31 个含原有平台扩展字段：保留这些字段并单独核对，核心字段视图通过同一校验器，未修改官方校验器。

核对了局部文案修改、Host 事务、已授权 Git 推送、权限代码改造、TDMS 保存后核验、插件失败与宠物局部修复这些场景的指令路径。这是静态指令与文件结构核对，不声称已进行新的模型效果实验、业务运行、发布或 TDMS 写操作。

写入前保留逐文件原文和差异，并比较目标内容以避免覆盖同期编辑；写入后读回核对。备份、完整差异和验证结果位于 `/tmp/astra-instruction-audit-20260906/`。本仓库变更可用 Git diff 审阅；父目录及全局修改需看该差异文件。

后续启动的任务会按文件来源加载新指令；修改磁盘文件不会追溯替换当前会话已经注入的文本。无需清缓存，也没有关闭技能自动发现。
