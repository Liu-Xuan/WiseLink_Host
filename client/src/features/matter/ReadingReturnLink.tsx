import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@client/src/components/ui/button';

import { matterOverviewRoute } from './matter-navigation';

export function readingReturnTarget(
  params: URLSearchParams,
): { route: string; label: string } | null {
  const matterId: string = params.get('returnMatterId')?.trim() ?? '';
  if (matterId) {
    const panel = params.get('returnMatterPanel');
    return {
      route: `${matterOverviewRoute(matterId)}${panel === 'review' || panel === 'materials' ? `?panel=${panel}` : ''}`,
      label:
        panel === 'review'
          ? '返回事项讨论'
          : panel === 'materials'
            ? '返回关联资料'
            : '返回事项简报',
    };
  }
  const libraryWorkItemId = params.get('returnLibraryWorkItemId')?.trim() ?? '';
  if (libraryWorkItemId)
    return {
      route: `/library?${new URLSearchParams({ mode: 'tasks', workItemId: libraryWorkItemId }).toString()}`,
      label: '返回任务快览',
    };
  const workItemId: string = params.get('returnWorkItemId')?.trim() ?? '';
  return workItemId
    ? {
        route: `/work-items/${encodeURIComponent(workItemId)}`,
        label: '返回评估简报',
      }
    : null;
}

export default function ReadingReturnLink() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const target = readingReturnTarget(params);
  return target ? (
    <div className="border-b border-border p-3">
      <Button
        variant="outline"
        size="sm"
        onClick={() => navigate(target.route)}
      >
        <ArrowLeft aria-hidden="true" />
        {target.label}
      </Button>
    </div>
  ) : null;
}
