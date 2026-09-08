import type { FC } from 'react';
import { Link } from 'react-router-dom';

import CreateMatterButton from './CreateMatterButton';
import LinkMatterMaterial from './LinkMatterMaterial';

interface TaskMatterActionsProps {
  workItemId: string;
  documentLabel: string;
  linkMatterId?: string;
  disabled?: boolean;
}

const TaskMatterActions: FC<TaskMatterActionsProps> = ({
  workItemId,
  documentLabel,
  linkMatterId,
  disabled = false,
}) => (
  <section
    className="library-query-band space-y-3"
    aria-label="工程事项与当前任务"
  >
    {linkMatterId ? (
      <LinkMatterMaterial
        matterId={linkMatterId}
        workItemId={workItemId}
        documentLabel={documentLabel}
        disabled={disabled}
      />
    ) : (
      <>
        <p className="text-sm leading-7">
          {workItemId
            ? '当前选择仍是单份材料的评估任务。建立工程事项后，可围绕同一问题持续关联和核对其他材料。'
            : '先选择一个已有任务，再以它作为主要材料建立工程事项。'}
        </p>
        {workItemId ? (
          <div className="flex flex-wrap items-center gap-3">
            <CreateMatterButton
              workItemId={workItemId}
              documentLabel={documentLabel}
              disabled={disabled}
            />
            <Link
              className="text-sm underline underline-offset-4"
              to={`/library?${new URLSearchParams({ mode: 'matter', workItemId }).toString()}`}
            >
              查看该任务关联的事项
            </Link>
          </div>
        ) : null}
      </>
    )}
  </section>
);

export default TaskMatterActions;
