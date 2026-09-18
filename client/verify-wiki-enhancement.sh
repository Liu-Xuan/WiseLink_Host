#!/bin/bash
# 测试 WikiPage 增强功能的快速验证脚本

echo "=== WikiPage Enhancement Verification ==="
echo ""

echo "1. 检查文件是否存在..."
files=(
  "src/pages/WikiPage/index.tsx"
  "src/pages/WikiPage/WikiArticle.tsx"
  "src/pages/WikiPage/WikiSidebar.tsx"
  "src/pages/WikiPage/types.ts"
  "src/pages/WikiPage/wiki.css"
  "src/adapters/WikiPageAdapter.tsx"
)

for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    echo "  ✓ $file"
  else
    echo "  ✗ $file (missing)"
  fi
done

echo ""
echo "2. 检查关键功能实现..."

# 检查可折叠章节
if grep -q "content-section" src/pages/WikiPage/WikiArticle.tsx; then
  echo "  ✓ 可折叠章节 (content-section)"
else
  echo "  ✗ 可折叠章节未实现"
fi

# 检查核心摘要高亮
if grep -q "matter-summary-highlight" src/pages/WikiPage/WikiArticle.tsx; then
  echo "  ✓ 核心摘要高亮 (matter-summary-highlight)"
else
  echo "  ✗ 核心摘要高亮未实现"
fi

# 检查关联事项
if grep -q "relatedMatters" src/pages/WikiPage/types.ts; then
  echo "  ✓ 关联事项类型定义 (relatedMatters)"
else
  echo "  ✗ 关联事项类型未定义"
fi

# 检查侧边栏折叠面板
if grep -q "expandedPanels" src/pages/WikiPage/WikiSidebar.tsx; then
  echo "  ✓ 侧边栏折叠功能 (expandedPanels)"
else
  echo "  ✗ 侧边栏折叠功能未实现"
fi

# 检查数量徽章
if grep -q "badge-count" src/pages/WikiPage/wiki.css; then
  echo "  ✓ 数量徽章样式 (badge-count)"
else
  echo "  ✗ 数量徽章样式未定义"
fi

# 检查关系徽章
if grep -q "relationship-badge" src/pages/WikiPage/wiki.css; then
  echo "  ✓ 关系徽章样式 (relationship-badge)"
else
  echo "  ✗ 关系徽章样式未定义"
fi

# 检查导航回调
if grep -q "onNavigateToMatter" src/adapters/WikiPageAdapter.tsx; then
  echo "  ✓ 事项导航回调 (onNavigateToMatter)"
else
  echo "  ✗ 事项导航回调未实现"
fi

echo ""
echo "3. TypeScript 类型检查..."
tsc_errors=$(npx tsc --noEmit --skipLibCheck 2>&1 | grep -c "WikiPage\|WikiArticle\|WikiSidebar" || echo "0")
if [ "$tsc_errors" -eq "0" ]; then
  echo "  ✓ WikiPage 相关文件无 TypeScript 错误"
else
  echo "  ⚠ WikiPage 相关文件有 $tsc_errors 个 TypeScript 错误"
fi

echo ""
echo "=== 验证完成 ==="
echo ""
echo "下一步："
echo "  1. 运行 npm run dev 启动开发服务器"
echo "  2. 访问 /wiki/:matterId 查看效果"
echo "  3. 测试折叠/展开功能是否正常工作"
echo "  4. 检查核心摘要的视觉突出效果"
echo "  5. 验证关联事项导航功能"
