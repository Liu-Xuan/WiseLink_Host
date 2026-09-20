# Suite 1.1 组件详细映射与差异分析

**日期**: 2026-09-18  
**状态**: S0 映射分析完成  
**目的**: 逐组件对比 Suite 1.1 与当前生产实现的差异

## 1. 共享外壳层 (Shell)

### Suite 1.1 Shell 组件结构
```jsx
// src/components/Shell.jsx (Suite 1.1)
- 品牌 Logo + 名称
- 全局导航: 资料库/知识/图谱/态势/进展
- 当前事项导航: Wiki/时间轴/分析/复核
- 顶部搜索栏
- 面包屑导航 + 返回按钮
- 事项切换下拉
- 全屏切换
- 主题/效果设置
```

### 当前生产实现
```tsx
// client/src/app.tsx + 各页面独立布局
- WorkspaceHomePage 有自己的布局
- KnowledgeLookupPage 有自己的头部
- RelationGraphPage 独立组件
- ❌ 缺少统一 Shell 组件
```

### 差异分析
| 特性 | Suite 1.1 | 当前生产 | 优先级 |
|---|---|---|---|
| 统一外壳 | ✅ Shell 组件 | ❌ 各页面独立 | **P0** |
| 全局导航 | ✅ 侧边栏 | ⚠️ 分散 | **P0** |
| 当前事项导航 | ✅ 动态显示 | ⚠️ 部分缺失 | **P0** |
| 面包屑 | ✅ 完整 | ⚠️ 不统一 | P1 |
| 主题切换 | ✅ Silver/Carbon | ⚠️ 需验证 | P1 |
| 搜索框 | ✅ 全局 `/` 快捷键 | ⚠️ 需验证 | P1 |

**S1 行动**: 创建统一 Shell 组件，迁移所有页面到新外壳

---

## 2. 资料库页面 (Library)

### Suite 1.1 结构
```jsx
// src/pages/Library.jsx
<div className="library-layout">
  <aside className="folder-pane">
    - 资料分组 (全部/ATA/负责范围)
    - 筛选器
  </aside>
  
  <section className="library-main">
    - 工具栏: 文档/事项切换 + 搜索 + 机型筛选
    - 表格 (5列):
      1. 文件与主题/工程事项
      2. 来源版本/当前工作
      3. 解读与当前认识 ⭐
      4. 范围/变化
      5. 操作按钮
    - 展开历史版本
    - 单击选行 vs 打开按钮
  </section>
  
  <aside className="quicklook">
    - 快速理解面板
    - 主题/认识/范围
    - 附件列表
    - 精读/Wiki/图谱入口
  </aside>
</div>
```

### 当前生产实现
```tsx
// client/src/pages/WorkspaceHomePage/
- LibraryDocumentDirectory.tsx
- LibraryClassificationControls.tsx
- ❌ 缺少 quicklook 面板
- ❌ 缺少统一文档/事项表格
- ⚠️ 短解读字段未接入
```

### 关键差异

#### 2.1 三栏布局
- **Suite**: 左分组 - 中表格 - 右快览 (固定3栏)
- **生产**: 主要是表格，缺少快览面板
- **行动**: 实现完整3栏布局

#### 2.2 短解读字段 ⭐ 关键
```jsx
// Suite 1.1 显示
<td className="meaning">{d.brief}</td>

// 期望内容示例:
"限定A320系列特定构型的起落架收放系统检查；
临时措施已明确，最终改装需确认工具兼容性"
```

**当前状态**: 
- 文档版本 ❌ 缺少 `brief` 字段
- 事项 ✅ 已有 `headline/listBrief` (已修复)

**S1 紧急**: 
1. 接入 DocumentReading 产物
2. 显示简明解读（40-80字）
3. 保留关键否定和条件

#### 2.3 表格交互
| 行为 | Suite 1.1 | 当前生产 | 状态 |
|---|---|---|---|
| 单击选行 | ✅ 只选择，更新快览 | ⚠️ 需验证 | 待实现 |
| 打开按钮 | ✅ 显式导航 | ⚠️ | 待实现 |
| 展开历史版本 | ✅ family 展开 | ⚠️ | 待验证 |
| 返回恢复 | ✅ 筛选/选择/滚动 | ❌ | 待实现 |

---

## 3. 工程知识页面 (Knowledge)

