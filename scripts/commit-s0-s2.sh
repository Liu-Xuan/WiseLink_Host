#!/bin/bash

# Suite 1.1 S0-S2 Git 提交脚本
# 2026-09-18

cd /Volumes/SSD/LLM/WiseLink/private/runtime/miaoda-app-repos/wiselink-v3-1-canonical-host-app

echo "=== Git 状态检查 ==="
git status

echo ""
echo "=== 添加 S0-S2 文件到暂存区 ==="

# Shell 组件
git add client/src/components/Shell/
git add client/src/components/Icon/
git add client/src/components/ShellAdapter.tsx
git add client/src/components/adapters/LibraryPageAdapter.tsx
git add client/src/components/adapters/KnowledgePageAdapter.tsx
git add client/src/components/adapters/WikiPageAdapter.tsx

# 页面组件
git add client/src/pages/LibraryPage/
git add client/src/pages/KnowledgePage/
git add client/src/pages/WikiPage/

# 样式系统
git add client/src/styles/suite/

# 文档
git add docs/coordination/SUITE_11_*.md

echo ""
echo "=== 暂存区状态 ==="
git status

echo ""
echo "=== 创建提交 ==="
git commit -m "feat(suite-1.1): implement S0-S2 Shell, Library, Knowledge, and Wiki pages" -m "Implement WiseLink Suite 1.1 frontend components for S0-S2 phases:

S0: Analysis and Mapping (100%)
- Complete component mapping analysis
- 12-page differential analysis
- Suite 1.1 resource inventory
- Data interface gap identification

S1: Shell and Library (100%)
- Unified Shell with 6 components
- Library three-column layout with 4 components
- Icon system
- Suite style system (4 files)
- Adapter layer (4 files)

S2: Knowledge and Wiki (100%)
- Knowledge dual-pane with 4 components
- Wiki article page with 3 components
- Adapter integration

Files added:
- Frontend: 22 components + 4 styles
- Documentation: 7 coordination docs
- Code: ~9,250 lines (TS + CSS + MD)

Known limitations:
- Backend DocumentReading API not implemented
- Integration tests pending
- Visual acceptance pending

Next phases: S3 (Reader), S4 (Graph), S5 (Analysis), S6 (Acceptance)

Design source: /Users/liuxuan/Downloads/WiseLink_Frontend_Suite_20260917/
Tech stack: React 19.1.1 + Cytoscape 3.33.1"

echo ""
echo "=== 推送到 origin (妙搭) ==="
git push origin codex/wl31-r09-master-handoff-20260903

echo ""
echo "=== 推送到 github ==="
git push github codex/wl31-r09-master-handoff-20260903

echo ""
echo "=== 完成 ==="
git log --oneline -3
