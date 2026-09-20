# WikiPage 视觉精修实施计划

## 📋 计划概述

基于 `WikiPage_Visual_Gap_Analysis.md` 的详细分析，本文档提供可执行的改动清单。

**目标**：将 WikiPage 视觉完成度从 75% 提升至 90%+  
**预计耗时**：1-2 小时  
**技术风险**：低  
**用户影响**：视觉体验显著提升

---

## ✅ 阶段一：核心视觉对齐（75% → 90%）

### 改动 1：添加网格背景纹理

**文件**：`src/pages/WikiPage/wiki.css`

**位置**：`.wiki-layout` 规则

**改动前**：
```css
.wiki-layout {
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 20px;
  padding: 16px 20px 40px;
  max-width: 1400px;
  margin: 0 auto;
  background: var(--bg);
  min-height: 100vh;
}
```

**改动后**：
```css
.wiki-layout {
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 20px;
  padding: 16px 20px 40px;
  max-width: 1400px;
  margin: 0 auto;
  min-height: 100vh;
  
  /* 添加微妙的网格背景纹理 */
  background-image:
    linear-gradient(rgba(30, 95, 168, 0.018) 1px, transparent 1px),
    linear-gradient(90deg, rgba(30, 95, 168, 0.018) 1px, transparent 1px);
  background-size: 32px 32px;
  background-color: var(--bg);
}
```

**暗色模式补充**（添加到文件末尾响应式规则之后）：
```css
/* 暗色模式网格背景 */
html[data-theme="dark"] .wiki-layout {
  background-image:
    linear-gradient(rgba(105, 180, 255, 0.026) 1px, transparent 1px),
    linear-gradient(90deg, rgba(105, 180, 255, 0.026) 1px, transparent 1px);
}
```

**预期效果**：增加专业感和层次，与静态页面视觉一致

---

### 改动 2：调整字号系统

**文件**：`src/pages/WikiPage/wiki.css`

**位置**：多个标题和文本规则

#### 2.1 主标题 h1

**改动前**：
```css
.article-panel h1 {
  font-size: 2rem;
  font-weight: 600;
  margin: 0 0 var(--space-xs) 0;
  color: var(--ink);
}
```

**改动后**：
```css
.article-panel h1 {
  font-size: 24px; /* 从 2rem (32px) 改为 24px */
  font-weight: 600;
  margin: 0 0 var(--space-xs) 0;
  color: var(--ink);
}
```

#### 2.2 章节标题 h2

**改动前**：
```css
.article-panel .section-header h2 {
  font-size: 1.125rem;
  font-weight: 600;
  margin: 0;
  color: var(--ink);
}
```

**改动后**：
```css
.article-panel .section-header h2 {
  font-size: 17px; /* 从 1.125rem (18px) 改为 17px */
  font-weight: 600;
  margin: 0;
  color: var(--ink);
}
```

#### 2.3 正文段落

**改动前**：
```css
.article-panel p {
  font-size: 0.9375rem;
  line-height: 1.8;
  color: var(--ink);
  margin: 0 0 var(--space-md) 0;
}
```

**改动后**：
```css
.article-panel p {
  font-size: 10px; /* 从 0.9375rem (15px) 改为 10px */
  line-height: 1.65; /* 从 1.8 收紧到 1.65 */
  color: var(--ink);
  margin: 0 0 var(--space-md) 0;
}
```

#### 2.4 列表项

**改动前**：
```css
.article-panel li {
  font-size: 0.9375rem;
  line-height: 1.7;
  margin-bottom: var(--space-xs);
}
```

**改动后**：
```css
.article-panel li {
  font-size: 10px; /* 从 0.9375rem (15px) 改为 10px */
  line-height: 1.65; /* 从 1.7 调整到 1.65 */
  margin-bottom: var(--space-xs);
}
```

#### 2.5 侧边栏标题

**改动前**：
```css
.wiki-sidebar .panel-head h3 {
  font-size: 0.875rem;
  font-weight: 600;
  margin: 0;
  color: var(--ink);
}
```

**改动后**：
```css
.wiki-sidebar .panel-head h3 {
  font-size: 13px; /* 从 0.875rem (14px) 改为 13px */
  font-weight: 600;
  margin: 0;
  color: var(--ink);
}
```

#### 2.6 侧边栏正文

**改动前**：
```css
.aside-body p {
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--ink);
  margin: 0 0 var(--space-sm) 0;
  padding-left: var(--space-md);
  position: relative;
}
```

**改动后**：
```css
.aside-body p {
  font-size: 9.5px; /* 从 0.875rem (14px) 改为 9.5px */
  line-height: 1.6;
  color: var(--ink);
  margin: 0 0 var(--space-sm) 0;
  padding-left: var(--space-md);
  position: relative;
}
```

#### 2.7 目录链接