### Suite 1.1 结构
```jsx
// src/pages/Knowledge.jsx
<div className="knowledge-layout">
  <header>
    - 工程认识/来源资料 切换
    - 搜索框
    - 当前/含历史/仅历史 三档选择 ⭐
  </header>
  
  <div className="two-column">
    <aside className="brief-list">
      - 短主题摘要列表
      - 范围、版本标识
    </aside>
    
    <article className="full-content">
      - 选中项的完整解释
      - 条件、来源链接
      - 邻接原文入口
    </article>
  </div>
</div>
```

### 当前生产实现
```tsx
// client/src/pages/KnowledgeLookupPage/
- EngineeringIssueSearchComponent.tsx
- ⚠️ 三块读取口径 (不是双栏)
- ⚠️ 复用问题搜索
- ❌ 缺少三档版本选择
```

### 关键差异

#### 3.1 信息架构 ⭐ 重点
**Suite 1.1 优先级**:
1. **首屏**: 已有解释列表（可复用认识）
2. 右侧: 完整正文 + 来源
3. 下钻: 原文、过程、技术细节

**当前生产问题**:
- 首屏显示"三块读取口径"
- 问题队列/过程占据主要位置
- 不符合"先理解后核查"原则

**S2 行动**: 完全重构信息架构

#### 3.2 版本选择 (三档)
```jsx
// Suite 1.1
<Tabs items={[
  { id: 'current', label: '当前' },
  { id: 'with-history', label: '含历史' },
  { id: 'history-only', label: '仅历史' }
]}/>
```

**当前API**: 
- 仅 `CURRENT` / `HISTORY` 两档
- ❌ 缺少精确三档语义

**S2 必需**: M 补充精确读取合同

#### 3.3 有界浏览
- Suite: 无关键词时仍有分页列表
- 生产: ❓ 待确认是否支持空查询

**S2 验证**: 是否需要补充列表接口

---

## 4. Wiki 页面

### Suite 1.1 结构
```jsx
// src/pages/Wiki.jsx
<div className="wiki-layout">
  <article className="wiki-main">
    - 主题
    - 范围说明
    - 连贯正文 (段落式) ⭐
    - 重要条件/否定突出
    - 邻接来源链接
  </article>
  
  <aside className="wiki-sidebar">
    - 目录
    - 继续关注
    - 关键依据
    - 认识历史
  </aside>
</div>
```

### 当前生产实现
```tsx
// ❌ 缺少独立 Wiki 页面
// Matter 详情分散在多处
```

### 差异分析
- **完全缺失**
- S2 需要新建完整页面
- 复用 `overallWorkRef` 数据
- 格式化连贯正文

**S2 行动**: 创建 EngineeringMatterWikiPage

---

## 5. Reader (精读工作台)

### Suite 1.1 特性
```jsx
// src/pages/Reader.jsx + src/components/Reading.jsx
- 五种阅读模式: ⭐
  1. 原文+原件 (双栏)
  2. 中英对照
  3. 中文阅读
  4. 仅原文
  5. 仅原件
- 可收起目录
- 拖动分栏比例
- 全屏模式
- 手机单阅读面
```

### 当前生产实现
```tsx
// client/src/pages/DocumentParsingPage/
- DocumentVersionReadingPage.tsx
- ⚠️ 阅读模式不完整
- ⚠️ 目录不可收起
```

### 差异
| 特性 | Suite 1.1 | 当前生产 | 优先级 |
|---|---|---|---|
| 五种模式 | ✅ | ⚠️ 部分 | P0 |
| 可收目录 | ✅ | ❌ | P1 |
| 拖动分栏 | ✅ | ⚠️ | P1 |
| 全屏 | ✅ | ⚠️ | P1 |
| 手机单面 | ✅ | ❓ | P2 |

**S3 行动**: 增强 Reader 组件

---

## 6. 关系图谱 (Graph) ⭐ 重点重构

### Suite 1.1 结构
```jsx
// src/pages/Graph.jsx + src/components/GraphCanvas.jsx
<div className="graph-three-column">
  <aside className="timeline-pane">
    - 工程时间线
    - 事件列表
    - "展开完整历程"按钮
  </aside>
  
  <section className="graph-main">
    - 事项标题/范围
    - Cytoscape 分组画布:
      • 中心事项卡 (HTML)
      • 4/5/6 组动态布局
      • 分组标题 + 对象卡片
      • 聚合曲线 vs 逐条边
      • 过滤器 + 溢出列表
    - 四种视角切换
    - 相机控制 (缩放/平移/适配)
  </section>
  
  <aside className="knowledge-pane">
    - 知识百科/依据资料/交流
    - 当前认识正文
    - 选中节点详情
  </aside>
</div>
```

