---
name: openapi-guide
description: "创建或修改本项目 /openapi 接口及 docs/openapi.json 时使用，含网关认证与 Host 业务授权边界。"
---

# OpenAPI 接口

本技能仅适用于 `/openapi` 及其对外类型。普通 `/api` 修改按 [coding-guide](../coding-guide/SKILL.md) 处理。

## 认证与业务授权

妙搭网关负责 API Key 认证；不能机械套用浏览器 `@NeedLogin()`。网关认证不替代 Host 业务授权：保留当前 Controller/Service 的 service-scope、租户/actor、来源与对象权限检查。例如 `canonical-host-openclaw-mcp.openapi.controller.ts` 的 `assertTransport` 必须保留。

系统调用身份不能从任意 body/userId 推导。按该入口现有受控身份映射绑定 actor 与允许的对象范围，不能以“系统身份”为由取消过滤或授权。

## 变更与文档

- 对外 Controller 与内部 Controller 可以共用领域 Service，但各自的认证入口和范围检查保持完整；新增 Controller 注册到实际 Module。
- `docs/openapi.json` 是运行时对外 spec。新增/删除路径、方法、参数或响应类型时，同步受影响条目；内部 `/api` 不加入。
- 请求和响应从 Controller 实际签名及共享 DTO 推导，Drizzle 仅辅助解释底层类型。内部字段不因表里存在就暴露给调用方。
- 编辑时核对当前 spec，使用局部补丁或结构化更新，保留无关 paths；完成一组修改后检查差异、JSON 和有关接口。无需每次文本替换都重读整个 spec 或重跑全套检查。
- 具体中间件格式、类型映射和结构检查见 [spec-format.md](references/spec-format.md)，仅在修改 spec 时读取。
