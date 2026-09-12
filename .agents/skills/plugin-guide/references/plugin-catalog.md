# 插件概念与选型

## 核心概念

- **插件包（Plugin Package）**：npm 格式的功能包，安装到 `node_modules/`，含 `manifest.json` 描述 actions 和 form.schema。
- **插件实例（Plugin Instance / Capability）**：基于插件包创建的业务配置，存储在 `server/capabilities/{id}.json`（默认全栈应用，路径规则见「配置目录」），定义 `paramsSchema`（业务入参）和 `formValue`（表单映射，通过 `{{input.xxx}}` 引用 paramsSchema 参数）。
- **变量映射**：`调用方传值 → paramsSchema 定义变量 → formValue 消费变量 {{input.xxx}} → Plugin form.schema 接收`。

### 插件包 ≠ npm 包（必读）

| | 插件包 | npm 依赖 |
|------|------|------|
| 写入字段 | `package.json` → **`actionPlugins`** | `package.json` → `dependencies` / `devDependencies` |
| 用途 | 妙搭平台 AI 能力 | 项目依赖库 |
| **禁止** | ❌ 不能用 `npm install` 装插件包 | ❌ 不能用 `npm install` 管理插件包 |

两套机制完全独立。混淆会导致运行时找不到插件。

### 插件实例配置目录

插件实例配置文件（`<instance_id>.json`）存放在 capabilities 目录下。按以下优先级确定路径：

1. 环境变量 `MIAODA_CAPABILITIES_DIR` → 直接使用
2. 环境变量 `MIAODA_APP_TYPE` 或 `.env.local` 中的 `MIAODA_APP_TYPE`：
   - `6` → `shared/capabilities/`（纯前端应用）
   - 其他 → `server/capabilities/`（全栈应用）
3. 以上都未设置 → 默认 `server/capabilities/`

目录不存在时 `mkdir -p` 创建。

---

## AI 插件目录（17 个）

### 文本类

| 插件 key | 能力 | 输出模式 | 输出类型 | 适用场景 |
|---------|------|---------|---------|---------|
| `ai-text-generate` | 文本生成 | stream | 流式文本 `content` | 文案、报告、对话、问答 |
| `ai-text-summary` | 文本摘要 | stream | 流式文本 `summary` | 长文本摘要、要点提取 |
| `ai-translate` | 多语言翻译 | stream | 流式文本 `translation` | 中英日韩等多语言互译 |
| `ai-categorization` | 文本分类 | unary | `{categories: string[]}` | 打标签、情感分析、内容分类 |
| `ai-text-to-json` | 文本→结构化 JSON | unary | `{字段名: 值}` | 信息提取、表单自动填充（最多 20 字段） |
| `ai-search-summary` | 搜索摘要 | stream | 流式文本 `content` | 联网搜索 + 摘要生成 |

### 图片类

| 插件 key | 能力 | 输出模式 | 输出类型 | 适用场景 |
|---------|------|---------|---------|---------|
| `ai-text-to-image` | 文生图 | unary | `{images: string[]}` | 根据文本描述生成图片 |
| `ai-image-to-image` | 图生图 | unary | `{images: string[]}` | 图片编辑、风格转换 |
| `ai-image-understanding` | 图片理解 | stream | 流式文本 `content` | 图片描述、问答、OCR |
| `ai-image-to-json` | 图片→结构化 JSON | unary | `{字段名: 值}` | 图片信息提取（单步直达） |
| `ai-image-compare` | 图片对比 | stream | 流式文本 `content` | 两张图片差异分析 |
| `ai-image-matting` | 抠图 | unary | `{images: string[]}` | 去背景、主体提取 |
| `ai-background-replace` | 换背景 | unary | `{images: string[]}` | 替换图片背景 |

### 文档/语音/其他

| 插件 key | 能力 | 输出模式 | 输出类型 | 适用场景 |
|---------|------|---------|---------|---------|
| `ai-doc-parser` | 文档解析 | unary | **纯文本 string** | PDF/Word/Excel 文本提取 |
| `ai-speech-to-text` | 语音识别 | unary | **纯文本 string** | 音频转文字 |
| `ai-speech-synthesis` | 语音合成 | unary | 音频 URL string | 文字转语音 |
| `web-crawler` | 网页抓取 | unary | 网页内容 string | 抓取指定 URL 的页面内容 |

> 所有插件 key 使用时需加 `@official-plugins/` 前缀，如 `@official-plugins/ai-text-generate`。

### 用户意图 → 插件选择

