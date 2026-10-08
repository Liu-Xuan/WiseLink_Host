import { isLibraryGraphReturnToken } from './library-graph-return-memory';
export type DocumentGraphEntry =
  | { kind: 'absent' }
  | { kind: 'invalid' }
  | { kind: 'document'; documentVersionId: string; readerWorkItemId?: string };
const singleIdentity = (params: URLSearchParams, name: string): string | null => {
  const values = params.getAll(name);
  return values.length === 1 && values[0] && values[0] === values[0].trim()
    && values[0].length <= 512 && !/[\u0000-\u001f\u007f]/u.test(values[0]) ? values[0] : null;
};
/** New explicit scope never changes the existing DV-only activity route. */
export function readDocumentGraphEntry(params: URLSearchParams): DocumentGraphEntry {
  if (!params.has('scope')) return params.has('readerWorkItemId') ? { kind: 'invalid' } : { kind: 'absent' };
  if (singleIdentity(params, 'scope') !== 'document') return { kind: 'invalid' };
  if (['matterId', 'workItemId', 'workRef', 'parseRunId', 'candidateRevision', 'runRef',
    'statementId', 'anchor', 'window', 'projection'].some(key => params.has(key))) return { kind: 'invalid' };
  if (['familyCursor', 'matterCursor'].some(name => {
    const values = params.getAll(name);
    return values.length > 1 || (values.length === 1 && (!values[0] || values[0].length > 2400 || /[\u0000-\u001f\u007f]/u.test(values[0])));
  })) return { kind: 'invalid' };
  if (params.getAll('returnLibrarySnapshot').length > 1 || (params.has('returnLibrarySnapshot') && !isLibraryGraphReturnToken(params.get('returnLibrarySnapshot')!))) return {kind: 'invalid'};
  const documentVersionId = singleIdentity(params, 'documentVersionId');
  const readerWorkItemId = params.has('readerWorkItemId') ? singleIdentity(params, 'readerWorkItemId') : undefined;
  if (!documentVersionId || readerWorkItemId === null) return { kind: 'invalid' };
  return { kind: 'document', documentVersionId, readerWorkItemId };
}
