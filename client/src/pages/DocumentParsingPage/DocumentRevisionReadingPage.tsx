import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { Badge } from '@client/src/components/ui/badge';
import { Button } from '@client/src/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@client/src/components/ui/card';
import {
  readDocumentParsingStatus,
  readDocumentRevisionReading,
  readDocumentSemanticReading,
  subscribeCanonicalHostClientSession,
} from '@client/src/api/canonical-host';
import {
  libraryReadingParams,
  revisionReadingParams,
  revisionReadingReturnParams,
} from '@client/src/features/matter/reading-return';
import type { DocumentOriginalBinding } from '@shared/document-original.interface';
import type { DocumentRevisionReadingResponse } from '@shared/document-revision-reading.interface';
import type { DocumentSemanticReadingResponse } from '@shared/document-semantic-map.interface';

import {
  roleUnion,
  sideIdentityComplete,
  validateRevisionEntry,
  type RevisionEntryValidation,
  type RevisionSideQuery,
} from './document-revision-entry';
import DocumentRevisionReadingView from './DocumentRevisionReadingView';

interface ResolvedPin {
  documentVersionId: string;
  parseRunId: string;
  semanticRevision: number;
}

interface ResolvedRevisionSide {
  identity: ResolvedPin | null;
  unreadable: string | null;
}

/**
 * Resolve one end to an exact pin. An explicit pin is never switched to latest; a
 * missing piece is discovered from the published parse run and the saved semantic
 * map. A null map or an unpublished run yields an unreadable state without
 * starting indexing, parsing or any model.
 */
async function resolveSidePin(
  side: RevisionSideQuery,
  signal: AbortSignal,
  current: () => boolean,
): Promise<ResolvedRevisionSide> {
  let parseRunId = side.parseRunId;
  let semanticRevision = side.semanticRevision;
  if (parseRunId === null) {
    const status = await readDocumentParsingStatus(
      side.documentVersionId,
      signal,
    );
    if (!current()) throw new Error('DOCUMENT_REVISION_ENTRY_OBSOLETE');
    if (!status.publishedRun) {
      return {
        identity: null,
        unreadable: `「${side.documentVersionId}」没有已发布的解析版本，无法进行改版比较。本页面不会启动新的解析。`,
      };
    }
    parseRunId = status.publishedRun.parseRunId;
  }
  if (semanticRevision === null) {
    const semantic = await readDocumentSemanticReading(
      { documentVersionId: side.documentVersionId, parseRunId },
      signal,
    );
    if (!current()) throw new Error('DOCUMENT_REVISION_ENTRY_OBSOLETE');
    if (!semantic.semanticMap) {
      return {
        identity: null,
        unreadable: `「${side.documentVersionId}」没有已保存的语义组织，无法进行改版比较。本页面不会生成语义组织。`,
      };
    }
    semanticRevision = semantic.semanticMap.semanticRevision;
  }
  return {
    identity: {
      documentVersionId: side.documentVersionId,
      parseRunId,
      semanticRevision,
    },
    unreadable: null,
  };
}

function isBlockedRevisionEntry(
  validation: RevisionEntryValidation,
): validation is Extract<RevisionEntryValidation, { ok: false }> {
  return validation.ok === false;
}

