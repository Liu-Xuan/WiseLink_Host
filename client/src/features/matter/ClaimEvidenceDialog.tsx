import { useRef, useState, type FC } from 'react';

import { Button } from '@client/src/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';
import type {
  AssessmentClaimEvidenceReadModel,
  AssessmentClaimPremise,
  AssessmentEvidence,
} from '@shared/assessment-reading.interface';

import AssessmentEvidenceContext from './AssessmentEvidenceContext';
import type {
  AssessmentClaimSelection,
  DocumentAssessmentEvidence,
  ReadAssessmentClaim,
} from './assessment-reading';
import useAssessmentClaim from './useAssessmentClaim';

interface ClaimEvidenceDialogProps {
  selection: AssessmentClaimSelection | null;
  readClaim: ReadAssessmentClaim;
  onClose: () => void;
  onLocateDocument: (evidence: DocumentAssessmentEvidence) => void;
  onDiscuss?: (claim: AssessmentClaimEvidenceReadModel) => void;
  returnFocus?: HTMLElement | null;
  returnFocusClaimId?: string | null;
}

const ASSESSMENT_PREMISE_ROLE_LABELS: Record<
  AssessmentClaimPremise['role'],
  string
> = {
  SUPPORTS: '支撑判断',
  LIMITS: '限制判断',
  CONTEXT: '提供上下文',
  CONFLICTS: '与判断冲突',
};

const ClaimEvidenceDialog: FC<ClaimEvidenceDialogProps> = ({
  selection,
  readClaim,
  onClose,
  onLocateDocument,
  onDiscuss,
  returnFocus,
  returnFocusClaimId,
}) => {
  const [retry, setRetry] = useState<number>(0);
  const discussFocusRef = useRef(false);
  const { data, error, loading } = useAssessmentClaim(
    selection,
    readClaim,
    retry,
  );
  return (
    <Dialog
      open={Boolean(selection)}
      onOpenChange={(open: boolean) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] max-w-3xl overflow-y-auto"
        onCloseAutoFocus={(event: Event) => {
          if (discussFocusRef.current) {
            discussFocusRef.current = false;
            event.preventDefault();
            window.requestAnimationFrame(() => {
              const target = Array.from(
                document.querySelectorAll<HTMLElement>(
                  '.continuous-review-composer textarea:not(:disabled), [data-review-start]:not(:disabled)',
                ),
              ).find((element) => !element.closest('[inert], [hidden]'));
              (
                target ??
                document.querySelector<HTMLElement>(
                  '[data-matter-review-panel]',
                )
              )?.focus();
            });
            return;
          }
          const target: HTMLElement | undefined = returnFocus?.isConnected
            ? returnFocus
            : Array.from(
                document.querySelectorAll<HTMLButtonElement>(
                  '[data-claim-trigger]',
                ),
              ).find(
                (element: HTMLButtonElement) =>
                  element.dataset.claimTrigger === returnFocusClaimId,
              );
          if (target && !target.closest('[inert], [hidden]')) {
            event.preventDefault();
            const details: HTMLDetailsElement | null =
              target.closest('details');
            if (details) details.open = true;
            target.focus({ preventScroll: true });
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>判断及其完整前提</DialogTitle>
          <DialogDescription>
            核对所选版本的原句、各项前提的贡献和限制。这里不形成正式采用或实施决定。
          </DialogDescription>
        </DialogHeader>
        {loading ? <p role="status">正在读取这条判断的依据…</p> : null}
        {error ? (
          <div role="alert" className="space-y-3 text-sm">
            <p>{error}</p>
            <Button
              variant="outline"
              onClick={() => setRetry((value: number) => value + 1)}
            >
              重新读取
            </Button>
          </div>
        ) : null}
        {data ? (
          <div
            className="space-y-5"
            data-result-ref={data.resultRef}
            data-result-revision={data.resultRevision}
          >
            <blockquote className="whitespace-pre-wrap break-words border-l-2 border-primary/50 pl-4 text-base leading-8">
              {data.claim.text}
            </blockquote>
            <p className="text-xs text-muted-foreground">
              {data.claim.basis === 'SOURCE_FACT' ? '来源陈述' : '条件性推断'}·{' '}
              {data.claim.premises.length} 项前提
            </p>
            {data.claim.premises.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                这条判断未登记可展开的前提。
              </p>
            ) : null}
            <ol className="space-y-6">
              {data.claim.premises.map(
                (premise: AssessmentClaimPremise, index: number) => {
                  const evidence: AssessmentEvidence | undefined =
                    data.evidence.find(
                      (item: AssessmentEvidence) =>
                        item.evidenceRef === premise.evidenceRef,
                    );
                  return (
                    <li
                      key={`${premise.evidenceRef}:${index}`}
                      className="space-y-3 border-t border-border pt-4"
                    >
                      <div className="text-sm font-medium">
                        {index + 1}.{' '}
                        {ASSESSMENT_PREMISE_ROLE_LABELS[premise.role]}
                      </div>
                      <p className="whitespace-pre-wrap break-words text-sm leading-7">
                        {premise.explanation}
                      </p>
                      {premise.limitation ? (
                        <p className="whitespace-pre-wrap break-words text-sm leading-7">
                          适用限制：{premise.limitation}
                        </p>
                      ) : null}
                      {evidence ? (
                        <AssessmentEvidenceContext
                          evidence={evidence}
                          onLocateDocument={onLocateDocument}
                        />
                      ) : null}
                    </li>
                  );
                },
              )}
            </ol>
            {onDiscuss ? (
              <Button
                variant="outline"
                onClick={() => {
                  discussFocusRef.current = true;
                  onDiscuss(data);
                }}
              >
                带这条判断继续讨论
              </Button>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};

export default ClaimEvidenceDialog;
