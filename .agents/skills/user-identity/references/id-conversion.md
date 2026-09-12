# 用户 ID 转换

## 三、飞书 ID 转换（FeishuID Converter）

### 核心概念

妙搭平台的用户 ID（`userId`）与飞书用户 ID 是两套独立体系。调用飞书 OpenAPI 时需要传入某种飞书侧 ID（`open_id` / `union_id` / `user_id` 任选其一，具体通过哪个参数指定取决于 API：消息 API 用 `receive_id_type`，多数其他 API 用 `user_id_type`，文档协作者用 `member_id_type`）。

`AuthNPaasService` 暴露的飞书 ID 是 **`user_id`**（即 `employee_id`，飞书企业内的用户标识）这一种，支持 **妙搭 userId ↔ 飞书 user_id 双向**转换（正向 `getBatchLarkUserIds`/`getCurrentUserLarkUserId`，反向 `getBatchMiaodaUserIds`）。

> 如果需要 `open_id` / `union_id`（无论正反向），开发操作可按 `lark-apps` 的 `+user-id-convert` 参考核实平台映射；产品运行时沿用项目已有官方身份转换适配器与受控 SDK，不执行 CLI 子进程。`employee_id` ↔ 妙搭 userId 双向都在本 SDK 内（见下方方法表）。

### 后端 API

```typescript
import { Injectable } from '@nestjs/common';
import { AuthNPaasService } from '@lark-apaas/fullstack-nestjs-core';

@Injectable()
export class MyService {
  constructor(private readonly authnService: AuthNPaasService) {}

  async example() {
    // 获取当前登录用户的飞书 user_id
    const larkUserId = await this.authnService.getCurrentUserLarkUserId();
    // => '<飞书 user_id>' | null

    // 批量转换（最多 100 个）
    const larkUserIds = await this.authnService.getBatchLarkUserIds(['uid1', 'uid2']);
    // => ['<飞书 user_id>', null]  顺序与输入对应，失败项为 null

    // 反向：飞书 user_id（employee_id） → 妙搭 userId
    const miaodaUserIds = await this.authnService.getBatchMiaodaUserIds(['emp1', 'emp2']);
    // => ['<妙搭 userId>', null]  顺序与输入对应，失败项为 null
  }
}
```

| 方法 | 签名 | 说明 |
|------|------|------|
| `getCurrentUserLarkUserId` | `() → Promise<string \| null>` | 从请求上下文获取当前用户的飞书 ID |
| `getBatchLarkUserIds` | `(userIds: string[]) → Promise<(string \| null)[]>` | 批量转换，最多 100 个，与输入顺序一一对应 |
| `getBatchMiaodaUserIds` | `(employeeIds: string[]) → Promise<(string \| null)[]>` | 反向：批量把飞书 user_id（employee_id）转为妙搭 userId，最多 100 个，顺序一一对应，失败项 `null`（底层 convertType 31） |

### 内置接口

模块自动注册了 `GET /api/authnpaas/lark-user-id`，返回当前登录用户的飞书 ID：

```json
{ "lark_user_id": "<飞书 user_id>" }
```

### 前端获取

`useCurrentUserProfile()` Hook 已自动调用上述内置接口，返回值中包含 `lark_user_id` 字段：

> 本节示例只涉及 ID 相关字段（`user_id` / `lark_user_id`）和顺手的 `name`。完整返回值（`name` / `avatar` / `email` / `tenantId` 等）见 `client-builtins-user-service` skill。

```typescript
import { useCurrentUserProfile } from '@lark-apaas/client-toolkit/hooks/useCurrentUserProfile';

const UserInfoPanel = () => {
  const userInfo = useCurrentUserProfile();

  if (!userInfo?.user_id) return <div>加载中...</div>;

  return (
    <div>
      <p>用户名: {userInfo.name}</p>
      <p>用户 ID: {userInfo.user_id}</p>
      {userInfo.lark_user_id && <p>飞书用户 ID: {userInfo.lark_user_id}</p>}
    </div>
  );
};
```

**注意**：
- `lark_user_id` 通过额外异步请求获取，可能晚于 `user_id` 等基础字段就绪
- 请求失败或用户无对应飞书账号时值为 `undefined`，**必须用条件渲染**
- `useCurrentUserProfile()` 的返回值里**不存在** `open_id`、`feishu_id`、`openId` 字段——在这个 Hook 的消费代码里飞书 ID 唯一字段名是 `lark_user_id`（仅约束本 Hook；项目其他场景调 spark `id_convert` / 通讯录 API 出现 `open_id` 是正常的）

---

## 四、自定义飞书 ID 转换接口

当内置接口不满足需求（如需要批量转换），可注入 `AuthNPaasService` 编写自定义 Controller：

```typescript
import { Controller, Get, Post, Body, HttpCode } from '@nestjs/common';
import { AuthNPaasService } from '@lark-apaas/fullstack-nestjs-core';

// 生产环境建议加 class-validator 装饰器（如 @IsArray() @IsString({ each: true })
// @ArrayMaxSize(100)）并启用全局 ValidationPipe；本示例聚焦 AuthNPaas 用法，省略校验
class BatchConvertDto {
  userIds!: string[];
}

@Controller('api/feishu-id')
export class FeishuIdController {
  constructor(private readonly authnService: AuthNPaasService) {}

  @Get('current')
  async getCurrent() {
    const larkUserId = await this.authnService.getCurrentUserLarkUserId();
    return { larkUserId };
  }

  @Post('batch')
  @HttpCode(200)
  async batchConvert(@Body() dto: BatchConvertDto) {
    const larkUserIds = await this.authnService.getBatchLarkUserIds(dto.userIds);
    return { larkUserIds };
  }
}
```

> 反向转换（employee_id → 妙搭 userId）同理，把 `getBatchLarkUserIds` 换成 `getBatchMiaodaUserIds` 即可，无需新增 Controller。

前端调用示例：

```typescript
// 获取当前用户飞书 ID
const { larkUserId } = await request<{ larkUserId: string | null }>({
  url: '/api/feishu-id/current',
  method: 'GET',
});

// 批量转换
const { larkUserIds } = await request<{ larkUserIds: (string | null)[] }>({
  url: '/api/feishu-id/batch',
  method: 'POST',
  data: { userIds: ['uid1', 'uid2', 'uid3'] },
});
```

---
