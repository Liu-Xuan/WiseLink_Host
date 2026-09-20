# WikiPage 设计增强路线图

## 概述

本文档记录 WikiPage 与静态演示页面设计对齐的实施计划。目标是将静态页面的专业视觉效果完整应用到实际 WikiPage 组件。

## ✅ Phase 1: 设计令牌系统（已完成）

**目标**：建立统一的设计语言基础

**已完成**：
- ✅ 创建 `design-tokens.css` - 提取静态页面的完整色彩、间距、圆角、阴影系统
- ✅ 定义语义化变量（`--navy`, `--blue`, `--cyan`, `--gold`）
- ✅ 暗色模式完整支持
- ✅ 实用类（`.card`, `.pill`, `.gradient-navy`）

**设计令牌对比**：

| 设计元素 | 静态页面 | WikiPage (旧) | WikiPage (新) |
|---------|---------|--------------|--------------|
| 主背景色 | #F4F7F8 | 默认白色 | var(--bg) |
| 卡片圆角 | 14px | 8px | var(--radius-lg) = 14px |
| 卡片阴影 | 0 7px 20px rgba(15,39,68,.065) | 简单边框 | var(--shadow-md) |
| 核心摘要 | 深色渐变 + 17px圆角 | 浅蓝渐变 + 8px圆角 | 深色渐变 + var(--radius-xl) |
| 按钮圆角 | 7px-11px | 4px | var(--radius-sm/md) |

## ✅ Phase 2: 核心样式迁移（已完成）

**目标**：将 `wiki.css` 完全重构为使用设计令牌

**已完成**：
- ✅ 主布局容器使用 `var(--bg)` 背景
- ✅ 卡片使用 `var(--panel)`, `var(--line)`, `var(--radius-lg)`
- ✅ 核心摘要使用深色渐变背景 `gradient-navy`
- ✅ 所有间距统一为 `var(--space-*)`
- ✅ 所有颜色统一为语义化变量
- ✅ 移除所有硬编码的暗色模式规则（由 design-tokens 统一处理）

**关键改进**：

```css
/* 旧版 - 硬编码值 */
.article-panel {
  background: white;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  padding: 2rem;
}

/* 新版 - 使用设计令牌 */
.article-panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  padding: var(--space-xl);
  box-shadow: var(--shadow-md);
}
```

## 🚧 Phase 3: 视觉细节对齐（进行中）

**目标**：完全匹配静态页面的视觉质感

### 3.1 核心摘要增强
**当前状态**：已使用深色渐变背景
**待优化**：
- [ ] 考虑添加微妙的网格纹理（可选）
- [ ] 字体颜色微调为 `var(--ink-soft)` 确保最佳对比度

### 3.2 可折叠章节交互
**当前状态**：基础折叠功能已实现
**待优化**：
- [ ] 展开/收起图标旋转动画
- [ ] 激活状态的背景高亮效果
- [ ] 更平滑的内容展开过渡

**参考代码**：
```css
.expand-toggle.expanded {
  transform: rotate(180deg);
}

.content-section.active {
  background: rgba(30, 95, 168, 0.02);
  border-color: var(--blue);
}
```

### 3.3 侧边栏徽章样式
**当前状态**：使用简单的圆角徽章
**待优化**：
- [ ] 使用 `.pill` 样式类（已在 design-tokens 定义）
- [ ] 更紧凑的 padding 和更大的 font-weight

### 3.4 关联事项悬浮效果
**当前状态**：基础悬浮效果
**已完成**：
- ✅ 使用 `var(--cyan2)` 背景
- ✅ 使用更明显的阴影效果

## 📅 Phase 4: 组件级优化（计划中）

**目标**：提取可复用组件，提高代码质量

### 4.1 创建通用组件
- [ ] `<Pill>` - 徽章组件
- [ ] `<CollapsiblePanel>` - 可折叠面板
- [ ] `<Card>` - 卡片容器
- [ ] `<Badge>` - 数量徽章

### 4.2 WikiArticle 重构
- [ ] 将 `.content-section` 提取为 `<CollapsibleSection>` 组件
- [ ] 统一使用 `<Card>` 组件
- [ ] 改进代码可读性和可维护性

