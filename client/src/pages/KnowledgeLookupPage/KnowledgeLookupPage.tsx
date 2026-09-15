import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type {
  CanonicalEntryQueryResponse,
  CanonicalLibraryIndexReadResponse,
  CanonicalLibraryIndexNode,
  UnifiedReaderQueryResult,
} from '@shared/api.interface';
import {
  getCanonicalHostIdentityContext,
  getLibraryIndex,
  queryParsedUnits,
  type CanonicalHostIdentityContext,
} from '@client/src/api/canonical-host';
import {
  readRecentWorkItems,
  type RecentWorkItemReference,
} from '@client/src/utils/recent-work-items';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';

import './knowledge-lookup.css';

interface DocumentVersionOption {
  versionId: string;
  label: string;
  detail: string;
  isCurrent: boolean;
}

interface QueryPhase {
  searching: boolean;
  submitted: boolean;
  results: UnifiedReaderQueryResult[];
  errorCode: string | null;
}

const EMPTY_QUERY_PHASE: QueryPhase = {
  searching: false,
  submitted: false,
  results: [],
  errorCode: null,
};

const SUMMARY_MAX_LENGTH = 180;

function errorCodeOf(error: unknown): string {
  if (error instanceof Error) {
    const code: unknown = (error as Error & { code?: unknown }).code;
    if (typeof code === 'string' && code.trim()) return code;
    if (error.message.trim()) return error.message;
  }
  return 'READ_FAILED';
}

function buildVersionOptions(
  index: CanonicalLibraryIndexReadResponse,
): DocumentVersionOption[] {
  const currentDocumentVersionId: string =
    index.currentness.currentDocumentVersionId ?? '';
  const options: DocumentVersionOption[] = [];
  const seen: Set<string> = new Set<string>();

  const versionNodes: CanonicalLibraryIndexNode[] =
    index.libraryIndex.nodes.filter(
      (node: CanonicalLibraryIndexNode): boolean =>
        node.kind === 'DOCUMENT_VERSION' && node.id.trim() !== '',
    );
  for (const node of versionNodes) {
    seen.add(node.id);
    options.push({
      versionId: node.id,
      label: node.label || node.id,
      detail: node.detail,
      isCurrent: node.id === currentDocumentVersionId,
    });
  }

  const selectedVersionId: string = index.document.documentVersionId;
  if (selectedVersionId && !seen.has(selectedVersionId)) {
    options.unshift({
      versionId: selectedVersionId,
      label: index.document.documentCode || selectedVersionId,
      detail: index.document.businessRevision,
      isCurrent: selectedVersionId === currentDocumentVersionId,
    });
  }
  return options;
}

function primarySourceRef(result: UnifiedReaderQueryResult): string {
  const firstRef: string | undefined = result.sourceRefIds[0];
  if (firstRef) return firstRef;
  return result.sourceLocators?.[0]?.sourceRefId ?? '';
}

function summarize(text: string): string {
  const normalized: string = text.replace(/\s+/gu, ' ').trim();
  if (normalized.length <= SUMMARY_MAX_LENGTH) return normalized;
  return `${normalized.slice(0, SUMMARY_MAX_LENGTH)}…`;
}