**改动前**：
```css
.outline-links button {
  display: block;
  width: 100%;
  padding: var(--space-xs) var(--space-sm);
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  text-align: left;
  font-size: 0.875rem;
  color: var(--ink);
  cursor: pointer;
  transition: var(--transition-fast);
}
```

**改动后**：
```css
.outline-links button {
  display: block;
  width: 100%;
  padding: var(--space-xs) var(--space-sm);
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  text-align: left;
  font-size: 10px; /* 从 0.875rem (14px) 改为 10px */
  color: var(--ink);
  cursor: pointer;
  transition: var(--transition-fast);
}
```

#### 2.8 来源链接

**改动前**：
```css
.source-link {
  padding: 0.25rem 0.625rem;
  border: 1px solid var(--line);
  background: var(--panel);
  border-radius: var(--radius-sm);
  font-size: 0.8125rem;
  color: var(--blue);
  cursor: pointer;
  transition: var(--transition-base);
  text-decoration: none;
}
```

**改动后**：
```css
.source-link {
  padding: 0.25rem 0.625rem;
  border: 1px solid var(--line);
  background: var(--panel);
  border-radius: var(--radius-sm);
  font-size: 9px; /* 从 0.8125rem (13px) 改为 9px */
  color: var(--blue);
  cursor: pointer;
  transition: var(--transition-base);
  text-decoration: none;
}
```

#### 2.9 关联事项标题

**改动前**：
```css
.related-title {
  font-size: 0.8125rem;
  color: var(--ink);
  line-height: 1.4;
}
```

**改动后**：
```css
.related-title {
  font-size: 10px; /* 从 0.8125rem (13px) 改为 10px */
  color: var(--ink);
  line-height: 1.4;
}
```

**预期效果**：视觉密度与静态页面一致，更紧凑专业

---

### 改动 3：展开图标旋转动画

**文件**：`src/pages/WikiPage/wiki.css`

**位置**：`.expand-toggle` 规则

**改动前**：
```css
.article-panel .expand-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--ink-secondary);
  cursor: pointer;
  transition: transform var(--transition-base), color var(--transition-fast);
}

.article-panel .expand-toggle:hover {
  color: var(--ink);
}
```

**改动后**（添加 `.expanded` 状态）：
```css
.article-panel .expand-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--ink-secondary);
  cursor: pointer;
  transition: transform var(--transition-base), color var(--transition-fast);
}

.article-panel .expand-toggle:hover {
  color: var(--ink);
}

/* 添加展开状态旋转 */
.article-panel .expand-toggle.expanded {
  transform: rotate(180deg);
}
```

**组件改动**：`src/pages/WikiPage/WikiArticle.tsx`

在渲染展开按钮时添加 `expanded` 类名：

**查找**：
```tsx
<button
  className="expand-toggle"
  onClick={() => toggleSection(section.id)}
  aria-label={expandedSections.has(section.id) ? '收起' : '展开'}
>
```

**改为**：
```tsx
<button
  className={`expand-toggle ${expandedSections.has(section.id) ? 'expanded' : ''}`}
  onClick={() => toggleSection(section.id)}
  aria-label={expandedSections.has(section.id) ? '收起' : '展开'}
>
```

**预期效果**：展开/收起时图标旋转 180 度，交互反馈更直观

---

### 改动 4：章节激活状态高亮

**文件**：`src/pages/WikiPage/wiki.css`

**位置**：添加新规则到 `.content-section` 相关部分

**添加**：
```css
/* 当前激活章节高亮 */
.article-panel .content-section.active {
  background: rgba(30, 95, 168, 0.02);
  border-color: var(--blue);
}

html[data-theme="dark"] .article-panel .content-section.active {
  background: rgba(105, 180, 255, 0.05);
  border-color: var(--blue);
}
```

**组件改动**：`src/pages/WikiPage/WikiArticle.tsx`

在渲染章节时添加 `active` 类名：

**查找**：
```tsx
<div
  key={section.id}
  id={`issue-${section.id}`}
  className="content-section"
>
```

**改为**：
```tsx
<div
  key={section.id}
  id={`issue-${section.id}`}
  className={`content-section ${activeSection === section.id ? 'active' : ''}`}
>
```

**确保父组件传递 activeSection**：

在 `WikiArticle.tsx` 的 props 定义中添加：
```tsx
export function WikiArticle({
  matter,
  onNavigateToDoc,
  activeSection, // 添加这个 prop
}: {
  matter: WikiMatter;
  onNavigateToDoc?: (docId: string) => void;
  activeSection?: string | null; // 添加类型定义
}) {
```

在 `index.tsx` 中确保传递：
```tsx
<WikiArticle
  matter={matter}
  onNavigateToDoc={onNavigateToDoc}
  activeSection={activeSection}
/>
```

**预期效果**：滚动时当前章节有微妙的背景色和边框高亮

---

