# 获取调用依据与错误处理

## 插件调用代码编写依据

### 获取调用依据

首次接入、实例配置或插件版本改变时获取实际 action/schema；同一任务已核实且未变化的输出可复用：

```bash
npx @lark-apaas/miaoda-cli plugin list --id <instance_id>
```

命令不可用时，依次尝试 fallback。如果所有工具都不可用且插件有 `{dynamic: true}`，按「无 Node.js 环境」兜底处理。

输出包含 `actions[].key`、`inputSchema`、`outputSchema`、`outputMode`，是编写调用代码的唯一依据。

### 充血 Fallback 链

`npx @lark-apaas/miaoda-cli plugin list --id <id>` → 失败则 `npx fullstack-cli capability list --id <id>` → 失败则 `node .agents/skills/plugin-guide/scripts/plugin-hydrate.js <pluginKey> <instanceId>` → 失败则手动合并 manifest + capability JSON。

### 无 Node.js 环境

1. 告知用户当前环境未安装 Node.js
2. 手动逐条校验 formValue + paramsSchema（对照 §Schema 规则）
3. 手动合并 manifest + capability JSON
4. 如果插件有 `{dynamic: true}`：
   a. 阅读插件源码（`node_modules/<pluginKey>/` 中动态 schema 函数）
   b. 结合 formValue 推导动态参数的实际结构
   c. 输出推导结论
   d. 基于推导结果编写调用代码
   e. 运行时若报错 → 上报用户（附带推导过程 + 实际报错）
   f. 运行正确 → 推导成立，代码注释说明推导来源

### Client vs Server 决策

| 应用类型 | 可选调用侧 |
|---------|-----------|
| 纯前端应用 | 只有 Client 侧 |
| 全栈应用（NestJS + React） | Client 侧（首选）或 Server 侧 |

**Server 侧仅在以下场景使用**：

1. 涉及敏感凭证（token/secret 不能暴露给前端）
2. 多步骤强事务编排
3. 触发器/定时任务（无前端上下文）
4. 插件结果需持久化到数据库

> 不涉及上述场景 → Client 侧。

### 持久化决策

以下任一条件成立时，插件结果**必须**保存到数据库：

1. 结果会在其他页面展示
2. 结果供后续功能消费
3. 用户再次访问时需要看到结果

**推荐**：Server 侧 Service 调用插件 + 同一方法落库。**备选**：Client 侧调用 → 流式结束后调已有 CRUD 接口保存。

### 生成代码

完成上述决策后，按需读取同目录的 [plugin-coding-guide.md](plugin-coding-guide.md) 获取具体代码模式。禁止凭记忆写调用代码。

---

| 错误类型 | 含义 | 应对策略 |
|----------|------|---------|
| `InputValidationError` | 入参不符合 schema | 修复参数后重试 |
| `RateLimitError` | 触发限流 | 指数退避重试（1s/2s/4s），最多 3 次 |
| `ExecutionError` | 插件执行失败 | 记录脱敏原因和失败状态，说明受影响功能；只使用用户已允许的替代路径 |
| `OutputValidationError` | 返回值不符合 schema | 保留脱敏诊断并修正 schema/消费者；不以默认业务值伪装成功 |

**规则**：

1. **禁止静默吞异常**：每个 `catch` 块必须向用户展示错误或触发补偿
2. **异步操作必须有终态**：DB 中维护状态（pending → success / failed）
3. **插件失败必须有补偿**：至少记录到待处理列表或提示用户重试

## 缓存与幂等性

- AI 类插件**没有请求级缓存**。同样输入返回相似结果是 LLM 正常行为。
- **禁止**通过修改业务参数注入 UUID 来"绕缓存"，这会污染 AI 输入。

## 参数来源规范

| 类型 | 来源 | 示例 |
|------|------|------|
| 业务数据 | 从 DB 查询或前端传入 | 候选人姓名、简历内容 |
| 运行时配置 | 从配置/环境变量/平台 API 获取 | 接收人 user_id、模板 |

**禁止**在业务代码中硬编码运行时配置值。固定值 → 在 formValue 中直接配置；动态值 → 从配置/API/DB 获取。

---

## 常见错误（必须避免）

| 错误做法 | 正确做法 |
|---------|---------|
| 用 `npm install` 安装插件包 | 插件包通过 lark-apps skill 引导安装 |
| 实例配置文件写入不正确的位置 | 按「插件实例配置目录」规则确定路径 |
| 未读 manifest 就写调用代码 | 先 `cat manifest.json`，确认 actionKey/schema |
| 用 Mock 冒充已运行 | 实际集成需真实调用；隔离测试与运行证据分开 |
| 通过 `getDataloom().capability` 调用插件 | `capabilityClient` 是独立导入 |
| Client 侧先通过 dataloom 上传文件再传给插件 | 直接传 File/Blob 对象 |
| 用正则/字符串解析处理 AI 输出 | 用 `ai-text-to-json` / `ai-image-to-json` |
| 认为 `ai-doc-parser` 能直接输出结构化 JSON | 只输出纯文本，需链式调用 `ai-text-to-json` |
| 图片提取结构化用两步链 | 优先 `ai-image-to-json` 单步直达 |
| 流式 chunk 当字符串拼接 | chunk 是对象，按 outputSchema 解构：`chunk.content` |
| formValue 中 `["{{input.xxx}}"]` 包装已是 array 的参数 | array 类型透传 `"{{input.xxx}}"`，不再包数组 |
| 创建了实例但未生成调用代码 | CREATE 后必须接着生成调用代码集成到业务 |
| 为保存插件结果单独新建 API 端点 | 复用已有 CRUD 接口 |

## 铁律

1. **写入实例配置前必须自查** — 逐条对照 §一致性铁律 检查参数定义与引用的对称性、类型合法性、模板语法限制。自查通过后再写入配置文件。
2. **先装包再建实例** — 创建插件实例前必须确保插件包已安装。
3. **按原因恢复** — 本地配置错误直接修复；有副作用的失败先确认结果与幂等性，不盲目重试。
4. **写代码前获取插件调用代码编写依据** — 必须按「插件调用代码编写依据」章流程获取。禁止凭记忆猜测 actionKey / inputSchema / outputMode。
5. **禁止用 `npm install` 安装插件包** — 插件包和 npm 包是两套独立机制。
6. **运行证据** — 实际集成需真实插件调用；隔离单元测试可使用明确标识的 fixture，不能冒充运行证明。
7. **formValue 禁止 Handlebars 控制语法** — 仅允许 `{{input.xxx}}`。
