import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  CircleAlert,
  Clock3,
  FileBox,
  FileText,
  FolderTree,
  RefreshCw,
  Search,
  Shield,
  Workflow,
} from 'lucide-react';

import {
  getCanonicalHostIdentityContext,
  getCanonicalHostClientSessionGeneration,
  getDocumentParsingPage,
  requireOfficialOauthSession,
  retryDevelopmentWorkItem,
} from '@client/src/api/canonical-host';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { useCurrentObjectContext } from '@client/src/app/providers/CurrentObjectContextProvider';
import {
  buildLibraryObjectContext,
  buildLibraryEngineeringQuicklook,
} from '@client/src/features/navigation/contextual-navigation';
import { workItemIdFromLocator } from '@client/src/utils/recent-work-items';
import { createCanonicalDocumentParsingRouteHandoff } from '../DocumentParsingPage/document-parsing-load';
import { HostedDevelopmentIntake } from './HostedDevelopmentIntake';
import {
  assertSameWorkItemReparseReadback,
  assertSameWorkItemReparseRun,
  availableParseAction,
} from './reparse-completed-work-item';
import EngineeringQuicklook from './EngineeringQuicklook';
import {
  libraryReadErrorPresentation,
  type LibraryReadErrorPresentation,
} from './library-read-error';
import { useLibraryDocuments } from './useLibraryDocuments';
import { useLibraryQuicklook } from './useLibraryQuicklook';
import { LibraryDocumentDirectory } from './LibraryDocumentDirectory';
import { LibraryDocumentDetails } from './LibraryDocumentDetails';
import {
  byteLabel,
  documentLabel,
  LIBRARY_PHASE_LABELS,
} from './library-document-presentation';
import './workspace-home.css';