| 用户表述 | 对应插件 | 类型 |
|---------|---------|------|
| "AI 写文案 / 生成文本 / 帮我写" | `ai-text-generate` | 流式生成 |
| "总结 / 摘要 / 提取要点" | `ai-text-summary` | 流式生成 |
| "翻译成XX / 多语言" | `ai-translate` | 流式生成 |
| "分类 / 打标签 / 情感分析" | `ai-categorization` | 结构化 |
| "从文本提取字段 / 文本转结构化" | `ai-text-to-json` | 结构化 |
| "搜索并总结 / 联网查询" | `ai-search-summary` | 流式生成 |
| "AI 生图 / 文生图 / 生成图片" | `ai-text-to-image` | 图片 |
| "图片编辑 / 风格转换 / 图生图" | `ai-image-to-image` | 图片 |
| "识别图片 / 图片问答 / 看图说话" | `ai-image-understanding` | 流式生成 |
| "从图片提取信息 / 图片转结构化" | `ai-image-to-json` | 结构化 |
| "对比两张图 / 图片差异" | `ai-image-compare` | 流式生成 |
| "抠图 / 去背景" | `ai-image-matting` | 图片 |
| "换背景 / 替换背景" | `ai-background-replace` | 图片 |
| "解析文档 / 读 PDF / 读 Word" | `ai-doc-parser` | 文本提取 |
| "语音合成 / 文字转语音 / 朗读" | `ai-speech-synthesis` | 音频 |
| "语音识别 / 音频转文字" | `ai-speech-to-text` | 文本提取 |
| "抓取网页 / 爬取页面" | `web-crawler` | 文本提取 |

---

## 设计原则

### 原子化

**一个插件实例只做一件事**。不同输出类型、不同业务语义必须创建独立的插件实例。

```
✅ 正确：需要生成标题 + 生成正文
   → 创建两个 ai-text-generate 实例：title-generator、content-generator

❌ 错误：把标题和正文塞进同一个实例的 prompt
   → 输出混在一起，无法分别渲染
```

### 链式调用

部分插件输出是纯文本，不能直接产出结构化数据。需要链式组合时：

```
文档 → 结构化：ai-doc-parser → ai-text-to-json（两步）
图片 → 结构化：ai-image-to-json（单步直达，优先用这个）
语音 → 结构化：ai-speech-to-text → ai-text-to-json（两步）
```

### 流式标注

使用 stream 输出模式的插件，功能设计中需注明涉及流式渲染，代码中使用 `callStream` + `normalizeStream`。

---

## Plugin 链式调用（Plugin Chain）

以下是已选用妙搭插件后的常见组合。按真实输出 schema 消费；不能伪造结构化结果。已存在的受控解析器不因本表被替换，普通 JSON 解码和字段映射不要求再次调用模型。

### 决策树：选择单步还是链式

```
输入是什么？
├── 需要插件解析的文档文件 → 可用 ai-doc-parser 提取文本：
│   ├── 需要结构化数据 → ai-doc-parser → ai-text-to-json（2步链）
│   ├── 需要摘要 → ai-doc-parser → ai-text-summary
│   ├── 需要翻译 → ai-doc-parser → ai-translate
│   └── 仅需原文 → ai-doc-parser（单步）
├── 图片 →
│   ├── 提取结构化数据 → ai-image-to-json（⭐ 单步直达！）
│   ├── 理解后提取结构化 → ai-image-understanding → ai-text-to-json（2步链）
│   └── 抠图后换背景 → ai-image-matting → ai-background-replace（2步链）
├── 音频 →
│   ├── 需要结构化数据 → ai-speech-to-text → ai-text-to-json（2步链）
│   └── 仅需文字 → ai-speech-to-text（单步）
└── 纯文本 →
    ├── 需要结构化数据 → ai-text-to-json（⭐ 单步直达！）
    └── 摘要/翻译/分类/生成 → 对应单插件
```

### 常见 Plugin Chain 组合

| 链路 | 插件组合 | 场景举例 |
|------|---------|---------|
| 文档→结构化数据 | `ai-doc-parser` → `ai-text-to-json` | 简历PDF→员工档案 |
| 文档→摘要 | `ai-doc-parser` → `ai-text-summary` | 研报PDF→摘要 |
| 图片→结构化数据 | `ai-image-to-json`（**单步**） | 发票→金额/日期 |
| 音频→结构化数据 | `ai-speech-to-text` → `ai-text-to-json` | 会议录音→待办 |
| 抠图→换背景 | `ai-image-matting` → `ai-background-replace` | 商品图→电商主图 |

### Plugin Chain 调用模式

```typescript
// 文档 → 结构化数据（2步链）
const rawResult = await capabilityClient
  .load('doc_parser_instance')
  .call('parseDocToMarkdown', { fileUrl: [docUrl] });

const structured = await capabilityClient
  .load('text_to_json_instance')
  .call('textToJson', { text: rawResult.content });
```

> **Client 侧提示**：`capabilityClient` 支持直接传 File/Blob 对象作为文件参数，无需先上传获取 URL。Server 侧 `CapabilityService` 仅支持 URL 字符串。

---
