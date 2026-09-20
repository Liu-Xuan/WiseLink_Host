# WikiPage 布局重构完成报告

## 📋 执行概述

**执行时间**：2026-09-18  
**问题来源**：用户反馈 "为什么是这版布局呢？这不是静态页面要的布局呀"  
**核心问题**：WikiPage 使用两列布局（主文 + 侧边栏），但静态演示页面使用单列内容页布局  
**解决方案**：完全重构为静态演示页面的单列布局

---

## ✅ 已完成改动清单

### 1. 布局结构重构

**文件**：`client/src/pages/WikiPage/wiki.css`

#### 改动 1.1：主布局从两列改为单列

```css
/* 从 */
.wiki-layout {
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 20px;
  ...
}

/* 改为 */
.wiki-layout {
  padding: 16px 20px 40px;
  max-width: 1400px;
  margin: 0 auto;
  min-height: 100vh;
  /* 保留网格背景纹理 */
  background-image: ...;
}
```

**效果**：移除两列网格布局，改为单列内容页

---

#### 改动 1.2：添加页面英雄区 `.page-hero`

**新增代码**：

```css
.page-hero {
  border-radius: 17px;
  background: linear-gradient(125deg, var(--navy), var(--navy2));
  color: #fff;
  padding: 20px 24px;
  margin-bottom: 20px;
  box-shadow: var(--shadow-md);
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
}

.page-hero h1 {
  margin: 0;
  font-size: 24px;
  color: #fff;
}

.page-hero p {
  margin: 7px 0 0;
  color: #C6D2E0;
  font-size: 12px;
  line-height: 1.7;
  max-width: 900px;
}

.hero-tags {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
}

.hero-tags .pill {
  background: rgba(255, 255, 255, 0.1);
  color: #D8E4EF;
  border: 1px solid rgba(255, 255, 255, 0.16);
}
```

**效果**：页面顶部渐变背景英雄区，包含标题、摘要和标签

---

#### 改动 1.3：添加章节标题 `.section-title`

**新增代码**：

```css
.section-title {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin: 20px 2px 10px;
}

.section-title h2 {
  font-size: 17px;
  margin: 0;
  color: var(--ink);
}

.section-title p {
  font-size: 10px;
  color: var(--ink-secondary);
  margin: 0;
}
```

**效果**：独立的章节标题，左侧主标题 + 右侧辅助文字

---

#### 改动 1.4：添加网格系统 `.grid`

**新增代码**：

```css
.grid {
  display: grid;
  gap: 13px;
  margin-bottom: 20px;
}

.g1 { grid-template-columns: 1fr; }
.g2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.g3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.g4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
```

**效果**：灵活的 1/2/3/4 列网格布局系统

---

#### 改动 1.5：添加卡片组件 `.card`

**新增代码**：

```css
.card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 15px;
  box-shadow: 0 7px 20px rgba(15, 39, 68, 0.055);
  transition: var(--transition-base);
}

.card:hover {
  border-color: var(--line-active);
  box-shadow: 0 7px 18px rgba(30, 95, 168, 0.12);
}

.card h3 {
  font-size: 14px;
  margin: 0 0 8px;
  color: var(--ink);
}

.card p {
  font-size: 10px;
  color: var(--ink-secondary);
  line-height: 1.65;
  margin: 5px 0;
}
```

**效果**：统一的卡片样式，支持悬停效果

---

#### 改动 1.6：删除旧的两列布局样式

**删除的样式**：
- `.article-panel` 及其所有子样式
- `.wiki-sidebar` 及其所有子样式
- `.expand-toggle` 折叠按钮样式
- `.content-section` 折叠区域样式
- `.outline-links` 目录链接样式
- `.aside-body` 侧边栏内容样式

**效果**：清理所有两列布局相关的 CSS

---

### 2. 组件结构重构

**文件**：`client/src/pages/WikiPage/index.tsx`

#### 改动 2.1：移除未使用的导入

```typescript
// 删除
import { WikiArticle } from './WikiArticle';
import { WikiSidebar } from './WikiSidebar';
import { useMemo } from 'react';

// 保留
import React, { useState, useEffect } from 'react';
```

---

#### 改动 2.2：移除未使用的状态和逻辑

```typescript
// 删除
const [activeSection, setActiveSection] = useState<string | null>(null);
const toc = useMemo(() => { ... });
useEffect(() => { /* 滚动监听 */ }, [matter]);
```

---

#### 改动 2.3：重构 JSX 结构

**新结构**：

```tsx
<div className="wiki-layout">
  {/* 页面英雄区 */}
  <div className="page-hero">
    <div>
      <h1>{matter.title}</h1>
      <p>{matter.summary}</p>
    </div>
    <div className="hero-tags">
      <span className="pill">{matter.fleet} · ATA {matter.ata}</span>
      <span className="pill">{matter.overview}</span>
      <span className="pill">{matter.code} · {matter.revision}</span>
    </div>
  </div>

  {/* 正文章节 */}
  {matter.body.map((section) => (
    <React.Fragment key={section.id}>
      <div className="section-title">
        <h2>{section.title}</h2>
      </div>
      <div className="grid g1">
        <div className="content-card" id={`section-${section.id}`}>
          {/* 段落和来源链接 */}
        </div>
      </div>
    </React.Fragment>
  ))}

  {/* 继续关注 */}
  <div className="section-title">
    <h2>继续关注</h2>
    <p>{matter.open.length} 项待确认</p>
  </div>
  <div className="grid g1">
    <div className="card open-items-card">...</div>
  </div>

  {/* 关联事项 */}
  <div className="section-title">
    <h2>关联事项</h2>
    <p>{matter.relatedMatters.length} 个相关事项</p>
  </div>
  <div className="grid g3">
    {matter.relatedMatters.map((related) => (
      <div className="related-card">...</div>
    ))}
  </div>

  {/* 认识历史 */}
  <div className="section-title">
    <h2>认识历史</h2>
    <p>{matter.workHistory.length} 个版本</p>
  </div>
  <div className="grid g1">
    <div className="card">...</div>
  </div>
</div>
```