### 当前生产实现
```tsx
// client/src/pages/RelationGraphPage/
- GraphCanvas.tsx
- ⚠️ 右侧是技术检查器
- ❌ 缺少三栏布局
- ❌ 缺少时间线联动
```

### 关键差异 (完整重构)

#### 6.1 布局
- **Suite**: 左时间线 - 中画布 - 右知识 (3栏)
- **生产**: 主要是画布 + 右侧技术面板
- **行动**: 完全重构为3栏

#### 6.2 画布内容
**Suite 1.1**:
- 中心事项 (大卡片)
- 分组 HTML 卡片 (多行文字+图标)
- 柔和材质、局部语义色
- 聚合曲线可展开核查

**当前生产**:
- 节点 + 边
- 技术属性显示
- ❌ 不是 Suite 设计

**S4 行动**: 完全按 Suite 重做

#### 6.3 四种视角
1. 事项图谱
2. 工程文档
3. 领域聚焦
4. 全景目录

**状态**: 部分接口存在，需补充完整

---

## 7. 时间轴 (Timeline)

### Suite 1.1 结构
```jsx
// src/pages/Timeline.jsx
<div className="timeline-layout">
  <section className="timeline-main">
    - 完整历程列表
    - 事件类型图标
    - 发生/取得时间 ⭐
    - 预计历史 (Q3/TBD 保留)
  </section>
  
  <aside className="event-detail">
    - 选中事件详情
    - 准确来源链接
    - 关联图谱入口
  </aside>
</div>
```

### 当前生产
```tsx
// client/src/pages/EngineeringTimelinePage/
- ✅ 基础存在
- ⚠️ 需对齐布局
- ⚠️ 验证时间口径
```

**S4 行动**: 验证并对齐布局

---

## 8. 其他页面快速状态

| 页面 | Suite | 生产 | 状态 |
|---|---|---|---|
| Revision (换版) | ✅ 完整 | ❌ 缺失 | S3 新建 |
| Process (问题分析) | ✅ | ❌ 缺失 | S5 新建 |
| Review (复核) | ✅ | ⚠️ DialoguePage | S5 重构 |
| Tasks (进展) | ✅ | ❌ 缺失 | S5 新建 |
| Demo (导览) | ✅ | ❌ 缺失 | S5 新建 |
| Situation (态势) | ✅ | ✅ 保留现有 | S1/S6 适配 |

---

## 9. 样式系统迁移策略

### Suite 1.1 样式
```css
/* src/styles/index.css - 915行 */
.wl-studio { /* 作用域根 */ }
.library-layout { /* 3栏布局 */ }
.library-table { /* 表格样式 */ }
.quicklook { /* 快览面板 */ }
/* ... 完整设计系统 */
```

### 迁移方案
```
client/src/styles/
├── suite/
│   ├── index.css (完整 Suite 样式)
│   ├── proof.css
│   ├── studio.css
│   └── suite.css
└── legacy/
    └── (保留现有样式)
```

**策略**:
1. Suite 样式作为 `.wl-studio` 命名空间
2. 不影响现有页面
3. 新页面使用 Suite 样式
4. 逐步迁移

---

## 10. S0 总结与 S1 准备

### S0 完成清单
- [x] 12类页面映射完成
- [x] 组件差异详细列出
- [x] 数据接口缺口明确
- [x] 优先级标注完成

### S1 立即行动
1. **创建统一 Shell** (P0)
   - 迁移 Suite Shell.jsx
   - 适配现有路由
   - 集成主题切换

2. **实现资料库3栏** (P0)
   - 左分组 + 中表格 + 右快览
   - 接入短解读字段
   - 单击选择 vs 打开

3. **DocumentReading 接口** (P0 - 阻塞)
   - M 负责后端实现
   - 前端等待接入

### 数据接口紧急清单 (M)
1. ❌ DocumentReading (文档短解读) - **阻塞 S1**
2. ⚠️ 知识三档版本查询 - 阻塞 S2
3. ⚠️ 知识有界浏览 - 阻塞 S2
4. ⚠️ 图谱完整关系接口 - 阻塞 S4

---

**下一步**: 启动 S1 实施，从 Shell 和资料库开始
**责任**: 前端 Luna (妙搭会话) + M (接口) + Astra (审查)
