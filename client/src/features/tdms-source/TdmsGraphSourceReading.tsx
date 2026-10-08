import { useCallback, useState } from 'react';
import type { EngineeringKnowledgeIdentity } from '@shared/engineering-issue-search.interface';
import { readEngineeringKnowledgeWork } from '@client/src/api/canonical-host';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { useTdmsReadResource } from './useTdmsReadResource';
import { savedTdmsSourceRefs } from './saved-tdms-source-refs';
import TdmsSourceReading from './TdmsSourceReading';

export interface TdmsGraphSourceReadingProps {
  enabled?: boolean;
  matterId?: string;
  documentVersionId?: string;
  savedWork?: EngineeringKnowledgeIdentity;
  openDocument?: (documentVersionId: string) => void;
  onAccessRejected?: () => void;
  onLayerChange?: (opened: boolean) => void;
}

/** Historical graph entry uses only saved, receipt-bound source references, never today's directory. */
export default function TdmsGraphSourceReading({
  enabled = false,
  matterId,
  documentVersionId,
  savedWork,
  openDocument,
  onAccessRejected,
}: TdmsGraphSourceReadingProps) {
  const { sessionGeneration, authenticationRequired, currentUser } =
    useCurrentUserSession();
  const [retry, setRetry] = useState(0);
  const [deniedKey, setDeniedKey] = useState<string | null>(null);
  const scope = JSON.stringify([
    sessionGeneration,
    currentUser?.user_id,
    matterId,
    documentVersionId,
    savedWork?.subjectKind,
    savedWork?.subjectId,
    savedWork?.workRef,
  ]);
  const invalid =
    Boolean(matterId && documentVersionId) ||
    (!matterId && !documentVersionId);
  const active = enabled && !authenticationRequired && !invalid && deniedKey !== scope;
  const load = useCallback(
    (signal: AbortSignal) => readEngineeringKnowledgeWork(savedWork!, signal),
    [savedWork?.subjectKind, savedWork?.subjectId, savedWork?.workRef],
  );
  const denied = useCallback(() => {
    setDeniedKey(scope);
    onAccessRejected?.();
  }, [scope, onAccessRejected]);
  const saved = useTdmsReadResource(
    `${scope}:${retry}`,
    active && Boolean(savedWork),
    load,
    denied,
  );
  const matching =
    saved.value &&
    savedWork &&
    saved.value.entry.subjectKind === savedWork.subjectKind &&
    saved.value.entry.subjectId === savedWork.subjectId &&
    saved.value.entry.workRef === savedWork.workRef;
  const context = matterId
    ? { matterId }
    : documentVersionId
      ? { documentVersionId }
      : {};
  if (!enabled) return null;
  if (invalid)
    return <p role="alert">TDMS 图谱读取范围不明确，未读取其他对象。</p>;
  if (!active || (savedWork && !matching))
    return (
      <section aria-label="TDMS 图谱保存来源">
        <p role={saved.error || deniedKey === scope ? 'alert' : 'status'}>
          {authenticationRequired
            ? '请先登录，再读取准确保存来源。'
            : saved.error ||
              (deniedKey === scope
                ? '准确工作来源暂不可读取，原关系已清除。'
                : saved.value
                  ? '返回工作身份与所选准确工作不符，未显示来源。'
                  : '正在核对准确工作与保存来源；不读取当前目录。')}
        </p>
        <button
          type="button"
          disabled={authenticationRequired}
          onClick={() => {
            setDeniedKey(null);
            setRetry((value) => value + 1);
          }}
        >
          重读此图谱来源
        </button>
      </section>
    );
  return (
    <TdmsSourceReading
      key={scope}
      context={context}
      enabled={active}
      graphFirst={true}
      exactRevisionRefs={
        savedWork && matching && saved.value
          ? savedTdmsSourceRefs([
              ...saved.value.content.evidence,
              ...(saved.value.overall?.readingResult.evidence ?? []),
            ])
          : undefined
      }
      openDocument={openDocument}
      onAccessRejected={denied}
    />
  );
}
