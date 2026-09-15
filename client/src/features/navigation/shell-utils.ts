export interface ShellCrumb {
  label: string;
  to?: string;
}

export function shortId(value: string): string {
  return value.length > 28 ? `${value.slice(0, 17)}…${value.slice(-8)}` : value;
}

export function workItemIdFromPath(pathname: string): string {
  return decodeURIComponent(
    pathname.match(/\/work-items\/([^/]+)/)?.[1] ?? '',
  );
}

export function deriveBreadcrumbs(
  pathname: string,
  workItemId: string,
): ShellCrumb[] {
  if (pathname === '/') {
    return [{ label: '资料库' }];
  }

  const crumbs: ShellCrumb[] = [{ label: '资料库', to: '/library' }];
  const encoded: string = encodeURIComponent(workItemId);

  if (pathname === '/library') {
    return [{ label: '资料库' }];
  } else if (
    pathname.startsWith('/work-items/') &&
    pathname.endsWith('/documents') &&
    workItemId
  ) {
    crumbs.push({ label: '资料库', to: '/library' });
    crumbs.push({ label: shortId(workItemId), to: `/work-items/${encoded}` });
    crumbs.push({ label: '精读工作台' });
  } else if (pathname.startsWith('/work-items/') && workItemId) {
    crumbs.push({ label: '资料库', to: '/library' });
    crumbs.push({ label: shortId(workItemId) });
  } else if (pathname === '/knowledge') {
    crumbs.push({ label: '工程知识' });
  } else if (pathname === '/graph') {
    crumbs.push({ label: '关系图谱' });
  } else if (pathname === '/external-discovery') {
    crumbs.push({ label: '补充资料' });
  } else if (pathname === '/runtime-probe') {
    crumbs.push({ label: '连接状态' });
  } else {
    crumbs.push({ label: '页面未找到' });
  }

  return crumbs;
}
