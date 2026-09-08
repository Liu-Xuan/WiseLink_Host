import { useCallback, useRef, useState, type FC } from 'react';
import { getCanonicalHostClientSessionGeneration } from '@client/src/api/canonical-host';
import { useWorkbenchPanelActive } from '@client/src/features/workbench/RetainedWorkbenchPanel';

import type {
  AssessmentClaimEvidenceReadModel,
  AssessmentReadingResult,
} from '@shared/assessment-reading.interface';

import AssessmentReadingBrief from './AssessmentReadingBrief';
import ClaimEvidenceDialog from './ClaimEvidenceDialog';
import { readReadingLocation } from './reading-location';
import useReadingLocation from './useReadingLocation';
import {
  readSavedAssessmentClaim,
  type AssessmentClaimSelection,
  type DocumentAssessmentEvidence,
} from './assessment-reading';

interface SavedAssessmentReadingProps {
  result: AssessmentReadingResult;
  depth?: 'brief' | 'full';
  onLocateDocument: (evidence: DocumentAssessmentEvidence) => void;
}

const SavedAssessmentReading: FC<SavedAssessmentReadingProps> = (props) => {
  const session = getCanonicalHostClientSessionGeneration();
  const scope = props.result.scope;
  const scopeKey = `reading:${scope.kind}:${scope.kind === 'ENGINEERING_MATTER' ? scope.matterId : scope.workItemId}:${props.depth ?? 'brief'}`;
  return (
    <SavedReadingLocation
      key={`${session}:${scopeKey}`}
      {...props}
      scopeKey={scopeKey}
      session={session}
    />
  );
};

const SavedReadingLocation: FC<
  SavedAssessmentReadingProps & { scopeKey: string; session: number }
> = ({ result, depth = 'brief', onLocateDocument, scopeKey, session }) => {
  const panelActive = useWorkbenchPanelActive();
  const [initialLocation] = useState(() => readReadingLocation(scopeKey));
  const [selection, setSelection] = useState<AssessmentClaimSelection | null>(
    initialLocation?.claim ?? null,
  );
  const [focusClaimId, setFocusClaimId] = useState<string | null>(
    initialLocation?.focusClaimId ?? null,
  );
  const saveLocation = useReadingLocation(scopeKey, session, panelActive, {
    claim: selection,
    focusClaimId,
    discussionClaimId: null,
  });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const readClaim = useCallback(
    async (
      selected: AssessmentClaimSelection,
    ): Promise<AssessmentClaimEvidenceReadModel> =>
      readSavedAssessmentClaim(result, selected),
    [result],
  );
  return (
    <>
      <AssessmentReadingBrief
        result={result}
        depth={depth}
        onOpenClaim={(
          selected: AssessmentClaimSelection,
          trigger: HTMLButtonElement,
        ) => {
          triggerRef.current = trigger;
          setFocusClaimId(selected.claimId);
          setSelection(selected);
        }}
      />
      <ClaimEvidenceDialog
        selection={panelActive ? selection : null}
        readClaim={readClaim}
        returnFocus={triggerRef.current}
        returnFocusClaimId={focusClaimId}
        onClose={() => setSelection(null)}
        onLocateDocument={(evidence) => {
          saveLocation();
          setSelection(null);
          onLocateDocument(evidence);
        }}
      />
    </>
  );
};

export default SavedAssessmentReading;
