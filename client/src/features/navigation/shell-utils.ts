export interface ShellCrumb {
  label: string;
  to?: string;
}

export interface ShellRouteContext {
  workItemId: string;
  matterId: string;
  documentVersionId: string;
  workRef: string;
}

export interface ShellObjectLink {
  to: string;
  label: string;
}

function routeSegment(pathname: string, pattern: RegExp): string {
  const encoded: string = pathname.match(pattern)?.[1] ?? '';
  try {
    return decodeURIComponent(encoded);
  } catch {
    return '';
  }
}

export function shortId(value: string): string {
  return value.length > 28 ? `${value.slice(0, 17)}…${value.slice(-8)}` : value;
}

export function workItemIdFromPath(pathname: string): string {
  return routeSegment(pathname, /^\/work-items\/([^/]+)(?:\/|$)/u);
}

export function matterIdFromPath(pathname: string): string {
  return routeSegment(pathname, /^\/matters\/([^/]+)(?:\/|$)/u);
}

export function documentVersionIdFromPath(pathname: string): string {
  return routeSegment(pathname, /^\/document-versions\/([^/]+)(?:\/|$)/u);
}

export function deriveShellRouteContext(
  pathname: string,
  search = '',
): ShellRouteContext {
  const matterId: string = matterIdFromPath(pathname);
  return {
    workItemId: workItemIdFromPath(pathname),
    matterId,
    documentVersionId: documentVersionIdFromPath(pathname),
    workRef: matterId
      ? (new URLSearchParams(search).get('workRef')?.trim() ?? '')
      : '',
  };
}

export function buildShellObjectLinks(
  context: ShellRouteContext,
): ShellObjectLink[] {
  if (context.matterId) {
    const overview = `/matters/${encodeURIComponent(context.matterId)}`;
    return [
      {
        to: overview,
        label: context.workRef ? '返回当前事项简报' : '事项简报',
      },
      { to: `${overview}?panel=review`, label: '当前事项核对与讨论' },
      { to: `${overview}?panel=materials`, label: '当前事项关联资料' },
    ];
  }
  if (context.workItemId) {
    const overview = `/work-items/${encodeURIComponent(context.workItemId)}`;
    const workspace = `${overview}/documents`;
    return [
      { to: overview, label: '事项综述' },
      { to: `${workspace}?node=assessment&tab=assessment`, label: '问题分析' },
      { to: `${workspace}?node=reader&tab=source`, label: '相关资料' },
      { to: `${workspace}?node=review&tab=review`, label: '复核与交流' },
      { to: `${workspace}?node=overall&tab=overall`, label: '变化与历史' },
      { to: `${workspace}?node=document`, label: '版本附件' },
    ];
  }
  return [];
}

export function deriveBreadcrumbs(
  pathname: string,
  search = '',
): ShellCrumb[] {
  if (pathname === '/' || pathname === '/library') {
    return [{ label: '资料库' }];
  }

  const context: ShellRouteContext = deriveShellRouteContext(pathname, search);
  const crumbs: ShellCrumb[] = [{ label: '资料库', to: '/library' }];

  if (context.workItemId) {
    const overview = `/work-items/${encodeURIComponent(context.workItemId)}`;
    crumbs.push({
      label: shortId(context.workItemId),
      ...(pathname.endsWith('/documents') ? { to: overview } : {}),
    });
    if (pathname.endsWith('/documents')) crumbs.push({ label: '精读工作台' });
    return crumbs;
  }

  if (context.matterId) {
    const overview = `/matters/${encodeURIComponent(context.matterId)}`;
    crumbs.push({ label: '工程事项', to: '/library?mode=matter' });
    crumbs.push({
      label: shortId(context.matterId),
      ...(context.workRef ? { to: overview } : {}),
    });
    if (context.workRef) {
      crumbs.push({ label: `历史工作 ${shortId(context.workRef)}` });
    }
    return crumbs;
  }

  if (context.documentVersionId) {
    crumbs.push({ label: '文档版本' });
    crumbs.push({ label: shortId(context.documentVersionId) });
    return crumbs;
  }

  if (pathname === '/dialogues' || pathname.startsWith('/dialogues/')) {
    crumbs.push({
      label:
        pathname === '/dialogues'
          ? '私有对话'
          : `私有对话 ${shortId(routeSegment(pathname, /^\/dialogues\/([^/]+)(?:\/|$)/u))}`,
    });
    return crumbs;
  }

  const pageLabels: Record<string, string> = {
    '/document-revisions': '改版比较',
    '/knowledge': '工程知识',
    '/graph': '关系图谱',
    '/external-discovery': '补充资料',
    '/runtime-probe': '连接状态',
    '/settings/models': '分析模型设置',
  };
  crumbs.push({ label: pageLabels[pathname] ?? '页面未找到' });
  return crumbs;
}
