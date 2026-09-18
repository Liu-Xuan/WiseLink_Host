# WikiPage 正确布局实现完成报告

## 📋 问题回顾

**用户反馈**：指出参考的静态页面是 `/Users/liuxuan/Downloads/WiseLink_Frontend_Suite_20260917/`

**核心发现**：这套静态页面的 WikiPage **实际使用两列布局**，而不是之前误解的单列布局。

---

## 🔍 正确的静态页面布局结构

### 实际 CSS 结构

```css
.wiki-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 298px;
  gap: 15px;
  min-height: 0;
  flex: 1;
}
```

**左侧（主文）**：`.article-panel` + `.engineering-article`  
**右侧（侧边栏）**：`.wiki-aside` - 包含 4 个面板

---

## ✅ 已完成改动清单

### 1. CSS 完全重构

**文件**：`client/src/pages/WikiPage/wiki.css`

#### 布局结构
```css
/* 两列布局 */
.wiki-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 298px;
  gap: 15px;
  min-height: 0;
  flex: 1;
}
```

#### 主文区样式
```css
/* 主文面板 */
.article-panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow: var(--shadow-sm);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* 文章工具栏 */
.article-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 22px;
  border-bottom: 1px solid var(--line);
}

/* 工程文章样式 */
.engineering-article {
  max-width: 1000px;
  margin: 0 auto;
  padding: 36px 54px 50px;
  overflow: auto;
  scrollbar-width: thin;
}

.engineering-article > h1 {
  font-size: 30px;
  line-height: 1.5;
  margin-bottom: 15px;
  letter-spacing: -0.75px;
}

.engineering-article > section > h2 {
  font-size: 19px;
  margin-bottom: 12px;
}

.engineering-article > section > p {
  font-size: 15px;
  color: var(--ink-secondary);
  line-height: 2.05;
  margin: 10px 0;
}
```

#### 侧边栏样式
```css
/* 侧边栏容器 */
.wiki-aside {
  display: flex;
  flex-direction: column;
  gap: 13px;
  overflow: auto;
  min-height: 0;
  scrollbar-width: thin;
}

/* 面板 */
.wiki-aside > .panel {
  flex-shrink: 0;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

/* 面板头部 */
.panel-head {
  padding: 17px 18px 13px;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  gap: 10px;
}

/* 大纲链接 */
.outline-links button {
  padding: 9px 8px;
  text-align: left;
  border: 0;
  background: none;
  color: var(--ink-secondary);
  font-size: 12px;
}

/* 侧边栏正文 */
.aside-body {
  padding: 17px 19px;
}

.aside-body > p {
  font-size: 13px;
  line-height: 1.95;
  color: var(--ink-secondary);
}

/* 历史条目 */
.history-entry {
  margin: 0 0 14px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--line);
}
```

---

### 2. 组件结构重构

**文件**：`client/src/pages/WikiPage/index.tsx`

#### JSX 结构

```tsx
<div className="wiki-layout">
  {/* 左侧：主文面板 */}
  <section className="panel article-panel scroll-region">
    {/* 工具栏 */}
    <div className="article-tools">
      <span className="badge">{matter.fleet} · ATA {matter.ata}</span>
      <span className="badge">{matter.overview}</span>
      <div className="push" />
      <button className="btn">主要来源</button>
      <button className="btn">复制</button>
    </div>

    {/* 工程文章主体 */}
    <article className="engineering-article">
      <div className="article-kicker">{matter.code} · {matter.revision}</div>
      <h1>{matter.title}</h1>
      <p className="article-lead">{matter.summary}</p>

      {/* 正文章节 */}
      {matter.body.map((section) => (
        <section key={section.id} id={`issue-${section.id}`}>
          <h2>{section.title}</h2>
          {section.paragraphs.map((para, index) => (
            <p key={index}>{para}</p>
          ))}
          {/* 来源链接 */}
        </section>
      ))}
    </article>
  </section>

  {/* 右侧：侧边栏 */}
  <aside className="wiki-aside">
    {/* 1. 阅读目录 */}
    <section className="panel">
      <div className="panel-head">
        <h3>阅读目录</h3>
      </div>
      <div className="outline-links">...</div>
    </section>

    {/* 2. 继续关注 */}
    <section className="panel">
      <div className="panel-head">
        <h3>继续关注</h3>
      </div>
      <div className="aside-body">...</div>
    </section>

    {/* 3. 关键依据 */}
    <section className="panel">
      <div className="panel-head">
        <h3>关键依据</h3>
      </div>
      <div className="aside-body">...</div>
    </section>

    {/* 4. 认识的历史 */}
    <section className="panel">
      <div className="panel-head">
        <h3>认识的历史</h3>
      </div>
      <div className="aside-body">...</div>
    </section>
  </aside>
</div>
```

---

## 📊 布局对比

