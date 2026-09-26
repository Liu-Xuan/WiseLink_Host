import { createHash } from 'node:crypto';
import type { MineruParseResult } from '../../../../professional-input/mineru/mineru-artifact-store';
import { readMineruArtifacts, safeMineruAssetPath } from '../../../../professional-input/mineru/mineru-artifacts';

export type LocalMineruResult = Pick<MineruParseResult, 'sourceSha256' | 'sourceByteLength' | 'rawArtifacts' | 'assets'> & { titleEnhancement?: LocalMineruTitleReceipt };
export type LocalMineruTitleReceipt =
  | { status: 'APPLIED'; levels: Array<{ id: string; level: number }>; provider: { model: string; endpointOrigin: string } }
  | { status: 'DISABLED' | 'NOT_APPLICABLE' }
  | { status: 'FAILED'; code: string };
/** The uploaded package is candidate data, never Host business identity or authorization. */
export function readLocalMineruCandidate(bytes: Uint8Array): LocalMineruResult {
  if (!bytes.length || bytes.length > 64 * 1024 * 1024) fail();
  const parsed: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
  const hasTitle = parsed && typeof parsed === 'object' && 'titleEnhancement' in parsed;
  const candidate = object(parsed, ['schemaVersion', 'source', 'parser', 'raw', 'assets', ...(hasTitle ? ['titleEnhancement'] : [])]);
  if (candidate.schemaVersion !== 'wiselink.mineru.local-candidate.v1') fail();
  const source = object(candidate.source, ['sha256', 'byteLength']);
  const parser = object(candidate.parser, ['version', 'backend']);
  const raw = object(candidate.raw, ['markdown', 'contentListV2', 'middle']);
  if (typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256) ||
      !Number.isSafeInteger(source.byteLength) || Number(source.byteLength) < 1 ||
      typeof raw.markdown !== 'string' || !Array.isArray(candidate.assets) || candidate.assets.length > 1024) fail();
  const paths = new Set<string>();
  const assets = candidate.assets.map((value: unknown) => {
    const asset = object(value, ['path', 'mediaType', 'sha256', 'byteLength', 'base64']);
    if (typeof asset.path !== 'string' || typeof asset.base64 !== 'string' ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(asset.base64) ||
        !['image/png', 'image/jpeg', 'image/webp'].includes(String(asset.mediaType))) fail();
    const path = safeMineruAssetPath(asset.path);
    if (paths.has(path)) fail();
    paths.add(path);
    const content = Buffer.from(asset.base64, 'base64');
    const actualType = content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
      : content[0] === 255 && content[1] === 216 && content[2] === 255 ? 'image/jpeg'
        : content.subarray(0, 4).toString() === 'RIFF' && content.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : null;
    if (actualType !== asset.mediaType) fail();
    const sha256 = createHash('sha256').update(content).digest('hex');
    if (!content.length || content.length > 32 * 1024 * 1024 || content.length !== asset.byteLength || sha256 !== asset.sha256) fail();
    return { path, bytes: new Uint8Array(content), mediaType: asset.mediaType as 'image/png' | 'image/jpeg' | 'image/webp', sha256 };
  });
  const rawArtifacts = { markdown: raw.markdown, contentListV2: raw.contentListV2, middle: raw.middle };
  const document = readMineruArtifacts({ ...rawArtifacts, assetPaths: assets.map(asset => asset.path) });
  if (document.version !== parser.version || document.backend !== parser.backend) fail();
  return { sourceSha256: source.sha256, sourceByteLength: Number(source.byteLength), rawArtifacts, assets, ...(hasTitle ? { titleEnhancement: titleReceipt(candidate.titleEnhancement) } : {}) };
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) fail();
  return value as Record<string, unknown>;
}
function fail(): never { throw new Error('DOCUMENT_MINERU_CANDIDATE_INVALID'); }

function titleReceipt(value: unknown): LocalMineruTitleReceipt {
  if (!value || typeof value !== 'object' || !('status' in value)) fail();
  if (value.status === 'DISABLED' || value.status === 'NOT_APPLICABLE') {
    object(value, ['status']); return { status: value.status };
  }
  if (value.status === 'FAILED') {
    const item = object(value, ['status', 'code']);
    if (typeof item.code !== 'string' || !/^[A-Z][A-Z0-9_]{1,159}$/.test(item.code)) fail();
    return { status: 'FAILED', code: item.code };
  }
  const item = object(value, ['status', 'levels', 'provider']);
  if (item.status !== 'APPLIED' || !Array.isArray(item.levels) || item.levels.length > 256) fail();
  const provider = object(item.provider, ['model', 'endpointOrigin']);
  if (typeof provider.model !== 'string' || !provider.model.trim() || provider.model.length > 200 || typeof provider.endpointOrigin !== 'string') fail();
  const url = new URL(provider.endpointOrigin);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== provider.endpointOrigin || url.username || url.password) fail();
  const levels = item.levels.map((entry: unknown) => {
    const level = object(entry, ['id', 'level']);
    if (typeof level.id !== 'string' || level.id.length > 160 || !Number.isSafeInteger(level.level) || Number(level.level) < 1 || Number(level.level) > 6) fail();
    return { id: level.id, level: Number(level.level) };
  });
  return { status: 'APPLIED', levels, provider: { model: provider.model, endpointOrigin: provider.endpointOrigin } };
}
