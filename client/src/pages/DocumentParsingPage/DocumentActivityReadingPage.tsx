import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { Badge } from '@client/src/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@client/src/components/ui/card';
import {
  readDocumentActivityReading,
  readDocumentParsingStatus,
  subscribeCanonicalHostClientSession,
} from '@client/src/api/canonical-host';
import {
  activityReaderParams,
  activityReadingReturnParams,
  libraryReadingParams,
  readingReturnTarget,
} from '@client/src/features/matter/reading-return';
import type { DocumentActivityReadingResponse } from '@shared/document-activity.interface';
import type { DocumentOriginalBinding } from '@shared/document-original.interface';

import {
  activityEntryPins,
  activityEntryReason,
  activitySelectionQuery,
  loadActivityEntry,
  validateActivityEntry,
} from './document-activity-entry';
import DocumentActivityReadingView from './DocumentActivityReadingView';

export default function DocumentActivityReadingPage() {
  const { documentVersionId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const entry = useMemo(() => validateActivityEntry(searchParams), [searchParams]);
  const entryBlocker = activityEntryReason(entry);
  const pins = activityEntryPins(entry);
  // The load identity is the exact pin set; selecting a statement or an anchor changes
  // the selection pins and therefore reloads under a fresh identity.
  const pinsIdentity = JSON.stringify([
    documentVersionId,
    pins.parseRunId ?? '',
    pins.candidateRevision ?? '',
    pins.runRef ?? '',
    pins.statementId ?? '',
    pins.anchor ?? '',
  ]);

  const [savedReading, setReading] = useState<{ identity: string; value: DocumentActivityReadingResponse } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unreadable, setUnreadable] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const epoch = useRef(0);
  const identity = useRef(pinsIdentity);
  identity.current = pinsIdentity;
  const readingIdentity = JSON.stringify([pinsIdentity, refresh]);
  const reading = entry.ok && savedReading?.identity === readingIdentity ? savedReading.value : null;
  const candidate = reading?.candidate ?? null;

  useEffect(() => {
    epoch.current++;
    setReading(null);
    setError(null);
    setUnreadable(null);
    setLoading(false);
    return subscribeCanonicalHostClientSession(() => {
      epoch.current++;
      setReading(null);
      setError(null);
      setUnreadable(null);
      setLoading(false);
      setRefresh((value) => value + 1);
    });
  }, [pinsIdentity]);

  useEffect(() => {
    const controller = new AbortController();
    const generation = epoch.current;
    const current = () =>
      !controller.signal.aborted &&
      identity.current === pinsIdentity &&
      epoch.current === generation;
    const run = async () => {
      setLoading(true);
      setReading(null);
      setError(null);
      setUnreadable(null);
      if (entryBlocker) {
        setLoading(false);
        return;
      }
      if (!documentVersionId) {
        if (!current()) return;
        setError('缺少文档版本，无法进行活动阅读。');
        setLoading(false);
        return;
      }
      try {
        const result = await loadActivityEntry({
          documentVersionId,
          entry,
          baseParams: searchParams,
          deps: {
            readParsingStatus: readDocumentParsingStatus,
            readActivityReading: readDocumentActivityReading,
          },
          signal: controller.signal,
          current,
        });
        if (!current()) return;
        if (result.replaceQuery) {
          navigate(
            `/document-versions/${encodeURIComponent(documentVersionId)}/activities?${result.replaceQuery}`,
            { replace: true },
          );
          return;
        }
        if (result.error) {
          setError(result.error);
          setLoading(false);
          return;
        }
        if (result.unreadable) {
          setUnreadable(result.unreadable);
          setLoading(false);
          return;
        }
        if (result.reading) setReading({ identity: readingIdentity, value: result.reading });
        setLoading(false);
      } catch (reason) {
        if (!current()) return;
        setError(reason instanceof Error ? reason.message : '活动阅读读取未完成，请重试。');
        setLoading(false);
      }
    };
    void run();
    return () => {
      controller.abort();
    };
  }, [pinsIdentity, refresh, entryBlocker, documentVersionId]);

  const selectStatement = (statementId: string) => {
    navigate(
      `/document-versions/${encodeURIComponent(documentVersionId)}/activities?${activitySelectionQuery(searchParams, documentVersionId, { statementId })}`,
      { replace: true },
    );
  };

  const selectAnchor = (anchorId: string) => {
    navigate(
      `/document-versions/${encodeURIComponent(documentVersionId)}/activities?${activitySelectionQuery(searchParams, documentVersionId, { anchor: anchorId })}`,
      { replace: true },
    );
  };

  const returnParamsFor = (
    bound: DocumentOriginalBinding,
    statementId: string | null = null,
    anchorId: string | null = null,
  ): string | null => {
    // The return identity comes from the loaded candidate, never from the current URL:
    // a source clicked under statement ST2 must return with ST2 even if the URL still
    // pins ST1 (or nothing), and a candidate-level anchor never fabricates a statement.
    if (!reading || !candidate) return null;
    if (bound.documentVersionId !== documentVersionId) return null;
    if (bound.parseRunId !== reading.binding.parseRunId) return null;
    const params = activityReaderParams(searchParams, documentVersionId);
    params.set('parseRunId', reading.binding.parseRunId);
    params.set('candidateRevision', String(candidate.candidateRevision));
    params.set('runRef', candidate.runRef);
    if (statementId) params.set('statementId', statementId);
    else params.delete('statementId');
    if (anchorId) params.set('anchor', anchorId);
    else params.delete('anchor');
    return activityReadingReturnParams(params.toString(), bound.documentVersionId).toString();
  };

  const returnLibraryQuery = searchParams.get('returnLibraryQuery');
  const libraryReturnRoute = returnLibraryQuery
    ? `/library?${libraryReadingParams(new URLSearchParams(returnLibraryQuery)).toString()}`
    : '/library?mode=document';
  const returnTarget = readingReturnTarget(searchParams, documentVersionId, pins.parseRunId);

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4">
      <header className="space-y-2">
        <Link to={returnTarget?.route ?? libraryReturnRoute} className="text-sm text-muted-foreground hover:underline">
          {returnTarget?.label ?? '变更选择并返回目录'}
        </Link>
        <h1 className="text-lg font-semibold">活动候选阅读</h1>
        <p className="text-xs text-muted-foreground">
          只读读取已保存的活动候选。候选仅表示模型对原文引用的解读，不代表已验证的执行、出版或采用；本页面不会启动解析、活动提取或模型。
        </p>
        {pins.statementId ? (
          <p role="status" className="text-xs text-muted-foreground">
            <Badge variant="outline" className="mr-2">声明 {pins.statementId}</Badge>
            更换声明会沿用当前来源与候选的固定绑定重新定位，不会改用其他候选。
          </p>
        ) : null}
      </header>

      {entryBlocker ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">无法读取活动候选</CardTitle>
          </CardHeader>
          <CardContent>
            <p role="alert" className="text-sm text-muted-foreground">{entryBlocker}</p>
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">无法读取活动候选</CardTitle>
          </CardHeader>
          <CardContent>
            <p role="alert" className="text-sm text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      ) : null}

      {unreadable ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">当前版本不可读</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p role="status" className="text-sm text-muted-foreground">{unreadable}</p>
            <p className="text-xs text-muted-foreground">
              本页面只读取已保存的内容，不会启动解析、索引或模型，也不会改用其他版本代替。
            </p>
          </CardContent>
        </Card>
      ) : null}

      {loading && !error && !unreadable && !entryBlocker && !reading ? (
        <p role="status" className="text-sm text-muted-foreground">正在读取活动候选…</p>
      ) : null}

      {reading ? (
        <DocumentActivityReadingView
          binding={reading.binding}
          familyId={reading.familyId}
          candidate={candidate}
          selectedStatementId={pins.statementId}
          selectedAnchorId={pins.anchor}
          returnParamsFor={returnParamsFor}
          onSelectStatement={selectStatement}
          onSelectAnchor={selectAnchor}
        />
      ) : null}

      {!error && !unreadable && !entryBlocker && !reading && !loading && candidate === null ? (
        <p role="status" className="text-sm text-muted-foreground">尚未产生可显示的活动候选。</p>
      ) : null}
    </main>
  );
}
