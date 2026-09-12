---
name: authz-guide
description: "修改妙搭应用的角色/权限点位鉴权代码或排查权限 403 时使用；仅操作平台角色成员时用 lark-apps。"
steering: true
steering-topic: authz_guide
match-template-name: nestjs-react-fullstack
---

# 角色与权限代码

先定位实际 handler、权限模型和平台绑定。只查角色/成员、不改应用代码时使用 `lark-apps`；排查普通 CSRF/网络 403 时先看 [本地调试](../coding-guide/references/local-debug.md)，不直接改角色。

## 按模式读取

| 模式 | 资料 |
| --- | --- |
| 现有静态角色控制 | [static-role.md](references/static-role.md) |
| 应用内角色成员管理 | [Controller/DTO](references/runtime-role-controller-spec.md)、[SDK 类型](references/sdk-types.md)；做页面时再读 [页面规格](references/management-page-spec.md) |
| 动态权限点位或模式迁移 | [dynamic-permission-guide.md](references/dynamic-permission-guide.md) |
| SDK 用法不明 | [sdk-examples.md](references/sdk-examples.md) |

## 保留的要求

- 从 `.spark/meta.json` 和当前上下文确认 app；使用具体角色标识时，以 `+role-list`/`+role-get` 等平台实读为准，不把 admin/editor 示例当真实 ID。
- 角色来源是平台。复杂授权可用已核实的平台角色配合数据层行级过滤；不创建平台不认识的平行角色库，不硬编码当前样本用户为权限策略。
- 运行态角色变更使用注入的 `AuthorizationSDK`；成员按 SDK 类型分组。保留公共/全员角色不可删除等 SDK 限制。
- 新建或迁移权限模型先形成与需求一致的方案。已获准的本地实现和验证继续完成；只有影响权限范围的关键选择未明确，或将执行尚未授权的真实权限变更时才询问。不能因例行设计格式停在未接线代码。
- 静态角色用现有 CanRole/useAuth；动态点位按方案用 @Can/<Can>，迁移完整覆盖受影响后端 API 与前端入口，避免混用导致漏检。加载期间不将 false 当无权限终态。
- 403 在统一 API 层按实际 validateStatus/拦截器处理，不断言只进入 resolve 或 catch；保留 cause，不靠错误字符串猜测。
- 真实平台写入仍遵守对应命令的授权与读回。只读诊断不能自动添加成员、创建角色或放大可见范围。
- 验证受影响的允许/拒绝路径及真实注册链，选择对应类型检查和测试；小修不自动运行无关构建或迁移。

角色面板可在对话提供 `BaseURL?openPanel=auth`，不把该平台管理入口硬编码进业务页面。
