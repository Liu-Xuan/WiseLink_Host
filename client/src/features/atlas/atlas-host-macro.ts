import type { CanonicalLibraryGraphRequest } from '@shared/library-graph.interface';
import { buildLibraryMacroGraph } from '@client/src/pages/RelationGraphPage/library-macro-graph';
import { readLibraryMacro } from '@client/src/pages/RelationGraphPage/library-macro-read';
import type { AtlasLocation } from './atlas-model';

export const isAtlasHostMacroView = (location: AtlasLocation) =>
  location.space === 'HOST' && ['panorama', 'domain'].includes(location.view);

export function atlasHostMacroRequest(
  location: AtlasLocation,
): CanonicalLibraryGraphRequest {
  return {
    level: 'clusters',
    groupBy: 'ata',
    ...(location.search.trim() ? { search: location.search.trim() } : {}),
    ...(location.view === 'domain' && location.hostAta
      ? { ata: location.hostAta }
      : {}),
  };
}

/** The same authorized catalog read and display projection as the full-library page. */
export async function readAtlasHostMacro(
  location: AtlasLocation,
  signal: AbortSignal,
) {
  const request = atlasHostMacroRequest(location);
  const read = await readLibraryMacro(request, signal);
  const projection = buildLibraryMacroGraph(
    read,
    'ata',
    Boolean(request.level === 'clusters' && (request.search || request.ata)),
  );
  projection.graph.notices = [
    ...read.issues,
    '文档引用尚未建立全库索引。',
    ...(projection.outsideLinks
      ? [`${projection.outsideLinks} 项登记资料在当前文档范围之外。`]
      : []),
  ];
  return { ...projection, read };
}

export type AtlasHostMacro = Awaited<ReturnType<typeof readAtlasHostMacro>>;

export const atlasMacroCoverageLabel = {
  COMPLETE: '已读完本次范围',
  PARTIAL: '部分读取',
  READ_FAILED: '读取失败',
  NOT_AUTHORIZED: '无权限或不可访问',
  NOT_LOADED: '未读取',
  NOT_INDEXED: '未建立全库索引',
} as const;

export function atlasHostAtaValues(macro?: AtlasHostMacro) {
  return [
    ...new Set(
      macro?.read.documents.flatMap((document) =>
        document.versions.flatMap(
          (version) =>
            version.extractedMetadata?.ata.observations
              .map((observation) => observation.value)
              .filter(Boolean) ?? [],
        ),
      ) ?? [],
    ),
  ];
}