export default function DocumentRevisionReadingPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const entry = useMemo(
    () => validateRevisionEntry(searchParams),
    [searchParams],
  );
  const before = entry.ok ? entry.before : null;
  const after = entry.ok ? entry.after : null;
  const entryBlocker = isBlockedRevisionEntry(entry) ? entry.reason : null;
  const roleKey = searchParams.get('roleKey');
  const focusSide = searchParams.get('focusSide');
  const returnLibraryQuery = searchParams.get('returnLibraryQuery');
  // The discovery identity is built only from the two ends' pins. Selecting a role
  // changes the query but never this identity, so it must not re-run discovery.
  const pinsIdentity = JSON.stringify([
    before?.documentVersionId ?? '',
    before?.parseRunId ?? '',
    before?.semanticRevision ?? '',
    after?.documentVersionId ?? '',
    after?.parseRunId ?? '',
    after?.semanticRevision ?? '',
  ]);

  const [savedReading, setReading] = useState<{ identity: string; value: DocumentRevisionReadingResponse } | null>(null);
  const [semanticBefore, setSemanticBefore] = useState<DocumentSemanticReadingResponse | null>(null);
  const [semanticAfter, setSemanticAfter] = useState<DocumentSemanticReadingResponse | null>(null);
  const [roleOptions, setRoleOptions] = useState<string[]>([]);
  const [resolvedPins, setResolvedPins] = useState<{ pinsIdentity: string; before: ResolvedPin; after: ResolvedPin } | null>(null);
  const [unreadable, setUnreadable] = useState<{ before: string | null; after: string | null }>({ before: null, after: null });
  const [error, setError] = useState<string | null>(null);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [roleLoading, setRoleLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const epoch = useRef(0);
  const identity = useRef(pinsIdentity);
  identity.current = pinsIdentity;
  const readingIdentity = JSON.stringify([pinsIdentity, roleKey, refresh]);
  const reading = entry.ok && savedReading?.identity === readingIdentity ? savedReading.value : null;
  const loading = discoveryLoading || roleLoading;

  useEffect(() => {
    epoch.current++;
    setReading(null);
    setSemanticBefore(null);
    setSemanticAfter(null);
    setRoleOptions([]);
    setResolvedPins(null);
    setUnreadable({ before: null, after: null });
    setError(null);
    setDiscoveryLoading(false);
    return subscribeCanonicalHostClientSession(() => {
      epoch.current++;
      setReading(null);
      setSemanticBefore(null);
      setSemanticAfter(null);
      setRoleOptions([]);
      setResolvedPins(null);
      setUnreadable({ before: null, after: null });
      setError(null);
      setDiscoveryLoading(false);
      setRefresh((value) => value + 1);
    });
  }, [pinsIdentity]);

  // Discovery: validate the pins, resolve only the unspecified pieces, then read the
  // semantic maps and the role union. Illegal or duplicated pins stop here before any
  // request; a legal partial pin set may still discover the remaining pieces.
  useEffect(() => {
    const controller = new AbortController();
    const generation = epoch.current;
    const current = () =>
      !controller.signal.aborted &&
      identity.current === pinsIdentity &&
      epoch.current === generation;
    const run = async () => {
      setDiscoveryLoading(true);
      setReading(null);
      setError(null);
      setUnreadable({ before: null, after: null });
      if (entryBlocker || !before || !after) {
        if (!current()) return;
        setError(entryBlocker ?? '缺少要比较的两个文档版本。');
        setDiscoveryLoading(false);
        return;
      }
      try {
        const beforeResult = await resolveSidePin(before, controller.signal, current);
        if (!current()) return;
        if (beforeResult.unreadable || !beforeResult.identity) {
          setUnreadable((state) => ({ ...state, before: beforeResult.unreadable }));
          setDiscoveryLoading(false);
          return;
        }
        const afterResult = await resolveSidePin(after, controller.signal, current);
        if (!current()) return;
        if (afterResult.unreadable || !afterResult.identity) {
          setUnreadable((state) => ({ ...state, after: afterResult.unreadable }));
          setDiscoveryLoading(false);
          return;
        }
        const beforeId = beforeResult.identity;
        const afterId = afterResult.identity;
        if (!sideIdentityComplete(before) || !sideIdentityComplete(after)) {
          const query = new URLSearchParams(searchParams);
          query.set('before', beforeId.documentVersionId);
          query.set('beforeParseRun', beforeId.parseRunId);
          query.set('beforeSemanticRevision', String(beforeId.semanticRevision));
          query.set('after', afterId.documentVersionId);
          query.set('afterParseRun', afterId.parseRunId);
          query.set('afterSemanticRevision', String(afterId.semanticRevision));
          navigate(`/document-revisions?${revisionReadingParams(query).toString()}`, { replace: true });
          return;
        }
        const semBefore = await readDocumentSemanticReading(
          { documentVersionId: beforeId.documentVersionId, parseRunId: beforeId.parseRunId, semanticRevision: beforeId.semanticRevision },
          controller.signal,
        );
        if (!current()) return;
        const semAfter = await readDocumentSemanticReading(
          { documentVersionId: afterId.documentVersionId, parseRunId: afterId.parseRunId, semanticRevision: afterId.semanticRevision },
          controller.signal,
        );
        if (!current()) return;
        if (!semBefore.semanticMap || !semAfter.semanticMap) {
          setUnreadable({
            before: semBefore.semanticMap ? null : '基线端没有已保存的语义组织，无法比较。',
            after: semAfter.semanticMap ? null : '比较目标端没有已保存的语义组织，无法比较。',
          });
          setDiscoveryLoading(false);
          return;
        }
        if (semBefore.familyId !== semAfter.familyId) {
          setError('两端不属于同一文档族，无法进行改版比较。');
          setDiscoveryLoading(false);
          return;
        }
        setSemanticBefore(semBefore);
        setSemanticAfter(semAfter);
        setRoleOptions(roleUnion([semBefore.semanticMap.sections, semAfter.semanticMap.sections]));
        setResolvedPins({ pinsIdentity, before: beforeId, after: afterId });
        setDiscoveryLoading(false);
      } catch (reason) {
        if (!current()) return;
        setError(reason instanceof Error ? reason.message : '改版比较读取未完成，请重试。');
        setDiscoveryLoading(false);
      }
    };
    void run();
    return () => {
      controller.abort();
    };
  }, [pinsIdentity, refresh, entryBlocker]);

  // Compare only the pins resolved for this URL; a role change cannot reuse a
  // result or an in-flight discovery from another identity.
  useEffect(() => {
    setReading(null);
    setRoleLoading(false);
    if (!entry.ok || !resolvedPins || resolvedPins.pinsIdentity !== pinsIdentity) return;
    setError(null);
    if (!roleKey) return;
    if (!roleOptions.includes(roleKey)) {
      setError(`角色「${roleKey}」不在这两端的语义组织中，无法比较。`);
      return;
    }
    const controller = new AbortController();
    const generation = epoch.current;
    const current = () =>
      !controller.signal.aborted &&
      identity.current === pinsIdentity &&
      epoch.current === generation;
    setRoleLoading(true);
    readDocumentRevisionReading(
      { before: resolvedPins.before, after: resolvedPins.after, roleKey },
      controller.signal,
    )
      .then((result) => {
        if (!current()) return;
        setReading({ identity: readingIdentity, value: result });
        setRoleLoading(false);
      })
      .catch((reason) => {
        if (!current()) return;
        setError(reason instanceof Error ? reason.message : '改版比较读取未完成，请重试。');
        setRoleLoading(false);
      });
    return () => controller.abort();
  }, [resolvedPins, roleKey, roleOptions, pinsIdentity, readingIdentity, entry.ok]);

  const selectRole = (role: string) => {
    const query = new URLSearchParams(searchParams);
    query.set('roleKey', role);
    navigate(`/document-revisions?${revisionReadingParams(query).toString()}`, { replace: true });
  };

  const returnParamsFor = useCallback(
    (binding: DocumentOriginalBinding): string | null => {
      if (!before || !after) return null;
      const side =
        binding.documentVersionId === before.documentVersionId
          ? 'before'
          : binding.documentVersionId === after.documentVersionId
            ? 'after'
            : null;
      if (!side) return null;
      const revisionQuery = revisionReadingParams(searchParams).toString();
      return revisionReadingReturnParams(
        revisionQuery,
        side,
        binding.documentVersionId,
      ).toString();
    },
    [before, after, searchParams],
  );

  const libraryReturnRoute = returnLibraryQuery
    ? `/library?${libraryReadingParams(new URLSearchParams(returnLibraryQuery)).toString()}`
    : '/library?mode=document';

  const hasBlocker = Boolean(error || unreadable.before || unreadable.after);
  const showRoleSelector =
    entry.ok && resolvedPins?.pinsIdentity === pinsIdentity;

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4">
      <header className="space-y-2">
        <Link
          to={libraryReturnRoute}
          className="text-sm text-muted-foreground hover:underline"
        >
          变更选择并返回目录
        </Link>
        <h1 className="text-lg font-semibold">改版比较阅读</h1>
        <p className="text-xs text-muted-foreground">
          只读比较两个版本所选角色的纯文本。基线端与比较目标端只表示本次比较的两端，不代表厂家先后、正式采用，也不代表最新或完整修订跨度。
        </p>
        {focusSide === 'before' || focusSide === 'after' ? (
          <p role="status" className="text-xs text-muted-foreground">
            已返回{focusSide === 'before' ? '基线端' : '比较目标端'}的来源位置。
          </p>
        ) : null}
      </header>

      {error ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">无法读取改版比较</CardTitle>
          </CardHeader>
          <CardContent>
            <p role="alert" className="text-sm text-muted-foreground">
              {error}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {unreadable.before || unreadable.after ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">存在不可读的一端</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[unreadable.before, unreadable.after]
              .filter((message): message is string => Boolean(message))
              .map((message) => (
                <p key={message} role="status" className="text-sm text-muted-foreground">
                  {message}
                </p>
              ))}
            <p className="text-xs text-muted-foreground">
              本页面只读取已保存的内容，不会启动解析、索引或模型，也不会改用其他版本代替。
            </p>
          </CardContent>
        </Card>
      ) : null}

      {showRoleSelector ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">选择要比较的内容角色</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              改版比较按内容角色逐角色进行。以下为两端语义组织中存在角色标注的并集；重复或缺失的角色会保留，并由比较结果显示为未产生比较。切换角色会沿用当前两端的固定版本绑定重新读取，不会重新解析或改用最新版本。
            </p>
            {roleOptions.length === 0 ? (
              <p role="status" className="text-sm text-muted-foreground">两端语义组织中没有可比较的内容角色。</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {roleOptions.map((role) => (
                <Button
                  key={role}
                  type="button"
                  variant={role === roleKey ? 'default' : 'outline'}
                  aria-pressed={role === roleKey}
                  onClick={() => selectRole(role)}
                >
                  {role}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {loading && !hasBlocker && !reading ? (
        <p role="status" className="text-sm text-muted-foreground">
          正在读取改版比较…
        </p>
      ) : null}

      {reading ? (
        <div className="space-y-2">
          {roleKey ? (
            <p className="text-xs text-muted-foreground">
              <Badge variant="outline" className="mr-2">
                当前角色 {roleKey}
              </Badge>
              更换角色会沿用当前两端的固定版本绑定重新读取该角色的比较，不会自动切换到其他版本。
            </p>
          ) : null}
          <DocumentRevisionReadingView
            reading={reading}
            returnParamsFor={returnParamsFor}
          />
        </div>
      ) : null}

      {!hasBlocker && !reading && !loading && semanticBefore && semanticAfter && roleKey ? (
        <p role="status" className="text-sm text-muted-foreground">
          尚未产生可显示的改版比较。
        </p>
      ) : null}
    </main>
  );
}
