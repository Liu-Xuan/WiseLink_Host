import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

const labelFor = (entry: EngineeringMatterCatalogEntry): string =>
  `${entry.document.documentCode} · ${entry.document.businessRevision}`;

/**
 * Loads saved source-declared activity candidates for authorized catalog documents.
 * Only the selected source is read by default; other sources load on explicit user
 * expand. GET reads never generate candidates and never call BEGIN. Responses whose
 * binding does not match the exact request are discarded; session changes abort
 * in-flight reads and drop late responses; revoked access clears the source.
 */
export function useSuiteGraphSources(input: {
  catalog: EngineeringMatterCatalogEntry[];
  /** False for exact historical work views: no current reads are attached then. */
  enabled: boolean;
  session: number;
  denied: boolean;
  restorePins?: SuiteGraphTimelineEventPins;
}) {
  const key = useMemo(
    () => JSON.stringify([
      input.catalog.map((entry) => entry.document.documentVersionId),
      input.session,
      input.enabled,
      input.denied,
      input.restorePins ?? null,
    ]),
    [input.catalog, input.session, input.enabled, input.denied, input.restorePins],
  );
  const [records, setRecords] = useState<ReadonlyMap<string, SourceRecord>>(new Map());
  const [loadingIds, setLoadingIds] = useState<ReadonlySet<string>>(new Set());
  const generationRef = useRef(0);
  const controllersRef = useRef(new Map<string, AbortController>());

  useEffect(() => {
    generationRef.current += 1;
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
  ) => {
    if (!input.enabled || input.denied) return;
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
    void (async () => {
      if (exactPins) {
        const reading = await readDocumentActivityReading({
          documentVersionId,
          parseRunId: exactPins.parseRunId,
          candidateRevision: exactPins.candidateRevision,
        }, controller.signal);
        if (
          reading.familyId !== exactPins.familyId
          || !reading.candidate
          || reading.candidate.runRef !== exactPins.runRef
          || !reading.candidate.statements.some(
            (statement) => statement.statementId === exactPins.statementId,
          )
        ) {
          finish({
            status: 'unavailable',
            notice: '原时间节点的保存候选已不可读；未改用当前候选。',
            candidate: null,
          });
          return;
        }
        finish({
          status: 'loaded',
          notice: null,
          candidate: { candidate: reading.candidate, familyId: reading.familyId },
        });
        return;
      }
      const status = await readDocumentParsingStatus(documentVersionId, controller.signal);
      const publishedRun = status.publishedRun;
      if (!publishedRun) {
        finish({ status: 'unparsed', notice: '该版本尚无已发布解析，没有可读的保存声明。', candidate: null });
        return;
      }
      const reading = await readDocumentActivityReading(
        { documentVersionId, parseRunId: publishedRun.parseRunId },
        controller.signal,
      );
      if (reading.binding.documentVersionId !== documentVersionId || reading.binding.parseRunId !== publishedRun.parseRunId) {
        finish({ status: 'unavailable', notice: '读取响应与请求来源不一致，已丢弃。', candidate: null });
        return;
      }
      if (!reading.candidate) {
        finish({ status: 'empty', notice: '该精确来源没有已保存的时间声明，不代表文件无活动。', candidate: null });
        return;
      }
      finish({
        status: 'loaded',
        notice: null,
        candidate: { candidate: reading.candidate, familyId: reading.familyId },
      });
    })().catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      const message = cause instanceof Error ? cause.message : '';
      const revoked = /401|403|404|UNAUTHORIZED|FORBIDDEN|NOT_FOUND/u.test(message);
      finish({
        status: 'unavailable',
        notice: revoked ? '该来源当前不可读，相关声明已从列表清除。' : '读取该来源声明失败，可重试。',
        candidate: null,
      });
    });
  }, [input.enabled, input.denied, input.session]);

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
    if (!input.enabled || input.denied || !activeSourceId) return;
    if (records.has(activeSourceId) || loadingIds.has(activeSourceId)) return;
    const entry = input.catalog.find((item) => item.document.documentVersionId === activeSourceId);
    if (entry) {
      const exactPins = input.restorePins?.documentVersionId === activeSourceId
        ? input.restorePins
        : undefined;
      loadSource(entry, exactPins);
    }
  }, [
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
      const record = records.get(documentVersionId);
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
  }, [input.catalog, input.restorePins, records, loadingIds]);

  const activities = useMemo(() => {
    const map = new Map<string, SuiteGraphActivityCandidate>();
    records.forEach((record, documentVersionId) => {
      if (record.status === 'loaded' && record.candidate) map.set(documentVersionId, record.candidate);
    });
    return map;
  }, [records]);

  const expandSource = useCallback((documentVersionId: string) => {
    const entry = input.catalog.find((item) => item.document.documentVersionId === documentVersionId);
    if (entry) {
      loadSource(
        entry,
        input.restorePins?.documentVersionId === documentVersionId
          ? input.restorePins
          : undefined,
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
