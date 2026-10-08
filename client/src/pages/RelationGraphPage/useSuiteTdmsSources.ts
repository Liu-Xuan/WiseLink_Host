import { useCallback, useRef, useState } from 'react';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { useEngineeringMatterQueryIdentity } from '@client/src/features/matter/useEngineeringMatter';
import { readTdmsSourceCatalogue, readTdmsSourceRecord, readTdmsSourceRelations } from '@client/src/api/canonical-host';
import { useTdmsReadResource } from '@client/src/features/tdms-source/useTdmsReadResource';

/** One authorized catalogue page and at most one explicitly requested exact read of each kind. */
export function useSuiteTdmsSources(input: {
  matterId: string;
  workRef: string;
  session: number;
  sourceAccessEpoch: number;
  enabled: boolean;
  allowCurrentSources: boolean;
  onAccessRejected: () => void;
}) {
  const { currentUser, authenticationRequired } = useCurrentUserSession();
  const [opened, setOpened] = useState(false);
  const [page, setPage] = useState<{ scope: string; cursor: string | undefined; previous: Array<string | undefined> } | null>(null);
  const [catalogueRetry, setCatalogueRetry] = useState(0);
  const [explicitRecheck, setExplicitRecheck] = useState(false);
  const recheckEpoch = useRef(0);
  const [relationSelection, setRelationSelection] = useState<{ scope: string; ref: string; retry: number } | null>(null);
  const [bodySelection, setBodySelection] = useState<{ scope: string; ref: string; retry: number } | null>(null);
  const [deniedScope, setDeniedScope] = useState<string | null>(null);
  const notifiedDenial = useRef<string | null>(null);
  const { identity, identityQuery } = useEngineeringMatterQueryIdentity(
    input.enabled && !authenticationRequired, input.session,
  );
  const scope = JSON.stringify([
    identity?.appId ?? null, identity?.tenantId ?? null, identity?.actorId ?? null,
    currentUser?.user_id ?? null, input.session, input.matterId, input.workRef,
    input.sourceAccessEpoch, identityQuery.dataUpdatedAt,
  ]);
  const denialScope = JSON.stringify([
    currentUser?.user_id ?? null, input.session, input.matterId, input.workRef,
  ]);
  const allowed = input.enabled && !authenticationRequired && !explicitRecheck && Boolean(identity)
    && !identityQuery.isFetching && !identityQuery.error && deniedScope !== denialScope;
  const currentAllowed = allowed && opened && input.allowCurrentSources;
  const currentPage = page?.scope === scope ? page : null;
  const cursor = currentPage?.cursor;
  const previous = currentPage?.previous ?? [];
  const onDenied = useCallback(() => {
    setDeniedScope(denialScope);
    setRelationSelection(null);
    setBodySelection(null);
    if (notifiedDenial.current !== denialScope) {
      notifiedDenial.current = denialScope;
      input.onAccessRejected();
    }
  }, [denialScope, input.onAccessRejected]);
  const context = { matterId: input.matterId };
  const catalogueLoad = useCallback((signal: AbortSignal) =>
    readTdmsSourceCatalogue(context, cursor, signal), [input.matterId, cursor]);
  const catalogue = useTdmsReadResource(
    JSON.stringify([scope, cursor, catalogueRetry]), currentAllowed, catalogueLoad, onDenied,
  );
  const relationAllowed = currentAllowed && catalogue.value?.sourceStatus === 'AVAILABLE';
  const relationRef = relationSelection?.scope === scope ? relationSelection.ref : null;
  const relationLoad = useCallback((signal: AbortSignal) =>
    readTdmsSourceRelations(relationRef!, context, signal), [input.matterId, relationRef]);
  const relations = useTdmsReadResource(
    JSON.stringify([scope, relationSelection]), relationAllowed && Boolean(relationRef), relationLoad, onDenied,
  );
  const bodyRef = bodySelection?.scope === scope ? bodySelection.ref : null;
  const bodyLoad = useCallback((signal: AbortSignal) =>
    readTdmsSourceRecord(bodyRef!, context, signal), [input.matterId, bodyRef]);
  const body = useTdmsReadResource(
    JSON.stringify([scope, bodySelection]), allowed && Boolean(bodyRef), bodyLoad, onDenied,
  );
  const readRelations = useCallback((ref: string) => {
    if (!relationAllowed) return;
    setRelationSelection(current => ({ scope, ref, retry: (current?.retry ?? 0) + 1 }));
  }, [relationAllowed, scope]);
  const readBody = useCallback((ref: string) => {
    if (!allowed) return;
    setBodySelection(current => ({ scope, ref, retry: (current?.retry ?? 0) + 1 }));
  }, [allowed, scope]);
  const closeBody = useCallback(() => setBodySelection(null), []);
  const recheckIdentity = useCallback(() => {
    const epoch = ++recheckEpoch.current;
    setExplicitRecheck(true);
    void identityQuery.refetch({ cancelRefetch: false }).then(() => {
      if (recheckEpoch.current === epoch) setExplicitRecheck(false);
    }, () => {
      if (recheckEpoch.current === epoch) setExplicitRecheck(false);
    });
  }, [identityQuery.refetch]);
  const refreshCatalogue = useCallback(() => {
    setPage({ scope, cursor: undefined, previous: [] });
    setRelationSelection(null); setBodySelection(null);
    setDeniedScope(null); setCatalogueRetry(value => value + 1);
    notifiedDenial.current = null;
    recheckIdentity();
  }, [recheckIdentity, scope]);
  const nextPage = useCallback(() => {
    if (!catalogue.value?.hasMore || !catalogue.value.nextAfter) return;
    setPage({ scope, cursor: catalogue.value.nextAfter, previous: [...previous, cursor] });
    setRelationSelection(null); setBodySelection(null);
  }, [catalogue.value, cursor, previous, scope]);
  const previousPage = useCallback(() => {
    if (!previous.length) return;
    setPage({ scope, cursor: previous[previous.length - 1], previous: previous.slice(0, -1) });
    setRelationSelection(null); setBodySelection(null);
  }, [previous, scope]);
  const toggle = useCallback(() => {
    if (!opened) recheckIdentity();
    setOpened(!opened);
    setPage(null);
    setRelationSelection(null); setBodySelection(null);
    setCatalogueRetry(value => value + 1);
  }, [opened, recheckIdentity]);
  return {
    opened, toggle, refreshCatalogue, nextPage, previousPage,
    hasPrevious: previous.length > 0,
    catalogue: currentAllowed ? catalogue : { value: null, loading: false, error: null },
    relations: relationAllowed ? relations : { value: null, loading: false, error: null },
    body: allowed ? body : { value: null, loading: false, error: null },
    relationRef: allowed ? relationRef : null,
    bodyRef: allowed ? bodyRef : null,
    readRelations, readBody, closeBody,
    canReadRelations: relationAllowed,
    canReadBody: allowed,
    accessBlocked: Boolean(identityQuery.error) || deniedScope === denialScope,
    retryAccess: refreshCatalogue,
    unavailable: opened && !currentAllowed,
    unavailableText: authenticationRequired ? '请先登录，再读取 TDMS 来源。'
      : identityQuery.error || deniedScope === denialScope ? '此来源暂不可读取；原目录、关系和正文已清除。'
        : '正在核对当前账户与来源读取范围…',
  };
}
