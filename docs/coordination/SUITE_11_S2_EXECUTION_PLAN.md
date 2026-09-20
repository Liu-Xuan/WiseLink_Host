# WiseLink Suite 1.1 S2 执行计划：工程知识与 Wiki

**日期**: 2026-09-18  
**批次**: S2 工程知识与 Wiki  
**状态**: 准备启动  
**预计时间**: 3-4天

---

## 📋 S2 目标

### 核心目标
实现工程知识页面和事项 Wiki 页面，提供清晰的信息架构：
- **首屏优先**: 已有解释列表（可复用认识）
- **下钻查看**: 完整正文、来源、过程
- **版本控制**: 当前/含历史/仅历史三档

### 与 S1 的区别
- S1: 资料库（文档列表 + 快览）
- S2: 知识页（解释列表 + 正文）+ Wiki（连贯正文）

---

## 🎯 交付范围

### 2.1 工程知识页面（KnowledgePage）

#### 页面结构
```
┌─────────────────────────────────────────┐
│ 工程知识                                │
│ [工程认识] [来源资料]                    │
│ [当前] [含历史] [仅历史]  [搜索框]      │
├──────────────┬──────────────────────────┤
│ 已有解释列表  │   完整正文                │
│              │                          │
│ • 起落架检查  │   标题：起落架收放检查    │
│   A320/32   │                          │
│   当前v3    │   范围与限制：           │
│              │   限定 A320 特定构型...   │
│ • 液压系统   │                          │
│   A320/29   │   当前认识：             │
│   历史v2    │   临时措施已明确...       │
│              │                          │
│              │   关键依据：             │
│              │   [AMM 32-11-00]         │
└──────────────┴──────────────────────────┘
```

#### 核心功能
1. **双栏布局**: 左列表 + 右正文
2. **三档版本选择**: 
   - 当前：仅显示最新有效工作
   - 含历史：包含历史认识
   - 仅历史：只看已归档认识
3. **两种视图切换**:
   - 工程认识：可复用的结论
   - 来源资料：原始参考文档
4. **搜索与筛选**: 按关键词、ATA、机型
5. **选择交互**: 单击列表项更新右侧正文

### 2.2 事项 Wiki 页面（WikiPage）

#### 页面结构
```
┌──────────────────────────────────────────┐
│ 起落架收放异常分析                        │
│ WL-M001 · A320 · ATA 32                 │
├──────────────────────┬───────────────────┤
│  连贯正文            │   侧边栏           │
│                      │                   │
│  ## 问题概述         │   目录             │
│  A320 特定构型的...  │   • 问题概述       │
│                      │   • 当前认识       │
│  ## 当前认识         │   • 关键条件       │
│  临时措施已明确...   │                   │
│                      │   继续关注         │
│  ## 关键条件         │   □ 工具兼容性     │
│  • 限定特定构型      │   □ 最终改装      │
│  • 需确认工具兼容性  │                   │
│                      │   关键依据         │
│  ## 相关资料         │   [AMM文档]       │
│  [查看精读]          │   [技术公告]       │
│                      │                   │
└──────────────────────┴───────────────────┘
```

#### 核心功能
1. **主次布局**: 主正文 + 侧边栏
2. **连贯正文**: Markdown 渲染，段落式
3. **目录导航**: 自动生成，点击滚动
4. **重要信息突出**: 条件、否定、限制
5. **相关链接**: 跳转精读、图谱、时间轴
6. **认识历史**: 查看修订记录

---

## 🏗️ 技术实现

### 前端组件结构

#### KnowledgePage
```
client/src/pages/KnowledgePage/
├── index.tsx              // 主容器
├── KnowledgeHeader.tsx    // 顶部控件（视图/版本/搜索）
├── KnowledgeList.tsx      // 左侧列表
├── KnowledgeDetail.tsx    // 右侧正文
└── knowledge.css          // 样式
```

#### WikiPage
```
client/src/pages/WikiPage/
├── index.tsx              // 主容器
├── WikiArticle.tsx        // 主正文区
├── WikiSidebar.tsx        // 侧边栏
├── WikiToc.tsx            // 目录组件
└── wiki.css               // 样式
```

### 后端接口需求

#### 工程知识查询
```typescript
GET /api/canonical-host/engineering-knowledge/search
  ?scope=current|with-history|history-only
  &view=recognition|source
  &query=起落架
  &ata=32
  &fleet=A320

返回:
{
  items: [{
    id: string;
    title: string;
    summary: string;        // 短摘要（列表显示）
    fullContent: string;    // 完整正文
    scope: string;          // 范围说明
    conditions: string[];   // 关键条件
    sources: Array<{        // 依据资料
      documentId: string;
      title: string;
    }>;
    version: string;
    createdAt: string;
    updatedAt: string;
  }]
}
```

#### 事项 Wiki 查询
```typescript
GET /api/canonical-host/matters/:matterId/wiki

返回:
{
  matterId: string;
  title: string;
  code: string;
  ata: string;
  fleet: string;
  
  content: {
    overview: string;       // 问题概述
    recognition: string;    // 当前认识
    conditions: string[];   // 关键条件
    limitations: string[];  // 限制说明
    relatedDocs: Array<{    // 相关资料
      id: string;
      title: string;
      type: string;
    }>;
  };
  
  toc: Array<{              // 目录
    level: number;
    title: string;
    anchor: string;
  }>;
  
  history: Array<{          // 认识历史
    version: string;
    updatedAt: string;
    summary: string;
  }>;
}
```

