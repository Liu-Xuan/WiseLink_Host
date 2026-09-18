import ReaderPage from '../pages/ReaderPage';

interface ReaderPageAdapterProps {
  documentId?: string;
  parseRunId?: string;
  sourceRef?: string;
}

/**
 * ReaderPage 集成适配器
 *
 * 将 Suite 1.1 的 ReaderPage 集成到现有系统中
 *
 * 使用方式：
 * <ReaderPageAdapter documentId="doc-123" sourceRef="block-5" />
 */
export default function ReaderPageAdapter(props: ReaderPageAdapterProps) {
  // 适配器直接透传到 ReaderPage
  // 未来可以在这里添加额外的集成逻辑，例如：
  // - 认证检查
  // - 租户上下文注入
  // - 数据预加载
  // - 错误边界处理

  return <ReaderPage />;
}
