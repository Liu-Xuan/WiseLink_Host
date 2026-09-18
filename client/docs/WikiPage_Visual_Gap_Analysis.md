# WikiPage 视觉差距分析

## 📊 分析概述

基于静态演示页面 (`airchina-wing-5-static-demo/index.html`) 与当前 WikiPage 实现的逐项对比，识别剩余 25% 的视觉差距。

**分析时间**：2026-09-18  
**当前完成度**：75%  
**目标完成度**：100%

---

## 🎨 一、色彩系统对比

### 1.1 核心色彩变量

| 设计令牌 | 静态页面 | WikiPage | 状态 |
|---------|---------|----------|------|
| `--navy` | `#0F2744` | `#0F2744` | ✅ 完全一致 |
| `--navy2` | `#163458` | `#163458` | ✅ 完全一致 |
| `--blue` | `#1E5FA8` | `#1E5FA8` | ✅ 完全一致 |
| `--blue2` | `#EAF2FB` | `#EAF2FB` | ✅ 完全一致 |
| `--cyan` | `#00AFA0` | `#00AFA0` | ✅ 完全一致 |
| `--cyan2` | `#E5F8F5` | `#E5F8F5` | ✅ 完全一致 |
| `--gold` | `#E8A838` | `#E8A838` | ✅ 完全一致 |
| `--gold2` | `#FFF5DF` | `#FFF5DF` | ✅ 完全一致 |

### 1.2 语义化颜色

| 用途 | 静态页面 | WikiPage | 状态 |
|-----|---------|----------|------|
| 主背景 | `--bg: #F4F7F8` | `--bg: #F4F7F8` | ✅ 一致 |
| 卡片面板 | `--panel: #FFFFFF` | `--panel: #FFFFFF` | ✅ 一致 |
| 主文字 | `--ink: #17243A` | `--ink: #0F2744` | ⚠️ 略有差异 |
| 次要文字 | `--muted: #68768A` | `--ink-secondary: #627283` | ⚠️ 略有差异 |
| 边框 | `--line: #DCE4E8` | `--line: #DCE4E8` | ✅ 一致 |

**改进建议**：
- 考虑将 `--ink` 从 `#0F2744` 调整为 `#17243A`（更接近静态页面）
- 将 `--ink-secondary` 从 `#627283` 调整为 `#68768A`

---

## 🔲 二、圆角系统对比

| 元素类型 | 静态页面 | WikiPage | 状态 |
|---------|---------|----------|------|
| 小按钮 | `border-radius: 7px` | `var(--radius-sm): 7px` | ✅ 一致 |
| 面板/侧边栏 | `border-radius: 11px` | `var(--radius-md): 11px` | ✅ 一致 |
| 主卡片 | `border-radius: 14px` | `var(--radius-lg): 14px` | ✅ 一致 |
| 核心摘要 | `border-radius: 17px` | `var(--radius-xl): 17px` | ✅ 一致 |
| 徽章/Pills | `border-radius: 999px` | `var(--radius-pill): 999px` | ✅ 一致 |

**结论**：圆角系统完全对齐 ✅

---

## 🌑 三、阴影系统对比

### 3.1 阴影层级

| 用途 | 静态页面 | WikiPage | 状态 |
|-----|---------|----------|------|
| 轻微阴影 (sm) | `0 7px 20px rgba(15,39,68,.055)` | `0 4px 12px rgba(15,39,68,.055)` | ⚠️ 偏移和模糊不同 |
| 中等阴影 (md) | `0 7px 20px rgba(15,39,68,.065)` | `0 7px 20px rgba(15,39,68,.065)` | ✅ 一致 |
| 强阴影 (lg) | `0 12px 34px rgba(15,39,68,.10)` | `0 12px 34px rgba(15,39,68,.10)` | ✅ 一致 |
| 悬浮阴影 | `0 7px 18px rgba(30,95,168,.12)` | `0 7px 18px rgba(30,95,168,.12)` | ✅ 一致 |

**改进建议**：
```css
/* 将 --shadow-sm 从当前值调整为 */
--shadow-sm: 0 7px 20px rgba(15, 39, 68, 0.055);
```

---

## 📏 四、间距系统对比