---

## 📝 实施步骤

### Week 1: Day 1-2 - KnowledgePage 开发

#### Day 1 上午：组件骨架
- [ ] 创建 KnowledgePage 目录结构
- [ ] 实现主容器组件
- [ ] 实现 KnowledgeHeader（视图/版本切换）
- [ ] 基础样式设置

#### Day 1 下午：列表组件
- [ ] 实现 KnowledgeList 组件
- [ ] 数据结构定义
- [ ] 列表项渲染
- [ ] 选择交互

#### Day 2 上午：正文组件
- [ ] 实现 KnowledgeDetail 组件
- [ ] Markdown 渲染
- [ ] 来源链接
- [ ] 条件突出显示

#### Day 2 下午：数据集成
- [ ] 创建 API 服务
- [ ] 适配器实现
- [ ] 模拟数据对接
- [ ] 测试验证

### Week 1: Day 3-4 - WikiPage 开发

#### Day 3 上午：组件结构
- [ ] 创建 WikiPage 目录结构
- [ ] 实现主容器
- [ ] 实现 WikiArticle（主正文）
- [ ] Markdown 样式

#### Day 3 下午：侧边栏
- [ ] 实现 WikiSidebar 组件
- [ ] 实现 WikiToc（目录）
- [ ] 自动目录生成
- [ ] 滚动同步

#### Day 4 上午：增强功能
- [ ] 继续关注列表
- [ ] 关键依据链接
- [ ] 相关操作按钮
- [ ] 认识历史

#### Day 4 下午：集成测试
- [ ] API 集成
- [ ] 路由集成
- [ ] 导航测试
- [ ] 问题修复

---

## 🎨 设计参考

### Suite 1.1 源文件
```
/Users/liuxuan/Downloads/WiseLink_Frontend_Suite_20260917/
├── src/pages/Knowledge.jsx    // 工程知识参考
├── src/pages/Wiki.jsx          // Wiki 参考
├── screenshots/
    ├── knowledge-light-1672.png
    ├── knowledge-history-light-1672.png
    └── wiki-light-1672.png
```

### 关键设计要点

#### KnowledgePage
- **信息优先级**: 已有解释 > 过程细节
- **列表项**: 标题 + 范围 + 版本（3行）
- **正文**: 范围 → 认识 → 条件 → 依据
- **颜色**: 历史项用灰色标识

#### WikiPage
- **可读性**: 行高 1.6，段落间距
- **层级**: 清晰的标题层级
- **突出**: 重要条件用背景色
- **链接**: 明确的操作入口

---

## ✅ 验收标准

### 功能验收

#### KnowledgePage
- [ ] 三档版本切换工作正常
- [ ] 两种视图切换正确
- [ ] 搜索筛选功能正常
- [ ] 列表选择更新正文
- [ ] 正文格式正确显示
- [ ] 来源链接可点击

#### WikiPage
- [ ] 连贯正文渲染正确
- [ ] 目录自动生成
- [ ] 目录点击滚动
- [ ] 滚动更新目录高亮
- [ ] 侧边栏信息完整
- [ ] 相关操作可用

### 视觉验收
- [ ] 1672×1000 对照
- [ ] 1440×1000 对照
- [ ] 390×844 对照
- [ ] 与 Suite 1.1 相似度 > 90%

### 性能验收
- [ ] 列表加载 < 500ms
- [ ] 切换响应 < 100ms
- [ ] 滚动流畅 60fps
- [ ] Markdown 渲染快速

---

## 🔗 与其他批次的关系

### 复用 S1 成果
- ✅ Shell 外壳（无需修改）
- ✅ ShellAdapter（路由映射）
- ✅ 图标系统
- ✅ 样式系统（Suite）

### 为后续准备
- S3 精读：WikiPage 的"查看精读"链接
- S4 图谱：KnowledgePage 的图谱入口
- S4 时间轴：WikiPage 的时间轴链接

---

## 📊 工作量估算

```
组件开发:   16h (KnowledgePage 8h + WikiPage 8h)
API 集成:    4h
样式调整:    4h
测试验证:    4h
文档编写:    2h
----------------------------------------
总计:       30h (约 4 个工作日)
```

---

## 🎯 成功标准

### 必须达成
- [x] KnowledgePage 完整实现
- [x] WikiPage 完整实现
- [x] 三档版本选择工作
- [x] 信息架构正确

### 应该达成
- [ ] 与 Suite 1.1 高度一致
- [ ] 性能达标
- [ ] 测试覆盖充分

### 可以优化
- [ ] Markdown 扩展语法
- [ ] 高级搜索功能
- [ ] 导出功能

---

## 🚀 立即开始

### 第一步：创建组件骨架
```bash
# 创建目录
mkdir -p client/src/pages/KnowledgePage
mkdir -p client/src/pages/WikiPage

# 复制 Suite 1.1 参考
# 参考文件：
# - src/pages/Knowledge.jsx
# - src/pages/Wiki.jsx
```

### 第二步：定义数据类型
```typescript
// shared/engineering-knowledge.interface.ts
// shared/matter-wiki.interface.ts
```

### 第三步：实现基础组件
```typescript
// KnowledgePage/index.tsx - 主容器
// WikiPage/index.tsx - 主容器
```

---

**状态**: 准备启动 S2  
**下一步**: 创建 KnowledgePage 组件  
**负责人**: M (全栈) + Luna (前端)  
**预计完成**: 2026-09-22