| 元素 | 错误理解（单列） | 实际静态页面（两列） | 当前实现 |
|------|----------------|-------------------|---------|
| 容器布局 | `.wiki-layout` (block) | `.wiki-layout` (grid, 2列) | ✅ 匹配 |
| 主文区 | 不存在 | `.article-panel` + `.engineering-article` | ✅ 匹配 |
| 侧边栏 | 不存在 | `.wiki-aside` (4个面板) | ✅ 匹配 |
| 工具栏 | 不存在 | `.article-tools` | ✅ 匹配 |
| 标题字号 | 24px | 30px | ✅ 匹配 |
| 段落字号 | 10px | 15px | ✅ 匹配 |
| 章节标题 | 17px | 19px | ✅ 匹配 |
| 侧边栏宽度 | - | 298px | ✅ 匹配 |
| 主文最大宽度 | - | 1000px 居中 | ✅ 匹配 |

---

## 📱 响应式设计

```css
/* 大屏 (>1450px) */
.wiki-layout {
  grid-template-columns: minmax(0, 1fr) 298px;
}
.engineering-article {
  padding: 36px 54px 50px;
}

/* 中屏 (1250px-1450px) */
@media (max-width: 1450px) {
  .wiki-layout {
    grid-template-columns: minmax(0, 1fr) 290px;
  }
  .engineering-article {
    padding: 29px 34px;
  }
}

/* 小屏 (<1250px) */
@media (max-width: 1250px) {
  .wiki-layout {
    grid-template-columns: minmax(0, 1fr) 255px;
  }
  .engineering-article {
    padding: 26px;
  }
}

/* 移动端 (<900px) */
@media (max-width: 900px) {
  .wiki-layout {
    grid-template-columns: 1fr;
  }
  .wiki-aside {
    margin-top: 12px;
    display: grid;
    grid-template-columns: 1fr;
  }
  .engineering-article {
    padding: 22px 19px;
  }
}
```

---

## 🔧 TypeScript 编译检查

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | grep "WikiPage"
```

**结果**：✅ WikiPage 相关代码无 TypeScript 错误

**修复的错误**：
- `onNavigateToTimeline?.()` → `onNavigateToTimeline?.(matter.id)`
- `onNavigateToGraph?.()` → `onNavigateToGraph?.(matter.id)`

---

## 📈 改动统计

### 文件改动
- ✅ `client/src/pages/WikiPage/wiki.css` - 完全重写
- ✅ `client/src/pages/WikiPage/index.tsx` - 完全重写
- ✅ `client/docs/WikiPage_Correct_Layout_Implementation.md` - 新增文档

### 代码行数
- CSS：约 300 行（匹配静态页面的两列布局）
- TypeScript：约 290 行
- 删除了之前错误的单列布局代码

---

## 🎯 关键差异总结

### 之前的错误理解
1. ❌ 认为静态页面使用单列布局
2. ❌ 添加了 `.page-hero` 渐变英雄区
3. ❌ 使用了 `.section-title` + `.grid` + `.card` 模式
4. ❌ 字号系统错误（24px/17px/10px）

### 正确的实际结构
1. ✅ 两列网格布局（主文 + 侧边栏）
2. ✅ `.article-panel` + `.engineering-article` 主文区
3. ✅ `.wiki-aside` 侧边栏（4个面板）
4. ✅ 正确的字号系统（30px/19px/15px）
5. ✅ `.article-tools` 工具栏
6. ✅ `.outline-links` 目录导航
7. ✅ `.history-entry` 历史条目样式

---

## 📦 Git 提交建议

```bash
git add client/src/pages/WikiPage/wiki.css
git add client/src/pages/WikiPage/index.tsx
git add client/docs/WikiPage_Correct_Layout_Implementation.md

git commit -m "fix(wiki): implement correct two-column layout from static demo

Previous implementation incorrectly used single-column layout.
The actual WiseLink_Frontend_Suite_20260917 static demo uses two-column grid.

Layout Structure:
- Left: .article-panel + .engineering-article (main content)
- Right: .wiki-aside (4 panels: TOC, open items, evidence, history)

CSS Changes:
- .wiki-layout: grid with columns minmax(0, 1fr) 298px
- .article-panel: main content panel with tools bar
- .engineering-article: max-width 1000px, centered, proper typography
- .wiki-aside: 4 sidebar panels with proper spacing
- .article-tools: toolbar with badges and action buttons
- .outline-links: TOC navigation
- .history-entry: timeline-style history entries

Typography (matching static demo):
- h1: 30px (was incorrectly 24px)
- section h2: 19px (was incorrectly 17px)
- section p: 15px (was incorrectly 10px)
- sidebar: 12-13px

Responsive:
- Desktop (>1450px): sidebar 298px
- Laptop (1250-1450px): sidebar 290px
- Tablet (<1250px): sidebar 255px
- Mobile (<900px): single column stack

TypeScript:
- Fixed onNavigateToTimeline callback signature
- Fixed onNavigateToGraph callback signature

Reference: WiseLink_Frontend_Suite_20260917/WiseLink_完整前端预览.html
Lines: 420-432 (CSS), 2518-2559 (React structure)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

**文档版本**：v2.0  
**完成时间**：2026-09-18  
**参考文件**：`/Users/liuxuan/Downloads/WiseLink_Frontend_Suite_20260917/WiseLink_完整前端预览.html`  
**布局来源**：第 420-432 行（CSS）、2518-2559 行（React 结构）
