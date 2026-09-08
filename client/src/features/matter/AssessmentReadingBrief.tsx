import type { FC } from 'react';
import { BookOpen, Link2 } from 'lucide-react';

import { Button } from '@client/src/components/ui/button';
import type {
  AssessmentReadingClaim,
  AssessmentReadingResult,
} from '@shared/assessment-reading.interface';

import {
  assessmentClaimGroups,
  type AssessmentClaimGroups,
  type AssessmentClaimSelection,
} from './assessment-reading';

interface AssessmentReadingBriefProps {
  result: AssessmentReadingResult;
  depth?: 'list' | 'brief' | 'full';
  onOpenClaim?: (
    selection: AssessmentClaimSelection,
    trigger: HTMLButtonElement,
  ) => void;
}

const AssessmentReadingBrief: FC<AssessmentReadingBriefProps> = ({
  result,
  depth = 'brief',
  onOpenClaim,
}) => {
  const groups: AssessmentClaimGroups = assessmentClaimGroups(result);
  const renderClaim = (claim: AssessmentReadingClaim): React.ReactNode => (
    <li key={claim.claimId} className="space-y-2" data-claim-id={claim.claimId}>
      <p className="whitespace-pre-wrap break-words text-sm leading-7">
        {claim.text}
      </p>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>{claim.basis === 'SOURCE_FACT' ? '来源事实' : '条件性推断'}</span>
        <Button
          variant="ghost"
          size="sm"
          disabled={!onOpenClaim}
          data-claim-trigger={claim.claimId}
          aria-label={`核对判断依据：${claim.text}`}
          onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
            onOpenClaim?.(
              {
                resultRef: result.resultRef,
                resultRevision: result.resultRevision,
                claimId: claim.claimId,
              },
              event.currentTarget,
            )
          }
        >
          <Link2 aria-hidden="true" />
          核对 {claim.premises.length} 项前提
        </Button>
      </div>
    </li>
  );

  return (
    <section
      className="space-y-5 text-foreground"
      data-result-ref={result.resultRef}
      data-result-revision={result.resultRevision}
      aria-label="已保存的工程认识"
    >
      <header className="space-y-2">
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <BookOpen className="size-4" aria-hidden="true" />
          {result.scope.kind === 'ENGINEERING_MATTER'
            ? '事项工作认识'
            : '当前对象的工程认识'}
          <span>· 已保存候选，尚非实施决定</span>
        </p>
        <h2 className="break-words text-xl font-semibold leading-8">
          {result.content.headline}
        </h2>
        <p className="whitespace-pre-wrap break-words text-sm leading-7">
          {depth === 'list' ? result.content.listBrief : result.content.lead}
        </p>
      </header>
      {depth !== 'list' && groups.decisive.length > 0 ? (
        <div className="space-y-3 border-l-2 border-primary/40 pl-4">
          <h3 className="text-sm font-medium">决定性条件与待核判断</h3>
          <ul className="space-y-4">{groups.decisive.map(renderClaim)}</ul>
        </div>
      ) : null}
      {depth !== 'list' && groups.supporting.length > 0 ? (
        depth === 'full' ? (
          <ul className="space-y-4">{groups.supporting.map(renderClaim)}</ul>
        ) : (
          <details className="border-t border-border pt-4">
            <summary className="cursor-pointer text-sm font-medium">
              展开其余判断与依据（{groups.supporting.length}）
            </summary>
            <ul className="mt-4 space-y-4">
              {groups.supporting.map(renderClaim)}
            </ul>
          </details>
        )
      ) : null}
    </section>
  );
};

export default AssessmentReadingBrief;
