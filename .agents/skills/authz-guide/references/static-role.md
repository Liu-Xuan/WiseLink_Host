# 静态角色鉴权

### 核心原则

1. 系统已内置角色权限表，**无需也禁止自建任何平行的角色/权限存储**（自建角色表 / 角色字段 / 用户名单等，不限具体命名）——@CanRole 只读平台角色，应用自建的存储对鉴权无效
2. 统一使用 `useAuth()` 获取 `{ ability, isLoading }`，**禁止** `useAuthAbility` / `useCanRole`（已移除）
3. 必须处理 `isLoading`——加载期间 `ability.can()` 返回 false，不检查会误判无权限
4. 创建角色后必须编写鉴权代码，切忌只创建角色不编写代码
5. **`@CanRole([X])`/`<CanRole roles={[X]}>` 里的 X 必须等于平台实际角色标识，不能凭语义臆造**——需要稳定标识时用 `lark-cli apps +role-create --app-id <app_id> --name <name> --role-id <X> --as user` 创建并回读，已有角色先用 `+role-list` / `+role-get` 取得真实 `role_id` 再写代码。若代码写 `'admin'`/`'reviewer'` 但平台分配给用户的角色标识是 `role_xxx`，两者对不上 → 线上恒 403（日志可见 `用户角色 [role_xxx], 需要 [admin, reviewer]`）

### 前端

```typescript
import { CanRole, useAuth, ROLE_SUBJECT } from '@lark-apaas/client-toolkit/auth';

// 组件级 —— CanRole 内置 isLoading 保护，fallback 仅用于加载态占位（Skeleton/Spinner）
// ⛔ fallback 禁止传入 <Navigate> 等重定向组件
<CanRole roles={['admin', 'super_admin']} fallback={<MenuSkeleton />}>
  <NavLink to="/admin">后台管理</NavLink>
</CanRole>

// 路由级 —— 必须用 ProtectedRoute + useAuth，禁止用 CanRole 做路由守卫
const ProtectedRoute: React.FC<{ children: React.ReactNode; requiredRoles: string[] }> = ({ children, requiredRoles }) => {
  const { ability, isLoading } = useAuth();
  if (isLoading) return <Loading />;
  const hasPermission = requiredRoles.some((role) => ability.can(role, ROLE_SUBJECT));
  return hasPermission ? <>{children}</> : <Navigate to="/unauthorized" replace />;
};
```

### 后端

```typescript
import { CanRole } from '@lark-apaas/fullstack-nestjs-core';

@CanRole(['admin'])           // 单角色
@CanRole(['admin', 'editor']) // 多角色（OR 逻辑：任一即可）
```

---
