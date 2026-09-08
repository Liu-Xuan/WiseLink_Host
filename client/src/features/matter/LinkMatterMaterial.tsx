import { useEffect, useRef, useState, type FC } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { getCanonicalHostClientSessionGeneration } from '@client/src/api/canonical-host';
import {
  getEngineeringMatter,
  linkEngineeringMatterWorkItem,
} from '@client/src/api/engineering-matter';
import { Button } from '@client/src/components/ui/button';
import { createRequestCorrelationId } from '@client/src/utils/request-correlation-id';
import type {
  EngineeringMatterReadModel,
  LinkEngineeringMatterWorkItemRequest,
} from '@shared/api.interface';
import { matterOverviewRoute } from './matter-navigation';

interface LinkMatterMaterialProps {
  matterId: string;
  workItemId: string;
  documentLabel: string;
  disabled: boolean;
}

const LinkMatterMaterial: FC<LinkMatterMaterialProps> = ({
  matterId,
  workItemId,
  documentLabel,
  disabled,
}) => {
  const navigate = useNavigate();
  const { sessionGeneration, authenticationRequired } = useCurrentUserSession();
  const [matter, setMatter] = useState<EngineeringMatterReadModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [readRevision, setReadRevision] = useState(0);
  const pendingRef = useRef<LinkEngineeringMatterWorkItemRequest | null>(null);
  const busyRef = useRef(false);
  const liveRef = useRef(false);
  const scope = `${sessionGeneration}:${matterId}:${workItemId}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setMatter(null);
    setError(null);
    setLoading(!authenticationRequired);
    if (!authenticationRequired)
      void getEngineeringMatter(matterId, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) setMatter(data);
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted)
            setError(cause instanceof Error ? cause.message : '事项读取失败。');
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    return () => controller.abort();
  }, [matterId, sessionGeneration, authenticationRequired, readRevision]);

  const alreadyLinked =
    matter?.catalog.entries.some((entry) => entry.workItemId === workItemId) ??
    false;
  async function linkMaterial(): Promise<void> {
    if (
      !matter ||
      !workItemId ||
      disabled ||
      authenticationRequired ||
      alreadyLinked ||
      loading ||
      busyRef.current
    )
      return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const current = (): boolean =>
      liveRef.current &&
      scopeRef.current === scope &&
      getCanonicalHostClientSessionGeneration() === sessionGeneration;
    const input: LinkEngineeringMatterWorkItemRequest =
      pendingRef.current?.workItemId === workItemId &&
      pendingRef.current.expectedMatterRevision ===
        matter.currentRevision.revisionNo
        ? pendingRef.current
        : {
            requestId: createRequestCorrelationId(),
            expectedMatterRevision: matter.currentRevision.revisionNo,
            workItemId,
            changeSummary:
              '工程师从资料库选择并关联已有材料，待核查其对当前认识的贡献。',
          };
    pendingRef.current = input;
    try {
      await linkEngineeringMatterWorkItem(matterId, input);
      if (current())
        navigate(`${matterOverviewRoute(matterId)}?panel=materials`);
    } catch (cause: unknown) {
      if (current())
        setError(
          cause instanceof Error ? cause.message : '资料未能关联，请重试。',
        );
    } finally {
      busyRef.current = false;
      if (current()) setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">
        加入材料{matter ? ` · ${matter.title}` : ''}
      </h2>
      <p className="text-sm leading-7">
        {workItemId
          ? `当前选择：${documentLabel}。`
          : '请在下方选择一个已有任务。'}
        关联后仅进入待核查材料，不会自动改写综合判断或正式采用状态。
      </p>
      {error ? (
        <p role="alert" className="text-sm">
          {error} 若需核对最新修订，可重新读取事项后再次选择加入。
        </p>
      ) : null}
      {authenticationRequired ? <p role="alert">请先登录。</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => void linkMaterial()}
          disabled={
            disabled ||
            authenticationRequired ||
            !workItemId ||
            !matter ||
            busy ||
            loading ||
            alreadyLinked
          }
        >
          {busy
            ? '正在加入…'
            : loading
              ? '正在读取事项…'
              : alreadyLinked
                ? '当前材料已在此事项中'
                : '将当前材料加入此事项'}
        </Button>
        <Button
          variant="outline"
          disabled={busy || loading || authenticationRequired}
          onClick={() => setReadRevision((value) => value + 1)}
        >
          重新读取事项
        </Button>
        <Link
          className="text-sm underline underline-offset-4"
          to={`${matterOverviewRoute(matterId)}?panel=materials`}
        >
          返回事项
        </Link>
      </div>
    </div>
  );
};

export default LinkMatterMaterial;
