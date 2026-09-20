# WikiPage 静态演示页面布局分析

## 📋 问题描述

**用户反馈**：为什么是这版布局呢？这不是静态页面要的布局呀

**核心问题**：当前 WikiPage 使用的是**两列布局**（主文 + 侧边栏），但静态演示页面使用的是**单列内容页布局**。

---

## 🔍 静态演示页面布局结构

### 核心 CSS 类

```css
.content-page {
  padding: 16px 20px 40px;
  min-height: 100%;
  background: var(--bg);
  overflow-x: hidden;
}
```

### HTML 结构模式

```html
<section id="lifecycle" class="page">
  <div class="content-page">
    
    <!-- 1. 页面英雄区 -->
    <div class="page-hero">
      <div>
        <h1>场景一｜全生命周期机队管理</h1>
        <p>描述文字...</p>
      </div>
      <div class="hero-tags">
        <span class="pill dark">端到端闭环</span>
        <span class="pill dark">当前快照 10:32</span>
      </div>
    </div>
    
    <!-- 2. 章节标题 -->
    <div class="section-title">
      <h2>从情报输入到可靠性反馈</h2>
      <p>双击首页蓝色业务节点进入本页</p>
    </div>
    
    <!-- 3. 内容网格 -->
    <div class="grid g3">
      <div class="card">
        <h3>来源与证据</h3>
        <p>...</p>
      </div>
      <div class="card">
        <h3>构型影响投影</h3>
        <p>...</p>
      </div>
      <div class="card">
        <h3>知识自动沉淀</h3>
        <p>...</p>
      </div>
    </div>
    
  </div>
</section>
```

---

## 📊 当前 WikiPage vs 静态演示页面

| 维度 | 当前 WikiPage | 静态演示页面 | 差异 |
|------|--------------|-------------|------|
| **布局结构** | 两列：`grid-template-columns: 1fr 280px` | 单列：`.content-page` 包裹全部内容 | ❌ 完全不同 |
| **主容器** | `.wiki-layout` (grid) | `.content-page` (block) | ❌ |
| **英雄区** | 不存在 | `.page-hero` 渐变背景 | ❌ |
| **章节标题** | `.section-header` 在折叠面板内 | `.section-title` 独立存在 | ❌ |
| **内容组织** | `.article-panel` + `.wiki-sidebar` | `.grid .g2/.g3/.g4` + `.card` | ❌ |
| **目录位置** | 右侧边栏 | 不存在（或在页面顶部） | ❌ |
| **卡片布局** | 不存在网格卡片 | `.grid .g3` 三列卡片网格 | ❌ |

---

## 🎯 静态演示页面的核心设计元素

### 1. `.page-hero`

```css
.page-hero {
  border-radius: 17px;
  background: linear-gradient(125deg, var(--navy), var(--navy2));
  color: #fff;
  padding: 20px 24px;
  box-shadow: var(--shadow);
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
}

.page-hero h1 {
  margin: 0;
  font-size: 24px;
}

.page-hero p {
  margin: 7px 0 0;
  color: #C6D2E0;
  font-size: 12px;
  line-height: 1.7;
  max-width: 900px;
}
```

**用途**：页面顶部的渐变英雄区，包含标题、描述和标签徽章

---

### 2. `.section-title`

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
}

.section-title p {
  font-size: 10px;
  color: var(--muted);
  margin: 0;
}
```

**用途**：章节分隔标题，左侧主标题 + 右侧辅助文字

---

### 3. `.grid` 网格系统

```css
.grid {
  display: grid;
  gap: 13px;
}

.g2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.g3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.g4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
```

**用途**：弹性网格布局，可以是 2/3/4 列

---

### 4. `.card`

```css
.card {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 15px;
  box-shadow: 0 7px 20px rgba(15, 39, 68, 0.055);
}

.card h3 {
  font-size: 14px;
  margin: 0 0 8px;
}

.card p {
  font-size: 10px;
  color: var(--muted);
  line-height: 1.65;
  margin: 5px 0;
}
```

**用途**：网格中的内容卡片

---

## 🔄 重构方案

### 方案一：完全匹配静态演示页面布局

**改动**：
1. 移除两列布局，改为 `.content-page` 单列布局
2. 添加 `.page-hero` 英雄区
3. 将侧边栏内容（目录、继续关注、关联事项）改为 `.grid` 网格卡片
4. 使用 `.section-title` 替代折叠面板的 `.section-header`
5. 将正文段落改为 `.card` 卡片布局

**优点**：
- 完全符合静态演示页面的视觉语言
- 单列布局更适合移动端
- 卡片化内容更易扫描

**缺点**：
- 需要完全重写 WikiPage 组件结构
- 失去侧边栏导航的便利性
- 工作量较大

---

### 方案二：混合方案（保留部分现有结构）

**改动**：
1. 保留两列布局基础
2. 在主文区顶部添加 `.page-hero`
3. 将正文章节改为使用 `.section-title` + `.grid .g1` （单列网格）
4. 侧边栏保持目录和元信息

**优点**：
- 改动量相对较小
- 保留导航便利性
- 部分匹配静态页面视觉

**缺点**：
- 不完全符合静态页面布局
- 视觉上仍有差异

---

## 💡 建议

**推荐方案一**：完全匹配静态演示页面布局

**理由**：
1. 用户明确指出"这不是静态页面要的布局"
2. 静态页面的单列 + 卡片布局是既定的设计语言
3. 之前的视觉精修工作（字号、颜色、动画）可以复用，只需调整布局结构
4. 单列布局响应式表现更好

---

## 📝 具体实施步骤（方案一）

### 1. 修改 `wiki.css` 主布局

```css
/* 从两列改为单列 */
.wiki-layout {
  padding: 16px 20px 40px;
  max-width: 1400px;
  margin: 0 auto;
  min-height: 100vh;
  background-image:
    linear-gradient(rgba(30, 95, 168, 0.018) 1px, transparent 1px),
    linear-gradient(90deg, rgba(30, 95, 168, 0.018) 1px, transparent 1px);
  background-size: 32px 32px;
  background-color: var(--bg);
  /* 移除 grid 布局 */
}
```

### 2. 添加 `.page-hero`

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
```

### 3. 添加 `.section-title`

```css
.section-title {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin: 20px 2px 10px;
}
```

### 4. 修改组件结构

**index.tsx**：
```tsx
<div className="wiki-layout">
  <div className="page-hero">
    <div>
      <h1>{matter.title}</h1>
      <p>{matter.summary}</p>
    </div>
    <div className="hero-tags">
      <span className="pill dark">{matter.fleet} · ATA {matter.ata}</span>
      <span className="pill dark">{matter.overview}</span>
    </div>
  </div>
  
  {/* 正文章节 */}
  {matter.body.map(section => (
    <>
      <div className="section-title">
        <h2>{section.title}</h2>
      </div>
      <div className="grid g1">
        {/* 内容卡片 */}
      </div>
    </>
  ))}
  
  {/* 关联事项网格 */}
  <div className="section-title">
    <h2>关联事项</h2>
  </div>
  <div className="grid g3">
    {matter.relatedMatters.map(related => (
      <div className="card">...</div>
    ))}
  </div>
</div>
```

---

**文档版本**：v1.0  
**创建时间**：2026-09-18  
**分析人员**：Claude Opus 5
