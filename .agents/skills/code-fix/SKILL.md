---
name: code-fix
description: "诊断本妙搭工程的编译、类型、路由、请求或数据库连接故障；从实际报错定位到受影响实现。"
---

# 妙搭代码故障定位

从实际失败请求、报错位置或用户可见症状追踪到原因，修复后复测受影响路径。已通过的检查不无理由重复，不把独立旧故障扩展成本次任务。

| 症状 | 有用检查 |
| --- | --- |
| 模块/图标缺失 | 核对当前文件的 import、实际文件路径、包导出和依赖；不凭记忆生成图标名 |
| duplicate identifier / export 冲突 | 检查发生冲突的导出链和消费者；只有证据显示同类复制问题时扩大搜索 |
| DTO/字段类型不符 | 追溯该符号实际定义（通常为 shared 类型，生成客户端则看生成源），同步生产者与消费者，不伪造宽松类型 |
| JSX 编译失败 | 修复具体语法/转义错误，沿用现有组件和编译器反馈 |
| API 异常 | 对照请求 method/path、Controller、Service 和错误 cause；修正真正有误的一侧，不预设客户端一定正确 |
| 404 或 HTML 响应 | 核对 base path、路由顺序、Module 注册及 ViewModule fallback 顺序 |
| 登录/CSRF/连接失败 | 读 [本地调试](../coding-guide/references/local-debug.md)；身份问题用 [user-identity](../user-identity/SKILL.md)，权限问题用 [authz-guide](../authz-guide/SKILL.md) |

React Hook、SDK 或库问题优先查本工程实现与当前依赖文档；没有 `react-hook-best-practices` 等技能时直接用这些来源，不将不存在的技能当成开工条件。

本地运行日志由当前启动脚本决定，线上日志/Trace 则按匹配的 lark-apps 可观测能力读取。记录可定位的脱敏原因；浏览器只接收适当的错误码和说明，不能把 `err.stack` 复制到响应 message。无法重现时说明已验证范围和具体缺失条件，继续可独立完成的修复。
