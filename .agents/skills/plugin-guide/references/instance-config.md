# 实例配置

## Schema 规则

生成 paramsSchema 和 formValue 前必读本章节。

### 变量三层映射

```
调用方传值              paramsSchema 定义变量       formValue 消费变量                         Plugin form.schema 接收
(resume_text="...")  →  (定义: resume_text)     →  ("prompt": "...{{input.resume_text}}...")  →  (prompt 字段)
(article="...")      →  (定义: article)         →  ("content": "{{input.article}}")           →  (content 字段)
```

**关键区分**：

- formValue 的 **key** = Plugin form.schema 的字段名（如 `prompt`、`content`、`fileUrl`）
- formValue 的 **value** 中通过 `{{input.xxx}}` 引用 paramsSchema 定义的变量
- 变量名（paramsSchema）与 form 字段名（form.schema）分属不同层，通常名称不同

### paramsSchema 生成规则

#### 支持的参数类型（仅 4 种）

**文本**：

```json
{ "type": "string", "description": "文本参数描述" }
```

**数组**：

```json
{ "type": "array", "description": "描述", "items": { "type": "string", "description": "元素描述" } }
```

**图片**：

```json
{ "type": "array", "format": "plugin-image-url", "description": "描述", "items": { "type": "string" } }
```

**文件**：

```json
{ "type": "array", "format": "plugin-file-url", "description": "描述", "items": { "type": "string" } }
```

#### 约束

- 只允许 string 和 array 两种 type
- 每个参数**必须**有 type 和 description
- array 类型**必须**有 items 字段
- format 只允许 `plugin-image-url` 或 `plugin-file-url`
- 若 form.schema 字段描述写"不允许使用参数"，则不生成对应 paramsSchema

### formValue 生成规则

- **key 必须**对应 form.schema 中定义的字段
- **value** 可以是常量，或 `{{input.xxx}}` 引用 paramsSchema 参数
- **类型一致性**：
  - form.schema type=string → `"字段名": "{{input.param}}"` 或常量字符串
  - form.schema type=array + paramsSchema type=array → **透传**：`"字段名": "{{input.param}}"`（禁止再包数组）
  - form.schema type=array + paramsSchema type=string → **包装**：`"字段名": ["{{input.param}}"]`
- **禁止双层包装**：paramsSchema 已经是 array 时，`["{{input.param}}"]` 会导致 `[url]` → `[[url]]`
- 无法明确赋值的字段留空字符串 `""`
- **业务枚举参数**：用户指定单一固定值 → 常量；用户列举多个值 → 生成 paramsSchema 参数
- 若 form.schema 字段描述写"固定填默认值 xxx" → 直接填固定值

### 插件字段映射表

#### 文本类

| 插件 | 内容入口字段 | 映射方式 | 其他常用字段 |
|------|------------|---------|------------|
| ai-text-generate | `prompt` | 用户输入嵌入 prompt 字符串 | `modelID`、`modelParams`（固定值） |
| ai-text-summary | `content` | 直接赋值 | `requirement`（摘要要求） |
| ai-translate | `content` | 直接赋值 | `targetLanguage`（单一语言写常量，多语言生成参数） |
| ai-categorization | `textToBeCategorized` | 直接赋值 | `categories`（分类列表，array 类型） |
| ai-text-to-json | `prompt` | 文本嵌入 prompt | `jsonStructure`（固定结构定义）、`modelID`、`modelParams` |
| ai-search-summary | `prompt` | 用户查询嵌入 prompt | `modelID`、`modelParams`（固定值） |

#### 图片类

| 插件 | 内容入口字段 | 映射方式 | 其他常用字段 |
|------|------------|---------|------------|
| ai-text-to-image | `prompt` | 图片描述嵌入 prompt | `ratio`（宽高比）、`style`（风格） |
| ai-image-to-image | `prompt` + `images` | 指令嵌入 prompt，图片传 images（透传） | `strength`（编辑强度） |
| ai-image-understanding | `prompt` + `images` | 指令嵌入 prompt，图片传 images（透传） | `modelID`、`modelParams` |
| ai-image-to-json | `prompt` + `images` | 文本嵌入 prompt，图片传 images | `jsonStructure`、`modelID`、`modelParams` |
| ai-image-compare | `prompt` + `images` | 对比指令嵌入 prompt，两张图片传 images | — |
| ai-image-matting | `images` | 图片直接传入（透传） | — |
| ai-background-replace | `images` + `prompt` | 原图传 images，新背景描述嵌入 prompt | — |

#### 文档/语音/其他

| 插件 | 内容入口字段 | 映射方式 | 其他常用字段 |
|------|------------|---------|------------|
| ai-doc-parser | `fileUrl` | file 类型：array → 透传，string → 包装 `["{{input.xxx}}"]` | — |
| ai-speech-to-text | `fileUrl` | 同 ai-doc-parser | — |
| ai-speech-synthesis | `text` | 直接赋值 | `voice`（语音角色，通常常量） |
| web-crawler | `url` | 直接赋值 | — |

### AI Prompt

