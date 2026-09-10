import { useEffect, useState } from 'react';
import {
  getCanonicalLibraryDocuments,
  getCanonicalLibraryQuicklook,
  getRelatedContextPreview,
  getCanonicalHostClientSessionGeneration,
  summarizeCanonicalDocumentReadFailure,
  isCanonicalObjectNotFound,
} from '@client/src/api/canonical-host';
import { getEngineeringMatterWorkspace } from '@client/src/api/engineering-matter';
import type {
  CanonicalLibraryQuicklookResponse,
  CanonicalRelatedContextPreviewResponse,
} from '@shared/api.interface';
import {
  catalogGraph,
  documentGraph,
  type AtlasGraph,
  type AtlasLocation,
} from './atlas-model';
import { libraryReadErrorPresentation } from '@client/src/pages/WorkspaceHomePage/library-read-error';
import type { AssessmentReadingResult } from '@shared/assessment-reading.interface';
export interface AtlasHostRead {
  key: string;
  graph: AtlasGraph;
  quicklook?: CanonicalLibraryQuicklookResponse;
  preview?: CanonicalRelatedContextPreviewResponse;
  reading?: AssessmentReadingResult | null;
  nextCursor?: string | null;
  loading: boolean;
  error?: string;
  readMs?: number;
}
export function atlasReadKey(location: AtlasLocation, session: number) {
  return JSON.stringify([
    session,
    location.space,
    location.view,
    location.focus,
    location.search,
    location.cursor,
  ]);
}
export function useAtlasHost(
  location: AtlasLocation,
  session: number,
  authenticationRequired: boolean,
  retry: number,
) {
  const [read, setRead] = useState<AtlasHostRead | null>(null);
  const key = atlasReadKey(location, session);
  useEffect(() => {
    if (location.space !== 'HOST' || authenticationRequired) return;
    const controller = new AbortController();
    const current = () =>
      !controller.signal.aborted &&
      getCanonicalHostClientSessionGeneration() === session;
    const empty: AtlasHostRead = {
      key,
      graph: { nodes: [], edges: [], notices: [] },
      loading: true,
    };
    setRead(empty);
    const start = performance.now();
    async function load(): Promise<AtlasHostRead> {
      if (location.view === 'classification')
        return {
          ...empty,
          loading: false,
          graph: {
            nodes: [],
            edges: [],
            notices: ['附件分类供原值与来源核对，不映射实际机队构型。'],
          },
        };
      if (
        ['documents', 'family', 'library', 'source'].includes(location.view)
      ) {
        if (location.focus && location.view !== 'family') {
          const quicklook = await getCanonicalLibraryQuicklook(
            location.focus,
            controller.signal,
          );
          let preview: CanonicalRelatedContextPreviewResponse | undefined;
          let error: string | undefined;
          try {
            preview = await getRelatedContextPreview(
              location.focus,
              quicklook.document.revision,
            );
          } catch (reason) {
            const p = summarizeCanonicalDocumentReadFailure(reason);
            if (
              isCanonicalObjectNotFound(reason) ||
              [401, 403, 404].includes(p.statusCode ?? 0)
            )
              throw reason;
            error = '显式引用读取失败，保留已读取文档与意见。';
          }
          return {
            ...empty,
            loading: false,
            graph: documentGraph(quicklook, preview ?? null),
            quicklook,
            preview,
            reading: quicklook.result?.readingResult,
            error,
          };
        }
        const familyQuicklook =
          location.view === 'family' && location.focus
            ? await getCanonicalLibraryQuicklook(
                location.focus,
                controller.signal,
              )
            : null;
        const catalog = await getCanonicalLibraryDocuments(
          {
            search:
              familyQuicklook?.document.documentCode ||
              location.search ||
              undefined,
            cursor: location.cursor || undefined,
            limit: 20,
          },
          controller.signal,
        );
        const graph = catalogGraph(catalog);
        if (location.view === 'family' && location.focus) {
          const q = familyQuicklook!;
          const ids = new Set(
            graph.nodes
              .filter((n) => n.familyId === q.document.familyId)
              .map((n) => n.id),
          );
          graph.nodes = graph.nodes.filter((n) => ids.has(n.id));
          graph.edges = graph.edges.filter(
            (e) => ids.has(e.source) && ids.has(e.target),
          );
          if (!graph.nodes.length)
            graph.notices.push(
              '所选文档族不在当前目录页，可返回资料库按文档族读取。',
            );
        }
        return {
          ...empty,
          loading: false,
          graph,
          nextCursor: catalog.nextCursor,
        };
      }
      if (location.view === 'matter' && location.focus) {
        const workspace = await getEngineeringMatterWorkspace(
          location.focus,
          controller.signal,
        );
        const graph: AtlasGraph = {
          nodes: [
            {
              id: workspace.matter.matterId,
              kind: 'matter',
              code: '工程事项',
              title: workspace.matter.title,
              sourceRefs: [],
            },
          ],
          edges: [],
          notices: [
            '仅显示 Host 已登记事项材料；对象实施与跨事项全景尚未接通。',
          ],
        };
        for (const entry of workspace.matter.catalog.entries) {
          graph.nodes.push({
            id: entry.document.documentVersionId,
            documentVersionId: entry.document.documentVersionId,
            workItemId: entry.workItemId,
            kind: 'document',
            code: entry.document.documentCode,
            title: entry.document.documentCode,
            sourceRefs: [],
          });
          graph.edges.push({
            id: `member:${entry.workItemId}`,
            source: workspace.matter.matterId,
            target: entry.document.documentVersionId,
            kind: '事项材料',
            sourceRefs: [],
          });
        }
        return {
          ...empty,
          loading: false,
          graph,
          reading: workspace.working.current?.state.substantiveResult,
        };
      }
      return {
        ...empty,
        loading: false,
        graph: {
          nodes: [],
          edges: [],
          notices: [
            '当前真实空间此视图尚未接线。可明确切换到独立示例空间查看设计，不代表真实机队数据。',
          ],
        },
      };
    }
    void load()
      .then((result) => {
        if (current())
          setRead({ ...result, readMs: Math.round(performance.now() - start) });
      })
      .catch((reason) => {
        if (current())
          setRead({
            ...empty,
            loading: false,
            error: libraryReadErrorPresentation(reason).message,
          });
      });
    return () => controller.abort();
  }, [
    key,
    retry,
    authenticationRequired,
    session,
    location.space,
    location.view,
    location.focus,
    location.search,
    location.cursor,
  ]);
  return authenticationRequired
    ? {
        key,
        graph: { nodes: [], edges: [], notices: [] },
        loading: false,
        error: '请先登录以读取授权工程资料。',
      }
    : read?.key === key
      ? read
      : { key, graph: { nodes: [], edges: [], notices: [] }, loading: true };
}
