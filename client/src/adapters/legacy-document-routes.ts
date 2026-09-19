import { revisionTextPin } from '@client/src/features/matter/reading-return';
import { validateRevisionEntry } from '@client/src/pages/DocumentParsingPage/document-revision-entry';

export type LegacyDocumentTarget =
  | { route: string; reason?: never }
  | { reason: string; route?: never };

function exactVersionId(value: string | undefined): string | null {
  if (!value) return null;
  const pin = revisionTextPin(new URLSearchParams({ version: value }), 'version');
  return pin.state === 'ok' && pin.value === value ? value : null;
}

function compatiblePin(
  params: URLSearchParams,
  canonical: string,
  legacy: string,
): { value: string | null; error: boolean } {
  const current = revisionTextPin(params, canonical);
  const old = revisionTextPin(params, legacy);
  if (current.state !== 'absent' && old.state !== 'absent')
    return { value: null, error: true };
  const pin = current.state === 'absent' ? old : current;
  const raw = params.get(current.state === 'absent' ? legacy : canonical);
  return pin.state === 'absent'
    ? { value: null, error: false }
    : pin.state === 'ok'
      ? { value: pin.value, error: raw !== pin.value }
      : { value: null, error: true };
}

export function legacyReaderTarget(
  documentId: string | undefined,
  params: URLSearchParams,
  hash = '',
): LegacyDocumentTarget {
  const version = exactVersionId(documentId);
  if (!version) return { reason: '缺少准确的文档版本标识。' };
  const explicitVersion = revisionTextPin(params, 'documentVersionId');
  if (explicitVersion.state !== 'absent' &&
    (explicitVersion.state !== 'ok' || explicitVersion.value !== version ||
      params.get('documentVersionId') !== version))
    return { reason: '链接中的文档版本与路径不一致。' };
  const run = compatiblePin(params, 'parseRunId', 'parse');
  const source = compatiblePin(params, 'sourceRef', 'source');
  if (run.error || source.error)
    return { reason: '解析版本或原文位置重复、为空或不合法，无法安全定位。' };
  if (source.value && !run.value)
    return { reason: '准确原文位置需要同时指定解析版本。' };
  const next = new URLSearchParams(params);
  next.delete('parse');
  next.delete('source');
  next.delete('documentVersionId');
  if (run.value) next.set('parseRunId', run.value);
  if (source.value) next.set('sourceRef', source.value);
  const query = next.toString();
  return {
    route: `/document-versions/${encodeURIComponent(version)}${query ? `?${query}` : ''}${hash}`,
  };
}

export function legacyComparisonTarget(
  documentId: string | undefined,
  params: URLSearchParams,
  hash = '',
): LegacyDocumentTarget {
  const version = exactVersionId(documentId);
  if (!version) return { reason: '缺少准确的比较目标版本。' };
  const entry = validateRevisionEntry(params);
  if (entry.ok === false) return { reason: entry.reason };
  if (entry.after.documentVersionId !== version)
    return { reason: '路径中的比较目标与链接指定的新版不一致。' };
  return { route: `/document-revisions?${params.toString()}${hash}` };
}
