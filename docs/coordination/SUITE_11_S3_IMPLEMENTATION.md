# Suite 1.1 S3 实施方案：精读与文件换版

**创建日期**: 2026-09-18  
**阶段**: S3 - 精读与文件换版  
**目标**: 复刻 Suite 1.1 的 Reader 和 Revision 页面

---

## 1. 设计资源分析

### 1.1 Reader.jsx 核心功能

**5种阅读模式**:
1. `original-pdf` - 原文＋原件（左原文，右PDF）
2. `bilingual` - 中英对照（左英文，右中文）
3. `chinese` - 中文阅读（仅中文）
4. `original` - 仅原文（仅英文）
5. `pdf` - 仅原件（仅PDF）

**核心交互**:
- 双目录系统：作者章节 / 业务主题
- 锚点同步：滚动自动联动
- 分栏拖动：动态调整左右宽度
- 页面跳转：点击块跳转到对应PDF页
- 全屏模式：专注阅读
- 手机模式：左右面板切换

**状态管理**:
```javascript
const [mode, setMode] = useState('original-pdf')
const [outline, setOutline] = useState(true)
const [outlineType, setOutlineType] = useState('author') // 'author' | 'business'
const [split, setSplit] = useState(50) // 分栏比例
const [selected, setSelected] = useState(selector) // 当前选中块
const [page, setPage] = useState(0) // PDF页码
const [zoom, setZoom] = useState(100) // PDF缩放
const [sync, setSync] = useState(true) // 锚点同步
const [mobileSide, setMobileSide] = useState('left') // 手机端显示面
```

**关键特性**:
- ✅ 中文部分可读：缺失时显示"本节中文尚未完成，原文可读"
- ✅ PDF 受控查看：页码控制、缩放、区域高亮
- ✅ 滚动联动：左右面板自动同步位置
- ✅ 状态持久化：保存到 `s.saved[key]`
- ✅ 路由恢复：返回时恢复滚动位置和选中状态

### 1.2 Revision.jsx 核心功能

**版本比较**:
- 左栏：此前原文（旧版本）
- 右栏：本版原文（新版本）
- 变化标记：`changed old` / `changed new`

**业务逻辑**:
```javascript
// 查找当前文档族的最新版本
const latest = ds.find(d => d.familyId === chosen.familyId && d.current) || chosen
// 查找它的前一版本
const old = ds.find(d => d.id === latest.previousId)
```

**关键特性**:
- ✅ 文档族历史链：通过 `previousId` 追溯
- ✅ 修订说明：显示 `revision` 块的内容
- ✅ 变化对比：逐块比较英文原文差异
- ✅ 快速跳转：打开精读页面

---

## 2. 当前生产环境基础

### 2.1 已有组件