export default function WorkspaceHomePage() {
  const { authenticationRequired, sessionGeneration } = useCurrentUserSession();
  const { publishCurrentObject } = useCurrentObjectContext();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkedWorkItemId: string =
    searchParams.get('workItemId')?.trim() ?? '';
  const search: string = searchParams.get('search')?.trim() ?? '';
  const treeMode: 'document' | 'matter' =
    searchParams.get('mode') === 'matter' || deepLinkedWorkItemId
      ? 'matter'
      : 'document';
  const familyId = searchParams.get('familyId')?.trim() ?? '';
  const [workItemId, setWorkItemId] = useState<string>('');
  const [searchText, setSearchText] = useState<string>(search);
  const [loadedSessionGeneration, setLoadedSessionGeneration] = useState<
    number | null
  >(null);
  const [developmentIntakeAvailable, setDevelopmentIntakeAvailable] =
    useState(false);
  const [identityError, setIdentityError] =
    useState<LibraryReadErrorPresentation | null>(null);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const selectionRef = useRef(deepLinkedWorkItemId);
  selectionRef.current = deepLinkedWorkItemId;
  const directory = useLibraryDocuments(
    search,
    sessionGeneration,
    authenticationRequired,
    refreshRevision,
    treeMode,
    treeMode === 'matter' ? familyId : '',
  );
  const quicklook = useLibraryQuicklook(
    deepLinkedWorkItemId,
    sessionGeneration,
    authenticationRequired,
    refreshRevision,
  );

  useEffect(() => {
    if (quicklook.accessDenied) directory.discard(deepLinkedWorkItemId);
  }, [deepLinkedWorkItemId, directory.discard, quicklook.accessDenied]);

  useEffect(() => setSearchText(search), [search]);
  useEffect(() => {
    setWorkItemId('');
    setRetryError(null);
  }, [deepLinkedWorkItemId, sessionGeneration]);

  useEffect(() => {
    let cancelled: boolean = false;
    const isCurrentSession = (): boolean =>
      !cancelled &&
      getCanonicalHostClientSessionGeneration() === sessionGeneration;
    setLoadedSessionGeneration(null);
    setDevelopmentIntakeAvailable(false);
    setIdentityError(null);
    if (!authenticationRequired) {
      void getCanonicalHostIdentityContext()
        .then((identity) => {
          if (!isCurrentSession()) return;
          setLoadedSessionGeneration(sessionGeneration);
          setDevelopmentIntakeAvailable(
            identity.developmentIntakeAvailable === true,
          );
        })
        .catch((reason: unknown) => {
          if (isCurrentSession())
            setIdentityError(libraryReadErrorPresentation(reason));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [authenticationRequired, refreshRevision, sessionGeneration]);

  const sessionDataVisible: boolean =
    !authenticationRequired && loadedSessionGeneration === sessionGeneration;
  const visibleDevelopmentIntakeAvailable: boolean =
    sessionDataVisible && developmentIntakeAvailable;
  const data = quicklook.data;
  const projection = data?.document ?? null;
  const selectedDocument = directory.items.find(
    (item) => item.kind === 'DOCUMENT' && item.familyId === familyId,
  );
  const currentObject = useMemo(
    () =>
      projection
        ? buildLibraryObjectContext(
            projection,
            treeMode === 'matter' ? 'MATTER' : 'DOCUMENT',
          )
        : null,
    [projection, treeMode],
  );
  const engineeringQuicklook = useMemo(
    () => (data ? buildLibraryEngineeringQuicklook(data) : null),
    [data],
  );
  useEffect(
    () => publishCurrentObject(currentObject),
    [currentObject, publishCurrentObject],
  );
  const error: LibraryReadErrorPresentation | null = authenticationRequired
    ? libraryReadErrorPresentation({ code: 'CANONICAL_PAGE_LOGIN_REQUIRED' })
    : identityError;
  const phaseLabel: string = projection
    ? (LIBRARY_PHASE_LABELS[projection.phase] ?? '状态待确认')
    : '';
  const canCheckParse: boolean =
    visibleDevelopmentIntakeAvailable &&
    !!projection &&
    (projection.phase === 'PARSE_REQUESTED' ||
      projection.phase === 'FAILED' ||
      (projection.phase === 'CANDIDATE_READBACK_VERIFIED' &&
        projection.packageRegistered));

  function selectTask(targetWorkItemId: string): void {
    const params: URLSearchParams = new URLSearchParams(searchParams);
    params.set('mode', 'matter');
    params.set('workItemId', targetWorkItemId);
    setSearchParams(params);
  }

  function selectDocument(targetFamilyId: string): void {
    const params = new URLSearchParams(searchParams);
    params.set('mode', 'document');
    params.set('familyId', targetFamilyId);
    params.delete('workItemId');
    setSearchParams(params);
  }

  function viewTasks(targetFamilyId = ''): void {
    const params = new URLSearchParams(searchParams);
    params.set('mode', 'matter');
    if (targetFamilyId) params.set('familyId', targetFamilyId);
    else params.delete('familyId');
    params.delete('workItemId');
    params.delete('search');
    setSearchParams(params);
  }

  function viewDocuments(): void {
    const params = new URLSearchParams(searchParams);
    params.set('mode', 'document');
    params.delete('workItemId');
    params.delete('familyId');
    params.delete('search');
    setSearchParams(params);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const normalized: string | null = workItemIdFromLocator(workItemId);
    if (normalized) selectTask(normalized);
  }

  function handleSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const params: URLSearchParams = new URLSearchParams(searchParams);
    if (searchText.trim()) params.set('search', searchText.trim());
    else params.delete('search');
    params.delete('workItemId');
    if (treeMode === 'document') params.delete('familyId');
    setSearchParams(params);
  }

  function openWorkbench(targetNode: string = 'reader'): void {
    if (!projection) return;
    const targetTab: string = targetNode === 'document' ? 'source' : targetNode;
    navigate(
      `/work-items/${encodeURIComponent(projection.workItemId)}/documents?node=${targetNode}&tab=${targetTab}`,
    );
  }

  function locateQuicklookEvidence(sourceRefId: string): void {
    if (!projection || !sourceRefId) return;
    navigate(
      `/work-items/${encodeURIComponent(projection.workItemId)}/documents?node=reader&tab=reader&readerMode=source&sourceRef=${encodeURIComponent(sourceRefId)}`,
    );
  }

  function refresh(): void {
    setRefreshRevision((current: number) => current + 1);
  }

  async function retryExistingWorkItem(): Promise<void> {
    if (!projection || !canCheckParse || retrying) return;
    const startedSessionGeneration: number = sessionGeneration;
    const expected = {
      workItemId: projection.workItemId,
      documentVersionId: projection.documentVersionId,
    };
    const isCurrent = (): boolean =>
      getCanonicalHostClientSessionGeneration() === startedSessionGeneration &&
      selectionRef.current === expected.workItemId;
    setRetryError(null);
    setRetrying(true);
    try {
      await requireOfficialOauthSession();
      if (!isCurrent()) return;
      // Full source verification is explicit here, never part of the directory or quicklook.
      const current = await getDocumentParsingPage(expected.workItemId, '');
      if (!isCurrent()) return;
      if (
        current.workItem.workItemId !== expected.workItemId ||
        current.workItem.source.documentVersionId !==
          expected.documentVersionId ||
        availableParseAction(true, current.workItem) === null
      ) {
        throw new Error('CANONICAL_PARSE_ACTION_NO_LONGER_AVAILABLE');
      }
      const retried = await retryDevelopmentWorkItem(expected.workItemId);
      assertSameWorkItemReparseRun(retried, expected);
      if (!isCurrent()) return;
      const readback = await getDocumentParsingPage(
        expected.workItemId,
        'applicability',
        { freshness: 'mutation' },
      );
      assertSameWorkItemReparseReadback(readback, expected);
      if (!isCurrent()) return;
      navigate(
        `/work-items/${encodeURIComponent(expected.workItemId)}/documents?node=document&tab=source`,
        {
          state: {
            documentParsingHandoff: createCanonicalDocumentParsingRouteHandoff(
              readback,
              sessionGeneration,
            ),
          },
        },
      );
    } catch (reason: unknown) {
      if (isCurrent())
        setRetryError(
          reason instanceof Error &&
            reason.message === 'CANONICAL_PARSE_ACTION_NO_LONGER_AVAILABLE'
            ? '当前状态不支持此解析操作，请刷新资料状态后进入工作台核对。'
            : libraryReadErrorPresentation(reason).message,
        );
    } finally {
      setRetrying(false);
    }
  }

  return (
    <main
      className="library-home"
      aria-busy={directory.loading || quicklook.loading}
    >
      <header className="library-home-header">
        <div>
          <p className="library-home-eyebrow">
            <span aria-hidden="true" /> 工程资料与综合评估
          </p>
          <h1>{treeMode === 'matter' ? '最近任务' : '资料库'}</h1>
          <p className="library-home-lede">
            {treeMode === 'matter'
              ? '查看每次工程评估的进展与候选判断，继续评估与讨论。'
              : '按工程文档检索资料，在同一 family 下查看当前版本与历史版本。'}
          </p>
        </div>
        <div className="library-home-status" aria-label="当前资料库视图">
          <span>
            {treeMode === 'matter'
              ? '当前账户的评估任务'
              : '当前账户可见的文档'}
          </span>
          <strong>
            已加载 {directory.items.length}{' '}
            {treeMode === 'matter' ? '个任务' : '份文档'}
          </strong>
        </div>
      </header>

      <details className="library-entry-disclosure" id="library-search">
        <summary>
          <span>
            <Search aria-hidden="true" /> 打开或受理资料
          </span>
          <small>粘贴已有链接，或选择 PDF 创建工程评估</small>
        </summary>
        <div
          className={`library-entry-grid${visibleDevelopmentIntakeAvailable ? ' has-intake' : ''}`}
        >
          <section
            className="library-query-band"
            aria-labelledby="library-query-title"
          >
            <div>
              <span className="library-section-label">已有工程评估</span>
              <h2 id="library-query-title">打开已有资料</h2>
              <p className="library-query-note">
                粘贴 WiseLink 工作链接，按当前账户权限读取已保存摘要。
              </p>
            </div>
            <form className="library-query-form" onSubmit={handleSubmit}>
              <label htmlFor="library-work-item-id">已有工作链接</label>
              <div className="library-query-row">
                <div className="library-query-input">
                  <Search aria-hidden="true" />
                  <Input
                    id="library-work-item-id"
                    value={workItemId}
                    onChange={(event) => setWorkItemId(event.target.value)}
                    placeholder="粘贴已有工作链接"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <Button
                  type="submit"
                  size="lg"
                  disabled={!workItemId.trim() || authenticationRequired}
                  data-ai-section-type="button"
                >
                  <ArrowRight aria-hidden="true" /> 定位资料
                </Button>
              </div>
            </form>
          </section>
          {visibleDevelopmentIntakeAvailable ? (
            <HostedDevelopmentIntake />
          ) : null}
        </div>
      </details>

      {error ? (
        <div className="library-alert" role="alert">
          <CircleAlert aria-hidden="true" />
          <div>
            <strong>{error.title}</strong>
            <span>{error.message}</span>
          </div>
          <Button type="button" variant="outline" onClick={refresh}>
            <RefreshCw aria-hidden="true" /> 重试
          </Button>
        </div>
      ) : null}

      <nav className="library-directory-tabs" aria-label="文档与任务视图">
        <Button
          type="button"
          variant={treeMode === 'document' ? 'default' : 'outline'}
          aria-pressed={treeMode === 'document'}
          onClick={viewDocuments}
        >
          工程文档
        </Button>
        <Button
          type="button"
          variant={treeMode === 'matter' ? 'default' : 'outline'}
          aria-pressed={treeMode === 'matter'}
          onClick={() => viewTasks()}
        >
          最近任务
        </Button>
        {treeMode === 'matter' && familyId ? (
          <span>
            仅显示所选文档的评估任务{' '}
            <Button type="button" variant="ghost" onClick={() => viewTasks()}>
              查看全部任务
            </Button>
          </span>
        ) : null}
      </nav>

      <section
        className="library-surface"
        aria-label={
          treeMode === 'matter' ? '评估任务与工程快览' : '工程文档与版本'
        }
      >
        <section
          className="library-tree-panel"
          aria-label={
            treeMode === 'matter' ? '当前账户评估任务' : '当前账户文档目录'
          }
        >
          <LibraryDocumentDirectory
            directory={directory}
            authenticationRequired={authenticationRequired}
            search={search}
            searchText={searchText}
            mode={treeMode}
            selectedId={treeMode === 'matter' ? deepLinkedWorkItemId : familyId}
            quicklookLoading={quicklook.loading}
            onSearchTextChange={setSearchText}
            onSearch={handleSearch}
            onRefresh={refresh}
            onSelect={treeMode === 'matter' ? selectTask : selectDocument}
          />

          {projection ? (
            <details className="library-selected-details">
              <summary>当前选择 · 资料登记与解析操作</summary>
              <section
                className="library-preview-panel"
                aria-label="资料登记与解析操作"
              >
                <div className="library-preview-title">
                  <div className="library-document-icon">
                    <FolderTree aria-hidden="true" />
                  </div>
                  <div>
                    <h3>{documentLabel(projection)}</h3>
                    <p>{projection.originalFilename}</p>
                  </div>
                  <div className="library-preview-actions">
                    {canCheckParse ? (
                      <Button
                        type="button"
                        size="sm"
                        disabled={retrying}
                        onClick={() => void retryExistingWorkItem()}
                      >
                        <RefreshCw
                          className={retrying ? 'library-spin' : undefined}
                          aria-hidden="true"
                        />
                        {retrying
                          ? '正在核对并解析…'
                          : projection.phase === 'PARSE_REQUESTED'
                            ? '继续解析'
                            : '重新解析'}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => openWorkbench()}
                    >
                      <Workflow aria-hidden="true" /> 进入工作台
                    </Button>
                  </div>
                </div>
                {retryError ? (
                  <p className="library-inline-empty" role="alert">
                    {retryError}
                  </p>
                ) : null}
                <dl className="library-facts">
                  <div>
                    <dt>
                      <Shield aria-hidden="true" /> 已登记状态
                    </dt>
                    <dd>{phaseLabel}</dd>
                  </div>
                  <div>
                    <dt>
                      <Clock3 aria-hidden="true" /> 文件版本
                    </dt>
                    <dd>
                      {projection.businessRevision || '版本未标注'} ·{' '}
                      {projection.selectedVersionIsCurrent
                        ? '当前登记'
                        : '历史版本'}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      <FileBox aria-hidden="true" /> 文件大小
                    </dt>
                    <dd>{byteLabel(projection.byteLength)}</dd>
                  </div>
                  <div>
                    <dt>
                      <FileText aria-hidden="true" /> 解析包登记
                    </dt>
                    <dd>
                      {projection.packageRegistered
                        ? '已登记，正文未核验'
                        : '尚未登记'}
                    </dd>
                  </div>
                </dl>
                <p className="library-recent-boundary">
                  这些是已保存的登记信息。打开工作台原文或发起解析操作时，才读取并核对实际来源。
                </p>
              </section>
            </details>
          ) : null}
        </section>

        {treeMode === 'document' ? (
          <LibraryDocumentDetails
            document={
              selectedDocument?.kind === 'DOCUMENT' ? selectedDocument : null
            }
            onOpenVersion={(readerWorkItemId) =>
              navigate(
                `/work-items/${encodeURIComponent(readerWorkItemId)}/documents?node=reader&tab=reader`,
              )
            }
            onViewTasks={viewTasks}
          />
        ) : (
          <EngineeringQuicklook
            title={projection ? documentLabel(projection) : '当前选择'}
            quicklook={engineeringQuicklook}
            loading={quicklook.loading}
            readError={quicklook.error ?? error}
            onOpenWorkbench={() => openWorkbench('reader')}
            onContinueReview={() => openWorkbench('review')}
            onOpenFamily={() => openWorkbench('document')}
            onLocateEvidence={locateQuicklookEvidence}
          />
        )}
      </section>
    </main>
  );
}