export default function KnowledgeLookupPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // null = 解析中，'' = 无事项
  const [workItemId, setWorkItemId] = useState<string | null>(null);
  const [versionOptions, setVersionOptions] = useState<DocumentVersionOption[]>(
    [],
  );
  const [indexLoading, setIndexLoading] = useState<boolean>(false);
  const [indexErrorCode, setIndexErrorCode] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');
  const [queryInput, setQueryInput] = useState<string>('');
  const [queryPhase, setQueryPhase] = useState<QueryPhase>(EMPTY_QUERY_PHASE);
  const [contextErrorCode, setContextErrorCode] = useState<string | null>(null);
  const queryEpochRef = useRef<number>(0);

  useEffect(() => {
    const queryWorkItemId: string =
      searchParams.get('workItemId')?.trim() ?? '';
    let cancelled = false;
    setContextErrorCode(null);
    if (queryWorkItemId) {
      setWorkItemId(queryWorkItemId);
      return (): void => {
        cancelled = true;
      };
    }
    void (async (): Promise<void> => {
      try {
        const identity: CanonicalHostIdentityContext =
          await getCanonicalHostIdentityContext();
        if (cancelled) return;
        const recent: RecentWorkItemReference[] = readRecentWorkItems(identity);
        setWorkItemId(recent[0]?.workItemId ?? '');
      } catch (error) {
        logger.error('读取会话上下文失败', error);
        if (!cancelled) {
          setContextErrorCode(errorCodeOf(error));
          setWorkItemId('');
        }
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [searchParams]);

  useEffect(() => {
    queryEpochRef.current += 1;
    if (!workItemId) return;
    let cancelled = false;
    setIndexLoading(true);
    setIndexErrorCode(null);
    setVersionOptions([]);
    setSelectedVersionId('');
    setQueryPhase(EMPTY_QUERY_PHASE);
    void (async (): Promise<void> => {
      try {
        const index: CanonicalLibraryIndexReadResponse =
          await getLibraryIndex(workItemId);
        if (cancelled) return;
        setVersionOptions(buildVersionOptions(index));
      } catch (error) {
        logger.error('读取文档版本列表失败', error);
        if (!cancelled) setIndexErrorCode(errorCodeOf(error));
      } finally {
        if (!cancelled) setIndexLoading(false);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [workItemId]);

  const selectedOption: DocumentVersionOption | undefined = useMemo(
    (): DocumentVersionOption | undefined =>
      versionOptions.find(
        (option: DocumentVersionOption): boolean =>
          option.versionId === selectedVersionId,
      ),
    [versionOptions, selectedVersionId],
  );

  const handleVersionChange = useCallback((nextVersionId: string): void => {
    queryEpochRef.current += 1;
    setSelectedVersionId(nextVersionId);
    setQueryInput('');
    setQueryPhase(EMPTY_QUERY_PHASE);
  }, []);

  const runQuery = useCallback(
    async (rawQuery: string): Promise<void> => {
      const query: string = rawQuery.trim();
      if (!workItemId || !selectedVersionId || !query) return;
      const queryEpoch: number = queryEpochRef.current + 1;
      queryEpochRef.current = queryEpoch;
      setQueryPhase({
        searching: true,
        submitted: true,
        results: [],
        errorCode: null,
      });
      try {
        const response: CanonicalEntryQueryResponse = await queryParsedUnits({
          workItemId,
          requestId: crypto.randomUUID(),
          documentVersionId: selectedVersionId,
          query,
        });
        if (queryEpochRef.current !== queryEpoch) return;
        setQueryPhase({
          searching: false,
          submitted: true,
          results: response.readback.queryResults,
          errorCode: null,
        });
      } catch (error) {
        logger.error('知识查询失败', error);
        if (queryEpochRef.current !== queryEpoch) return;
        setQueryPhase({
          searching: false,
          submitted: true,
          results: [],
          errorCode: errorCodeOf(error),
        });
      }
    },
    [workItemId, selectedVersionId],
  );

  const openResult = useCallback(
    (result: UnifiedReaderQueryResult): void => {
      if (!workItemId) return;
      const sourceRef: string = primarySourceRef(result);
      const params = new URLSearchParams({
        node: 'reader',
        tab: 'source',
        documentVersionId: selectedVersionId,
      });
      if (sourceRef) params.set('sourceRef', sourceRef);
      navigate(
        `/work-items/${encodeURIComponent(workItemId)}/documents?${params.toString()}`,
      );
    },
    [workItemId, navigate, selectedVersionId],
  );

  const goToLibrary = useCallback((): void => {
    navigate('/library');
  }, [navigate]);

  if (workItemId === null) {
    return (
      <div className="knowledge-lookup">
        <div className="knowledge-lookup-status">正在确认事项范围…</div>
      </div>
    );
  }

  if (!workItemId) {
    if (contextErrorCode !== null) {
      return (
        <div className="knowledge-lookup">
          <header className="knowledge-lookup-header">
            <h1 className="knowledge-lookup-title">工程知识</h1>
          </header>
          <div className="knowledge-lookup-blocked">
            <p className="knowledge-lookup-blocked-title">事项范围读取受阻</p>
            <p className="knowledge-lookup-blocked-detail">
              当前身份或网络状态未能完成核验，请稍后重试。
            </p>
            <code className="knowledge-lookup-blocked-code">
              {contextErrorCode}
            </code>
          </div>
        </div>
      );
    }
    return (
      <div className="knowledge-lookup">
        <header className="knowledge-lookup-header">
          <h1 className="knowledge-lookup-title">工程知识</h1>
          <p className="knowledge-lookup-subtitle">
            基于当前事项的已解析单元进行知识查阅
          </p>
        </header>
        <div className="knowledge-lookup-empty" data-ai-section-type="card-menu">
          <p className="knowledge-lookup-empty-text">
            工程知识按事项范围组织。请先在资料库选择事项。
          </p>
          <Button data-ai-section-type="button" onClick={goToLibrary}>
            去资料库
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="knowledge-lookup">
      <header className="knowledge-lookup-header">
        <h1 className="knowledge-lookup-title">工程知识</h1>
        <p className="knowledge-lookup-subtitle">
          基于当前事项的已解析单元进行知识查阅
        </p>
      </header>

      {indexLoading ? (
        <div className="knowledge-lookup-status">正在读取文档版本…</div>
      ) : indexErrorCode !== null ? (
        <div className="knowledge-lookup-blocked">
          <p className="knowledge-lookup-blocked-title">知识读取受阻</p>
          <p className="knowledge-lookup-blocked-detail">
            暂时无法读取该事项的文档版本，请稍后重试。
          </p>
          <code className="knowledge-lookup-blocked-code">
            {indexErrorCode}
          </code>
        </div>
      ) : versionOptions.length === 0 ? (
        <div className="knowledge-lookup-status">
          该事项下暂时没有可查阅的文档版本
        </div>
      ) : (
        <>
          <section className="knowledge-lookup-controls">
            <label className="knowledge-lookup-field-label" htmlFor="knowledge-version-select">
              文档版本
            </label>
            <Select
              value={selectedVersionId || undefined}
              onValueChange={handleVersionChange}
            >
              <SelectTrigger
                id="knowledge-version-select"
                className="knowledge-lookup-version-select"
              >
                <SelectValue placeholder="请选择文档版本" />
              </SelectTrigger>
              <SelectContent>
                {versionOptions.map((option: DocumentVersionOption) => (
                  <SelectItem
                    key={option.versionId}
                    value={option.versionId}
                  >
                    {option.label}
                    {option.isCurrent ? '（当前版本）' : ''}
                    {option.detail ? ` · ${option.detail}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </section>

          {!selectedOption ? (
            <div className="knowledge-lookup-status">请选择文档版本</div>
          ) : (
            <>
              <section className="knowledge-lookup-search">
                <Input
                  className="knowledge-lookup-search-input"
                  placeholder="输入关键词或问题，查阅该版本下的解析内容"
                  value={queryInput}
                  onChange={(event): void => setQueryInput(event.target.value)}
                  onKeyDown={(event): void => {
                    if (event.key === 'Enter' && !queryPhase.searching) {
                      void runQuery(queryInput);
                    }
                  }}
                />
                <Button
                  data-ai-section-type="button"
                  disabled={queryPhase.searching || !queryInput.trim()}
                  onClick={(): void => {
                    void runQuery(queryInput);
                  }}
                >
                  {queryPhase.searching ? '查阅中…' : '查阅'}
                </Button>
              </section>

              {queryPhase.errorCode !== null ? (
                <div className="knowledge-lookup-blocked">
                  <p className="knowledge-lookup-blocked-title">知识读取受阻</p>
                  <p className="knowledge-lookup-blocked-detail">
                    本次查阅未能完成，请稍后重试。
                  </p>
                  <code className="knowledge-lookup-blocked-code">
                    {queryPhase.errorCode}
                  </code>
                </div>
              ) : queryPhase.searching ? (
                <div className="knowledge-lookup-status">正在查阅解析内容…</div>
              ) : queryPhase.submitted && queryPhase.results.length === 0 ? (
                <div className="knowledge-lookup-status">
                  该版本下没有匹配的解析单元
                </div>
              ) : queryPhase.results.length > 0 ? (
                <ul className="knowledge-lookup-results" data-ai-section-type="card-list">
                  {queryPhase.results.map((result: UnifiedReaderQueryResult) => {
                    const sourceRef: string = primarySourceRef(result);
                    return (
                      <li key={result.unitId}>
                        <button
                          type="button"
                          className="knowledge-lookup-result-card"
                          onClick={(): void => openResult(result)}
                        >
                          <div className="knowledge-lookup-result-head">
                            <span className="knowledge-lookup-result-title">
                              {result.unitId}
                            </span>
                            <span className="knowledge-lookup-result-kind">
                              {result.kind}
                            </span>
                          </div>
                          <p className="knowledge-lookup-result-summary">
                            {summarize(result.text)}
                          </p>
                          <span className="knowledge-lookup-result-source">
                            {sourceRef
                              ? `来源引用：${sourceRef}`
                              : '来源引用：未提供'}
                            {result.sourceRefIds.length > 1
                              ? `（共 ${result.sourceRefIds.length} 处）`
                              : ''}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}