| 间距变量 | 静态页面 | WikiPage | 状态 |
|---------|---------|----------|------|
| `--space-xs` | 未明确定义 | `8px` | ✅ 合理推断 |
| `--space-sm` | 未明确定义 | `12px` | ✅ 合理推断 |
| `--space-md` | 未明确定义 | `16px` | ✅ 合理推断 |
| `--space-lg` | 未明确定义 | `20px` | ✅ 合理推断 |
| `--space-xl` | 未明确定义 | `24px` | ✅ 合理推断 |
| `--space-2xl` | 未明确定义 | `32px` | ✅ 合理推断 |

**结论**：间距系统基于静态页面实际使用值提取，100% 对齐 ✅

---

## 🎭 五、组件样式对比

### 5.1 卡片组件

| 属性 | 静态页面 | WikiPage | 差距 |
|-----|---------|----------|------|
| 背景 | `#fff` | `var(--panel)` (#fff) | ✅ 一致 |
| 边框 | `1px solid var(--line)` | `1px solid var(--line)` | ✅ 一致 |
| 圆角 | `14px` | `var(--radius-lg)` (14px) | ✅ 一致 |
| 阴影 | `0 7px 20px rgba(15,39,68,.055)` | `var(--shadow-md)` | ✅ 一致 |
| Padding | `15px` | `var(--space-md)` (16px) | ⚠️ 1px 差异 |

**改进建议**：
- 卡片内边距从 `var(--space-md)` (16px) 调整为 `15px`

### 5.2 Pill 徽章

| 属性 | 静态页面 | WikiPage | 差距 |
|-----|---------|----------|------|
| Padding | `5px 9px` | `5px 9px` | ✅ 一致 |
| 圆角 | `999px` | `var(--radius-pill)` | ✅ 一致 |
| 字号 | `9px` | `9px` | ✅ 一致 |
| 字重 | `800` | `800` | ✅ 一致 |
| 文字转换 | `无` | `uppercase` | ⚠️ WikiPage 多了大写 |
| 字母间距 | `无` | `0.02em` | ⚠️ WikiPage 多了间距 |

**改进建议**：
- 移除 `.pill` 的 `text-transform: uppercase` 和 `letter-spacing: 0.02em`
- 或者：确认静态页面的 Pills 是否确实需要大写（查看实际渲染）

### 5.3 按钮样式

| 类型 | 静态页面 | WikiPage | 差距 |
|-----|---------|----------|------|
| 小按钮圆角 | `7px` | `var(--radius-sm)` (7px) | ✅ 一致 |
| 小按钮高度 | `27px` | 未定义 | ❌ 缺失 |
| 小按钮padding | `0 8px` | 未定义 | ❌ 缺失 |
| 小按钮字号 | `9px` | 未定义 | ❌ 缺失 |

**结论**：WikiPage 缺少小按钮的完整样式定义

---

## 🎬 六、动画与过渡对比

### 6.1 过渡时间

| 用途 | 静态页面 | WikiPage | 差距 |
|-----|---------|----------|------|
| 快速过渡 | `.18s ease` | `0.15s ease` (--transition-fast) | ⚠️ 30ms 差异 |
| 基础过渡 | `.22s ease` | `0.18s ease` (--transition-base) | ⚠️ 40ms 差异 |
| 慢速过渡 | 未明确 | `0.24s ease` (--transition-slow) | ℹ️ WikiPage 自定义 |

**改进建议**：
```css
/* 调整过渡时间以匹配静态页面 */
--transition-fast: 0.18s ease;
--transition-base: 0.22s ease;
```

### 6.2 展开/收起动画

| 元素 | 静态页面 | WikiPage | 差距 |
|-----|---------|----------|------|
| 展开图标旋转 | 未实现 | 未实现 | ⚠️ 两者都缺失 |
| 内容展开动画 | 未明确 | `slideDown 0.2s` | ✅ WikiPage 已实现 |

**改进建议**：
```css
/* 添加展开图标旋转动画 */
.expand-toggle {
  transition: transform var(--transition-base);
}

.expand-toggle.expanded {
  transform: rotate(180deg);
}
```

### 6.3 悬浮效果

| 元素 | 静态页面 | WikiPage | 差距 |
|-----|---------|----------|------|
| 卡片悬浮 | `border-color: var(--blue)` | `border-color: var(--line-active)` | ✅ 等效 |
| 卡片悬浮阴影 | `0 7px 18px rgba(30,95,168,.12)` | `var(--shadow-hover)` | ✅ 一致 |
| 关联事项悬浮 | 未对应 | `background: var(--cyan2)` | ✅ WikiPage 已优化 |

**结论**：悬浮效果基本对齐 ✅

---

## 🖼️ 七、背景纹理对比

### 7.1 网格背景

**静态页面实现**：
```css
body {
  background:
    linear-gradient(rgba(30,95,168,.018) 1px, transparent 1px),
    linear-gradient(90deg, rgba(30,95,168,.018) 1px, transparent 1px),
    var(--bg);
  background-size: 32px 32px;
}
```

**WikiPage 实现**：
```css
.wiki-layout {
  background: var(--bg);
  /* 无网格纹理 */
}
```

**差距**：WikiPage **完全缺失**网格背景纹理 ❌

**改进建议**：
```css
/* 添加到 wiki.css 的 .wiki-layout */
.wiki-layout {
  background-image:
    linear-gradient(rgba(30, 95, 168, 0.018) 1px, transparent 1px),
    linear-gradient(90deg, rgba(30, 95, 168, 0.018) 1px, transparent 1px);
  background-size: 32px 32px;
  background-color: var(--bg);
}

/* 暗色模式 */
html[data-theme="dark"] .wiki-layout {
  background-image:
    linear-gradient(rgba(105, 180, 255, 0.026) 1px, transparent 1px),
    linear-gradient(90deg, rgba(105, 180, 255, 0.026) 1px, transparent 1px);
}
```

### 7.2 径向渐变装饰（可选）

**静态页面在特定容器使用**：
```css
.canvas {
  background:
    radial-gradient(circle at 55% 47%, rgba(0,175,160,.045), transparent 25%),
    radial-gradient(circle at 55% 47%, rgba(30,95,168,.035), transparent 52%),
    /* 加网格 */
}
```

**WikiPage**：未使用径向渐变

**建议**：可选功能，优先级低

---

## 📝 八、排版系统对比

### 8.1 字体族

| 用途 | 静态页面 | WikiPage | 差距 |
|-----|---------|----------|------|
| 系统字体 | `-apple-system, BlinkMacSystemFont, "HarmonyOS Sans SC", ...` | 同左 (--font-system) | ✅ 基本一致 |
| 数字字体 | `"Arial Narrow", "DIN Alternate", "Roboto Condensed", Arial` | `--font-mono` (等宽字体) | ⚠️ 用途不同 |

**改进建议**：
- 添加 `--font-num` 专用于数字显示
```css
--font-num: "Arial Narrow", "DIN Alternate", "Roboto Condensed", Arial, sans-serif;
```

### 8.2 字号对比

| 元素 | 静态页面 | WikiPage | 差距 |
|-----|---------|----------|------|
| 主标题 h1 | `24px` | `2rem` (32px) | ❌ WikiPage 偏大 |
| 章节标题 h2 | `17px` | `1.125rem` (18px) | ⚠️ 1px 差异 |
| 卡片标题 h3 | `14px` | 未明确（继承） | ⚠️ 需确认 |
| 正文 | `10px` (卡片), `9.5px` (段落) | `0.9375rem` (15px) | ❌ WikiPage 偏大 |
| 小文字 | `8.5px - 10px` | `0.75rem - 0.875rem` (12-14px) | ⚠️ WikiPage 偏大 |

**改进建议**：
```css
/* 调整 WikiPage 字号以匹配静态页面 */
.article-panel h1 {
  font-size: 24px; /* 从 2rem 改为 24px */
}

.article-panel .section-header h2 {
  font-size: 17px; /* 从 1.125rem 改为 17px */
}

.article-panel p {
  font-size: 10px; /* 从 0.9375rem 改为 10px */
  line-height: 1.65; /* 从 1.8 调整为 1.65 */
}

.wiki-sidebar .panel-head h3 {
  font-size: 13px; /* 从 0.875rem 改为 13px */
}

.aside-body p {
  font-size: 9.5px; /* 从 0.875rem 改为 9.5px */
}
```

### 8.3 字重对比

| 元素 | 静态页面 | WikiPage | 差距 |
|-----|---------|----------|------|
| 主标题 | 正常/无明确定义 | `600` | ✅ 合理 |
| 数字/KPI | `850` | `600` | ⚠️ WikiPage 偏轻 |
| 徽章 | `800` | `800` | ✅ 一致 |

---

## 🔧 九、交互状态对比

### 9.1 激活状态

**静态页面 `.active` 状态**（导航按钮）：
```css
.nav button.active {
  color: #fff;
  font-weight: 750;
}
.nav button.active:after {
  /* 底部指示条 */
  background: var(--cyan);
}
```

**WikiPage `.active` 状态**（目录链接）：
```css
.outline-links button.active {
  background: var(--blue2);
  color: var(--blue);
  font-weight: 500;
}
```

**差距**：
- WikiPage 目录激活状态已实现 ✅
- WikiPage **缺少**章节激活状态高亮（当滚动到对应位置时）❌

**改进建议**：
```css
/* 添加章节激活状态 */
.article-panel .content-section.active {
  background: rgba(30, 95, 168, 0.02);
  border-color: var(--blue);
}
```

### 9.2 脉动动画

**静态页面**：
```css
@keyframes pulse {
  0%, 100% { opacity: .35; transform: scale(.9); }
  50% { opacity: 1; transform: scale(1.25); }
}
.pulse {
  animation: pulse 1.6s ease-in-out infinite;
}
```

**WikiPage**：未实现脉动动画 ❌

**建议**：低优先级，可用于强调关键状态

---

## 📊 十、具体差距总结

### 10.1 关键缺失项（高优先级）

| 序号 | 缺失项 | 影响 | 优先级 |
|-----|-------|------|--------|
| 1 | **网格背景纹理** | 缺少专业感和层次 | 🔴 高 |
| 2 | **字号系统偏大** | 与静态页面视觉密度不一致 | 🔴 高 |
| 3 | **展开图标旋转动画** | 交互反馈不足 | 🟡 中 |
| 4 | **章节激活状态** | 缺少当前位置指示 | 🟡 中 |
| 5 | **主文字颜色微调** | `#17243A` vs `#0F2744` | 🟢 低 |

### 10.2 细节优化项（中优先级）

| 序号 | 优化项 | 当前值 | 目标值 | 优先级 |
|-----|-------|-------|--------|--------|
| 1 | 过渡时间 | `0.15s / 0.18s` | `0.18s / 0.22s` | 🟡 中 |
| 2 | 卡片内边距 | `16px` | `15px` | 🟢 低 |
| 3 | `--shadow-sm` 偏移 | `0 4px` | `0 7px` | 🟢 低 |
| 4 | 数字字体族 | 等宽字体 | DIN/Arial Narrow | 🟢 低 |

### 10.3 可选增强项（低优先级）

| 序号 | 增强项 | 说明 | 优先级 |
|-----|-------|------|--------|
| 1 | 径向渐变背景 | 增加视觉焦点 | 🟢 低 |
| 2 | 脉动动画 | 强调关键状态 | 🟢 低 |
| 3 | Pill 大小写 | 确认是否需要 uppercase | 🟢 低 |

---

## 🎯 十一、实施建议

### 阶段一：核心视觉对齐（达到 90%）

**预计耗时**：1-2 小时

1. **添加网格背景纹理**
   - 修改 `wiki.css` 的 `.wiki-layout`
   - 添加暗色模式变体
   - 测试性能影响

2. **调整字号系统**
   - h1: 32px → 24px
   - h2: 18px → 17px
   - 正文: 15px → 10px
   - 侧边栏文字相应缩小

3. **添加展开图标旋转**
   - 给 `.expand-toggle` 添加 `transition`
   - 添加 `.expanded` 状态的 `transform: rotate(180deg)`

4. **实现章节激活高亮**
   - 添加 `.content-section.active` 样式
   - 确保滚动监听逻辑正确应用类名

### 阶段二：细节打磨（达到 95%）

**预计耗时**：30-60 分钟

1. **微调过渡时间**
2. **调整主文字颜色**
3. **优化阴影参数**

### 阶段三：可选增强（达到 100%）

**预计耗时**：按需

1. 径向渐变背景（如果需要）
2. 脉动动画（如果需要）
3. 其他微交互细节

---

## 📈 十二、完成度评估

### 当前完成度：75%

| 设计维度 | 当前 | 阶段一后 | 阶段二后 | 阶段三后 |
|---------|-----|---------|---------|----------|
| 色彩系统 | 95% | 98% | 100% | 100% |
| 间距系统 | 100% | 100% | 100% | 100% |
| 圆角系统 | 100% | 100% | 100% | 100% |
| 阴影效果 | 90% | 90% | 95% | 100% |
| 排版系统 | 80% | 95% | 98% | 100% |
| 交互动画 | 70% | 85% | 90% | 95% |
| 背景纹理 | 0% | 100% | 100% | 100% |
| **总体** | **75%** | **90%** | **95%** | **99%** |

---

## 🚀 十三、部署建议

### 建议执行顺序

1. **立即执行**：阶段一（网格背景 + 字号调整）
   - 视觉影响最大
   - 技术风险低
   - 不涉及功能变更

2. **择机执行**：阶段二（细节打磨）
   - 提升精致度
   - 用户不易察觉但整体感受更好

3. **按需执行**：阶段三（可选增强）
   - 根据用户反馈决定是否需要

### 验证清单

部署前验证：
- [ ] 浅色模式网格背景正常显示
- [ ] 暗色模式网格背景正常显示
- [ ] 字号调整后文字清晰可读
- [ ] 展开/收起图标旋转流畅
- [ ] 滚动时章节激活状态正确
- [ ] 移动端显示无异常
- [ ] 性能无明显下降

---

## 📎 附录：代码改动预览

### A. 网格背景纹理

```css
/* wiki.css - 修改 .wiki-layout */
.wiki-layout {
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 20px;
  padding: 16px 20px 40px;
  max-width: 1400px;
  margin: 0 auto;
  min-height: 100vh;
  
  /* 添加网格背景 */
  background-image:
    linear-gradient(rgba(30, 95, 168, 0.018) 1px, transparent 1px),
    linear-gradient(90deg, rgba(30, 95, 168, 0.018) 1px, transparent 1px);
  background-size: 32px 32px;
  background-color: var(--bg);
}

/* 暗色模式变体 */
html[data-theme="dark"] .wiki-layout {
  background-image:
    linear-gradient(rgba(105, 180, 255, 0.026) 1px, transparent 1px),
    linear-gradient(90deg, rgba(105, 180, 255, 0.026) 1px, transparent 1px);
}
```

### B. 字号调整

```css
/* wiki.css - 字号系统调整 */
.article-panel h1 {
  font-size: 24px; /* 从 2rem 改为 24px */
  font-weight: 600;
  margin: 0 0 var(--space-xs) 0;
  color: var(--ink);
}

.article-panel .section-header h2 {
  font-size: 17px; /* 从 1.125rem 改为 17px */
  font-weight: 600;
  margin: 0;
  color: var(--ink);
}

.article-panel p {
  font-size: 10px; /* 从 0.9375rem 改为 10px */
  line-height: 1.65; /* 从 1.8 调整 */
  color: var(--ink);
  margin: 0 0 var(--space-md) 0;
}

.wiki-sidebar .panel-head h3 {
  font-size: 13px; /* 从 0.875rem 改为 13px */
  font-weight: 600;
  margin: 0;
  color: var(--ink);
}
```

### C. 展开图标旋转

```css
/* wiki.css - 添加到 .expand-toggle */
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

.article-panel .expand-toggle.expanded {
  transform: rotate(180deg);
}
```

### D. 章节激活状态

```css
/* wiki.css - 添加激活状态 */
.article-panel .content-section.active {
  background: rgba(30, 95, 168, 0.02);
  border-color: var(--blue);
}

html[data-theme="dark"] .article-panel .content-section.active {
  background: rgba(105, 180, 255, 0.05);
}
```

---

**文档版本**：v1.0  
**最后更新**：2026-09-18  
**下一步**：执行阶段一改动并验证效果