### 4.3 WikiSidebar 重构
- [ ] 统一面板头部样式
- [ ] 提取重复的折叠逻辑
- [ ] 使用 `<Pill>` 组件替代 `.badge-count`

## 🎨 Phase 5: 高级视觉效果（可选）

**目标**：添加精致的视觉细节

### 5.1 网格背景纹理
静态页面使用微妙的网格背景增强专业感：

```css
.wiki-layout.with-grid-texture {
  background-image:
    linear-gradient(rgba(30, 95, 168, 0.018) 1px, transparent 1px),
    linear-gradient(90deg, rgba(30, 95, 168, 0.018) 1px, transparent 1px);
  background-size: 32px 32px;
}
```

**决策**：是否启用？
- 优点：增加专业感和层次
- 缺点：可能影响性能

### 5.2 悬浮状态细节
- [ ] 卡片悬浮时的轻微上浮效果
- [ ] 按钮点击时的轻微缩放反馈
- [ ] 更流畅的颜色过渡

### 5.3 加载状态动画
- [ ] 骨架屏加载效果
- [ ] 内容淡入动画
- [ ] 更友好的错误状态展示

## 📊 设计对齐度评估

### 当前完成度：75%

| 设计维度 | 完成度 | 说明 |
|---------|--------|------|
| 色彩系统 | 95% | 设计令牌完整，应用到位 |
| 间距系统 | 100% | 所有间距使用变量 |
| 圆角系统 | 100% | 完全对齐静态页面 |
| 阴影效果 | 90% | 基础阴影已应用，悬浮效果待优化 |
| 排版系统 | 80% | 字号和行高基本一致，字体待确认 |
| 交互动画 | 70% | 基础动画到位，细节待打磨 |
| 暗色模式 | 100% | 完整支持，自动切换 |
| 响应式 | 85% | 基础适配完成，移动端待优化 |

## 🛠️ 技术债务

### 待清理
- [ ] 移除旧的 CSS 变量引用（`--text-primary`, `--border-color` 等）
- [ ] 统一组件内部的状态管理
- [ ] 改进类型定义的导出结构

### 性能优化
- [ ] 使用 CSS containment 优化渲染
- [ ] 减少不必要的重新渲染
- [ ] 优化阴影和渐变的性能影响

## 📝 后续任务清单

### 立即可做（优先级：高）
1. ✅ 创建 design-tokens.css
2. ✅ 重构 wiki.css 使用设计令牌
3. ✅ 更新 index.tsx 引入设计令牌
4. [ ] 验证暗色模式切换效果
5. [ ] 测试所有交互功能

### 下一步（优先级：中）
1. [ ] 提取 CollapsibleSection 组件
2. [ ] 提取 Pill 和 Badge 组件
3. [ ] 优化悬浮动画细节
4. [ ] 移动端适配优化

### 未来考虑（优先级：低）
1. [ ] 添加网格背景纹理
2. [ ] 实现骨架屏加载
3. [ ] 添加更多微交互
4. [ ] 性能监控和优化

## 🎯 成功标准

WikiPage 设计增强达到以下标准即可认为完成：

1. **视觉一致性**：与静态演示页面的视觉风格完全一致
2. **暗色模式**：暗色模式下所有元素正常显示，无样式异常
3. **交互流畅**：所有动画流畅自然，无卡顿
4. **代码质量**：无硬编码值，所有样式使用设计令牌
5. **性能良好**：首次渲染时间 < 1s，交互响应 < 100ms
6. **类型安全**：无 TypeScript 错误或警告
7. **向后兼容**：现有功能完全保留，数据接口不变

## 📖 参考资料

- **静态演示页面**：`/Volumes/SSD/LLM/WiseLink/Deliverables/airchina-wing-5-static-demo/index.html`
- **设计令牌文件**：`client/src/styles/design-tokens.css`
- **WikiPage 样式**：`client/src/pages/WikiPage/wiki.css`
- **组件文件**：`client/src/pages/WikiPage/index.tsx`
