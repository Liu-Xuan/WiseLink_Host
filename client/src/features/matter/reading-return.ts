const LIBRARY_FILTERS = [
  'familyId',
  'search',
  'normalizedFamily',
  'ata',
  'aircraftModel',
  'fleetFamily',
  'fleetModel',
] as const;

function identifier(value: string | null): string {
  const text = value?.trim() ?? '';
  return text.length <= 512 && !/[\u0000-\u001f\u007f]/u.test(text) ? text : '';
}

/** Read-only directory state, never arbitrary URLs or write-intent parameters. */
export function libraryReadingParams(params: URLSearchParams): URLSearchParams {
  const result = new URLSearchParams({ mode: 'document' });
  for (const key of LIBRARY_FILTERS) {
    const value = identifier(params.get(key));
    if (value) result.set(key, value);
  }
  if (params.get('catalogView') === 'tree') result.set('catalogView', 'tree');
  if (params.get('grouping') === 'ata' || params.get('grouping') === 'aircraft')
    result.set('grouping', params.get('grouping')!);
  result.sort();
  return result;
}

export function libraryReadingScope(params: URLSearchParams): string {
  return `library:${libraryReadingParams(params).toString()}`;
}

export function libraryDocumentReadingRoute(
  documentVersionId: string,
  params: URLSearchParams,
): string {
  const query = new URLSearchParams({
    returnDocumentVersionId: documentVersionId,
    returnLibraryQuery: libraryReadingParams(params).toString(),
  });
  return `/document-versions/${encodeURIComponent(documentVersionId)}?${query}`;
}

export function matterReadingReturnParams(
  matterId: string,
  documentVersionId: string,
  panel: string,
  workRef = '',
): URLSearchParams {
  const params = new URLSearchParams({
    returnMatterId: matterId,
    returnDocumentVersionId: documentVersionId,
  });
  if (panel === 'review' || panel === 'materials')
    params.set('returnMatterPanel', panel);
  if (workRef) params.set('returnMatterWorkRef', workRef);
  return params;
}

export function readingReturnTarget(
  params: URLSearchParams,
  documentVersionId?: string,
): { route: string; label: string } | null {
  const keys = [
    'returnMatterId',
    'returnLibraryQuery',
    'returnLibraryWorkItemId',
    'returnWorkItemId',
  ];
  if (keys.filter((key) => params.has(key)).length > 1) return null;
  if (
    [...keys, 'returnMatterWorkRef', 'returnDocumentVersionId'].some(
      (key) => params.getAll(key).length > 1,
    )
  )
    return null;
  const binding = identifier(params.get('returnDocumentVersionId'));
  if (
    params.has('returnDocumentVersionId') &&
    (!binding ||
      (documentVersionId !== undefined && binding !== documentVersionId))
  )
    return null;
  const matterId = identifier(params.get('returnMatterId'));
  if (matterId) {
    const panel = params.get('returnMatterPanel');
    const workRef = identifier(params.get('returnMatterWorkRef'));
    if (params.has('returnMatterWorkRef') && !workRef) return null;
    const query = new URLSearchParams();
    if (workRef) query.set('workRef', workRef);
    else if (panel === 'review' || panel === 'materials')
      query.set('panel', panel);
    return {
      route: `/matters/${encodeURIComponent(matterId)}${query.size ? `?${query}` : ''}`,
      label: workRef
        ? '返回原工作简报'
        : panel === 'review'
          ? '返回事项讨论'
          : panel === 'materials'
            ? '返回关联资料'
            : '返回事项简报',
    };
  }
  if (params.has('returnLibraryQuery')) {
    if (
      !binding ||
      !params.get('returnLibraryQuery') ||
      params.get('returnLibraryQuery')!.length > 4096
    )
      return null;
    return {
      route: `/library?${libraryReadingParams(new URLSearchParams(params.get('returnLibraryQuery')!))}`,
      label: '返回原文档目录',
    };
  }
  const libraryWorkItemId = identifier(params.get('returnLibraryWorkItemId'));
  if (libraryWorkItemId)
    return {
      route: `/library?${new URLSearchParams({ mode: 'tasks', workItemId: libraryWorkItemId })}`,
      label: '返回任务快览',
    };
  const workItemId = identifier(params.get('returnWorkItemId'));
  return workItemId
    ? {
        route: `/work-items/${encodeURIComponent(workItemId)}`,
        label: '返回评估简报',
      }
    : null;
}