**DocumentParsingPage/** (30个文件):
- `DocumentReaderWorkspace.tsx` - 现有阅读工作区 ✅
- `SemanticBilingualReader.tsx` - 双语阅读器 ✅
- `PdfSourcePane.tsx` - PDF 查看面板 ✅
- `StructuredDocumentArticle.tsx` - 结构化文章 ✅
- `DocumentRevisionReadingPage.tsx` - 修订阅读页 ✅
- `LegacyBilingualReader.tsx` - 遗留双语阅读器 ⚠️

**关键能力**:
```typescript
export type ReaderViewMode = 
  | 'bilingual'      // 中英对照
  | 'translation'    // 仅中文
  | 'original'       // 仅原文
  | 'source'         // 仅原件
  | 'minimal';       // 最简模式

// 已有的阅读器能力构建
function buildReaderCapabilities(params: {
  readerProjection: CanonicalReaderProjection | null;
}): ReaderCapability[]
```

### 2.2 需要补充的能力

**缺失模式**:
- ❌ `original-pdf` - 原文＋原件双栏模式（Suite 1.1 默认）
- ⚠️ 业务主题目录（当前只有作者章节）
- ⚠️ 分栏拖动（当前可能是固定布局）
- ⚠️ 手机端左右切换

**需要增强**:
- 双目录系统：作者章节 / 业务主题
- 状态持久化：保存阅读位置、模式选择
- PDF 区域高亮：`REGION` 级别的精确框
- 滚动联动：左右面板自动同步

---

## 3. 实施方案

### 3.1 ReaderPage 组件结构

```
client/src/pages/ReaderPage/
├── index.tsx                    // 主容器：路由、数据加载
├── ReaderHeader.tsx             // 顶部：标题、版本、操作
├── ReaderControls.tsx           // 控制栏：模式切换、同步开关
├── ReaderOutline.tsx            // 目录：作者章节/业务主题
├── ReaderTextPane.tsx           // 文本面板：结构化内容
├── ReaderPdfPane.tsx            // PDF面板：页码、缩放、高亮
├── ReaderSplitter.tsx           // 分隔条：拖动调整宽度
├── ReaderMobileControls.tsx    // 手机控件：左右切换
└── reader.css                   // 完整样式
```

### 3.2 VersionComparisonPage 组件结构

```
client/src/pages/VersionComparisonPage/
├── index.tsx                    // 主容器：版本查询
├── ComparisonHeader.tsx         // 顶部：文档族选择
├── ComparisonOverview.tsx       // 修订说明：版本变化概述
├── ComparisonGrid.tsx           // 对比网格：左旧右新
├── ComparisonBlock.tsx          // 对比块：单个章节对比
└── version-comparison.css       // 完整样式
```

### 3.3 适配器层

```
client/src/adapters/
├── ReaderPageAdapter.tsx              // 精读页集成适配器
└── VersionComparisonPageAdapter.tsx   // 换版页集成适配器
```

---

## 4. 详细实施步骤

### 4.1 阶段 1：ReaderPage 核心布局（2天）

**任务清单**:
- [ ] 创建 ReaderPage 主容器
- [ ] 集成现有 DocumentReaderWorkspace
- [ ] 实现 5 种阅读模式切换
- [ ] 添加双目录系统（作者/业务）
- [ ] 实现分栏拖动
- [ ] 状态持久化到 localStorage

**关键代码**:
```typescript
interface ReaderPageState {
  mode: 'original-pdf' | 'bilingual' | 'chinese' | 'original' | 'pdf';
  outline: boolean;
  outlineType: 'author' | 'business';
  split: number; // 0-100
  selectedBlockId: string;
  pdfPage: number;
  pdfZoom: number;
  sync: boolean;
  mobileSide: 'left' | 'right';
}
```

### 4.2 阶段 2：PDF 增强与同步（1天）

**任务清单**:
- [ ] 集成现有 PdfSourcePane
- [ ] 添加页码控制和缩放
- [ ] 实现 PDF 区域高亮（REGION级）
- [ ] 实现滚动联动逻辑
- [ ] 手机端左右切换

**滚动联动算法**:
```typescript
const scrollSync = (from: HTMLElement, to: HTMLElement) => {
  if (!sync || isLocked) return;
  
  // 找到当前可见的第一个块
  const visibleBlock = findFirstVisibleBlock(from);
  if (!visibleBlock) return;
  
  const blockId = visibleBlock.dataset.blockId;
  setSelectedBlockId(blockId);
  
  // 更新 PDF 页码
  const block = blocks.find(b => b.id === blockId);
  if (block) setPdfPage(block.page);
  
  // 同步到另一侧
  if (to) {
    const target = to.querySelector(`[data-block-id="${blockId}"]`);
    if (target) {
      isLocked = true;
      to.scrollTo({ top: target.offsetTop - 16, behavior: 'smooth' });
      setTimeout(() => isLocked = false, 500);
    }
  }
};
```

### 4.3 阶段 3：VersionComparisonPage（1天）

**任务清单**:
- [ ] 创建 VersionComparisonPage 主容器
- [ ] 实现文档族历史查询
- [ ] 实现左右对比布局
- [ ] 添加变化标记（changed/unchanged）
- [ ] 修订说明展示
- [ ] 快速跳转到精读

**变化检测**:
```typescript
interface ComparisonBlock {
  id: string;
  oldContent: string;
  newContent: string;
  changed: boolean;
}

function detectChanges(
  oldBlocks: Block[],
  newBlocks: Block[]
): ComparisonBlock[] {
  return newBlocks.map(newBlock => {
    const oldBlock = oldBlocks.find(b => b.id === newBlock.id);
    return {
      id: newBlock.id,
      oldContent: oldBlock?.en || '',
      newContent: newBlock.en,
      changed: oldBlock?.en !== newBlock.en
    };
  });
}
```

### 4.4 阶段 4：样式与响应式（0.5天）

**任务清单**:
- [ ] 复刻 Suite 1.1 Reader 样式
- [ ] 复刻 Suite 1.1 Revision 样式
- [ ] 响应式适配（1672/1440/1024/390）
- [ ] 手机端优化

**响应式断点**:
```css
/* 1672px - 桌面主尺寸 */
@media (min-width: 1672px) {
  .reader-layout { grid-template-columns: 260px 1fr; }
}

