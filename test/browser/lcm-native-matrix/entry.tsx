import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LcmConfigurationLibrary } from '../../../client/src/pages/WorkspaceHomePage/LcmConfigurationLibrary';
import './theme.css';

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}>
  <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <aside style={{ padding: 8, fontSize: 12 }}>本地组件测试 · 合成原生矩阵 · 无数据库、真实来源或产品授权</aside>
    <LcmConfigurationLibrary />
  </BrowserRouter>
</QueryClientProvider>);
