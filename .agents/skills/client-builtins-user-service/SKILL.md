---
name: client-builtins-user-service
description: "实现妙搭前端登录/登出、401 处理及用户或部门展示/选择组件；服务端身份和 ID 转换用 user-identity。"
steering: true
steering-topic: client_builtins_user_service
match-template-name: nestjs-react-fullstack
---

# 前端账户与用户组件

这些 SDK 仅在前端使用，不导入 `server/`。后端身份和 ID 转换使用 [user-identity](../user-identity/SKILL.md)，权限策略使用 [authz-guide](../authz-guide/SKILL.md)。

| 需求 | 资料 |
| --- | --- |
| 登录/登出、用户详情跳转、非 React 账户信息或 401 | [session-api.md](references/session-api.md) |
| 当前用户、人员/部门选择、用户名称与头像 | [user-components.md](references/user-components.md) 及实际 business-ui 组件 README |

`authClient` 从 `@lark-apaas/client-toolkit/auth` 导入，是已有 singleton。插件调用使用独立 capabilityClient，不属于账户 SDK。

React 当前用户优先 `useCurrentUserProfile()`，初始对象为空，以 `userInfo?.user_id` 判断就绪。展示复用已有 UserDisplay/UserProfile，选择复用 UserSelect/DepartmentSelect；props 与返回字段以当前源码类型为准。妙搭 ID 与飞书 ID 不相互回退，长整数字符串不转 Number。

登录失效、权限不足、获取失败与尚未关联账号分开处理；不以默认身份掩盖错误。
