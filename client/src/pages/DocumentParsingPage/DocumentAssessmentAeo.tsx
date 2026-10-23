import { Button } from '@client/src/components/ui/button';
import type { CanonicalDocumentParsingPageResponse } from '@shared/api.interface';
import { AeoAuthoringWorkspace } from './AeoAuthoringWorkspace';
import { documentAssessmentAeoEligible, type DocumentAssessmentActions } from './useDocumentAssessmentActions';

export default function DocumentAssessmentAeo({ page, refreshing, actions }: {
  page: CanonicalDocumentParsingPageResponse; refreshing: boolean; actions: DocumentAssessmentActions;
}) {
  const assessment = page.workItem.integratedAssessment ?? null;
  const eligible: boolean = documentAssessmentAeoEligible(page);
  return <section aria-label="AEO 候选与门槛">
    <h2>AEO 候选</h2>
    {eligible ? assessment?.overallForAeoConfirmation ? <>
      <p>工程师确认已记录，可按原协议形成候选素材。</p>
      {!page.workItem.aeo ? <Button disabled={refreshing || actions.assessmentAction !== null}
        onClick={() => void actions.generateAeoCandidate()}>生成 AEO 候选</Button> : null}
    </> : <><p>确认仅用于后续候选素材，不构成正式采用。</p>
      <Button disabled={refreshing || actions.assessmentAction !== null}
        onClick={() => void actions.confirmOverallForAeo()}>确认当前整体综合用于 AEO 候选</Button></>
      : <p>尚不满足原 AEO 候选门槛：需要已确认的 SB、原逐项评估路径及未过期的当前整体候选。</p>}
    {page.workItem.aeo ? <AeoAuthoringWorkspace workItemId={page.workItem.workItemId}
      aeo={page.workItem.aeo} integratedAssessment={assessment} /> : null}
  </section>;
}