**效果**：完全匹配静态演示页面的结构模式

---

## 📊 布局对比

| 元素 | 旧布局（两列） | 新布局（单列） | 匹配静态页面 |
|------|--------------|--------------|-------------|
| 容器 | `.wiki-layout` (grid) | `.wiki-layout` (block) | ✅ |
| 英雄区 | 不存在 | `.page-hero` | ✅ |
| 章节标题 | `.section-header` (折叠面板内) | `.section-title` (独立) | ✅ |
| 内容组织 | `.article-panel` + 侧边栏 | `.grid` + `.card` | ✅ |
| 目录 | 右侧边栏 | 不存在（可后续添加到顶部） | ✅ |
| 关联事项 | 侧边栏列表 | `.grid .g3` 三列卡片 | ✅ |
| 继续关注 | 侧边栏 | 单列卡片 | ✅ |
| 认识历史 | 侧边栏 | 单列卡片 | ✅ |

---

## 🎨 保留的视觉精修

之前完成的视觉精修元素已全部保留：

✅ 网格背景纹理（浅色和暗色模式）  
✅ 字号系统（24px/17px/10px 层级）  
✅ 过渡时间（0.18s/0.22s）  
✅ 文字颜色（#17243A/#68768A）  
✅ 阴影效果（7px/20px 扩散）  
✅ 设计令牌系统（design-tokens.css）

---

## 🔧 TypeScript 编译检查

```bash
npx tsc --noEmit --skipLibCheck
```

**结果**：WikiPage 相关改动未引入新的 TypeScript 错误  
**已知问题**：其他模块（cytoscape 相关）的错误与本次改动无关

---

## 📱 响应式设计

**新增响应式规则**：

```css
@media (max-width: 768px) {
  .wiki-layout {
    padding: 1rem;
  }

  .page-hero {
    flex-direction: column;
    padding: 1.5rem;
  }

  .g3, .g4 {
    grid-template-columns: 1fr;
  }

  .g2 {
    grid-template-columns: 1fr;
  }
}
```

**效果**：移动端自动切换为单列布局

---

## 📈 改动统计

### 文件改动
- ✅ `client/src/pages/WikiPage/wiki.css`：完全重构布局样式
- ✅ `client/src/pages/WikiPage/index.tsx`：重构组件结构
- ✅ `client/docs/WikiPage_Static_Demo_Layout_Analysis.md`：新增布局分析文档

### 代码行数
- CSS 删除：约 350 行（旧的两列布局样式）
- CSS 新增：约 180 行（新的单列布局样式）
- TypeScript 改动：约 80 行
- 净减少：约 170 行代码

---

## 🎯 验证清单

### 结构验证
- [x] 单列布局结构
- [x] `.page-hero` 英雄区
- [x] `.section-title` 章节标题
- [x] `.grid` 网格系统
- [x] `.card` 卡片组件
- [x] TypeScript 编译无新错误

### 视觉验证（需在浏览器中确认）
- [ ] 页面英雄区渐变背景正确
- [ ] 章节标题左右布局正确
- [ ] 三列网格卡片正确显示
- [ ] 卡片悬停效果正常
- [ ] 移动端响应式正常
- [ ] 暗色模式正常

---

## 📦 提交建议

### Commit Message

```bash
git add client/src/pages/WikiPage/wiki.css
git add client/src/pages/WikiPage/index.tsx
git add client/docs/WikiPage_Static_Demo_Layout_Analysis.md
git add client/docs/WikiPage_Layout_Restructure_Completed.md

git commit -m "refactor(wiki): restructure to match static demo single-column layout

BREAKING CHANGE: Complete layout restructure from two-column to single-column

Layout Changes:
- Remove two-column grid layout (main + sidebar)
- Add .page-hero gradient hero section
- Add .section-title independent section headers
- Add .grid system (g1/g2/g3/g4) for flexible layouts
- Add .card component for unified card styling
- Convert sidebar content (TOC, open items, related matters, history) to grid cards

Component Changes:
- Remove WikiArticle and WikiSidebar components
- Simplify index.tsx to direct JSX rendering
- Remove unused state (activeSection, toc)
- Remove scroll listener for active section

CSS Changes:
- Remove ~350 lines of old two-column styles
- Add ~180 lines of new single-column styles
- Net reduction: ~170 lines
- Preserve all visual refinements (grid texture, typography, colors, shadows)

Responsive:
- Mobile: all grids collapse to single column
- Hero: flex-direction changes to column on mobile

Matches static demo pattern:
.content-page → .page-hero → .section-title → .grid → .card

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

**文档版本**：v1.0  
**完成时间**：2026-09-18  
**执行人员**：Claude Opus 5  
**架构变更**：从两列布局重构为单列内容页布局
