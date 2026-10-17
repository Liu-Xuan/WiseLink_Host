export type DocumentWorkbenchPanel = 'reader' | 'assessment' | 'wiki';

export function readDocumentWorkbenchPanel(params: URLSearchParams): {
  panel: DocumentWorkbenchPanel; error: string | null;
} {
  const values: string[] = params.getAll('panel');
  if (!values.length) return { panel: 'reader', error: null };
  if (values.length === 1 && (values[0] === 'reader' || values[0] === 'assessment' || values[0] === 'wiki'))
    return { panel: values[0], error: null };
  return { panel: 'reader', error: '工作台面板参数无效，请选择原文、评估或 Wiki。' };
}

/** Only the panel changes; exact source and caller-owned return state survive. */
export function documentWorkbenchPanelRoute(params: URLSearchParams, panel: DocumentWorkbenchPanel): string {
  const next: URLSearchParams = new URLSearchParams(params);
  if (panel === 'reader') next.delete('panel'); else next.set('panel', panel);
  return `?${next.toString()}`;
}
