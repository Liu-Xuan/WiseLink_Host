import type { WlCardAction } from '../types';

/* ============================================================
 * WiseLink 3.1 · AppLink 构建器
 * 卡片主按钮使用 AppLink 打开飞书内网页工作台（独立窗口/侧边栏），
 * 落到本仓库现有路由。链接形如：
 *   https://applink.feishu.cn/client/web_url/open?url=<encoded>
 * ============================================================ */

/** 工作台目标视图（对应 app.tsx 中的现有路由） */
export type WorkbenchView =
  | { kind: 'overview'; workItemId: string }
  | { kind: 'source'; workItemId: string; sourceRef?: string }
  | { kind: 'documents'; workItemId: string }
  | { kind: 'library' }
  | { kind: 'home' };

export function workbenchPathOf(view: WorkbenchView): string {
  switch (view.kind) {
    case 'overview':
      return `/work-items/${encodeURIComponent(view.workItemId)}?view=overview`;
    case 'source':
      return `/work-items/${encodeURIComponent(view.workItemId)}/documents${
        view.sourceRef
          ? `?view=source&sourceRef=${encodeURIComponent(view.sourceRef)}`
          : ''
      }`;
    case 'documents':
      return `/work-items/${encodeURIComponent(view.workItemId)}/documents`;
    case 'library':
      return '/library';
    case 'home':
      return '/';
  }
}

/** 生成飞书内打开网页工作台的 AppLink */
export function buildAppLink(view: WorkbenchView, baseUrl: string): string {
  const target = `${baseUrl.replace(/\/$/, '')}${workbenchPathOf(view)}`;
  return `https://applink.feishu.cn/client/web_url/open?url=${encodeURIComponent(target)}`;
}

/** 业务动作 → 默认工作台视图；不表示官方事件回调已经接线。 */
export function defaultViewForAction(
  action: WlCardAction,
): WorkbenchView | null {
  switch (action) {
    case 'OPEN_OVERVIEW':
    case 'ACKNOWLEDGE_REVIEW':
    case 'VIEW_LATEST':
      return { kind: 'overview', workItemId: '' };
    case 'OPEN_SOURCE':
      return { kind: 'source', workItemId: '' };
    case 'OPEN_TASK':
    case 'SUPPLY_MATERIALS':
    case 'REQUEST_RESYNTHESIS':
      return { kind: 'documents', workItemId: '' };
    case 'RETRY_TASK':
      return null;
  }
}
