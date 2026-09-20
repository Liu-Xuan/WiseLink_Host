import { BookOpenCheck, MessageSquareText } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@client/src/components/ui/button';

import './work-item-assessment-workspace.css';

interface WorkItemAssessmentWorkspaceProps {
  documentCode: string;
  children: ReactNode;
  onOpenProcess: () => void;
  onOpenReview: () => void;
}

export default function WorkItemAssessmentWorkspace({
  documentCode,
  children,
  onOpenProcess,
  onOpenReview,
}: WorkItemAssessmentWorkspaceProps) {
  return (
    <section className="wl-assessment-workspace" id="workspace-assessment">
      <header className="wl-assessment-heading">
        <div>
          <p>当前事项 · {documentCode}</p>
          <h1>综合评估</h1>
          <span>先读当前判断，再核对决定性条件、来源和保存范围。</span>
        </div>
        <div className="wl-assessment-heading-actions">
          <Button type="button" variant="outline" onClick={onOpenProcess}>
            <BookOpenCheck aria-hidden="true" /> 问题与分析
          </Button>
          <Button type="button" variant="outline" onClick={onOpenReview}>
            <MessageSquareText aria-hidden="true" /> 复核与交流
          </Button>
        </div>
      </header>
      <div className="wl-assessment-content">{children}</div>
    </section>
  );
}
