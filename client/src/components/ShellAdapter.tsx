/**
 * ShellAdapter - Shell 组件路由适配器
 *
 * 将 Suite 1.1 Shell 组件适配到现有的 React Router 系统
 */

import React from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { Shell } from '../components/Shell';

interface ShellAdapterProps {
  children: React.ReactNode;
}

/**
 * 路由到页面名称的映射
 */
const routeToPageMap: Record<string, string> = {
  '/library': 'library',
  '/knowledge': 'knowledge',
  '/graph': 'graph',
  '/activity-graph': 'graph',
  '/situation': 'situation',
  '/timeline': 'timeline',
  '/work-items': 'tasks',
  '/matters': 'wiki',
  '/document-versions': 'reader',
  '/document-revisions': 'revision',
  '/dialogues': 'review',
};

/**
 * 页面名称到路由的映射
 */
const pageToRouteMap: Record<string, string> = {
  library: '/library',
  knowledge: '/knowledge',
  graph: '/graph',
  situation: '/situation',
  timeline: '/timeline',
  tasks: '/work-items',
  wiki: '/matters',
  reader: '/document-versions',
  revision: '/document-revisions',
  review: '/dialogues',
  process: '/matters/:matterId/process',
  demo: '/dev-preview/demo',
};

/**
 * 从当前路由推断页面名称
 */
function getCurrentPage(pathname: string): string {
  // 精确匹配
  if (routeToPageMap[pathname]) {
    return routeToPageMap[pathname];
  }

  // 前缀匹配
  for (const [route, page] of Object.entries(routeToPageMap)) {
    if (pathname.startsWith(route)) {
      return page;
    }
  }

  return 'library'; // 默认
}

/**
 * ShellAdapter - 适配 Shell 到 React Router
 */
export function ShellAdapter({ children }: ShellAdapterProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ matterId?: string; documentVersionId?: string }>();

  const currentPage = getCurrentPage(location.pathname);

  // 处理导航
  const handleNavigate = (page: string, navParams?: Record<string, any>) => {
    let route = pageToRouteMap[page] || '/library';

    // 替换路由参数
    if (navParams?.matter && route.includes(':matterId')) {
      route = route.replace(':matterId', navParams.matter);
    }
    if (navParams?.doc && route.includes(':documentVersionId')) {
      route = route.replace(':documentVersionId', navParams.doc);
    }

    // 添加查询参数
    const searchParams = new URLSearchParams();
    if (navParams?.query) searchParams.set('q', navParams.query);
    if (navParams?.event) searchParams.set('event', navParams.event);
    if (navParams?.view) searchParams.set('view', navParams.view);

    const search = searchParams.toString();
    navigate({ pathname: route, search: search ? `?${search}` : '' });
  };

  // 处理返回
  const handleBack = () => {
    navigate(-1);
  };

  // 获取当前事项信息（如果有）
  const currentMatter = params.matterId
    ? {
        id: params.matterId,
        title: '当前工程事项', // 实际应从数据获取
        code: 'WL-MATTER',
      }
    : undefined;

  // 获取当前文档信息（如果有）
  const currentDocument = params.documentVersionId
    ? {
        id: params.documentVersionId,
        title: '当前文档', // 实际应从数据获取
        version: 'R1',
      }
    : undefined;

  return (
    <Shell
      currentPage={currentPage}
      currentMatter={currentMatter}
      currentDocument={currentDocument}
      mode="production"
      onNavigate={handleNavigate}
      onBack={handleBack}
    >
      {children}
    </Shell>
  );
}
