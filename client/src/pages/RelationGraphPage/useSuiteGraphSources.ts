import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ENGINEERING_MATTER_QUERY_ROOT, useEngineeringMatterQueryIdentity } from '@client/src/features/matter/useEngineeringMatter';
import type { EngineeringMatterCatalogEntry } from '@shared/api.interface';
import {
  getCanonicalHostClientSessionGeneration,
  readDocumentActivityReading,
  readDocumentParsingStatus,
} from '@client/src/api/canonical-host';
import type { SuiteGraphActivityCandidate } from './suite-matter-graph';
import type {
  SuiteGraphTimelineEventPins,
  SuiteGraphTimelineSource,
  SuiteGraphTimelineSourceStatus,
} from './suite-graph-timeline';

interface SourceRecord {
  status: SuiteGraphTimelineSourceStatus;
  notice: string | null;
  candidate: SuiteGraphActivityCandidate | null;
}

const EMPTY_RECORDS: ReadonlyMap<string, SourceRecord> = new Map();

const labelFor = (entry: EngineeringMatterCatalogEntry): string =>
  `${entry.document.documentCode} · ${entry.document.businessRevision}`;

/**
 * Loads saved source-declared activity candidates for authorized catalog documents.
 * Only the selected source is read by default; other sources load on explicit user
 * expand. GET reads never generate candidates and never call BEGIN. Responses whose
 * binding does not match the exact request are discarded; session changes abort
 * shared queries through the existing session cleanup and drop late responses; revoked access clears the source.
 * Fresh results live in the existing identity-scoped QueryClient for 30 seconds,
 * with five-minute GC. Explicit refresh bypasses freshness; no permission grant
 * is cached. An unmounted subscriber cannot publish a late result.
 */
