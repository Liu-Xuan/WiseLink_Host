# 请求身份

## 二、用户上下文（req.userContext）

`UserContextMiddleware` 解析 Gateway 注入的 `x-larkgw-suda-webuser` 头，把当前用户上下文挂到 `req.userContext`，所有 Controller 均可通过 `@Req() req: Request` 读取。

> 接口认证以当前 Guard、Controller 与平台包类型为准；调试入口见 [local-debug.md](../../coding-guide/references/local-debug.md)。

### 字段表

| 字段 | 类型 | 说明 |
|------|------|------|
| `userId` | `string` | 妙搭用户 ID |
| `tenantId` | `number` | 租户 ID |
| `appId` | `string` | 应用 ID |
| `loginUrl` | `string` | 登录跳转 URL |
| `userType` | `string` | 用户类型（如 `_employee`） |
| `env` | `string` | 环境（`preview` 预览态、`runtime` 发布运行态） |
| `userName` | `string` | 用户名 |
| `userNameI18n` | `{ zh_cn, en_us, ja_jp }` | 多语言用户名 |
| `isSystemAccount` | `boolean` | 是否系统账号 |
| `roles` | `string[] \| null` | 用户角色列表。**未开启权限服务或用户无角色时为 `null`** |
| `baseUrl` | `string` | 网关内部地址 |

### 服务端读取角色示例

`roles` 字段记录当前用户在应用中的角色列表，可在 Controller 业务逻辑中消费（如根据角色返回不同数据）：

```typescript
import { Controller, Get, Req } from '@nestjs/common';
import { Request } from 'express';   // ⚠️ Request 类型必须来自 'express'，不要 import 自 'http' / 'undici' 或漏掉 import
import { TaskService } from './task.service';   // 按项目实际路径 import 业务 Service

// req.userContext 的类型由 @lark-apaas/fullstack-nestjs-core 通过 declare module 'express' 自动注入到 Request，无需手动声明
@Controller('api/tasks')
export class TasksController {
  constructor(private readonly taskService: TaskService) {}

  @Get()
  async listTasks(@Req() req: Request) {
    const roles: string[] | null = req.userContext?.roles ?? null;
    // roles 示例：['text_editor', 'visitor', 'admin']
    // ⚠️ 未开启权限服务或用户无角色时为 null
    if (roles?.includes('admin')) {
      return this.taskService.findAll();
    }
    return this.taskService.findByUser(req.userContext?.userId);
  }
}
```

> **注意**：`roles` 在未开启权限服务或用户无角色时为 `null`，使用前必须做空值处理。

---
