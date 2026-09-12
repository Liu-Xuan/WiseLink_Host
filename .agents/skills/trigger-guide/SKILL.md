---
name: trigger-guide
description: "编写妙搭应用 @Automation/@BindTrigger handler 时使用；平台触发器配置用 lark-apps，Codex 提醒不在此范围。"
steering: true
steering-topic: trigger_guide
match-template-name: nestjs-react-fullstack
---

# 妙搭自动化 handler

只编写应用内 `@Automation()` / `@BindTrigger()` 代码。平台 trigger 的创建、状态、启停和发布使用 lark-apps 的对应参考；Hosted OpenClaw cron 和 Codex 提醒各走既有工具，不套用本技能频率限制。

- 从已有任务或创建响应取得真实名字。`@BindTrigger('<任务名字>')` 按该名字绑定，不能用 ID/方法名代替。
- 自动化类注册到所属 Module 的 providers，Module 接入实际 app.module.ts 链路。保留现有业务结构，不因模板要求每模块一个文件重排代码。
- cron 无业务 event 入参；record_change/webhook 按 [trigger-lifecycle.md](references/trigger-lifecycle.md) 解析。字符串 JSON 显式解析并处理错误；INSERT/UPDATE 看 after，DELETE 看 before，Webhook body 可能还需一次解析。
- 自动化没有浏览器当前用户上下文。身份、目标人和允许的数据范围来自已授权配置或已有业务绑定，不能用任意 event 字段冒充身份。
- 新建 handler 完成后按任务要求接线、验证和交付。真实启用/试运行沿用已有授权与平台状态要求，不自动启用未授权触发器；已有明确启用授权不要求用户重复手工操作。
- cron 语法需要时查 [cron-examples.md](references/cron-examples.md) 并核对当前平台能力；只在用户要求表达式 JSON 时固定该格式，开发回复说明改动与验证。