写清任务、输入来源、输出要求和必要边界即可。用户已经提供完整 prompt 时可在既有边界内透传；不强加角色扮演、固定字数、风格套话或与需求无关的分段。示例只用于解释变量映射，不替代用户目标。

### 模板语法限制

- **仅允许** `{{input.参数名}}` 一种语法
- **严禁** `{{#if}}`、`{{#each}}`、`{{#unless}}`、`{{/if}}`、`{{/each}}`、`{{else}}`

### 一致性铁律

1. **定义的变量必须被引用** — paramsSchema 中定义了 `xxx`，formValue 中至少有一处 `{{input.xxx}}`
2. **引用的变量必须被定义** — formValue 中出现 `{{input.xxx}}`，paramsSchema.properties 中必须有 `xxx`
3. **paramsSchema 允许为空** — 当 formValue 所有字段都是常量时可以是 `{}`
4. **不一致 → 后端 actions 为空 → 插件无法调用** — 常见致命错误

### ID 生成规则

1. 基于插件实例的名称和描述，设计有业务语义的 ID
2. 格式：小写字母 + 数字 + 短横线（如 `task-text-summary`）
3. 长度不超过 128 字符
4. 必须在当前项目内唯一

---

## CRUD 链路

### Create 链路

创建一个**插件实例**（Plugin Instance），即能力目录下的 `<id>.json` 配置文件。

1. **安装插件包** — 由 lark-apps skill 引导完成
2. **读 manifest** — `cat node_modules/<pluginKey>/manifest.json`，理解插件的 actions 和 form.schema
3. **确定配置目录** — 按上方「插件实例配置目录」规则确定目录，不存在则 `mkdir -p` 创建
4. **设计实例配置** — 规则见 §Schema 规则，确定：
   - `id`：语义化 ID（小写+短横线，如 `task-text-summary`）
   - `name` / `description`：实例的显示名称和描述
   - `paramsSchema`：对外暴露的业务入参
   - `formValue`：将业务入参映射到插件的 form.schema 字段
5. **自查规则** — 写入前逐条对照 §一致性铁律 检查：变量引用是否对称、类型是否允许、是否使用了禁止的模板语法、数组是否有 items。发现违规按具体原因修正；同一错误没有新证据时改变诊断方法，不因固定重试次数停止仍可完成的本地修复
6. **写入实例配置** — 将以下结构写入 `server/capabilities/<id>.json`（或步骤 3 确定的路径）：

   ```json
   {
     "id": "<id>",
     "pluginKey": "<pluginKey>",
     "pluginVersion": "<version>",
     "name": "<实例名称>",
     "description": "<实例描述>",
     "paramsSchema": { ... },
     "formValue": { ... },
     "createdAt": <unix毫秒>,
     "updatedAt": <unix毫秒>
   }
   ```

7. **获取插件调用代码编写依据** — 必须按「插件调用代码编写依据」章的获取流程执行（含多级 Fallback）。未成功获取 → 禁止进入步骤 8
8. **编写调用代码** — 基于步骤 7 的结果，**禁止凭记忆猜测**

大 JSON 场景先写临时文件再读取，避免命令行转义问题。

### Update 链路

修改已有**插件实例**的配置。不可变字段（id / pluginKey / pluginVersion / createdAt）不要修改。

1. `cat server/capabilities/<id>.json` → 查看当前实例配置
2. 读 manifest + 设计修改方案（改 name / formValue / paramsSchema）
3. 改后逐条对照 §一致性铁律 自查，修正后写回配置文件，更新 `updatedAt`
4. **获取插件调用代码编写依据** — 按「插件调用代码编写依据」章的获取流程执行
5. paramsSchema 变化 → 基于步骤 4 的结果扫描代码引用并更新

### Delete 链路

1. `cat server/capabilities/<id>.json` → 确认实例存在
2. `grep -rn "load('${id}')" <project-path>/` → 扫描代码引用，有则先清理
3. `rm server/capabilities/<id>.json`
4. 确认清理完成

### Get 链路

| 查什么 | 操作 |
|--------|------|
| 已声明的插件包及安装状态 | 由 lark-apps skill 引导 |
| 所有实例概览 | `ls server/capabilities/` |
| 单个实例完整配置 | `cat server/capabilities/<id>.json` |
| 插件的 actions/schema | `cat node_modules/<pluginKey>/manifest.json` |
| 获取插件调用代码编写依据 | 按「插件调用代码编写依据」章流程获取 |

### 常见违规及修正

| 违规信息 | 原因 | 修正 |
|---------|------|------|
| `forbidden Handlebars syntax at formValue.xxx` | 使用了控制语法 | 改为纯 `{{input.xxx}}` |
| `paramsSchema property "x" type "number" is invalid` | 类型不在 string/array 范围 | 改为 `"type": "string"` 或 `"type": "array"` |
| `paramsSchema property "x" is array but missing items` | 缺少 items | 补上 `"items": {"type": "string"}` |
| `{{input.xxx}} at formValue.yyy is not defined` | 引用了未定义的变量 | 在 paramsSchema 中补充定义 |
| `paramsSchema property "x" is never referenced` | 定义了但未引用 | 在 formValue 中补充引用或从 paramsSchema 移除 |

---