## 🎯 阶段一完成标准

执行完上述 4 个改动后，应达到：

- [x] 网格背景纹理显示正常（浅色+暗色）
- [x] 所有文字大小与静态页面一致
- [x] 展开/收起图标旋转流畅
- [x] 滚动时章节激活状态正确

**预期完成度**：90%

---

## ⚙️ 阶段二：细节打磨（90% → 95%）

### 改动 5：调整过渡时间

**文件**：`src/styles/design-tokens.css`

**改动前**：
```css
/* 过渡动画 */
--transition-fast: 0.15s ease;
--transition-base: 0.18s ease;
--transition-slow: 0.24s ease;
```

**改动后**：
```css
/* 过渡动画 */
--transition-fast: 0.18s ease;
--transition-base: 0.22s ease;
--transition-slow: 0.24s ease;
```

**影响**：所有使用这些变量的过渡效果会稍微变慢，更接近静态页面

---

### 改动 6：微调主文字颜色

**文件**：`src/styles/design-tokens.css`

**改动前**：
```css
/* 文字颜色 */
--ink: #0F2744;
--ink-secondary: #627283;
```

**改动后**：
```css
/* 文字颜色 */
--ink: #17243A;
--ink-secondary: #68768A;
```

**影响**：主文字颜色稍微浅一点，次要文字更灰一些

---

### 改动 7：调整轻微阴影

**文件**：`src/styles/design-tokens.css`

**改动前**：
```css
/* 阴影系统 */
--shadow-sm: 0 4px 12px rgba(15, 39, 68, 0.055);
```

**改动后**：
```css
/* 阴影系统 */
--shadow-sm: 0 7px 20px rgba(15, 39, 68, 0.055);
```

**影响**：轻微阴影更柔和，扩散更大

---

## 🔍 验证步骤

### 本地验证

```bash
# 1. 启动开发服务器
npm run dev

# 2. 访问 WikiPage
# 浏览器打开: http://localhost:xxxx/wiki/WL-M001

# 3. 检查清单
# - 页面背景有微妙的网格纹理
# - 文字大小看起来更紧凑
# - 点击展开/收起时图标旋转
# - 滚动时当前章节有高亮
# - 切换暗色模式，网格纹理仍正常

# 4. TypeScript 检查
npx tsc --noEmit --skipLibCheck

# 5. 构建测试
npm run build:client
```

### 视觉对比

在浏览器中同时打开：
- 静态演示页面：`file:///Volumes/SSD/LLM/WiseLink/Deliverables/airchina-wing-5-static-demo/index.html`
- WikiPage：`http://localhost:xxxx/wiki/WL-M001`

对比检查：
- 字号是否一致
- 网格背景是否相似
- 卡片样式是否接近
- 动画效果是否流畅

---

## 📦 提交建议

### Commit 1：核心视觉对齐（改动 1-4）

```bash
git add client/src/pages/WikiPage/wiki.css
git add client/src/pages/WikiPage/WikiArticle.tsx
git add client/src/pages/WikiPage/index.tsx

git commit -m "feat(wiki): align visual design with static demo

- Add subtle grid background texture (light + dark mode)
- Adjust font sizes to match static demo (more compact)
- Add expand icon rotation animation
- Highlight active section on scroll

Increases visual completion from 75% to 90%

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Commit 2：细节打磨（改动 5-7）

```bash
git add client/src/styles/design-tokens.css

git commit -m "refine(wiki): fine-tune transitions and colors

- Adjust transition timing to match static demo
- Refine text colors for better consistency
- Improve shadow-sm parameters

Increases visual completion from 90% to 95%

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 🚨 风险评估

### 低风险改动

- ✅ 网格背景纹理：纯CSS，不影响功能
- ✅ 字号调整：纯CSS，可立即回滚
- ✅ 展开图标旋转：增量改动，向后兼容

### 需要测试的改动

- ⚠️ 字号缩小：确保移动端仍可读
- ⚠️ 激活状态：确保滚动监听逻辑正常工作

### 性能影响

- 网格背景纹理：可能略微增加绘制成本
- 建议在低端设备测试：如果性能下降明显，可添加 `@media (prefers-reduced-motion: reduce)` 禁用

---

## 📝 后续优化（可选）

如果需要进一步提升到 99%：

1. **添加数字字体**
   - 在 design-tokens.css 添加 `--font-num`
   - 为数字、统计数据应用等宽数字字体

2. **卡片内边距微调**
   - 从 16px 调整为 15px

3. **Pill 样式确认**
   - 确认是否需要 `text-transform: uppercase`

4. **脉动动画**（如果需要强调关键状态）
   - 添加 `@keyframes pulse`
   - 应用到需要脉动的元素

---

**文档版本**：v1.0  
**创建时间**：2026-09-18  
**执行人员**：开发团队  
**预计完成**：1-2 小时内