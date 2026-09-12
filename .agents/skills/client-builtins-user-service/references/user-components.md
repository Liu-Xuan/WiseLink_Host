# 用户系统前端相关规范

## 概述

内置用户前端组件：UserSelect（单选/多选用户选择器，onChange 返回用户对象）、DepartmentSelect（部门选择组件，交互与受控规范与 UserSelect 一致）、UserDisplay（用户信息展示组件）。均基于统一的 userid 数据，用于用户相关的表单输入和数据展示场景。

## 类型定义

### 用户数据类型

```typescript
import type { User } from "@/types/common";
```

`User` 接口包含用户的基本信息，如用户 ID、姓名、头像字段。

```typescript
export type User = {
  /** 妙搭用户 ID：入库、传飞书内置插件、跨边界透传一律用它 */
  user_id: string;
  /** 飞书企业内 user_id（仅内部飞书用户），调飞书开放平台 API 用它 */
  employee_id?: string;
  name: string;
  avatar: string;
};
```

> **用户/部门 ID 怎么选、字段获取与权限引导 → 见 [user-identity](../../user-identity/SKILL.md)；部门/群组字段按实际组件与目标 API 文档核实，不混用内部 ID。**

## 当前用户信息的获取方案

### Hooks 方法: `useCurrentUserProfile` - 在 React 中获取当前用户信息

- **文件路径**：`@lark-apaas/client-toolkit/hooks/useCurrentUserProfile`
- **功能**：获取当前登录用户的个人信息（含飞书 user_id）
- **返回值**：`Partial<IUserProfile>`（初始为空对象 `{}`，异步获取后填充完整字段）

**IUserProfile 字段**：

| 字段           | 类型     | 说明                                                     |
| -------------- | -------- | -------------------------------------------------------- |
| `user_id`      | `string` | 妙搭用户 ID                                              |
| `email`        | `string` | 用户邮箱                                                 |
| `name`         | `string` | 用户名称                                                 |
| `avatar`       | `string` | 用户头像 URL                                             |
| `lark_user_id` | `string` | 飞书 user_id，通过额外异步请求获取，可能晚于其他字段就绪 |

> ⚠️ **空值处理（CRITICAL）**：Hook 初始返回空对象 `{}`（truthy），**MUST** 用 `if (!userInfo?.user_id)` 判加载态（不是 `!userInfo`）；`lark_user_id` 可能为 `undefined`，使用前条件渲染。完整禁止行为清单与飞书 ID 转换指南（后端 `AuthNPaasService` 等）参见 `user-identity` skill。

```typescript
import { useCurrentUserProfile } from "@lark-apaas/client-toolkit/hooks/useCurrentUserProfile";

const MyComponent = () => {
  const userInfo = useCurrentUserProfile();
  if (!userInfo?.user_id) return <div>加载中...</div>;
  return <p>{userInfo.name}</p>;
};
```

## 用户展示与选择方案

这些组件在使用之前必须读取 client/src/components/business-ui/README.md文件来理解用法

目前可用的组件有：

- UserSelect 用户选择组件（@/components/business-ui/user-select）
- DepartmentSelect 部门选择组件（@/components/business-ui/department-select）
- UserDisplay - 用户展示组件（@/components/business-ui/user-display）

## 使用注意事项

### 最佳实践

- 根据展示场景选择合适的组件尺寸（`small`、`medium`、`large`）
- 对于用户信息 userId，禁止直接展示文本，总是使用 UserDisplay 组件展示
