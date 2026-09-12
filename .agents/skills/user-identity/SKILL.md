---
name: user-identity
description: "读取妙搭 req.userContext、处理当前用户资料或转换妙搭/飞书用户 ID；登录交互和权限策略由相应技能处理。"
steering: true
steering-topic: user_identity
match-template-name: nestjs-react-fullstack
---

# 用户身份

本技能处理身份值与上下文；登录/登出和展示组件见 [client-builtins-user-service](../client-builtins-user-service/SKILL.md)，权限策略见 [authz-guide](../authz-guide/SKILL.md)。接口认证以当前 Controller/Guard 和平台包为准，不要求调用未安装的 authn-guide/contacts-service/feishu 技能。

## 不能混用的 ID

| 来源 | 含义 |
| --- | --- |
| req.userContext.userId、useCurrentUserProfile().user_id | 妙搭用户 ID |
| useCurrentUserProfile().lark_user_id、AuthNPaasService 的 LarkUserId | 飞书企业 user_id / employee_id |
| 飞书 API open_id / union_id | 另外两种飞书标识，不能用前两项代替 |

身份 ID 按 string 透传，不能 Number/parseInt；大整数会丢精度。Hook 的飞书字段是 `lark_user_id`，不自行补造 open_id；该字段未就绪时不能退回 `user_id`。

## 选择实现

- 服务端当前身份、租户与 roles：读 [request-context.md](references/request-context.md)，来源为可信中间件/既有 Host 授权绑定，不能相信前端自报身份。
- 前端当前用户：`useCurrentUserProfile()` 初始 `{}`，按 `userInfo?.user_id` 判断就绪，展示用项目现有用户组件。
- 妙搭 userId ↔ 飞书 user_id：注入 `AuthNPaasService`，读 [id-conversion.md](references/id-conversion.md)。批量每次最多 100，保留输入顺序及 null 未映射项。
- open_id/union_id：开发查询按 lark-apps 的 ID 转换参考，应用运行时沿用已授权的平台适配器，不把 CLI 嵌入产品代码。用户/部门/群组选择的返回值与目标 API 的 ID 类型需对应。

不手动实例化服务，不重复注册 PlatformModule 已提供的身份模块，不跨前后端导入 SDK。身份未关联、异步加载、认证失败和权限不足分别表达。
