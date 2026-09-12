---
name: coding-guide
description: "妙搭 Host 的 NestJS/React/Drizzle 开发约定。用于模块、接口、数据库或页面实现；按改动选择相关章节，普通文本编辑不触发。"
---

# 妙搭 Host 开发指引

在需要平台专有约定时读取本技能；已有代码、当前依赖类型和项目 `AGENTS.md` 共同确定实现。只阅读当前改动所需资料，已核实且未变化的定义不重复加载。

## 选择资料

| 改动 | 按需读取 |
| --- | --- |
| 后端模块、HTTP 接口、Drizzle 数据操作 | [后端与数据](references/backend.md) |
| React 页面、请求封装、组件、样式、路由 | [前端](references/frontend.md) |
| 本地启动、身份、CSRF、端口或接口调试 | [本地调试](references/local-debug.md) |
| /openapi 接口或对外类型 | [openapi-guide](../openapi-guide/SKILL.md) |
| 用户身份/ID 转换、权限、登录组件 | 分别用 [user-identity](../user-identity/SKILL.md)、[authz-guide](../authz-guide/SKILL.md)、[client-builtins-user-service](../client-builtins-user-service/SKILL.md) |
| 妙搭插件或自动化业务 handler | 分别用 [plugin-guide](../plugin-guide/SKILL.md)、[trigger-guide](../trigger-guide/SKILL.md) |

## 共同约定

- 前端在 `client/`，后端在 `server/`，共享类型在 `shared/`。沿用邻近模块结构与 `@client/`、`@server/`、`@shared/` 别名；共享类型不反向依赖前后端。
- 改接口时同步真实消费者和共享类型；读取涉及的定义即可。保持字段、方法、路径与运行时返回一致，修正根因，不用宽松 ambient 类型或 `as any` 掩盖不匹配。
- 新 Controller、Service、Module、页面应接入对应注册链；`ViewModule` 保持 fallback 的最后位置。按实际依赖完成接线，不预先添加指向不存在模块的 import。
- 并行任务只在确有独立工作且符合现有协作授权时分工；聚合入口避免多 writer 同时改写，由集成 owner 协调。单人小修无需先生成分工表。
- 使用现有依赖和 UI 组件；新增依赖、SDK 用法不明或版本变化时核对实际导出。类型可推断时无需逐变量注解，不为固定行数拆文件或重排无关代码。
- 保留内置登录、Host 授权、RLS、SourceRef、版本/CAS、事务与正式动作边界。业务数据不从 mock 或默认值伪造；隔离测试 fixture 与实际运行证明分别表述。
- 验证覆盖改动风险与用户完成标准：类型/API 变化检查受影响消费者，交互变化检查真实页面，持久化/权限变化验证有关边界。文本或提示词修改检查内容、格式和引用；不自动跑完整产品发布流程。
