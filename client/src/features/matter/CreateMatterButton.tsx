import { useEffect, useRef, useState, type FC } from 'react';
import { useNavigate } from 'react-router-dom';

import { createEngineeringMatter } from '@client/src/api/engineering-matter';
import { Button } from '@client/src/components/ui/button';
import { createRequestCorrelationId } from '@client/src/utils/request-correlation-id';
import type {
  CreateEngineeringMatterRequest,
  CreateEngineeringMatterResponse,
} from '@shared/api.interface';

import { matterOverviewRoute } from './matter-navigation';

interface CreateMatterButtonProps {
  workItemId: string;
  documentLabel: string;
  disabled?: boolean;
}

const CreateMatterButton: FC<CreateMatterButtonProps> = ({
  workItemId,
  documentLabel,
  disabled = false,
}) => {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef<CreateEngineeringMatterRequest | null>(null);
  const busyRef = useRef<boolean>(false);
  const liveRef = useRef<boolean>(false);
  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
    };
  }, []);
  const currentWorkItemRef = useRef<string>(workItemId);
  currentWorkItemRef.current = workItemId;
  async function create(): Promise<void> {
    if (disabled || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const input: CreateEngineeringMatterRequest =
      pendingRef.current?.primaryWorkItemId === workItemId
        ? pendingRef.current
        : {
            requestId: createRequestCorrelationId(),
            primaryWorkItemId: workItemId,
            title: `${documentLabel || '当前材料'} 工程事项`.slice(0, 240),
          };
    pendingRef.current = input;
    try {
      const response: CreateEngineeringMatterResponse =
        await createEngineeringMatter(input);
      if (!liveRef.current || currentWorkItemRef.current !== workItemId) return;
      navigate(matterOverviewRoute(response.matter.matterId));
    } catch (cause: unknown) {
      if (liveRef.current && currentWorkItemRef.current === workItemId)
        setError(
          cause instanceof Error ? cause.message : '事项创建失败，请重试。',
        );
    } finally {
      busyRef.current = false;
      if (liveRef.current) setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        disabled={disabled || busy}
        onClick={() => void create()}
      >
        {busy ? '正在建立事项…' : '以当前任务建立工程事项'}
      </Button>
      {error ? (
        <p className="text-sm" role="alert">
          {error} 再次点击会复用原请求，避免重复创建。
        </p>
      ) : null}
    </div>
  );
};

export default CreateMatterButton;