/* 1024px - 折叠屏 */
@media (max-width: 1024px) {
  .reader-layout { grid-template-columns: 1fr; }
  .reader-outline { display: none; }
}

/* 390px - 手机 */
@media (max-width: 390px) {
  .reader-panes.mobile-left .reader-text-pane { display: block; }
  .reader-panes.mobile-left .reader-pdf-pane { display: none; }
  .reader-panes.mobile-right .reader-text-pane { display: none; }
  .reader-panes.mobile-right .reader-pdf-pane { display: block; }
}
```

### 4.5 阶段 5：集成与测试（0.5天）

**任务清单**:
- [ ] 创建适配器
- [ ] 集成到 Shell 导航
- [ ] 添加路由配置
- [ ] 端到端测试
- [ ] 视觉验收（截图对照）

---

## 5. 数据接口需求

### 5.1 Reader 数据结构

```typescript
interface ReaderDocument {
  id: string;
  familyId: string;
  version: string;
  title: string;
  type: string;
  current: boolean;
  chinesePartial: boolean;
  binding: {
    parseRunId: string;
    parseRevision: string;
    documentVersionId: string;
    selector: string;
  };
  blocks: ReaderBlock[];
  pdf: {
    file: string;
    pageCount: number;
    pages: string[]; // 页面图片URL
  } | null;
  pdfState: 'available' | 'native' | 'unavailable';
  locations: Record<string, SourceLocation>;
}

interface ReaderBlock {
  id: string;
  kind: 'heading' | 'paragraph' | 'table' | 'list';
  role: 'background' | 'scope' | 'limitations' | 'comparison' | 'revision' | 'references';
  page: number;
  title: string;
  zhTitle: string;
  en: string;
  zh: string;
  sourceRefIds: string[];
  // 表格特有
  headers?: string[];
  zhHeaders?: string[];
  rows?: string[][];
  zhRows?: string[][];
}

interface SourceLocation {
  precision: 'PAGE' | 'REGION';
  pageIndex: number;
  pageWidth: number;
  pageHeight: number;
  rect: [number, number, number, number]; // [x, y, width, height]
}
```

### 5.2 Revision 数据结构

```typescript
interface RevisionComparison {
  newer: ReaderDocument;
  older: ReaderDocument | null;
}

// Family 历史链查询
GET /api/canonical-host/documents/family/:familyId/history
Response: {
  current: DocumentVersion;
  history: DocumentVersion[];
}
```

---

## 6. 与现有系统的集成

### 6.1 继承现有能力

**DocumentReaderWorkspace**:
- ✅ `readerMode` 状态管理
- ✅ `buildReaderCapabilities` 能力检测
- ✅ 查询输入和提交
- ✅ `onSourceRefSelect` 定位回调

**SemanticBilingualReader**:
- ✅ 双语对照渲染
- ✅ 块级定位
- ✅ 滚动恢复

**PdfSourcePane**:
- ✅ PDF 页面渲染
- ✅ 页码控制
- ✅ 区域高亮

### 6.2 需要扩展的部分

**新增 ReaderViewMode**:
```typescript
export type ReaderViewMode = 
  | 'original-pdf'   // ⭐ 新增：原文＋原件
  | 'bilingual'      // 已有：中英对照
  | 'translation'    // 映射到 'chinese'
  | 'original'       // 已有：仅原文
  | 'source'         // 映射到 'pdf'
  | 'minimal';       // 保留