export function useSuiteGraphSources(input: {
  catalog: EngineeringMatterCatalogEntry[];
  /** False for exact historical work views: no current reads are attached then. */
  enabled: boolean;
  session: number;
  denied: boolean;
  restorePins?: SuiteGraphTimelineEventPins;
}) {
  const queryClient = useQueryClient();
  const { identity: resolvedIdentity, identityQuery } = useEngineeringMatterQueryIdentity(input.enabled && !input.denied, input.session);
  const identity = identityQuery.error ? null : resolvedIdentity;
  const identityKey = identity ? JSON.stringify(identity) : null;
  const key = useMemo(
    () => JSON.stringify([
      identityKey,
      input.catalog.map((entry) => entry.document.documentVersionId),
      input.session,
      input.enabled,
      input.denied,
      input.restorePins ?? null,
    ]),
    [identityKey, input.catalog, input.session, input.enabled, input.denied, input.restorePins],
  );
  const [records, setRecords] = useState<ReadonlyMap<string, SourceRecord>>(new Map());
  const [loadingIds, setLoadingIds] = useState<ReadonlySet<string>>(new Set());
  const generationRef = useRef(0);
  const recordsKey = useRef(key);
  const visibleRecords = recordsKey.current === key && identity && input.enabled && !input.denied ? records : EMPTY_RECORDS;
  const controllersRef = useRef(new Map<string, AbortController>());

  useEffect(() => {
    generationRef.current += 1;
    recordsKey.current = key;
    setRecords(new Map());
    setLoadingIds(new Set());
    const controllers = controllersRef.current;
    return () => {
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    };
  }, [key]);

  const loadSource = useCallback((
    entry: EngineeringMatterCatalogEntry,
    exactPins?: SuiteGraphTimelineEventPins,
    force = false,
  ) => {
    if (!input.enabled || input.denied || !identity) return;
    const documentVersionId = entry.document.documentVersionId;
    const generation = generationRef.current;
    controllersRef.current.get(documentVersionId)?.abort();
    const controller = new AbortController();
    controllersRef.current.set(documentVersionId, controller);
    setLoadingIds((current) => new Set(current).add(documentVersionId));
    setRecords((current) => {
      const next = new Map(current);
      next.set(documentVersionId, { status: 'loading', notice: null, candidate: null });
      return next;
    });
    const finish = (record: SourceRecord) => {
      if (controller.signal.aborted) return;
      if (generation !== generationRef.current || getCanonicalHostClientSessionGeneration() !== input.session) return;
      setRecords((current) => new Map(current).set(documentVersionId, record));
      setLoadingIds((current) => {
        const next = new Set(current);
        next.delete(documentVersionId);
        return next;
      });
    };
    const read = async (signal: AbortSignal): Promise<SourceRecord> => {
      if (exactPins) {
        const reading = await readDocumentActivityReading({
          documentVersionId,
          parseRunId: exactPins.parseRunId,
          candidateRevision: exactPins.candidateRevision,
        }, signal);
        if (
          reading.binding.documentVersionId !== documentVersionId
          || reading.binding.parseRunId !== exactPins.parseRunId
          || reading.candidate?.candidateRevision !== exactPins.candidateRevision
          || reading.familyId !== exactPins.familyId
          || !reading.candidate
          || reading.candidate.runRef !== exactPins.runRef
          || !reading.candidate.statements.some(
            (statement) => statement.statementId === exactPins.statementId,
          )
        ) {
          return {
            status: 'unavailable',
            notice: '原时间节点的保存候选已不可读；未改用当前候选。',
            candidate: null,
          };
        }
        return {
          status: 'loaded',
          notice: null,
          candidate: { candidate: reading.candidate, familyId: reading.familyId },
        };
      }
      const status = await readDocumentParsingStatus(documentVersionId, signal);
      if (signal.aborted || getCanonicalHostClientSessionGeneration() !== input.session) {
        throw Object.assign(new Error('登录状态已变化。'), { name: 'AbortError' });
      }
      const publishedRun = status.publishedRun;
      if (!publishedRun) {
        return { status: 'unparsed', notice: '该版本尚无已发布解析，没有可读的保存声明。', candidate: null };
      }
      const reading = await readDocumentActivityReading(
        { documentVersionId, parseRunId: publishedRun.parseRunId },
        signal,
      );
      if (reading.binding.documentVersionId !== documentVersionId || reading.binding.parseRunId !== publishedRun.parseRunId) {
        return { status: 'unavailable', notice: '读取响应与请求来源不一致，已丢弃。', candidate: null };
      }
      if (!reading.candidate) {
        return { status: 'empty', notice: '该精确来源没有已保存的时间声明，不代表文件无活动。', candidate: null };
      }
      return {
        status: 'loaded',
        notice: null,
        candidate: { candidate: reading.candidate, familyId: reading.familyId },
      };
    };
    void queryClient.fetchQuery({
      queryKey: [...ENGINEERING_MATTER_QUERY_ROOT, 'graph-source', identity.appId,
        identity.tenantId, identity.actorId, input.session, documentVersionId, exactPins ?? null],
      staleTime: force ? 0 : 30_000,
      gcTime: 5 * 60_000,
      retry: false,
      queryFn: async ({ signal }): Promise<SourceRecord> => {
        try {
          const record = await read(signal);
          if (signal.aborted || getCanonicalHostClientSessionGeneration() !== input.session) {
            throw Object.assign(new Error('登录状态已变化。'), { name: 'AbortError' });
          }
          return record;
        } catch (cause: unknown) {
          if (signal.aborted || getCanonicalHostClientSessionGeneration() !== input.session) throw cause;
          const message = cause instanceof Error ? cause.message : '';
          const statusCode = cause && typeof cause === 'object' && 'statusCode' in cause ? cause.statusCode : null;
          const revoked = [401, 403, 404].includes(Number(statusCode)) || /401|403|404|UNAUTHORIZED|FORBIDDEN|NOT_FOUND/u.test(message);
          return { status: 'unavailable', candidate: null,
            notice: revoked ? '该来源当前不可读，相关声明已从列表清除。' : '读取该来源声明失败，可重试。' };
        }
      },
    }).then(finish).catch(() => {
      finish({ status: 'unavailable', candidate: null, notice: '读取该来源声明失败，可重试。' });
    });
  }, [input.enabled, input.denied, input.session, identity, queryClient]);

  const restorableSourceId = input.restorePins
    && input.catalog.some(
      (entry) => entry.document.documentVersionId === input.restorePins?.documentVersionId,
    )
    ? input.restorePins.documentVersionId
    : null;
  const defaultSourceId = restorableSourceId
    ?? input.catalog[0]?.document.documentVersionId
    ?? null;
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  useEffect(() => {
    setSelectedSourceId(null);
  }, [key]);
  const activeSourceId = selectedSourceId && input.catalog.some((entry) => entry.document.documentVersionId === selectedSourceId)
    ? selectedSourceId
    : defaultSourceId;

  useEffect(() => {
    if (!input.enabled || input.denied || !identity || !activeSourceId) return;
    if (records.has(activeSourceId) || loadingIds.has(activeSourceId)) return;
    const entry = input.catalog.find((item) => item.document.documentVersionId === activeSourceId);
    if (entry) {
      const exactPins = input.restorePins?.documentVersionId === activeSourceId
        ? input.restorePins
        : undefined;
      loadSource(entry, exactPins);
    }
  }, [
    identity,
    input.enabled,
    input.denied,
    input.restorePins,
    activeSourceId,
    records,
    loadingIds,
    input.catalog,
    loadSource,
  ]);

  const sources = useMemo<SuiteGraphTimelineSource[]>(() => {
    const items = input.catalog.map((entry) => {
      const documentVersionId = entry.document.documentVersionId;
      const record = visibleRecords.get(documentVersionId);
      return {
        documentVersionId,
        label: labelFor(entry),
        status: record?.status
          ?? (loadingIds.has(documentVersionId) ? 'loading' : 'skipped'),
        notice: record?.notice ?? null,
      };
    });
    if (
      input.restorePins
      && !input.catalog.some(
        (entry) => entry.document.documentVersionId
          === input.restorePins?.documentVersionId,
      )
    ) {
      items.push({
        documentVersionId: input.restorePins.documentVersionId,
        label: '原时间节点来源',
        status: 'unavailable',
        notice: '原时间节点来源已不在当前授权目录；未改用其他来源。',
      });
    }
    return items;
  }, [input.catalog, input.restorePins, visibleRecords, loadingIds]);

  const activities = useMemo(() => {
    const map = new Map<string, SuiteGraphActivityCandidate>();
    visibleRecords.forEach((record, documentVersionId) => {
      if (record.status === 'loaded' && record.candidate) map.set(documentVersionId, record.candidate);
    });
    return map;
  }, [visibleRecords]);

  const expandSource = useCallback((documentVersionId: string) => {
    const entry = input.catalog.find((item) => item.document.documentVersionId === documentVersionId);
    if (entry) {
      loadSource(
        entry,
        input.restorePins?.documentVersionId === documentVersionId
          ? input.restorePins
          : undefined,
        true,
      );
    }
  }, [input.catalog, input.restorePins, loadSource]);

  return {
    activities,
    sources,
    loading: loadingIds.size > 0,
    activeSourceId,
    selectSource: setSelectedSourceId,
    expandSource,
  };
}
