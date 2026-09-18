import VersionComparisonPage from '../pages/VersionComparisonPage';

interface VersionComparisonPageAdapterProps {
  documentId?: string;
}

/**
 * VersionComparisonPage 集成适配器
 *
 * 将 Suite 1.1 的 VersionComparisonPage 集成到现有系统中
 *
 * 使用方式：
 * <VersionComparisonPageAdapter documentId="doc-123" />
 */
export default function VersionComparisonPageAdapter(
  props: VersionComparisonPageAdapterProps
) {
  // 适配器直接透传到 VersionComparisonPage
  // 未来可以在这里添加额外的集成逻辑，例如：
  // - 认证检查
  // - 租户上下文注入
  // - 文档族历史数据预加载
  // - 错误边界处理

  return <VersionComparisonPage />;
}