```

**业务主题目录**:
```typescript
interface BusinessOutline {
  background: '问题背景';
  scope: '范围与条件';
  limitations: '限制与解释';
  comparison: '条件比较';
  revision: '本版变化';
  references: '参考与复看';
}

function getBusinessTitle(role: string): string {
  return BusinessOutline[role] || role;
}
```

---

## 7. 验收标准

### 7.1 ReaderPage 验收

**功能验收**:
- ✅ 5种阅读模式正常切换
- ✅ 双目录（作者/业务）正常切换
- ✅ 分栏拖动流畅（50px-95%范围）
- ✅ 滚动联动准确（±50px容差）
- ✅ PDF 页码跳转正确
- ✅ 区域高亮准确（REGION级）
- ✅ 中文缺失提示友好
- ✅ 状态持久化正常
- ✅ 返回恢复位置准确

**视觉验收**:
- ✅ 1672px：完整三栏布局
- ✅ 1440px：目录自动收起
- ✅ 1024px：单栏+模式切换
- ✅ 390px：手机左右切换

### 7.2 VersionComparisonPage 验收

**功能验收**:
- ✅ 文档族历史正确查询
- ✅ 左右对比布局清晰
- ✅ 变化标记准确
- ✅ 修订说明完整显示
- ✅ 跳转精读正常

**视觉验收**:
- ✅ 左右栏等宽对称
- ✅ 变化块高亮明显
- ✅ 修订说明醒目

---

## 8. 技术风险与缓解

### 8.1 风险点

1. **PDF 渲染性能** (中)
   - 大文件加载慢
   - 缩放时重新渲染卡顿
   - 缓解：使用 `renderPdf` 回调，延迟加载，虚拟滚动

2. **滚动联动抖动** (中)
   - 左右互相触发死循环
   - 缓解：使用 `lock.current` 标志位，`setTimeout` 防抖

3. **状态持久化冲突** (低)
   - 多标签页同时修改
   - 缓解：使用 `localStorage` + 页面刷新时读取

4. **移动端体验** (中)
   - 左右切换不直观
   - 缓解：明确的切换按钮，保存切换状态

### 8.2 降级方案

如果某些功能无法在期限内完成：
- **P0**: 5种阅读模式、基本PDF查看
- **P1**: 双目录、滚动联动、分栏拖动
- **P2**: 手机端优化、状态持久化
- **P3**: PDF区域高亮、业务主题目录

---

## 9. 时间线

**总计**: 3-4天

| 阶段 | 任务 | 时间 |
|------|------|------|
| 1 | ReaderPage 核心布局 | 2天 |
| 2 | PDF 增强与同步 | 1天 |
| 3 | VersionComparisonPage | 1天 |
| 4 | 样式与响应式 | 0.5天 |
| 5 | 集成与测试 | 0.5天 |

**并行策略**:
- Reader 和 Revision 可以部分并行开发
- 样式可以在功能开发中同步进行

---

## 10. 交付清单

**代码文件**:
- [ ] `client/src/pages/ReaderPage/` (9个文件)
- [ ] `client/src/pages/VersionComparisonPage/` (5个文件)
- [ ] `client/src/adapters/ReaderPageAdapter.tsx`
- [ ] `client/src/adapters/VersionComparisonPageAdapter.tsx`

**文档**:
- [ ] `SUITE_11_S3_IMPLEMENTATION.md` (本文档)
- [ ] `SUITE_11_S3_COMPLETION_REPORT.md` (完成报告)

**测试**:
- [ ] 端到端测试用例
- [ ] 视觉回归测试截图

---

**状态**: 规划完成，待开始实施  
**预计开始**: 2026-09-18  
**预计完成**: 2026-09-21
